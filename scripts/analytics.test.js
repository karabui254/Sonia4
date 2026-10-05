const {
  test
} = require('node:test');
const assert = require('node:assert/strict');
const {
  series,
  report
} = require('../backend/analytics');
const base = () => ({
  flocks: [{
    id: 1,
    batch: 'A',
    stage: 'Laying',
    placement_date: '2026-01-01',
    initial_bird_count: 100,
    mortality: 0,
    culls: 0,
    mortality_reconciled: 1,
    status: 'Active'
  }, {
    id: 2,
    batch: 'B',
    stage: 'Growing',
    placement_date: '2026-01-01',
    initial_bird_count: 500,
    mortality: 0,
    culls: 0,
    mortality_reconciled: 1,
    status: 'Active'
  }],
  production: [],
  audit_log: [],
  sales: [],
  purchases: [],
  payments: [],
  expenses: [],
  feed_usage: [],
  feed_entries: [],
  customers: [],
  suppliers: []
});
const entry = (id, date, eggs, extra = {}) => ({
  id,
  date,
  flock_id: 1,
  trays: Math.floor(eggs / 30),
  loose_eggs: eggs % 30,
  damaged_eggs: 0,
  mortality: 0,
  ...extra
});
test('daily rate excludes growing birds, distinguishes missing/zero and uses opening mortality', () => {
  const d = base();
  d.production = [entry(1, '2026-10-01', 90, {
    mortality: 10
  }), entry(2, '2026-10-02', 0), entry(3, '2026-10-02', 0, {
    flock_id: 2
  })];
  const r = series(d, {
    end: '2026-10-03',
    days: 3
  });
  assert.equal(r.rows[0].rate, 90);
  assert.equal(r.rows[0].status, 'At target');
  assert.equal(r.rows[1].rate, 0);
  assert.equal(r.rows[1].openingBirds, 90);
  assert.equal(r.rows[2].rate, null);
  assert.equal(r.summary.daysBelow, 1);
  assert.equal(series(d, {
    end: '2026-10-02',
    days: 1,
    flockId: 2
  }).rows[0].rate, null);
});
test('identical duplicates and voids do not inflate reports; missing flock prevents aggregate rate', () => {
  const d = base();
  d.production = [entry(1, '2026-10-01', 89), entry(2, '2026-10-01', 89), entry(3, '2026-10-01', 50, {
    is_voided: 1
  })];
  assert.equal(series(d, {
    end: '2026-10-01',
    days: 1
  }).rows[0].rate, 89);
  d.flocks[1].stage = 'Laying';
  assert.equal(series(d, {
    end: '2026-10-01',
    days: 1
  }).rows[0].rate, null);
  assert.equal(series(d, {
    end: '2026-10-01',
    days: 1,
    flockId: 1
  }).rows[0].rate, 89);
});
test('historical stage edits and unresolved mortality are respected', () => {
  const d = base();
  d.flocks[1].stage = 'Laying';
  d.audit_log = [{
    id: 1,
    table_name: 'flocks',
    record_id: 2,
    timestamp: '2026-10-02',
    old_values: JSON.stringify({
      stage: 'Growing'
    })
  }];
  d.production = [entry(1, '2026-10-01', 90)];
  assert.equal(series(d, {
    end: '2026-10-01',
    days: 1
  }).rows[0].rate, 90);
  d.flocks[0].mortality_reconciled = 0;
  assert.equal(series(d, {
    end: '2026-10-01',
    days: 1
  }).rows[0].rate, null);
});
test('report financial breakdown reconciles other purchases and paid/partial invoices', () => {
  const d = base();
  d.production = [entry(1, '2026-10-01', 90)];
  d.sales = [{
    id: 1,
    date: '2026-10-01',
    total: 1000,
    quantity: 2,
    price_per_tray: 500,
    customer_id: 1
  }];
  d.purchases = [{
    id: 1,
    date: '2026-10-01',
    category: 'Feed',
    feed_type: 'Layers',
    quantity: 10,
    total: 500
  }, {
    id: 2,
    date: '2026-10-01',
    category: 'Chicks',
    total: 200
  }, {
    id: 3,
    date: '2026-10-01',
    category: 'Equipment',
    total: 100
  }];
  d.expenses = [{
    date: '2026-10-01',
    amount: 50
  }];
  d.payments = [{
    date: '2026-10-01',
    sale_id: 1,
    amount: 300
  }, {
    date: '2026-10-01',
    purchase_id: 1,
    amount: 500
  }];
  const r = report(d, {
    end: '2026-10-02'
  });
  assert.equal(r.latest.date, '2026-10-01');
  assert.equal(r.finance.customerOutstanding, 700);
  assert.equal(r.finance.supplierOutstanding, 300);
  assert.equal(r.finance.operatingResult, 450);
  assert.equal(r.finance.afterBirds, 250);
  assert.equal(r.finance.afterAllPurchases, 150);
  assert.equal(r.paidPurchases.count, 1);
  assert.ok(Object.values(r.checks).every(Boolean));
  assert.ok(r.attention.length <= 5);
});
