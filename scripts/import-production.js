const {
  createOperations
} = require('../backend/operations');
const FIELDS = ['trays', 'loose_eggs', 'damaged_eggs', 'mortality'];
async function importProduction(db, review, adminId) {
  if (!Array.isArray(review.rows) || !review.rows.length) throw new Error('Production review has no rows');
  const dates = new Set();
  const totals = {
    records: 0,
    collected: 0,
    damaged: 0,
    usable: 0,
    mortality: 0
  };
  for (const row of review.rows) {
    if (row.batch !== review.preflight.batch || dates.has(row.date)) throw new Error('Duplicate date or inconsistent flock in review');
    dates.add(row.date);
    for (const key of FIELDS) if (!Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error('Invalid production count');
    const collected = row.trays * 30 + row.loose_eggs;
    if (collected !== row.collected_eggs || collected - row.damaged_eggs !== row.usable_eggs) throw new Error('Production totals do not reconcile');
    totals.records++;
    totals.collected += collected;
    totals.damaged += row.damaged_eggs;
    totals.usable += row.usable_eggs;
    totals.mortality += row.mortality;
  }
  for (const [key, value] of Object.entries(totals)) if (review.summary[key] !== value) throw new Error('Review summary mismatch: ' + key);
  return db.transaction(async () => {
    // All writes below share this outer transaction and its business-rule lock.
    const op = createOperations({
      ...db,
      transaction: fn => fn()
    });
    const admin = await op.get('SELECT id,role,is_active FROM users WHERE id=?', adminId);
    if (admin?.role !== 'admin' || !admin.is_active) throw new Error('An active administrator is required');
    const p = review.preflight;
    let flock = await op.get('SELECT * FROM flocks WHERE batch=?', p.batch);
    if (!flock) {
      flock = await op.write('flocks', {
        batch: p.batch,
        breed: 'Kenchick',
        placement_date: p.placement_date,
        initial_bird_count: p.initial_birds,
        mortality: p.initial_birds - p.current_birds,
        mortality_baseline_date: p.checked_on,
        stage: 'Laying',
        status: 'Active',
        notes: 'Reconstructed from the live flock observed on ' + p.checked_on + '. Opening losses cover deaths through this date. Additional details can be restored by the administrator.'
      }, admin);
    }
    if (flock.is_voided || flock.placement_date !== p.placement_date || flock.initial_bird_count !== p.initial_birds) throw new Error('Existing flock conflicts with reviewed baseline');
    let inserted = 0,
      skipped = 0;
    for (const row of review.rows) {
      const existing = await op.all('SELECT * FROM production WHERE flock_id=? AND date=?', flock.id, row.date);
      if (existing.length) {
        if (existing.length !== 1 || existing[0].is_voided || FIELDS.some(k => existing[0][k] !== row[k]) || existing[0].notes !== row.notes) throw new Error('Existing production conflicts on ' + row.date);
        skipped++;
        continue;
      }
      await op.write('production', {
        flock_id: flock.id,
        date: row.date,
        trays: row.trays,
        loose_eggs: row.loose_eggs,
        damaged_eggs: row.damaged_eggs,
        mortality: row.mortality,
        notes: row.notes
      }, admin);
      inserted++;
    }
    return {
      batch: p.batch,
      flock_id: flock.id,
      inserted,
      skipped,
      ...totals
    };
  });
}
if (require.main === module) {
  (async () => {
    const {
      config
    } = require('../backend/config');
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required for the PostgreSQL import');
    const [file, adminId] = process.argv.slice(2);
    if (!file || !/^\d+$/.test(adminId || '')) throw new Error('Usage: node scripts/import-production.js <review.json> <admin-id>');
    const db = await require('../database/connection').connect(config);
    try {
      console.log(JSON.stringify(await importProduction(db, JSON.parse(require('node:fs').readFileSync(file, 'utf8')), Number(adminId)), null, 2));
    } finally {
      await db.close();
    }
  })().catch(error => {
    console.error('Import failed:', error.code || error.message);
    process.exitCode = 1;
  });
}
module.exports = {
  importProduction
};
