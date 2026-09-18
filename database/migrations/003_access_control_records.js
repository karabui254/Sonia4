module.exports = {
  id: '003_access_control_records',
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        item TEXT NOT NULL,
        date TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
      CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON expenses(created_by);
      CREATE TABLE IF NOT EXISTS pricing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        value REAL NOT NULL DEFAULT 0,
        updated_by INTEGER,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT OR IGNORE INTO pricing(name, value) VALUES ('egg_tray', 0);
    `);
  }
};
