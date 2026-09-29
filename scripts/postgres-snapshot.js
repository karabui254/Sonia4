const fs = require('node:fs');
const crypto = require('node:crypto');
const TABLES = ['users', 'flocks', 'customers', 'suppliers', 'pricing', 'production', 'feed_entries', 'purchases', 'sales', 'supplier_debts', 'expenses', 'payments', 'feed_usage', 'audit_log', 'migration_notes'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot(db) {
  return db.transaction(async () => {
    const tables = {};
    for (const table of TABLES) tables[table] = await db.all('SELECT * FROM ' + table + ' ORDER BY id');
    const payload = {
      format: 'sonia-postgres-v1',
      createdAt: new Date().toISOString(),
      migrations: await db.all('SELECT id,checksum FROM postgres_migrations ORDER BY id'),
      tables
    };
    return {
      payload,
      sha256: digest(payload)
    };
  });
}
async function restore(db, document) {
  const p = document.payload;
  if (!p || p.format !== 'sonia-postgres-v1' || digest(p) !== document.sha256 || Object.keys(p.tables).sort().join() !== [...TABLES].sort().join()) throw new Error('Invalid snapshot or checksum');
  return db.transaction(async () => {
    if (JSON.stringify(await db.all('SELECT id,checksum FROM postgres_migrations ORDER BY id')) !== JSON.stringify(p.migrations)) throw new Error('Snapshot schema differs from destination');
    for (const table of TABLES) {
      if (table === 'pricing') {
        const rows = await db.all('SELECT * FROM pricing');
        if (rows.length !== 1 || rows[0].name !== 'egg_tray' || rows[0].value !== 0 || rows[0].updated_by !== null) throw new Error('Destination pricing is not empty');
      } else if ((await db.get('SELECT COUNT(*) n FROM ' + table)).n) throw new Error('Destination must be empty: ' + table);
    }
    await db.run('DELETE FROM pricing');
    for (const table of TABLES) {
      const columns = new Set((await db.all('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?', table)).map(r => r.column_name));
      for (const row of p.tables[table]) {
        const keys = Object.keys(row);
        if (!keys.length || keys.some(k => !columns.has(k))) throw new Error('Invalid snapshot columns');
        const values = keys.map(k => table === 'users' && k === 'created_by' ? null : row[k]);
        await db.run(`INSERT INTO ${table}(${keys.map(k => '"' + k + '"').join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...values);
      }
      await db.get(`SELECT setval(pg_get_serial_sequence(?, 'id'),COALESCE((SELECT MAX(id) FROM ${table}),1),(SELECT COUNT(*)>0 FROM ${table}))`, table);
      if ((await db.get('SELECT COUNT(*) n FROM ' + table)).n !== p.tables[table].length) throw new Error('Restore row count mismatch');
    }
    for (const row of p.tables.users) if (row.created_by !== null) await db.run('UPDATE users SET created_by=? WHERE id=?', row.created_by, row.id);
    // Sessions intentionally do not transfer: restored accounts must sign in again.
    await db.run('DELETE FROM sessions');
    return Object.fromEntries(TABLES.map(t => [t, p.tables[t].length]));
  });
}
if (require.main === module) (async () => {
  const [mode, file] = process.argv.slice(2);
  if (!['export', 'restore-empty'].includes(mode) || !file) throw new Error('Usage: node scripts/postgres-snapshot.js export|restore-empty <file.json>');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = await require('../database/connection').connect({
    databaseUrl: process.env.DATABASE_URL
  });
  try {
    if (mode === 'export') {
      fs.writeFileSync(file, JSON.stringify(await snapshot(db), null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600
      });
      console.log('Verified snapshot written: ' + file);
    } else console.log(await restore(db, JSON.parse(fs.readFileSync(file, 'utf8'))));
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error('Snapshot failed:', error.code || error.message);
  process.exitCode = 1;
});
module.exports = {
  snapshot,
  restore
};
