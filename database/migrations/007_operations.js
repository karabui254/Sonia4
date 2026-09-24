module.exports = {
  id: '007_operations',
  up(db) {
    db.exec(`
      ALTER TABLE production ADD COLUMN damaged_eggs INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE flocks ADD COLUMN stage TEXT NOT NULL DEFAULT 'Laying';
      ALTER TABLE flocks ADD COLUMN closed_date TEXT;
      ALTER TABLE flocks ADD COLUMN mortality_baseline_date TEXT;
      UPDATE flocks SET mortality_baseline_date=date('now') WHERE mortality>0;
      ALTER TABLE purchases ADD COLUMN feed_type TEXT;
      ALTER TABLE purchases ADD COLUMN total REAL NOT NULL DEFAULT 0;
      UPDATE purchases SET total=quantity*unit_cost;
      ALTER TABLE audit_log ADD COLUMN reason TEXT;
      ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY, sale_id INTEGER REFERENCES sales(id), purchase_id INTEGER REFERENCES purchases(id),
        date TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>0), reference TEXT NOT NULL DEFAULT '',
        is_voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, voided_by INTEGER, voided_at TEXT,
        created_by INTEGER, updated_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK ((sale_id IS NOT NULL)+(purchase_id IS NOT NULL)=1)
      );
      INSERT INTO payments(sale_id,date,amount,reference,created_by,is_voided)
        SELECT id,date,amount_paid,'Imported opening receipt',created_by,is_voided FROM sales WHERE amount_paid>0;
      INSERT INTO payments(purchase_id,date,amount,reference,created_by,is_voided)
        SELECT id,date,amount_paid,'Imported opening payment',created_by,is_voided FROM purchases WHERE amount_paid>0;
      CREATE INDEX idx_payments_sale ON payments(sale_id,is_voided);
      CREATE INDEX idx_payments_purchase ON payments(purchase_id,is_voided);
      CREATE TABLE feed_usage (
        id INTEGER PRIMARY KEY, date TEXT NOT NULL, flock_id INTEGER REFERENCES flocks(id),
        type TEXT NOT NULL CHECK(type IN ('Chick Mash','Growers','Layers')),
        consumed_kg REAL NOT NULL CHECK(consumed_kg>0), notes TEXT,
        is_voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT, voided_by INTEGER, voided_at TEXT,
        created_by INTEGER, updated_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_usage_type_date ON feed_usage(type,date);
      CREATE TABLE migration_notes (id INTEGER PRIMARY KEY, message TEXT NOT NULL);
      INSERT INTO migration_notes(message) SELECT 'Legacy feed entries and supplier debts remain read-only for reconciliation; no automatic duplicate purchase conversion.'
        WHERE EXISTS(SELECT 1 FROM feed_entries) OR EXISTS(SELECT 1 FROM supplier_debts);
      INSERT INTO migration_notes(message) SELECT 'Legacy flock mortality is treated as an opening cumulative baseline; only production mortality after migration day is added. Review each flock baseline before entering new mortality.'
        WHERE EXISTS(SELECT 1 FROM flocks WHERE mortality>0);
    `);
  }
};
