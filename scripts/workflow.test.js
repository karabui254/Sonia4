const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  spawn
} = require('node:child_process');
const {
  DatabaseSync
} = require('node:sqlite');
const {
  migrate
} = require('../database/migrate');
process.env.NODE_ENV = 'test';
const {
  createOperations,
  today
} = require('../backend/operations');
const {
  createBackup
} = require('./backup');
const {
  restore
} = require('./restore');
const admin = {
    id: 1,
    role: 'admin'
  },
  manager = {
    id: 2,
    role: 'manager'
  },
  staff = {
    id: 3,
    role: 'production_staff'
  };
function fixture() {
  const db = migrate(':memory:');
  for (const u of [admin, manager, staff]) db.prepare('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)').run(u.id, u.role, 'unused', u.role);
  return {
    db,
    op: createOperations(db)
  };
}
async function masters(op) {
  const flock = await op.write('flocks', {
    batch: 'TEST-001',
    breed: 'Layers',
    placement_date: today(),
    initial_bird_count: 100
  }, admin);
  const customer = await op.write('customers', {
    name: 'Test customer'
  }, admin);
  const supplier = await op.write('suppliers', {
    name: 'Test supplier'
  }, admin);
  await op.run("UPDATE pricing SET value=450 WHERE name='egg_tray'");
  return {
    flock,
    customer,
    supplier
  };
}
test('complete daily workflow, price history, balances, stock, corrections and audit', async () => {
  const {
    db,
    op
  } = fixture();
  try {
    const {
      flock,
      customer,
      supplier
    } = await masters(op);
    const purchase = await op.write('purchases', {
      date: today(),
      supplier_id: supplier.id,
      category: 'Feed',
      feed_type: 'Layers',
      item: 'Layer feed',
      quantity: 100,
      total: 6000,
      amount_paid: 2000
    }, manager);
    assert.equal(purchase.unit_cost, 60);
    assert.equal(purchase.outstanding, 4000);
    const production = await op.write('production', {
      date: today(),
      flock_id: flock.id,
      trays: 3,
      loose_eggs: 0,
      damaged_eggs: 2,
      mortality: 1
    }, staff);
    const usage = await op.write('feed', {
      date: today(),
      flock_id: flock.id,
      type: 'Layers',
      consumed_kg: 12
    }, staff);
    const sale = await op.write('sales', {
      date: today(),
      customer_id: customer.id,
      quantity: 2,
      amount_paid: 400
    }, manager);
    await op.write('expenses', {
      date: today(),
      category: 'Transport',
      item: 'Delivery',
      amount: 150
    }, manager);
    assert.equal(sale.price_per_tray, 450);
    assert.equal(sale.total, 900);
    assert.equal(sale.outstanding, 500);
    let d = await op.dashboard(admin);
    assert.equal(d.metrics.activeBirds, 99);
    assert.equal(d.metrics.eggsToday, 90);
    assert.equal(d.metrics.productionRate, 90);
    assert.equal(d.metrics.damagedEggs, 2);
    assert.equal(d.stock.find(r => r.type === 'Layers').available_kg, 88);
    assert.equal(d.metrics.netProfit, -5250);
    await op.run("UPDATE pricing SET value=500 WHERE name='egg_tray'");
    const edited = await op.write('sales', {
      notes: 'Updated reference',
      reason: 'Correct note'
    }, manager, sale.id);
    assert.equal(edited.total, 900);
    assert.equal(edited.price_per_tray, 450);
    const second = await op.write('sales', {
      date: today(),
      customer_id: customer.id,
      quantity: 1,
      amount_paid: 500
    }, manager);
    assert.equal(second.total, 500);
    await op.payment('sales', sale.id, {
      amount: 500,
      date: today(),
      reference: 'Balance'
    }, manager);
    await op.payment('purchases', purchase.id, {
      amount: 4000,
      date: today()
    }, manager);
    assert.equal((await op.list('sales', manager)).find(s => s.id === sale.id).outstanding, 0);
    assert.equal((await op.list('suppliers', admin))[0].outstanding_balance, 0);
    await assert.rejects(async () => await op.payment('sales', sale.id, {
      amount: 1
    }, manager), /exceeds/);
    await assert.rejects(async () => await op.voidRecord('purchases', purchase.id, {
      reason: 'Wrong'
    }, admin), /payments first/);
    await assert.rejects(async () => await op.write('feed', {
      date: today(),
      flock_id: flock.id,
      type: 'Layers',
      consumed_kg: 1000
    }, staff), /Insufficient/);
    assert.equal((await op.list('feed', staff)).length, 1);
    await op.write('production', {
      trays: 2,
      reason: 'Count corrected'
    }, staff, production.id);
    assert.equal((await op.dashboard(admin)).metrics.eggsToday, 60);
    await op.voidRecord('production', production.id, {
      reason: 'Duplicate entry'
    }, staff);
    assert.equal((await op.dashboard(admin)).metrics.activeBirds, 100);
    await op.voidRecord('feed', usage.id, {
      reason: 'Incorrect intake'
    }, staff);
    assert.equal((await op.stock()).find(r => r.type === 'Layers').available_kg, 100);
    assert.ok((await op.all("SELECT * FROM audit_log WHERE action='update'")).every(r => r.reason && r.old_values && r.new_values));
    const staffDashboard = await op.dashboard(staff);
    assert.equal(staffDashboard.metrics.sales, undefined);
    assert.equal((await op.list('flocks', staff))[0].cost_per_chick, undefined);
  } finally {
    db.close();
  }
});
test('validation, rollback, same-day permissions and closed historical references', async () => {
  const {
    db,
    op
  } = fixture();
  try {
    const {
      flock,
      customer,
      supplier
    } = await masters(op);
    for (const mortality of [-1, 1.5, 101]) await assert.rejects(async () => await op.write('production', {
      flock_id: flock.id,
      date: today(),
      mortality
    }, staff));
    await assert.rejects(async () => await op.write('production', {
      flock_id: flock.id,
      date: today(),
      damaged_eggs: 1
    }, staff), /Damaged/);
    await assert.rejects(async () => await op.write('production', {
      flock_id: flock.id,
      date: '2026-02-30'
    }, staff), /valid date/);
    await assert.rejects(async () => await op.write('sales', {
      customer_id: customer.id,
      quantity: 1,
      price_per_tray: 1
    }, manager), /controlled/);
    const sale = await op.write('sales', {
      customer_id: customer.id,
      quantity: 1
    }, manager);
    await op.write('customers', {
      status: 'Inactive',
      reason: 'Account closed'
    }, admin, customer.id);
    await assert.rejects(async () => await op.write('sales', {
      customer_id: customer.id,
      quantity: 1
    }, manager), /active/);
    assert.equal((await op.write('sales', {
      notes: 'Historical correction',
      reason: 'Correct reference'
    }, manager, sale.id)).total, 450);
    const p = await op.write('production', {
      flock_id: flock.id,
      date: today(),
      trays: 1
    }, manager);
    await assert.rejects(async () => await op.write('production', {
      trays: 2,
      reason: 'No'
    }, staff, p.id), /cannot correct/);
    await assert.rejects(async () => await op.write('production', {
      trays: 2
    }, manager, p.id), /reason/);
    await op.write('flocks', {
      status: 'Closed',
      reason: 'Closed flock'
    }, admin, flock.id);
    assert.equal((await op.dashboard(admin)).metrics.activeBirds, 0);
    assert.equal((await op.write('production', {
      trays: 2,
      reason: 'Historical correction'
    }, manager, p.id)).trays, 2);
    await assert.rejects(async () => await op.write('production', {
      flock_id: flock.id,
      trays: 1
    }, staff), /active/);
    const count = (await op.get('SELECT COUNT(*) n FROM expenses')).n;
    db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_log WHEN NEW.table_name='expenses' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    await assert.rejects(async () => await op.write('expenses', {
      category: 'Transport',
      item: 'Atomic',
      amount: 100
    }, manager), /audit unavailable/);
    assert.equal((await op.get('SELECT COUNT(*) n FROM expenses')).n, count);
  } finally {
    db.close();
  }
});
test('WAL online backup restores committed rows; migrations remain repeatable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonia-backup-'));
  let db;
  try {
    const filename = path.join(dir, 'live.db');
    db = migrate(filename);
    db.exec('PRAGMA wal_autocheckpoint=0');
    db.prepare("INSERT INTO customers(name) VALUES(?)").run('Committed in WAL');
    assert.ok(fs.existsSync(filename + '-wal'));
    const out = await createBackup(filename, path.join(dir, 'backups'));
    const restored = path.join(dir, 'restored.db');
    await restore(out, restored);
    const check = migrate(restored);
    try {
      assert.equal(check.prepare('SELECT name FROM customers').get().name, 'Committed in WAL');
      assert.equal(check.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 8);
    } finally {
      check.close();
    }
    await assert.rejects(() => restore(out, restored), /exists/);
  } finally {
    db?.close();
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });
  }
});
test('legacy migration preserves ambiguous debts and mortality without destructive conversion', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonia-migrate-')),
    filename = path.join(dir, 'old.db');
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    for (const name of ['001_initial', '002_legacy_upgrades', '003_access_control_records', '004_audit_void_fields', '005_master_data']) {
      require('../database/migrations/' + name).up(db);
      db.prepare('INSERT INTO schema_migrations(id) VALUES(?)').run(name);
    }
    db.exec("INSERT INTO flocks(batch,initial_bird_count,received,mortality,current_bird_count) VALUES('OLD',100,100,3,96);INSERT INTO production(date,flock_id,mortality) VALUES('2026-01-01',1,3);INSERT INTO supplier_debts(supplier,opening_debt) VALUES('Legacy',100)");
  } finally {
    db.close();
  }
  const upgraded = migrate(filename);
  try {
    assert.equal(upgraded.prepare('SELECT COUNT(*) n FROM purchases').get().n, 0);
    assert.equal(upgraded.prepare('SELECT opening_debt FROM supplier_debts').get().opening_debt, 100);
    assert.equal((await createOperations(upgraded).list('flocks', admin))[0].current_bird_count, 96);
  } finally {
    upgraded.close();
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });
  }
});
test('HTTP roles, persistent sessions, user security, PDF and API errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonia-http-'));
  const net = require('node:net');
  const port = await new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  let child,
    logs = '';
  async function start(environment = 'test') {
    child = spawn(process.execPath, ['backend/server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: environment,
        DATABASE_URL: '',
        HOST: '127.0.0.1',
        PORT: String(port),
        DATA_DIR: dir,
        DATABASE_PATH: path.join(dir, 'farm.db'),
        SESSION_PATH: path.join(dir, 'sessions.db'),
        ADMIN_PASSWORD: 'TestPassword-2026!',
        SESSION_SECRET: 'test-secret-long-enough-for-integration-tests'
      }
    });
    child.stdout.on('data', s => {
      logs += s;
    });
    child.stderr.on('data', s => {
      logs += s;
    });
    for (let i = 0; i < 200; i++) {
      try {
        if ((await fetch(base + '/health')).ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(logs);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    await new Promise(resolve => {
      child.once('exit', resolve);
      child.kill();
    });
  }
  async function req(url, method = 'GET', body, cookie) {
    const r = await fetch(base + '/api' + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        ...(cookie ? {
          cookie
        } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {
      cookieHeader: r.headers.get('set-cookie'),
      status: r.status,
      body: await r.json().catch(() => null),
      cookie: r.headers.get('set-cookie')?.split(';')[0]
    };
  }
  try {
    await start();
    let a = await req('/auth/login', 'POST', {
      username: 'admin',
      password: 'TestPassword-2026!'
    });
    assert.equal(a.status, 200, logs);
    const cookie = a.cookie;
    assert.equal((await req('/users', 'POST', {
      username: 'manager',
      password: 'ManagerPassword-2026!',
      role: 'manager'
    }, cookie)).status, 200);
    assert.equal((await req('/users', 'POST', {
      username: 'production',
      password: 'ProductionPassword-2026!',
      role: 'production_staff'
    }, cookie)).status, 200);
    const m = (await req('/auth/login', 'POST', {
      username: 'manager',
      password: 'ManagerPassword-2026!'
    })).cookie;
    const s = (await req('/auth/login', 'POST', {
      username: 'production',
      password: 'ProductionPassword-2026!'
    })).cookie;
    assert.equal((await req('/suppliers', 'POST', {
      name: 'Forbidden'
    }, m)).status, 403);
    assert.equal((await req('/suppliers', 'GET', undefined, s)).status, 403);
    assert.equal((await req('/feed', 'GET', undefined, m)).status, 200);
    assert.equal((await req('/performance?period=30','GET',undefined,s)).status,200);
    assert.equal((await req('/performance?period=bad','GET',undefined,s)).status,400);
    assert.equal((await req('/dashboard?flock_id=99999','GET',undefined,s)).status,400);
    assert.equal((await req('/report-data','GET',undefined,s)).status,403);
    assert.equal((await req('/report-data','GET',undefined,m)).status,200);
    assert.equal((await req('/dashboard', 'GET', undefined, s)).body.metrics.sales, undefined);
    assert.equal((await req('/production', 'POST', {
      date: today()
    }, s)).status, 400);
    assert.equal((await req('/missing', 'GET', undefined, cookie)).status, 404);
    const pdf = await fetch(base + '/api/report.pdf', {
      headers: {
        cookie
      }
    });
    assert.equal(pdf.status, 200);
    assert.ok(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).equals(Buffer.from('%PDF')));
    const setup = await req('/auth/2fa/setup', 'POST', {}, cookie);
    assert.equal(setup.status, 200);
    await stop();
    await start();
    assert.equal((await req('/auth/me', 'GET', undefined, cookie)).body.user.username, 'admin');
    const {
      generateSync
    } = require('otplib');
    const token = generateSync({
      secret: setup.body.secret
    });
    const enabled = await req('/auth/2fa/confirm', 'POST', {
      token
    }, cookie);
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    assert.equal((await req('/auth/me', 'GET', undefined, cookie)).body.user, null);
    const newCookie = enabled.cookie;
    assert.equal((await req('/users/1', 'PUT', {
      role: 'manager',
      reason: 'Test'
    }, newCookie)).status, 400);
    assert.equal((await req('/users/2', 'PUT', {
      is_active: false,
      reason: 'Leaver'
    }, newCookie)).status, 200);
    assert.equal((await req('/auth/me', 'GET', undefined, m)).status, 401);
    assert.equal((await req('/users/3', 'PUT', {
      role: 'manager',
      reason: 'Role changed'
    }, newCookie)).status, 200);
    assert.equal((await req('/production', 'GET', undefined, s)).status, 401);
    let staffLogin = await req('/auth/login', 'POST', {
      username: 'production',
      password: 'ProductionPassword-2026!'
    });
    assert.equal((await req('/users/3', 'PUT', {
      reset_2fa: true,
      reason: 'Security reset'
    }, newCookie)).status, 200);
    assert.equal((await req('/production', 'GET', undefined, staffLogin.cookie)).status, 401);
    staffLogin = await req('/auth/login', 'POST', {
      username: 'production',
      password: 'ProductionPassword-2026!'
    });
    assert.equal((await req('/auth/password', 'POST', {
      current_password: 'ProductionPassword-2026!',
      new_password: 'ChangedPassword-2026!'
    }, staffLogin.cookie)).status, 200);
    assert.equal((await req('/production', 'GET', undefined, staffLogin.cookie)).status, 401);
    for (const kind of ['idle', 'absolute']) {
      const login = await req('/auth/login', 'POST', {
        username: 'production',
        password: 'ChangedPassword-2026!'
      });
      const sessions = new DatabaseSync(path.join(dir, 'sessions.db'));
      try {
        for (const row of sessions.prepare('SELECT * FROM sessions').all()) {
          const value = JSON.parse(row.data);
          if (value.user?.id !== 3) continue;
          if (kind === 'idle') value.lastActivityAt = Date.now() - 46 * 60000;else {
            value.authenticatedAt = Date.now() - 11 * 3600000;
            value.lastActivityAt = Date.now();
          }
          sessions.prepare('UPDATE sessions SET data=?,expires=? WHERE sid=?').run(JSON.stringify(value), Date.now() + 60000, row.sid);
        }
      } finally {
        sessions.close();
      }
      assert.equal((await req('/production', 'GET', undefined, login.cookie)).status, 401);
    }
    assert.equal((await req('/auth/logout', 'POST', {}, newCookie)).status, 200);
    await stop();
    await start('production');
    const secure = await req('/auth/login', 'POST', {
      username: 'production',
      password: 'ChangedPassword-2026!'
    });
    assert.equal(secure.status, 200);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Expires=']) assert.ok(secure.cookieHeader.includes(flag), flag);
  } finally {
    await stop();
    fs.rmSync(dir, {
      recursive: true,
      force: true
    });
  }
});
test('payment corrections restore balances and dates cannot invalidate existing payments', async () => {
  const {
    db,
    op
  } = fixture();
  try {
    const {
      customer,
      supplier
    } = await masters(op);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const sale = await op.write('sales', {
      date: yesterday,
      customer_id: customer.id,
      quantity: 2,
      amount_paid: 100
    }, manager);
    await assert.rejects(async () => await op.write('sales', {
      date: today(),
      reason: 'Move date'
    }, manager, sale.id), /payment date/);
    const paymentId = (await op.payment('sales', sale.id, {
      date: today(),
      amount: 800
    }, manager)).id;
    assert.equal((await op.list('customers', admin))[0].outstanding_balance, 0);
    await assert.rejects(async () => await op.voidPayment(paymentId, {
      reason: 'No permission'
    }, staff), /Forbidden/);
    await assert.rejects(async () => await op.voidPayment(paymentId, {}, manager), /reason/);
    await op.voidPayment(paymentId, {
      reason: 'Wrong payment reference'
    }, manager);
    assert.equal((await op.list('customers', admin))[0].outstanding_balance, 800);
    assert.equal((await op.dashboard(admin)).metrics.sales, 900);
    const replacement = await op.payment('sales', sale.id, {
      date: today(),
      amount: 800,
      reference: 'Corrected'
    }, manager);
    assert.ok(replacement.id > paymentId);
    const purchase = await op.write('purchases', {
      date: today(),
      supplier_id: supplier.id,
      category: 'Equipment',
      item: 'Feeder',
      quantity: 2,
      total: 1000
    }, manager);
    assert.equal(purchase.unit_cost, 500);
    assert.equal((await op.list('suppliers', admin))[0].outstanding_balance, 1000);
    await op.voidRecord('purchases', purchase.id, {
      reason: 'Duplicate order'
    }, manager);
    assert.equal((await op.list('suppliers', admin))[0].outstanding_balance, 0);
    for (const quantity of [[], {}, true, ' ']) await assert.rejects(async () => await op.write('sales', {
      customer_id: customer.id,
      quantity
    }, manager));
  } finally {
    db.close();
  }
});
