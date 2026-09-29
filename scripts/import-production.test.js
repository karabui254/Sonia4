const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const {
  migrate
} = require('../database/migrate');
const {
  adapt
} = require('../database/connection');
const {
  importProduction
} = require('./import-production');
test('historical import is atomic, audited and safe to repeat', async () => {
  const db = adapt(migrate(':memory:'));
  try {
    const id = Number((await db.run("INSERT INTO users(username,password_hash,role) VALUES('test-admin','unused','admin')")).lastInsertRowid);
    const row = {
      batch: 'TEST-04',
      date: '2026-08-14',
      trays: 0,
      loose_eggs: 6,
      damaged_eggs: 0,
      mortality: 0,
      collected_eggs: 6,
      usable_eggs: 6,
      notes: 'Approved estimate'
    };
    const review = {
      preflight: {
        batch: 'TEST-04',
        placement_date: '2026-04-07',
        initial_birds: 704,
        current_birds: 659,
        checked_on: '2026-09-28'
      },
      rows: [row],
      summary: {
        records: 1,
        collected: 6,
        damaged: 0,
        usable: 6,
        mortality: 0
      }
    };
    assert.equal((await importProduction(db, review, id)).inserted, 1);
    assert.equal((await importProduction(db, review, id)).skipped, 1);
    const conflicting = {
      ...review,
      rows: [{
        ...row,
        date: '2026-08-15'
      }, {
        ...row,
        notes: 'Changed evidence'
      }],
      summary: {
        records: 2,
        collected: 12,
        damaged: 0,
        usable: 12,
        mortality: 0
      }
    };
    await assert.rejects(() => importProduction(db, conflicting, id), /conflicts/);
    assert.equal((await db.get('SELECT COUNT(*) n FROM production')).n, 1);
    assert.equal((await db.get("SELECT COUNT(*) n FROM audit_log WHERE table_name='production'")).n, 1);
  } finally {
    await db.close();
  }
});
