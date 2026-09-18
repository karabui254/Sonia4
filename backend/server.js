require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const session = require('express-session');
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
const ROOT_DIR = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT_DIR, 'data');
const BACKUP_DIR = path.join(ROOT_DIR, 'backups');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const database = new DatabaseSync(path.join(DATA_DIR, 'sonia4.db'));
database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

function initDb() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager',
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS flocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch TEXT NOT NULL UNIQUE,
      breed TEXT,
      received INTEGER NOT NULL DEFAULT 0,
      date_received TEXT,
      supplier TEXT,
      cost_per_chick REAL NOT NULL DEFAULT 0,
      house TEXT,
      mortality INTEGER NOT NULL DEFAULT 0,
      culls INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS feed_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('Chick Mash','Growers','Layers')),
      supplier TEXT,
      received_kg REAL NOT NULL DEFAULT 0,
      cost_per_kg REAL NOT NULL DEFAULT 0,
      consumed_kg REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      flock_id INTEGER,
      notes TEXT,
      FOREIGN KEY (flock_id) REFERENCES flocks(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feed_date ON feed_entries(date);
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      item TEXT NOT NULL,
      supplier TEXT,
      reference TEXT,
      date TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'Paid',
      amount_paid REAL NOT NULL DEFAULT 0,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_date ON purchases(date);
    CREATE TABLE IF NOT EXISTS production (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      flock_id INTEGER,
      trays INTEGER NOT NULL DEFAULT 0,
      loose_eggs INTEGER NOT NULL DEFAULT 0,
      birds_sold INTEGER NOT NULL DEFAULT 0,
      avg_weight_kg REAL NOT NULL DEFAULT 0,
      mortality INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (flock_id) REFERENCES flocks(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_production_date ON production(date);
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      location TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      customer_id INTEGER,
      type TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      weight_kg REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'Paid',
      amount_paid REAL NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
    CREATE TABLE IF NOT EXISTS supplier_debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT NOT NULL UNIQUE,
      opening_debt REAL NOT NULL DEFAULT 0,
      feed_credit REAL NOT NULL DEFAULT 0,
      other_credit REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      notes TEXT
    );
  `);
  // Safe upgrades for existing Sonia 4.0 SQLite databases.
  const migrations = [
    ['customers','customer_code','TEXT'],
    ['supplier_debts','supplier_code','TEXT'],
    ['feed_entries','total_cost','REAL NOT NULL DEFAULT 0'],
    ['sales','price_per_tray','REAL NOT NULL DEFAULT 0']
  ];
  for (const [table,col,type] of migrations) {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name);
    if (!cols.includes(col)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  database.exec(`UPDATE customers SET customer_code='CUS-' || printf('%04d',id) WHERE customer_code IS NULL OR customer_code='';`);
  database.exec(`UPDATE supplier_debts SET supplier_code='SUP-' || printf('%04d',id) WHERE supplier_code IS NULL OR supplier_code='';`);
  database.exec(`UPDATE feed_entries SET total_cost=received_kg*cost_per_kg WHERE total_cost=0 AND received_kg>0 AND cost_per_kg>0;`);
}

const db = {
  async all(sql, params = []) { return database.prepare(sql).all(...params); },
  async get(sql, params = []) { return database.prepare(sql).get(...params); },
  async run(sql, params = []) {
    const r = database.prepare(sql).run(...params);
    return { insertId: Number(r.lastInsertRowid || 0), affectedRows: Number(r.changes || 0) };
  }
};

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
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
  secret: process.env.SESSION_SECRET || getSessionSecret(),
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
  next();
}
function role(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Insufficient permission' });
    next();
  };
}

const adminUser = process.env.ADMIN_USERNAME || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'Sonia4@2026!';

async function ensureAdmin() {
  const existing = await db.get('SELECT id FROM users WHERE username=?', [adminUser]);
  if (!existing) {
    await db.run('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)', [adminUser, bcrypt.hashSync(adminPass, 12), 'admin']);
    fs.writeFileSync(path.join(ROOT_DIR, 'FIRST_LOGIN.txt'), `Sonia 4.0 First Login\r\nUsername: ${adminUser}\r\nPassword: ${adminPass}\r\n\r\nFor security, create your own administrator account after login, sign in with it, then remove the default admin account.\r\n`);
  }
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, otp } = req.body || {};
    const u = await db.get('SELECT * FROM users WHERE username=?', [username || '']);
    if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
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
      res.json({ ok: true, user: req.session.user });
    });
  } catch (e) { res.status(500).json({ error: 'Login service error' }); }
});

app.post('/api/auth/logout', auth, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));

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

app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const flocks = await db.all('SELECT * FROM flocks ORDER BY id DESC');
    const feed = await db.all('SELECT * FROM feed_entries ORDER BY date DESC,id DESC');
    const prod = await db.all('SELECT * FROM production ORDER BY date DESC,id DESC');
    const purchases = await db.all('SELECT * FROM purchases ORDER BY date DESC,id DESC');
    const sales = await db.all("SELECT s.*,c.name customer,c.customer_code FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.date DESC,s.id DESC");
    const debts = await db.all('SELECT *,opening_debt+feed_credit+other_credit-paid remaining FROM supplier_debts ORDER BY supplier');
    const alive = flocks.reduce((a, f) => a + Math.max(0, Number(f.received) - Number(f.mortality) - Number(f.culls)), 0);
    const mortality = flocks.reduce((a, f) => a + Number(f.mortality) + Number(f.culls), 0) + prod.reduce((a, p) => a + Number(p.mortality), 0);
    const consumed = feed.reduce((a, f) => a + Number(f.consumed_kg), 0);
    const feedCost = feed.reduce((a, f) => a + Number(f.consumed_kg) * Number(f.cost_per_kg), 0);
    const purchaseCost = purchases.reduce((a, p) => a + Number(p.quantity) * Number(p.unit_cost), 0);
    const revenue = sales.reduce((a, s) => a + Number(s.total), 0);
    const eggs = prod.reduce((a, p) => a + Number(p.trays) * 30 + Number(p.loose_eggs), 0);
    res.json({ metrics: { alive, mortality, consumed, feedCost, purchaseCost, revenue, profit: revenue - purchaseCost, eggs, debt: debts.reduce((a, d) => a + Math.max(0, Number(d.remaining)), 0) }, flocks, feed, prod, purchases, sales, debts, firstEgg: process.env.FIRST_EGG_DATE || '2025-08-14' });
  } catch (e) { res.status(500).json({ error: 'Dashboard service error' }); }
});

const resources = {
  flocks: { table: 'flocks', fields: ['batch','breed','received','date_received','supplier','cost_per_chick','house','mortality','culls','notes'] },
  feed: { table: 'feed_entries', fields: ['type','supplier','received_kg','total_cost','cost_per_kg','consumed_kg','date','flock_id','notes'] },
  purchases: { table: 'purchases', fields: ['category','item','supplier','reference','date','quantity','unit_cost','payment_status','amount_paid','notes'] },
  production: { table: 'production', fields: ['date','flock_id','trays','loose_eggs','mortality','notes'] },
  customers: { table: 'customers', fields: ['name','phone','location','notes'] },
  sales: { table: 'sales', fields: ['date','customer_id','type','quantity','price_per_tray','total','payment_status','amount_paid','notes'] },
  debts: { table: 'supplier_debts', fields: ['supplier','opening_debt','feed_credit','other_credit','paid','notes'] }
};

for (const [name, r] of Object.entries(resources)) {
  app.get('/api/' + name, auth, async (req, res) => {
    try {
      if (name === 'production') return res.json(await db.all('SELECT p.*,f.batch flock_batch FROM production p LEFT JOIN flocks f ON f.id=p.flock_id ORDER BY p.id DESC'));
      if (name === 'sales') return res.json(await db.all('SELECT s.*,c.name customer,c.customer_code FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC'));
      res.json(await db.all(`SELECT * FROM ${r.table} ORDER BY id DESC`));
    }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/' + name, auth, async (req, res) => {
    const body = req.body || {};
    try {
      if (name === 'debts') {
        const existing = await db.get('SELECT * FROM supplier_debts WHERE supplier=?', [body.supplier || '']);
        if (existing) {
          await db.run('UPDATE supplier_debts SET feed_credit=feed_credit+?, other_credit=other_credit+?, paid=paid+?, notes=? WHERE id=?', [Number(body.feed_credit || 0), Number(body.other_credit || 0), Number(body.paid || 0), body.notes || existing.notes, existing.id]);
          return res.json({ id: existing.id });
        }
        const result = await db.run('INSERT INTO supplier_debts(supplier,opening_debt,feed_credit,other_credit,paid,notes) VALUES(?,?,?,?,?,?)', [body.supplier, Number(body.opening_debt || 0), Number(body.feed_credit || 0), Number(body.other_credit || 0), Number(body.paid || 0), body.notes || '']);
        await db.run('UPDATE supplier_debts SET supplier_code=? WHERE id=?', [`SUP-${String(result.insertId).padStart(4,'0')}`, result.insertId]);
        return res.json({ id: result.insertId });
      }
      if (name === 'feed') {
        body.received_kg = Number(body.received_kg || 0);
        body.total_cost = Number(body.total_cost || 0);
        body.cost_per_kg = body.received_kg > 0 ? body.total_cost / body.received_kg : 0;
      }
      if (name === 'sales') {
        body.type = 'Eggs';
        body.quantity = Number(body.quantity || 0);
        body.price_per_tray = Number(body.price_per_tray || 0);
        body.total = body.quantity * body.price_per_tray;
      }
      const vals = r.fields.map(f => body[f] ?? (f === 'date' ? today() : 0));
      const placeholders = r.fields.map(() => '?').join(',');
      const result = await db.run(`INSERT INTO ${r.table} (${r.fields.join(',')}) VALUES (${placeholders})`, vals);
      if (name === 'customers') await db.run(`UPDATE customers SET customer_code=? WHERE id=?`, [`CUS-${String(result.insertId).padStart(4,'0')}`, result.insertId]);
      res.json({ id: result.insertId });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.put('/api/' + name + '/:id', auth, async (req, res) => {
    const body = req.body || {};
    const fields = r.fields.filter(f => body[f] !== undefined);
    if (!fields.length) return res.json({ ok: true });
    try {
      await db.run(`UPDATE ${r.table} SET ${fields.map(f => f + '=?').join(',')} WHERE id=?`, [...fields.map(f => body[f]), req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/' + name + '/:id', auth, role('admin'), async (req, res) => {
    try { await db.run(`DELETE FROM ${r.table} WHERE id=?`, [req.params.id]); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
}

app.get('/api/users', auth, role('admin'), async (req, res) => {
  try { res.json(await db.all('SELECT id,username,role,totp_enabled,created_at FROM users ORDER BY id')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/users', auth, role('admin'), async (req, res) => {
  const { username, password, role: rl = 'manager' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const result = await db.run('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)', [username, bcrypt.hashSync(password, 12), rl]);
    res.json({ id: result.insertId });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/users/:id', auth, role('admin'), async (req, res) => {
  if (Number(req.params.id) === req.session.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  try { await db.run('DELETE FROM users WHERE id=?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/report.pdf', auth, async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM production ORDER BY date DESC');
    const flocks = await db.all('SELECT * FROM flocks');
    const feed = await db.all('SELECT * FROM feed_entries');
    const purchases = await db.all('SELECT * FROM purchases');
    const sales = await db.all('SELECT s.*,c.name customer FROM sales s LEFT JOIN customers c ON c.id=s.customer_id');
    const debts = await db.all('SELECT *,opening_debt+feed_credit+other_credit-paid remaining FROM supplier_debts');
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

app.get('/health', (req, res) => res.json({ ok: true, service: 'sonia-4-farm' }));
app.use(express.static(path.join(ROOT_DIR, 'frontend')));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(ROOT_DIR, 'frontend', 'index.html')));

async function start() {
  await initDb();
  await ensureAdmin();
  app.listen(PORT, '0.0.0.0', () => console.log(`Sonia 4.0 Farm listening on ${PORT}`));
}
start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
