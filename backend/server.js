const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { config, createDevelopmentSecret } = require('./config');
const { ROLES, permissionsForRole, can } = require('./access-control');
const { migrate } = require('../database/migrate');

const app = express();
app.set('trust proxy', 1);
const ROOT_DIR = config.rootDir;
const PORT = config.port;
const DATA_DIR = config.dataDir;
const BACKUP_DIR = config.backupDir;
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const database = migrate(config.databasePath);

const db = {
  async all(sql, params = []) { return database.prepare(sql).all(...params); },
  async get(sql, params = []) { return database.prepare(sql).get(...params); },
  async run(sql, params = []) {
    const r = database.prepare(sql).run(...params);
    return { insertId: Number(r.lastInsertRowid || 0), affectedRows: Number(r.changes || 0) };
  }
};

function getSessionSecret() {
  const f = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  if (config.isProduction) throw new Error('SESSION_SECRET is required in production');
  const secret = createDevelopmentSecret();
  fs.writeFileSync(f, secret, { mode: 0o600 });
  return secret;
}

function today() { return new Date().toISOString().slice(0, 10); }

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.use(session({
  name: 'sonia.sid',
  secret: config.sessionSecret || getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
  const currentUser = database.prepare('SELECT id,username,role,is_active FROM users WHERE id=?').get(req.session.user.id);
  if (!currentUser || !currentUser.is_active) {
    return req.session.destroy(() => res.status(401).json({ error: 'Account is inactive' }));
  }
  req.session.user = { id: currentUser.id, username: currentUser.username, role: currentUser.role };
  req.user = req.session.user;
  next();
}

async function audit(userId, action, tableName, recordId, oldValues = null, newValues = null) {
  await db.run('INSERT INTO audit_log(user_id,action,table_name,record_id,old_values,new_values) VALUES(?,?,?,?,?,?)', [userId || null, action, tableName, recordId || null, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null]);
}

function correctionPermission(resource) {
  return resource === 'debts' ? 'suppliers:write' : `${resource}:write`;
}

function canCorrect(req, resource, record) {
  if (can(req.user.role, '*')) return true;
  if (!can(req.user.role, correctionPermission(resource))) return false;
  if (req.user.role !== 'production_staff') return true;
  return ['production', 'feed'].includes(resource) && record.created_by === req.user.id && record.date === today();
}

async function getRecord(table, id) {
  return db.get(`SELECT * FROM ${table} WHERE id=?`, [id]);
}

async function recalculateFlockCurrentCount(flockId) {
  if (!flockId) return;
  const flock = await db.get('SELECT initial_bird_count,mortality,culls FROM flocks WHERE id=?', [flockId]);
  if (!flock) return;
  const productionMortality = await db.get('SELECT COALESCE(SUM(mortality),0) mortality FROM production WHERE flock_id=? AND is_voided=0', [flockId]);
  const current = Math.max(0, Number(flock.initial_bird_count) - Number(flock.mortality) - Number(flock.culls) - Number(productionMortality.mortality));
  await db.run('UPDATE flocks SET current_bird_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [current, flockId]);
}

async function resolveActiveSupplier(body) {
  if (!body.supplier_id) return;
  const supplier = await db.get('SELECT id,name,status FROM suppliers WHERE id=? AND is_voided=0', [body.supplier_id]);
  if (!supplier || supplier.status !== 'Active') throw new Error('Select an active supplier');
  body.supplier_id = supplier.id;
  body.supplier = supplier.name;
}

async function resolveActiveFlock(body) {
  if (!body.flock_id) return;
  const flock = await db.get("SELECT id,batch,status,is_voided FROM flocks WHERE id=? AND is_voided=0 AND status='Active'", [body.flock_id]);
  if (!flock) throw new Error('Select an active flock');
  body.flock_id = flock.id;
}

async function resolveActiveCustomer(body) {
  if (!body.customer_id) return;
  const customer = await db.get("SELECT id,name,status,is_voided FROM customers WHERE id=? AND is_voided=0 AND status='Active'", [body.customer_id]);
  if (!customer) throw new Error('Select an active customer');
  body.customer_id = customer.id;
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (can(req.user?.role, permission)) return next();
    void audit(req.user?.id, `denied:${permission}`, 'authorization', null);
    return res.status(403).json({ error: 'Forbidden' });
  };
}

const adminUser = config.adminUsername;

async function ensureAdmin() {
  const existing = await db.get('SELECT id FROM users WHERE username=?', [adminUser]);
  if (!existing) {
    if (config.isProduction && !config.adminPassword) throw new Error('ADMIN_PASSWORD is required in production');
    const adminPass = config.adminPassword || createDevelopmentSecret();
    await db.run('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)', [adminUser, bcrypt.hashSync(adminPass, 12), 'admin']);
    if (!config.adminPassword) {
      fs.writeFileSync(path.join(DATA_DIR, 'FIRST_LOGIN.txt'), `Sonia 4.0 First Login\r\nUsername: ${adminUser}\r\nPassword: ${adminPass}\r\n\r\nFor security, create your own administrator account after login, sign in with it, then remove the default admin account.\r\n`);
      console.log(`Development administrator created. Credentials are in ${path.join(DATA_DIR, 'FIRST_LOGIN.txt')}`);
    }
  }
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, otp } = req.body || {};
    const u = await db.get('SELECT * FROM users WHERE username=?', [username || '']);
    if (!u || !u.is_active || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
    if (u.totp_enabled) {
      if (!otp) return res.json({ requires2fa: true });
      let ok = false;
      try { ok = verifySync({ token: String(otp), secret: u.totp_secret }).valid; } catch {}
      if (!ok) return res.status(401).json({ error: 'Invalid two-factor code' });
    }
    req.session.user = { id: u.id, username: u.username, role: u.role };
    // Persist the session before the browser immediately requests dashboard data.
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Unable to create login session' });
      res.json({ ok: true, user: req.session.user, permissions: permissionsForRole(u.role) });
    });
  } catch (e) { res.status(500).json({ error: 'Login service error' }); }
});

app.post('/api/auth/logout', auth, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null, permissions: [] });
  auth(req, res, () => res.json({ user: req.session.user, permissions: permissionsForRole(req.user.role) }));
});

app.post('/api/auth/2fa/setup', auth, async (req, res) => {
  try {
    const u = await db.get('SELECT * FROM users WHERE id=?', [req.session.user.id]);
    if (u.totp_enabled) return res.status(400).json({ error: '2FA already enabled' });
    const secret = generateSecret();
    const uri = generateURI({ issuer: 'Sonia 4.0 Farm', label: u.username, secret });
    req.session.pendingTotp = secret;
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri) });
  } catch (e) { res.status(500).json({ error: 'Unable to start 2FA setup' }); }
});

app.post('/api/auth/2fa/confirm', auth, async (req, res) => {
  try {
    const { token } = req.body || {};
    const secret = req.session.pendingTotp;
    if (!secret) return res.status(400).json({ error: 'Start 2FA setup first' });
    let ok = false;
    try { ok = verifySync({ token: String(token), secret }).valid; } catch {}
    if (!ok) return res.status(400).json({ error: 'Invalid code' });
    await db.run('UPDATE users SET totp_secret=?,totp_enabled=1 WHERE id=?', [secret, req.session.user.id]);
    delete req.session.pendingTotp;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Unable to confirm 2FA' }); }
});

app.get('/api/dashboard', auth, requirePermission('dashboard:read'), async (req, res) => {
  try {
    const flocks = await db.all('SELECT * FROM flocks WHERE is_voided=0 ORDER BY id DESC');
    const feed = await db.all('SELECT * FROM feed_entries WHERE is_voided=0 ORDER BY date DESC,id DESC');
    const prod = await db.all('SELECT * FROM production WHERE is_voided=0 ORDER BY date DESC,id DESC');
    const purchases = await db.all('SELECT * FROM purchases WHERE is_voided=0 ORDER BY date DESC,id DESC');
    const sales = await db.all("SELECT s.*,c.name customer,c.customer_code FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.is_voided=0 ORDER BY s.date DESC,s.id DESC");
    const debts = await db.all('SELECT *,opening_debt+feed_credit+other_credit-paid remaining FROM supplier_debts WHERE is_voided=0 ORDER BY supplier');
    const alive = flocks.reduce((a, f) => a + Number(f.current_bird_count ?? Math.max(0, Number(f.received) - Number(f.mortality) - Number(f.culls))), 0);
    const mortality = flocks.reduce((a, f) => a + Number(f.mortality) + Number(f.culls), 0) + prod.reduce((a, p) => a + Number(p.mortality), 0);
    const consumed = feed.reduce((a, f) => a + Number(f.consumed_kg), 0);
    const feedCost = feed.reduce((a, f) => a + Number(f.consumed_kg) * Number(f.cost_per_kg), 0);
    const purchaseCost = purchases.reduce((a, p) => a + Number(p.quantity) * Number(p.unit_cost), 0);
    const revenue = sales.reduce((a, s) => a + Number(s.total), 0);
    const eggs = prod.reduce((a, p) => a + Number(p.trays) * 30 + Number(p.loose_eggs), 0);
    const productionOnly = req.user.role === 'production_staff';
    res.json({ metrics: { alive, mortality, consumed, feedCost, purchaseCost: productionOnly ? 0 : purchaseCost, revenue: productionOnly ? 0 : revenue, profit: productionOnly ? 0 : revenue - purchaseCost, eggs, debt: productionOnly ? 0 : debts.reduce((a, d) => a + Math.max(0, Number(d.remaining)), 0) }, flocks, feed, prod, purchases: productionOnly ? [] : purchases, sales: productionOnly ? [] : sales, debts: productionOnly ? [] : debts, firstEgg: config.firstEggDate });
  } catch (e) { res.status(500).json({ error: 'Dashboard service error' }); }
});

const resources = {
  flocks: { table: 'flocks', fields: ['batch','breed','placement_date','date_received','initial_bird_count','received','current_bird_count','status','supplier','cost_per_chick','house','mortality','culls','notes'] },
  feed: { table: 'feed_entries', fields: ['type','supplier_id','supplier','received_kg','total_cost','cost_per_kg','consumed_kg','date','flock_id','notes'] },
  purchases: { table: 'purchases', fields: ['category','item','supplier_id','supplier','reference','date','quantity','unit_cost','payment_status','amount_paid','notes'] },
  expenses: { table: 'expenses', fields: ['category','item','date','amount','notes'] },
  production: { table: 'production', fields: ['date','flock_id','trays','loose_eggs','mortality','notes'] },
  customers: { table: 'customers', fields: ['name','phone','email','location','status','notes'] },
  sales: { table: 'sales', fields: ['date','customer_id','type','quantity','price_per_tray','total','payment_status','amount_paid','notes'] },
  debts: { table: 'supplier_debts', fields: ['supplier','opening_debt','feed_credit','other_credit','paid','notes'] }
};

for (const [name, r] of Object.entries(resources)) {
  const permissionName = name === 'debts' ? 'suppliers' : name;
  app.get('/api/' + name, auth, requirePermission(`${permissionName}:read`), async (req, res) => {
    try {
      const includeVoided = req.query.include_voided === '1';
      const activeOnly = req.query.active_only === '1';
      const conditions = [];
      if (!includeVoided) conditions.push('is_voided=0');
      if (activeOnly && ['flocks', 'customers'].includes(name)) conditions.push("status='Active'");
      const filter = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
      if (name === 'production') return res.json(await db.all(`SELECT p.*,f.batch flock_batch FROM production p LEFT JOIN flocks f ON f.id=p.flock_id${includeVoided ? '' : ' WHERE p.is_voided=0'} ORDER BY p.id DESC`));
      if (name === 'sales') return res.json(await db.all(`SELECT s.*,c.name customer,c.customer_code FROM sales s LEFT JOIN customers c ON c.id=s.customer_id${includeVoided ? '' : ' WHERE s.is_voided=0'} ORDER BY s.id DESC`));
      res.json(await db.all(`SELECT * FROM ${r.table}${filter} ORDER BY id DESC`));
    }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/' + name, auth, requirePermission(`${permissionName}:write`), async (req, res) => {
    const body = req.body || {};
    try {
      if (name === 'debts') {
        await resolveActiveSupplier(body);
        const existing = await db.get('SELECT * FROM supplier_debts WHERE supplier_id=? OR (supplier_id IS NULL AND supplier=?)', [body.supplier_id || null, body.supplier || '']);
        if (existing) {
          await db.run('UPDATE supplier_debts SET supplier_id=?,supplier=?,feed_credit=feed_credit+?, other_credit=other_credit+?, paid=paid+?, notes=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [body.supplier_id || existing.supplier_id, body.supplier || existing.supplier, Number(body.feed_credit || 0), Number(body.other_credit || 0), Number(body.paid || 0), body.notes || existing.notes, req.user.id, existing.id]);
          await audit(req.user.id, 'update', r.table, existing.id);
          return res.json({ id: existing.id });
        }
        const result = await db.run('INSERT INTO supplier_debts(supplier_id,supplier,opening_debt,feed_credit,other_credit,paid,notes,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)', [body.supplier_id || null, body.supplier, Number(body.opening_debt || 0), Number(body.feed_credit || 0), Number(body.other_credit || 0), Number(body.paid || 0), body.notes || '', req.user.id, req.user.id, new Date().toISOString()]);
        await db.run('UPDATE supplier_debts SET supplier_code=? WHERE id=?', [`SUP-${String(result.insertId).padStart(4,'0')}`, result.insertId]);
        await audit(req.user.id, 'create', r.table, result.insertId);
        return res.json({ id: result.insertId });
      }
      if (name === 'flocks') {
        body.batch = String(body.batch || '').trim();
        body.breed = String(body.breed || '').trim();
        body.placement_date = body.placement_date || body.date_received || today();
        body.date_received = body.placement_date;
        body.initial_bird_count = Number(body.initial_bird_count ?? body.received ?? 0);
        if (!body.batch || !body.breed || !body.initial_bird_count || body.initial_bird_count < 1) return res.status(400).json({ error: 'Batch, breed, and initial bird count are required' });
        body.received = body.initial_bird_count;
        body.current_bird_count = body.initial_bird_count;
        body.status = body.status === 'Closed' ? 'Closed' : 'Active';
      }
      if (name === 'customers') {
        body.name = String(body.name || '').trim();
        body.status = body.status === 'Inactive' ? 'Inactive' : 'Active';
        if (!body.name) return res.status(400).json({ error: 'Customer name is required' });
      }
      if (name === 'feed') {
        await resolveActiveFlock(body);
        await resolveActiveSupplier(body);
        body.received_kg = Number(body.received_kg || 0);
        body.total_cost = Number(body.total_cost || 0);
        body.cost_per_kg = body.received_kg > 0 ? body.total_cost / body.received_kg : 0;
      }
      if (name === 'sales') {
        await resolveActiveCustomer(body);
        body.type = 'Eggs';
        body.quantity = Number(body.quantity || 0);
        const pricing = await db.get('SELECT value FROM pricing WHERE name=?', ['egg_tray']);
        body.price_per_tray = can(req.user.role, 'pricing:manage') && body.price_per_tray !== undefined
          ? Number(body.price_per_tray || 0)
          : Number(pricing?.value || 0);
        body.total = body.quantity * body.price_per_tray;
      }
      if (name === 'purchases') await resolveActiveSupplier(body);
      if (name === 'production') await resolveActiveFlock(body);
      const numericDefaults = ['received','cost_per_chick','mortality','culls','received_kg','total_cost','cost_per_kg','consumed_kg','trays','loose_eggs','birds_sold','avg_weight_kg','quantity','weight_kg','total','amount_paid','opening_debt','feed_credit','other_credit','paid','amount'];
      const vals = r.fields.map(f => body[f] ?? (f === 'date' ? today() : numericDefaults.includes(f) ? 0 : f === 'payment_status' ? 'Paid' : null));
      const placeholders = r.fields.map(() => '?').join(',');
      const result = await db.run(`INSERT INTO ${r.table} (${r.fields.join(',')}) VALUES (${placeholders})`, vals);
      if (name === 'customers') await db.run(`UPDATE customers SET customer_code=? WHERE id=?`, [`CUS-${String(result.insertId).padStart(4,'0')}`, result.insertId]);
      await db.run(`UPDATE ${r.table} SET created_by=?,updated_by=?,created_at=COALESCE(created_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?`, [req.user.id, req.user.id, result.insertId]);
      if (name === 'expenses') await db.run('UPDATE expenses SET created_by=? WHERE id=?', [req.user.id, result.insertId]);
      const created = await getRecord(r.table, result.insertId);
      await audit(req.user.id, 'create', r.table, result.insertId, null, created);
      if (name === 'production') await recalculateFlockCurrentCount(body.flock_id);
      res.json({ id: result.insertId });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.put('/api/' + name + '/:id', auth, requirePermission(`${permissionName}:write`), async (req, res) => {
    const body = req.body || {};
    try {
      const before = await getRecord(r.table, req.params.id);
      if (!before) return res.status(404).json({ error: 'Record not found' });
      if (before.is_voided) return res.status(400).json({ error: 'Voided records cannot be edited' });
      if (!canCorrect(req, name, before)) {
        await audit(req.user.id, 'denied:edit', r.table, req.params.id, before, null);
        return res.status(403).json({ error: 'You cannot edit this record' });
      }
      if (name === 'flocks') {
        delete body.current_bird_count;
        if (body.status !== undefined && !['Active', 'Closed'].includes(body.status)) return res.status(400).json({ error: 'Invalid flock status' });
      }
      if (name === 'customers' && body.status !== undefined && !['Active', 'Inactive'].includes(body.status)) return res.status(400).json({ error: 'Invalid customer status' });
      if (name === 'production') await resolveActiveFlock(body);
      if (name === 'sales') await resolveActiveCustomer(body);
      if (name === 'sales') {
        const pricing = await db.get('SELECT value FROM pricing WHERE name=?', ['egg_tray']);
        body.price_per_tray = can(req.user.role, 'pricing:manage') && body.price_per_tray !== undefined
          ? Number(body.price_per_tray || 0)
          : Number(pricing?.value ?? before.price_per_tray ?? 0);
        if (body.quantity !== undefined || body.price_per_tray !== undefined) {
          body.total = Number(body.quantity ?? before.quantity ?? 0) * body.price_per_tray;
        }
      }
      const fields = r.fields.filter(f => body[f] !== undefined);
      if (!fields.length) return res.json({ ok: true });
      await db.run(`UPDATE ${r.table} SET ${fields.map(f => f + '=?').join(',')},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [...fields.map(f => body[f]), req.user.id, req.params.id]);
      const after = await getRecord(r.table, req.params.id);
      await audit(req.user.id, 'update', r.table, req.params.id, before, after);
      if (name === 'production') await recalculateFlockCurrentCount(after.flock_id);
      if (name === 'flocks') await recalculateFlockCurrentCount(req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/' + name + '/:id/void', auth, requirePermission(`${permissionName}:write`), async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A void reason is required' });
    try {
      const before = await getRecord(r.table, req.params.id);
      if (!before) return res.status(404).json({ error: 'Record not found' });
      if (before.is_voided) return res.status(400).json({ error: 'Record is already voided' });
      if (!canCorrect(req, name, before)) {
        await audit(req.user.id, 'denied:void', r.table, req.params.id, before, null);
        return res.status(403).json({ error: 'You cannot void this record' });
      }
      await db.run(`UPDATE ${r.table} SET is_voided=1,voided_by=?,voided_at=CURRENT_TIMESTAMP,void_reason=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [req.user.id, reason, req.user.id, req.params.id]);
      const after = await getRecord(r.table, req.params.id);
      await audit(req.user.id, 'void', r.table, req.params.id, before, after);
      if (name === 'production') await recalculateFlockCurrentCount(before.flock_id);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}

app.get('/api/suppliers', auth, requirePermission('suppliers:read'), async (req, res) => {
  try {
    const conditions = ["is_voided=0"];
    if (req.query.active_only === '1') conditions.push("status='Active'");
    const suppliers = await db.all(`SELECT s.*,
      COALESCE((SELECT SUM(opening_debt+feed_credit+other_credit-paid) FROM supplier_debts d WHERE d.supplier_id=s.id AND d.is_voided=0),0) outstanding_balance
      FROM suppliers s WHERE ${conditions.join(' AND ')} ORDER BY s.name`);
    res.json(suppliers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/suppliers/:id/history', auth, requirePermission('suppliers:read'), async (req, res) => {
  try {
    const supplier = await db.get('SELECT * FROM suppliers WHERE id=? AND is_voided=0', [req.params.id]);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    const purchases = await db.all('SELECT * FROM purchases WHERE is_voided=0 AND (supplier_id=? OR (supplier_id IS NULL AND supplier=?)) ORDER BY date DESC,id DESC', [supplier.id, supplier.name]);
    const feed = await db.all('SELECT * FROM feed_entries WHERE is_voided=0 AND (supplier_id=? OR (supplier_id IS NULL AND supplier=?)) ORDER BY date DESC,id DESC', [supplier.id, supplier.name]);
    const debt = await db.get('SELECT COALESCE(SUM(opening_debt+feed_credit+other_credit-paid),0) outstanding_balance FROM supplier_debts WHERE is_voided=0 AND (supplier_id=? OR (supplier_id IS NULL AND supplier=?))', [supplier.id, supplier.name]);
    res.json({ supplier, purchases, feed, outstanding_balance: Number(debt.outstanding_balance || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/suppliers', auth, requirePermission('suppliers:write'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Supplier name is required' });
  try {
    const result = await db.run('INSERT INTO suppliers(supplier_code,name,phone,location,products,status,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)', ['PENDING', name, body.phone || null, body.location || null, body.products || null, body.status === 'Inactive' ? 'Inactive' : 'Active', req.user.id, req.user.id]);
    const code = `SUP-${String(result.insertId).padStart(4, '0')}`;
    await db.run('UPDATE suppliers SET supplier_code=? WHERE id=?', [code, result.insertId]);
    const created = await getRecord('suppliers', result.insertId);
    await audit(req.user.id, 'create', 'suppliers', result.insertId, null, created);
    res.json({ id: result.insertId, supplier_code: code });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/suppliers/:id', auth, requirePermission('suppliers:write'), async (req, res) => {
  const before = await getRecord('suppliers', req.params.id);
  if (!before) return res.status(404).json({ error: 'Supplier not found' });
  const fields = ['name', 'phone', 'location', 'products', 'status'].filter(field => req.body?.[field] !== undefined);
  if (!fields.length) return res.status(400).json({ error: 'No supplier changes supplied' });
  if (req.body.status !== undefined && !['Active', 'Inactive'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid supplier status' });
  try {
    await db.run(`UPDATE suppliers SET ${fields.map(field => `${field}=?`).join(',')},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [...fields.map(field => req.body[field]), req.user.id, req.params.id]);
    const after = await getRecord('suppliers', req.params.id);
    await audit(req.user.id, 'update', 'suppliers', req.params.id, before, after);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/pricing', auth, requirePermission('pricing:read'), async (req, res) => {
  try { res.json(await db.all('SELECT name,value,updated_at FROM pricing ORDER BY name')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/pricing/:name', auth, requirePermission('pricing:manage'), async (req, res) => {
  const value = Number(req.body?.value);
  if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'Pricing value must be a non-negative number' });
  try {
    const result = await db.run('UPDATE pricing SET value=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE name=?', [value, req.user.id, req.params.name]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Pricing item not found' });
    await audit(req.user.id, 'update', 'pricing', req.params.name);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/audit-log', auth, requirePermission('audit:read'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    res.json(await db.all(`SELECT a.id,a.action,a.table_name,a.record_id,a.old_values,a.new_values,a.timestamp,u.username
      FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
      ORDER BY a.id DESC LIMIT ${limit}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users', auth, requirePermission('users:manage'), async (req, res) => {
  try { res.json(await db.all('SELECT id,username,role,is_active,totp_enabled,created_at FROM users ORDER BY id')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/users', auth, requirePermission('users:manage'), async (req, res) => {
  const { username, password, role: rl = 'manager' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!Object.values(ROLES).includes(rl)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const result = await db.run('INSERT INTO users(username,password_hash,role,is_active,created_by) VALUES(?,?,?,1,?)', [username, bcrypt.hashSync(password, 12), rl, req.user.id]);
    await audit(req.user.id, 'create', 'users', result.insertId);
    res.json({ id: result.insertId });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/users/:id', auth, requirePermission('users:manage'), async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });
  if (userId === req.user.id && req.body?.is_active === false) return res.status(400).json({ error: 'Cannot deactivate yourself' });
  const fields = [];
  const values = [];
  if (req.body?.is_active !== undefined) { fields.push('is_active=?'); values.push(req.body.is_active ? 1 : 0); }
  if (req.body?.role !== undefined && Object.values(ROLES).includes(req.body.role)) { fields.push('role=?'); values.push(req.body.role); }
  if (!fields.length) return res.status(400).json({ error: 'No user changes supplied' });
  try {
    values.push(userId);
    const result = await db.run(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);
    if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
    await audit(req.user.id, 'update', 'users', userId);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/report.pdf', auth, requirePermission('reports:read'), async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM production WHERE is_voided=0 ORDER BY date DESC');
    const flocks = await db.all('SELECT * FROM flocks WHERE is_voided=0');
    const feed = await db.all('SELECT * FROM feed_entries WHERE is_voided=0');
    const purchases = await db.all('SELECT * FROM purchases WHERE is_voided=0');
    const sales = await db.all('SELECT s.*,c.name customer FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.is_voided=0');
    const debts = await db.all('SELECT *,opening_debt+feed_credit+other_credit-paid remaining FROM supplier_debts WHERE is_voided=0');
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="sonia-4-farm-report.pdf"');
    doc.pipe(res);
    doc.fontSize(20).fillColor('#0d684b').text('Sonia 4.0 Farm');
    doc.fontSize(10).fillColor('#333').text('Poultry Farm Management Report');
    doc.text('Generated: ' + new Date().toLocaleString());
    doc.moveDown();
    const metric = (label, val) => doc.fontSize(11).fillColor('#333').text(`${label}: ${val}`);
    metric('Current flock', flocks.reduce((a, f) => a + Number(f.received) - Number(f.mortality) - Number(f.culls), 0));
    metric('Eggs produced', data.reduce((a, p) => a + Number(p.trays) * 30 + Number(p.loose_eggs), 0));
    metric('Feed consumed', feed.reduce((a, f) => a + Number(f.consumed_kg), 0).toFixed(1) + ' kg');
    metric('Purchases', purchases.reduce((a, p) => a + Number(p.quantity) * Number(p.unit_cost), 0).toLocaleString() + ' KES');
    metric('Sales', sales.reduce((a, s) => a + Number(s.total), 0).toLocaleString() + ' KES');
    metric('Supplier debt', debts.reduce((a, d) => a + Math.max(0, Number(d.remaining)), 0).toLocaleString() + ' KES');
    doc.moveDown();
    doc.fontSize(14).fillColor('#0d684b').text('Production');
    doc.fontSize(9).fillColor('#222');
    data.slice(0, 40).forEach(p => doc.text(`${p.date} | ${p.trays} trays + ${p.loose_eggs} eggs | mortality ${p.mortality}`));
    doc.addPage();
    doc.fontSize(14).fillColor('#0d684b').text('Supplier Debt');
    doc.fontSize(9).fillColor('#222');
    debts.forEach(d => doc.text(`${d.supplier}: opening ${d.opening_debt}, feed credit ${d.feed_credit}, paid ${d.paid}, remaining ${d.remaining}`));
    doc.end();
  } catch (e) { res.status(500).json({ error: 'Unable to generate report' }); }
});

app.get('/api/production-report.pdf', auth, requirePermission('reports:read'), async (req, res) => {
  try {
    const production = await db.all(`SELECT p.*, f.batch flock_batch, f.breed
      FROM production p
      LEFT JOIN flocks f ON f.id=p.flock_id
      WHERE p.is_voided=0
      ORDER BY p.date DESC, p.id DESC`);
    const eggs = production.reduce((sum, row) => sum + Number(row.trays || 0) * 30 + Number(row.loose_eggs || 0), 0);
    const mortality = production.reduce((sum, row) => sum + Number(row.mortality || 0), 0);
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="sonia-4-production-output.pdf"');
    doc.pipe(res);
    doc.fontSize(20).fillColor('#0d684b').text('Sonia 4.0 Farm');
    doc.fontSize(13).fillColor('#333').text('Production Output Report');
    doc.fontSize(10).text('Generated: ' + new Date().toLocaleString());
    doc.moveDown();
    doc.fontSize(11).text(`Production records: ${production.length}`);
    doc.text(`Eggs produced: ${eggs.toLocaleString()}`);
    doc.text(`Mortality recorded: ${mortality.toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(12).fillColor('#0d684b').text('Production Records');
    doc.fontSize(9).fillColor('#222');
    if (!production.length) doc.text('No production records have been recorded.');
    production.forEach(row => {
      const eggsForRow = Number(row.trays || 0) * 30 + Number(row.loose_eggs || 0);
      doc.text(`${row.date} | ${row.flock_batch || 'No flock'}${row.breed ? ` (${row.breed})` : ''} | ${row.trays || 0} trays + ${row.loose_eggs || 0} loose eggs = ${eggsForRow} eggs | mortality ${row.mortality || 0}`);
    });
    doc.end();
  } catch (e) { res.status(500).json({ error: 'Unable to generate production report' }); }
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'sonia-4-farm' }));
app.use(express.static(path.join(ROOT_DIR, 'frontend')));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(ROOT_DIR, 'frontend', 'index.html')));

async function start() {
  await ensureAdmin();
  app.listen(PORT, '0.0.0.0', () => console.log(`Sonia 4.0 Farm listening on ${PORT}`));
}
start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
