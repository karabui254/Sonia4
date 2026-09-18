function columns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

module.exports = {
  id: '004_audit_void_fields',
  up(database) {
    const records = ['flocks', 'feed_entries', 'purchases', 'production', 'customers', 'sales', 'supplier_debts', 'expenses'];
    const additions = [
      ['is_voided', 'INTEGER NOT NULL DEFAULT 0'],
      ['voided_by', 'INTEGER'],
      ['voided_at', 'TEXT'],
      ['void_reason', 'TEXT'],
      ['created_by', 'INTEGER'],
      ['updated_by', 'INTEGER'],
      ['created_at', 'TEXT'],
      ['updated_at', 'TEXT']
    ];

    for (const table of records) {
      const existing = columns(database, table);
      for (const [column, definition] of additions) {
        if (!existing.includes(column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
      database.exec(`
        UPDATE ${table}
        SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
            updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP),
            is_voided = COALESCE(is_voided, 0)
      `);
      database.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_voided ON ${table}(is_voided)`);
    }

    for (const [column, definition] of [['old_values', 'TEXT'], ['new_values', 'TEXT']]) {
      if (!columns(database, 'audit_log').includes(column)) database.exec(`ALTER TABLE audit_log ADD COLUMN ${column} ${definition}`);
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)');
  }
};
