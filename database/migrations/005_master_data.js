function columns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

function addColumn(database, table, column, definition) {
  if (!columns(database, table).includes(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

module.exports = {
  id: '005_master_data',
  up(database) {
    addColumn(database, 'flocks', 'placement_date', 'TEXT');
    addColumn(database, 'flocks', 'initial_bird_count', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(database, 'flocks', 'current_bird_count', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(database, 'flocks', 'status', "TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Closed'))");
    database.exec(`
      UPDATE flocks
      SET placement_date = COALESCE(placement_date, date_received),
          initial_bird_count = CASE WHEN initial_bird_count = 0 THEN received ELSE initial_bird_count END,
          current_bird_count = CASE WHEN current_bird_count = 0 THEN MAX(0, received - mortality - culls) ELSE current_bird_count END;
      CREATE INDEX IF NOT EXISTS idx_flocks_status ON flocks(status);
    `);

    addColumn(database, 'customers', 'email', 'TEXT');
    addColumn(database, 'customers', 'status', "TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive'))");
    database.exec("CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)");

    database.exec(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        phone TEXT,
        location TEXT,
        products TEXT,
        status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),
        is_voided INTEGER NOT NULL DEFAULT 0,
        voided_by INTEGER,
        voided_at TEXT,
        void_reason TEXT,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
      CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
    `);

    addColumn(database, 'feed_entries', 'supplier_id', 'INTEGER');
    addColumn(database, 'purchases', 'supplier_id', 'INTEGER');
    addColumn(database, 'supplier_debts', 'supplier_id', 'INTEGER');
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_feed_supplier ON feed_entries(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON purchases(supplier_id);
      CREATE INDEX IF NOT EXISTS idx_debt_supplier ON supplier_debts(supplier_id);
    `);
  }
};
