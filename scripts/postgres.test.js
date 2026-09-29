const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const {
  PGlite
} = require('@electric-sql/pglite');
const {
  postgres,
  postgresSql,
  poolOptions
} = require('../database/connection');
const {
  migrate
} = require('../database/postgres-migrate');
process.env.NODE_ENV = 'test';
const {
  createOperations,
  today
} = require('../backend/operations');
test('PostgreSQL schema, farm workflow, financial corrections, rollback and sessions', async () => {
  let neonUrl = process.env.NEON_TEST_URL;
  if (neonUrl) {
    const url = new URL(neonUrl);
    url.hostname = url.hostname.replace('-pooler.', '.');
    neonUrl = url.toString();
  }
  const schema = 'sonia_test_' + require('node:crypto').randomBytes(8).toString('hex');
  const controller = neonUrl ? new (require('pg').Pool)(poolOptions(neonUrl)) : null;
  if (controller) await controller.query('CREATE SCHEMA ' + schema);
  const engine = neonUrl ? null : new PGlite();
  // PGlite is one connection; this fixture deliberately runs operations sequentially.
  const client = {
    query: async (sql, args) => {
      if (sql.startsWith('SELECT pg_advisory')) return {
        rows: []
      };
      if (!args?.length && sql.includes(';')) {
        await engine.exec(sql);
        return {
          rows: []
        };
      }
      const r = await engine.query(sql, args);
      return {
        ...r,
        rowCount: r.affectedRows
      };
    },
    release() {}
  };
  const pool = neonUrl ? new (require('pg').Pool)({
    ...poolOptions(neonUrl),
    options: '-c search_path=' + schema
  }) : {
    query: client.query,
    connect: async () => client,
    end: () => engine.close()
  };
  if (neonUrl) require('pg').types.setTypeParser(20, Number);
  const db = postgres(pool);
  try {
    await migrate(db);
    await migrate(db);
    const op = createOperations(db),
      admin = {
        id: 1,
        role: 'admin'
      },
      staff = {
        id: 2,
        role: 'production_staff'
      },
      manager = {
        id: 3,
        role: 'manager'
      };
    for (const u of [admin, staff, manager]) await op.run('INSERT INTO users(id,username,password_hash,role) VALUES(?,?,?,?)', u.id, u.role, 'test-only', u.role);
    const flock = await op.write('flocks', {
      batch: 'PG-TEST',
      breed: 'Layers',
      placement_date: today(),
      initial_bird_count: 100
    }, admin);
    const customer = await op.write('customers', {
      name: 'PG customer'
    }, admin);
    const supplier = await op.write('suppliers', {
      name: 'PG supplier'
    }, admin);
    await op.run("UPDATE pricing SET value=450 WHERE name='egg_tray'");
    const purchase = await op.write('purchases', {
      date: today(),
      supplier_id: supplier.id,
      category: 'Feed',
      feed_type: 'Layers',
      item: 'Feed',
      quantity: 100,
      total: 6000,
      amount_paid: 2000
    }, manager);
    assert.equal(purchase.outstanding, 4000);
    const production = await op.write('production', {
      date: today(),
      flock_id: flock.id,
      trays: 3,
      loose_eggs: 0,
      damaged_eggs: 2,
      mortality: 1
    }, staff);
    await op.write('feed', {
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
    await op.run("UPDATE pricing SET value=500 WHERE name='egg_tray'");
    assert.equal((await op.write('sales', {
      notes: 'Corrected',
      reason: 'Reference correction'
    }, manager, sale.id)).price_per_tray, 450);
    await op.payment('sales', sale.id, {
      date: today(),
      amount: 500
    }, manager);
    await assert.rejects(() => op.payment('sales', sale.id, {
      date: today(),
      amount: 1
    }, manager), /exceeds/);
    await assert.rejects(() => op.write('feed', {
      date: today(),
      flock_id: flock.id,
      type: 'Layers',
      consumed_kg: 1000
    }, staff), /Insufficient/);
    assert.equal((await op.list('feed', staff)).length, 1);
    const dashboard = await op.dashboard(admin);
    assert.equal(dashboard.metrics.activeBirds, 99);
    assert.equal(dashboard.metrics.eggsToday, 90);
    assert.equal(dashboard.metrics.customerOutstanding, 0);
    assert.equal(dashboard.stock.find(r => r.type === 'Layers').available_kg, 88);
    await op.voidRecord('production', production.id, {
      reason: 'Duplicate'
    }, staff);
    assert.equal((await op.dashboard(admin)).metrics.activeBirds, 100);
    assert.ok((await op.mortalityReport()).length);
    assert.ok(await op.productionTrend('monthly'));
    const Store = require('../backend/postgres-session-store'),
      store = new Store(pool);
    const policy = require('../backend/session-policy'),
      session = {
        user: {
          id: 1
        },
        cookie: {
          maxAge: policy.IDLE_MS
        }
      };
    policy.start(session);
    const invoke = (method, ...args) => new Promise((resolve, reject) => store[method](...args, (e, v) => e ? reject(e) : resolve(v)));
    await invoke('set', 'test-session', session);
    assert.ok(await invoke('get', 'test-session'));
    await pool.query('UPDATE sessions SET expires=0');
    assert.equal(await invoke('get', 'test-session'), null);
    await invoke('destroy', 'test-session');
    if (!neonUrl) {
      const {
        snapshot,
        restore
      } = require('./postgres-snapshot');
      const backup = await snapshot(db);
      await assert.rejects(() => restore(db, backup), /empty/);
      await assert.rejects(() => restore(db, {
        ...backup,
        sha256: 'invalid'
      }), /checksum/);
      await db.run('CREATE SCHEMA recovery_test');
      await db.run('SET search_path TO recovery_test');
      await migrate(db);
      const restored = await restore(db, backup);
      assert.equal(restored.sales, 1);
      assert.equal((await op.dashboard(admin)).metrics.customerOutstanding, 0);
      assert.equal((await op.get('SELECT COUNT(*) n FROM sessions')).n, 0);
      assert.ok(Number((await op.run('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)', 'restored-user', 'test', 'manager')).lastInsertRowid) > 3);
      await db.run('SET search_path TO public');
    }
    if (neonUrl) {
      const concurrent = await op.write('sales', {
        date: today(),
        customer_id: customer.id,
        quantity: 1
      }, manager);
      const results = await Promise.allSettled([op.payment('sales', concurrent.id, {
        date: today(),
        amount: 400
      }, manager), op.payment('sales', concurrent.id, {
        date: today(),
        amount: 400
      }, manager)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await op.list('sales', manager)).find(r => r.id === concurrent.id).outstanding, 100);
    }
  } finally {
    await db.close();
    if (controller) {
      await controller.query('DROP SCHEMA ' + schema + ' CASCADE');
      await controller.end();
    }
  }
});
test('PostgreSQL parameter conversion preserves quoted question marks', () => {
  assert.equal(postgresSql("SELECT '?' literal WHERE x=? AND (? IS NULL OR date>?)"), "SELECT '?' literal WHERE x=$1 AND ($2::text IS NULL OR date>$3)");
});
