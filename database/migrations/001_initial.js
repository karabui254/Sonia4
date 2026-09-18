module.exports = {
  id: '001_initial',
  up(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'manager',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        record_id INTEGER,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS flocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch TEXT NOT NULL UNIQUE,
        breed TEXT,
        received INTEGER NOT NULL DEFAULT 0,
        date_received TEXT,
        supplier TEXT,
        cost_per_chick REAL NOT NULL DEFAULT 0,
        house TEXT,
        mortality INTEGER NOT NULL DEFAULT 0,
        culls INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS feed_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('Chick Mash','Growers','Layers')),
        supplier TEXT,
        received_kg REAL NOT NULL DEFAULT 0,
        cost_per_kg REAL NOT NULL DEFAULT 0,
        consumed_kg REAL NOT NULL DEFAULT 0,
        date TEXT NOT NULL,
        flock_id INTEGER,
        notes TEXT,
        FOREIGN KEY (flock_id) REFERENCES flocks(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        item TEXT NOT NULL,
        supplier TEXT,
        reference TEXT,
        date TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        unit_cost REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'Paid',
        amount_paid REAL NOT NULL DEFAULT 0,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS production (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        flock_id INTEGER,
        trays INTEGER NOT NULL DEFAULT 0,
        loose_eggs INTEGER NOT NULL DEFAULT 0,
        birds_sold INTEGER NOT NULL DEFAULT 0,
        avg_weight_kg REAL NOT NULL DEFAULT 0,
        mortality INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        FOREIGN KEY (flock_id) REFERENCES flocks(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        location TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        customer_id INTEGER,
        type TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        weight_kg REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'Paid',
        amount_paid REAL NOT NULL DEFAULT 0,
        notes TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS supplier_debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier TEXT NOT NULL UNIQUE,
        opening_debt REAL NOT NULL DEFAULT 0,
        feed_credit REAL NOT NULL DEFAULT 0,
        other_credit REAL NOT NULL DEFAULT 0,
        paid REAL NOT NULL DEFAULT 0,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_log(table_name, record_id);
      CREATE INDEX IF NOT EXISTS idx_feed_date ON feed_entries(date);
      CREATE INDEX IF NOT EXISTS idx_feed_flock ON feed_entries(flock_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_date ON purchases(date);
      CREATE INDEX IF NOT EXISTS idx_production_date ON production(date);
      CREATE INDEX IF NOT EXISTS idx_production_flock ON production(flock_id);
      CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
      CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
    `);
  }
};
