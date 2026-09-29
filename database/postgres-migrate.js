const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function migrate(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'postgres/001_initial.sql'), 'utf8').replace(/\r\n/g, '\n');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  await db.transaction(async () => {
    await db.run('CREATE TABLE IF NOT EXISTS postgres_migrations(id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const previous = await db.get('SELECT checksum FROM postgres_migrations WHERE id=?', '001');
    if (previous) {
      if (previous.checksum !== checksum) throw new Error('PostgreSQL migration checksum mismatch');
      return;
    }
    await db.run(sql);
    await db.all('INSERT INTO postgres_migrations(id,checksum) VALUES(?,?)', '001', checksum);
  });
}
module.exports = {
  migrate
};
