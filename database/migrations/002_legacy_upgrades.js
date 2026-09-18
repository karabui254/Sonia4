function columns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

module.exports = {
  id: '002_legacy_upgrades',
  up(database) {
    const additions = [
      ['users', 'is_active', 'INTEGER NOT NULL DEFAULT 1'],
      ['users', 'created_by', 'INTEGER'],
      ['customers', 'customer_code', 'TEXT'],
      ['supplier_debts', 'supplier_code', 'TEXT'],
      ['feed_entries', 'total_cost', 'REAL NOT NULL DEFAULT 0'],
      ['sales', 'price_per_tray', 'REAL NOT NULL DEFAULT 0']
    ];

    for (const [table, column, definition] of additions) {
      if (!columns(database, table).includes(column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }

    database.exec(`
      UPDATE customers SET customer_code = 'CUS-' || printf('%04d', id)
        WHERE customer_code IS NULL OR customer_code = '';
      UPDATE supplier_debts SET supplier_code = 'SUP-' || printf('%04d', id)
        WHERE supplier_code IS NULL OR supplier_code = '';
      UPDATE feed_entries SET total_cost = received_kg * cost_per_kg
        WHERE total_cost = 0 AND received_kg > 0 AND cost_per_kg > 0;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_debts_code ON supplier_debts(supplier_code);
    `);
  }
};
