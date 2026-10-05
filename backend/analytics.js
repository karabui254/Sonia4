// Read-only reporting calculations. No production records are changed here.
const sum = (rows, fn) => rows.reduce((n, r) => n + Number(fn(r) || 0), 0);
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const shift = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const age = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
const collected = r => r.trays * 30 + r.loose_eggs;
const active = rows => (rows || []).filter(r => !r.is_voided);
const title = s => String(s || 'Unknown').trim().replace(/\bgroweers\b/ig, 'Growers').toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
function cleanProduction(rows) {
  const seen = new Set(),
    duplicates = [];
  const records = active(rows).filter(r => {
    const key = JSON.stringify([r.date, r.flock_id, r.trays, r.loose_eggs, r.damaged_eggs, r.mortality, r.birds_sold || 0, r.avg_weight_kg || 0]);
    if (seen.has(key)) {
      duplicates.push(r.id);
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    records,
    duplicates
  };
}
function stateAt(f, day, audits = []) {
  let state = {
      ...f
    },
    evidence = false;
  const changes = audits.filter(a => a.table_name === 'flocks' && a.record_id === f.id && a.old_values).sort((a, b) => b.id - a.id);
  for (const a of changes) {
    try {
      const old = JSON.parse(a.old_values);
      const stamp = String(a.timestamp || '');
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(stamp) ? NaN : Date.parse(/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(stamp) ? stamp : stamp + 'Z');
      const when = Number.isFinite(parsed) ? new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(parsed) : stamp.slice(0,10);
      if (when > day) {
        state = {
          ...state,
          ...old
        };
        evidence = true;
      }
    } catch {}
  }
  return {
    state,
    evidence
  };
}
function population(f, day, records, opening = false) {
  if (!f.mortality_reconciled) return null;
  const deaths = sum(records.filter(r => r.flock_id === f.id && (opening ? r.date < day : r.date <= day) && (!f.mortality_baseline_date || r.date > f.mortality_baseline_date)), r => r.mortality);
  return Math.max(0, f.initial_bird_count - f.mortality - f.culls - deaths);
}
function series(data, {
  end,
  days = 60,
  flockId = null
} = {}) {
  const clean = cleanProduction(data.production),
    records = clean.records;
  const flocks = active(data.flocks).filter(f => !flockId || f.id === flockId);
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = shift(end, -i);
    let denominator = 0,
      estimated = false,
      complete = true;
    const eligible = flocks.map(f => stateAt(f, day, data.audit_log).state).filter(f => f.stage === 'Laying' && f.placement_date <= day && (!f.closed_date || day <= f.closed_date));
    const daily = records.filter(r => r.date === day && eligible.some(f => f.id === r.flock_id));
    for (const f of eligible) {
      const birds = population(f, day, records, true);
      if (birds === null) complete = false;else denominator += birds;
      if (!daily.some(r => r.flock_id === f.id)) complete = false;
      if (f.mortality_baseline_date && day <= f.mortality_baseline_date) estimated = true;
    }
    const eggs = daily.length ? sum(daily, collected) : null;
    const rate = complete && daily.length && denominator > 0 ? round(eggs / denominator * 100) : null;
    rows.push({
      date: day,
      eggs,
      damaged: sum(daily, r => r.damaged_eggs),
      openingBirds: denominator,
      rate,
      complete: !!(complete && daily.length),
      estimated: estimated || daily.some(r => /estimat/i.test(r.notes || '')),
      status: rate === null ? 'Not recorded / incomplete' : rate < 90 ? 'Below target' : rate > 100 ? 'Check count' : 'At target'
    });
  }
  rows.forEach((r, i) => {
    const window = rows.slice(Math.max(0, i - 6), i + 1);
    r.average = window.length === 7 && window.every(x => x.complete) ? round(sum(window, x => x.eggs) / 7) : null;
  });
  const valid = rows.filter(r => r.rate !== null);
  return {
    rows,
    duplicates: clean.duplicates,
    summary: {
      rate: valid.length ? round(sum(valid, r => r.eggs) / sum(valid, r => r.openingBirds) * 100) : null,
      daysRecorded: valid.length,
      daysBelow: valid.filter(r => r.rate < 90).length,
      best: valid.length ? Math.max(...valid.map(r => r.rate)) : null,
      worst: valid.length ? Math.min(...valid.map(r => r.rate)) : null
    },
    notes: ['Historical laying status uses recorded flock edits; there is no dated laying-start ledger. Rates are provisional where stage history is incomplete.', ...(rows.some(r => r.estimated) ? ['Estimated points use approved collection estimates or a later opening-mortality baseline; the exact earlier bird population is unknown.'] : [])]
  };
}
function report(data, {
  end,
  generatedAt = new Date().toISOString()
} = {}) {
  const start = shift(end, -59),
    trend = series(data, {
      end,
      days: 60
    }),
    clean = cleanProduction(data.production);
  const prod = clean.records.filter(r => r.date <= end),
    flocks = active(data.flocks).filter(f => f.placement_date <= end);
  const payments = active(data.payments).filter(p => p.date <= end);
  const sales = active(data.sales).filter(r => r.date <= end),
    purchases = active(data.purchases).filter(r => r.date <= end),
    expenses = active(data.expenses).filter(r => r.date <= end);
  const balance = (r, key) => round(r.total - sum(payments.filter(p => p[key] === r.id), p => p.amount));
  const customer = id => title((data.customers || []).find(c => c.id === id)?.name);
  const supplier = r => title((data.suppliers || []).find(s => s.id === r.supplier_id)?.name || r.supplier);
  const owed = sales.map(r => ({
    ...r,
    name: customer(r.customer_id),
    outstanding: balance(r, 'sale_id'),
    days: age(r.date, end)
  }));
  const payable = purchases.map(r => ({
    ...r,
    name: supplier(r),
    description: title(r.item),
    outstanding: balance(r, 'purchase_id'),
    days: age(r.date, end)
  }));
  const finance = {
    sales: round(sum(sales, r => r.total)),
    purchases: round(sum(purchases, r => r.total)),
    feed: round(sum(purchases.filter(r => r.category === 'Feed'), r => r.total)),
    birds: round(sum(purchases.filter(r => r.category === 'Chicks'), r => r.total)),
    expenses: round(sum(expenses, r => r.amount)),
    supplierOutstanding: round(sum(payable, r => r.outstanding)),
    customerOutstanding: round(sum(owed, r => r.outstanding))
  };
  finance.other = round(finance.purchases - finance.feed - finance.birds);
  finance.operatingResult = round(finance.sales - finance.feed - finance.expenses);
  finance.afterBirds = round(finance.operatingResult - finance.birds);
  finance.afterAllPurchases = round(finance.afterBirds - finance.other);
  const payableOpen = payable.filter(r => r.outstanding > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id),
    receivableOpen = owed.filter(r => r.outstanding > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const paidPurchases = payable.filter(r => r.outstanding === 0),
    paidSales = owed.filter(r => r.outstanding === 0);
  const latest = trend.rows.filter(r => r.complete).at(-1) || null;
  const collectionEnd = latest?.date || end,
    completedIndex = trend.rows.findIndex(r => r.date === collectionEnd) + 1;
  const window7 = trend.rows.slice(Math.max(0, completedIndex - 7), completedIndex),
    previous7 = trend.rows.slice(Math.max(0, completedIndex - 14), Math.max(0, completedIndex - 7));
  const average = window7.length === 7 && window7.every(r => r.complete) ? round(sum(window7, r => r.eggs) / 7) : null,
    previousAverage = previous7.length === 7 && previous7.every(r => r.complete) ? round(sum(previous7, r => r.eggs) / 7) : null;
  const flockRows = flocks.map((f, index) => {
    const p = prod.filter(r => r.flock_id === f.id),
      birds = population(f, end, prod),
      last7 = p.filter(r => r.date >= shift(collectionEnd, -6) && r.date <= collectionEnd),
      ft = series(data, {
        end: collectionEnd,
        days: 7,
        flockId: f.id
      });
    const month = new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(f.placement_date + 'T12:00:00Z'));
    return {
      id: f.id,
      batch: f.batch,
      name: `Flock ${index + 1} - ${f.stage === 'Laying' ? 'Layers' : 'Chicks'} (${month})`,
      type: f.stage === 'Laying' ? 'Layers' : 'Chicks',
      placed: f.placement_date,
      initial: f.initial_bird_count,
      birds: birds ?? f.current_bird_count,
      mortality: birds === null ? null : f.initial_bird_count - f.culls - birds,
      mortalityRate: birds === null || !f.initial_bird_count ? null : round((f.initial_bird_count - f.culls - birds) / f.initial_bird_count * 100),
      eggs7: sum(last7, collected),
      rate: ft.rows.filter(r => r.complete).at(-1)?.rate ?? null,
      status: f.status
    };
  });
  const feed = ['Chick Mash', 'Growers', 'Layers'].map(type => {
    const bought = purchases.filter(r => r.category === 'Feed' && r.feed_type === type),
      legacy = active(data.feed_entries).filter(r => r.date <= end && r.type === type),
      usage = active(data.feed_usage).filter(r => r.date <= end && r.type === type);
    return {
      type,
      kg: round(sum(bought, r => r.quantity) + sum(legacy, r => r.received_kg - r.consumed_kg) - sum(usage, r => r.consumed_kg)),
      lastPurchase: [...bought, ...legacy.filter(r => r.received_kg > 0)].map(r => r.date).sort().at(-1) || null
    };
  });
  const consumed = round(sum(active(data.feed_usage).filter(r => r.date <= end), r => r.consumed_kg) + sum(active(data.feed_entries).filter(r => r.date <= end), r => r.consumed_kg));
  const feed7 = sum(active(data.feed_usage).filter(r => r.date >= shift(end, -6) && r.date <= end), r => r.consumed_kg) + sum(active(data.feed_entries).filter(r => r.date >= shift(end, -6) && r.date <= end), r => r.consumed_kg);
  const stockDays = feed7 > 0 ? round(sum(feed, r => r.kg) / (feed7 / 7)) : null;
  const totalsByCustomer = new Map();
  sales.forEach(r => totalsByCustomer.set(r.customer_id, (totalsByCustomer.get(r.customer_id) || 0) + r.total));
  const top = [...totalsByCustomer].sort((a, b) => b[1] - a[1])[0];
  const trays = sum(sales, r => r.quantity);
  const sortedSales = [...sales].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const durations = paidSales.flatMap(s => {
    const ps = payments.filter(p => p.sale_id === s.id).sort((a, b) => a.date.localeCompare(b.date));
    return ps.length ? [age(s.date, ps.at(-1).date)] : [];
  });
  const insights = {
    trays,
    averagePrice: trays ? round(finance.sales / trays) : null,
    firstPrice: sortedSales[0]?.price_per_tray ?? null,
    lastPrice: sortedSales.at(-1)?.price_per_tray ?? null,
    topCustomer: top ? customer(top[0]) : null,
    topShare: top && finance.sales ? round(top[1] / finance.sales * 100) : null,
    daysToPay: durations.length ? round(sum(durations, x => x) / durations.length) : null
  };
  const damage = rows => {
    const total = sum(rows, collected);
    return total ? round(sum(rows, r => r.damaged_eggs) / total * 100) : null;
  };
  const notes = [...trend.notes, 'Seven-day production summaries end on the latest complete collection day. No collection-completion flag exists: a day is complete when every eligible laying flock has an entry. Missing days are not treated as zero.', 'Invoice due dates are not recorded; invoice ages are shown, not claimed overdue days.'];
  if (clean.duplicates.length) notes.push(`${clean.duplicates.length} identical production duplicate(s) excluded from reporting only; stored records unchanged.`);
  if (flocks.some(f => !f.mortality_reconciled)) notes.push('Unreconciled flock mortality: historical rate withheld; review opening balances.');
  if (finance.other) notes.push('Other purchases are shown separately so all purchases reconcile. Bird purchases are a management investment view, not a formal accounting classification.');
  if ([...(data.customers || []), ...(data.purchases || [])].some(r => r.name && r.name !== title(r.name) || /groweers/i.test(r.item || ''))) notes.push('Display names normalised to Title Case and Groweers to Growers; source text unchanged.');
  if (purchases.some((r, i) => i && r.date < purchases[i - 1].date)) notes.push('Invoices were entered out of date order; outstanding invoices sorted oldest first.');
  const activeBirds = sum(flockRows.filter(f => f.status === 'Active'), r => r.birds);
  const rawBirds = sum(flocks.filter(f => f.status === 'Active'), f => population(f, end, active(data.production)) ?? f.current_bird_count);
  if (rawBirds !== activeBirds) notes.unshift(`Bird count requires review: ${activeBirds} after duplicate exclusion versus ${rawBirds} from stored entries. Repeated mortality rows cause the difference; no source records were changed.`);
  const lowFeed = activeBirds > 0 && sum(purchases.filter(r => r.category === 'Feed'), r => r.quantity) > 0 && feed7 / 7 / activeBirds < 0.03;
  if (lowFeed) notes.push('Recorded feed usage is under 30 g per active bird/day over seven days. This is a data-completeness check, not a nutrition target.');
  const attention = [];
  if (receivableOpen.length) attention.push({
    level: 'red',
    text: `Collect KES ${finance.customerOutstanding.toLocaleString('en-KE')} from customers; oldest balance is ${receivableOpen[0].days} days old.`
  });
  if (payableOpen.length) attention.push({
    level: 'red',
    text: `Plan KES ${finance.supplierOutstanding.toLocaleString('en-KE')} supplier payments; oldest invoice is ${payableOpen[0].days} days old.`
  });
  if (latest?.rate !== null && latest?.rate < 90) attention.push({
    level: 'red',
    text: `Latest lay rate is ${latest.rate.toFixed(1)}%, below the 90% target. Review flock age, feed and health.`
  });
  if (window7.filter(r => r.complete).length < 7) attention.push({
    level: 'amber',
    text: 'Complete missing daily collections before comparing seven-day performance.'
  });
  if (lowFeed) attention.push({
    level: 'amber',
    text: 'Check feed-use entries: recorded consumption looks low for the bird population.'
  });
  if (insights.topShare > 50) attention.push({
    level: 'amber',
    text: `${insights.topCustomer} accounts for ${insights.topShare.toFixed(1)}% of sales; reduce reliance on one customer.`
  });
  if (stockDays !== null && stockDays < 7) attention.unshift({
    level: 'red',
    text: `Feed covers about ${stockDays.toFixed(1)} days at recorded seven-day consumption; arrange supply.`
  });
  const checks = {
    sales: round(sum(paidSales, r => r.total) + sum(receivableOpen, r => r.total)) === finance.sales,
    purchases: round(sum(paidPurchases, r => r.total) + sum(payableOpen, r => r.total)) === finance.purchases,
    payables: round(sum(payableOpen, r => r.outstanding)) === finance.supplierOutstanding,
    receivables: round(sum(receivableOpen, r => r.outstanding)) === finance.customerOutstanding
  };
  if (Object.values(checks).some(v => !v)) throw new Error('Report reconciliation failed: inspect payments and source balances');
  return {
    farm: 'Sonia 4.0 Farm',
    start,
    end,
    generatedAt,
    timezone: 'Africa/Nairobi',
    status: `${latest ? `Latest lay rate ${latest.rate?.toFixed(1) ?? 'unavailable'}%` : 'Production not yet recorded'}; KES ${finance.supplierOutstanding.toLocaleString('en-KE')} owed to suppliers.`,
    latest,
    collectionEnd,
    average,
    previousAverage,
    trend,
    flocks: flockRows,
    activeBirds,
    finance,
    payables: payableOpen,
    receivables: receivableOpen,
    paidPurchases: {
      count: paidPurchases.length,
      total: round(sum(paidPurchases, r => r.total))
    },
    paidSales: {
      count: paidSales.length,
      total: round(sum(paidSales, r => r.total))
    },
    insights,
    feed,
    consumed,
    stockDays,
    damageAll: damage(prod),
    damage7: damage(prod.filter(r => r.date >= shift(collectionEnd, -6) && r.date <= collectionEnd)),
    attention: attention.slice(0, 5),
    notes,
    checks
  };
}
module.exports = {
  series,
  report,
  cleanProduction,
  population,
  shift
};
