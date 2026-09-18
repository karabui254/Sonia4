const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const migrations = [
  require('./migrations/001_initial'),
  require('./migrations/002_legacy_upgrades')
];

function migrate(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const applied = new Set(database.prepare('SELECT id FROM schema_migrations').all().map(row => row.id));
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    database.exec('BEGIN');
    try {
      migration.up(database);
      database.prepare('INSERT INTO schema_migrations(id) VALUES(?)').run(migration.id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      database.close();
      throw new Error(`Migration ${migration.id} failed: ${error.message}`);
    }
  }

  return database;
}

if (require.main === module) {
  const databasePath = process.argv[2] || path.join(process.cwd(), 'data', 'sonia4.db');
  const database = migrate(databasePath);
  console.log(`Database ready: ${databasePath}`);
  database.close();
}

module.exports = { migrate };
