// Preserve every stored population until an administrator confirms its sources.
module.exports = {
  id: '008_mortality_reconciliation',
  up(db, context = {}) {
    db.exec(`
      ALTER TABLE flocks ADD COLUMN mortality_reconciled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE flocks ADD COLUMN mortality_reconciled_by INTEGER REFERENCES users(id);
      ALTER TABLE flocks ADD COLUMN mortality_reconciled_at TEXT;
      ALTER TABLE flocks ADD COLUMN mortality_existing_current INTEGER;
      UPDATE flocks SET mortality_existing_current=current_bird_count;
    `);
    // When upgrading through older migrations, retain the pre-upgrade stored count,
    // even if an earlier migration recalculates its current_bird_count column.
    for (const row of context.legacyFlockCounts || []) {
      db.prepare('UPDATE flocks SET current_bird_count=?,mortality_existing_current=? WHERE id=?')
        .run(row.current_bird_count, row.current_bird_count, row.id);
    }
  }
};
