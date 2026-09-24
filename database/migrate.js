const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const migrations = [
  require('./migrations/001_initial'),
  require('./migrations/002_legacy_upgrades'),
  require('./migrations/003_access_control_records'),
  require('./migrations/004_audit_void_fields'),
  require('./migrations/005_master_data'),
  require('./migrations/006_flock_current_count_formula'),
  require('./migrations/007_operations'),
  require('./migrations/008_mortality_reconciliation')
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
  const hasFlocks = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='flocks'").get();
  const hasCount = hasFlocks && database.prepare('PRAGMA table_info(flocks)').all().some(c=>c.name==='current_bird_count');
  const legacyFlockCounts = hasCount ? database.prepare('SELECT id,current_bird_count FROM flocks').all() : [];
  // Keep a multi-version upgrade atomic, including restoration of legacy counts.
  let activeMigration;
  database.exec('BEGIN');
  try {
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      activeMigration=migration.id;
      migration.up(database, { legacyFlockCounts });
      database.prepare('INSERT INTO schema_migrations(id) VALUES(?)').run(migration.id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    database.close();
    throw new Error(`Migration ${activeMigration} failed: ${error.message}`);
  }

  return database;
}

if (require.main === module) {
  const databasePath = process.argv[2] || require('../backend/config').config.databasePath;
  const database = migrate(databasePath);
  console.log(`Database ready: ${databasePath}`);
  database.close();
}

module.exports = { migrate };
