const PDFDocument = require('pdfkit');
const C = {
  ink: '#163C37',
  muted: '#60756F',
  green: '#087E6C',
  red: '#B42318',
  amber: '#A86500',
  line: '#DCE7E3',
  wash: '#F2F7F5'
};
const num = n => n === null || n === undefined ? 'Not recorded' : Number(n).toLocaleString('en-KE', {
  maximumFractionDigits: 1
});
const kes = n => 'KES ' + Number(n || 0).toLocaleString('en-KE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const pct = n => n === null || n === undefined ? 'N/A' : n.toFixed(1) + '%';
function renderReport(r) {
  const d = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
    info: {
      Title: 'Sonia 4.0 Farm - Farm Management Report'
    }
  });
  const text = (s, x, y, w = 523, size = 9, color = C.ink, height = 26, bold = false) => {
    d.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color).text(String(s), x, y, {
      width: w,
      height,
      lineBreak: true,
      ellipsis: true
    });
  };
  const rule = y => d.moveTo(36, y).lineTo(559, y).strokeColor(C.line).lineWidth(.6).stroke();
  const heading = (s, y) => {
    text(s, 36, y, 523, 13, C.green, 22, true);
    rule(y + 23);
  };
  const header = page => {
    text('SONIA 4.0 FARM', 36, 30, 340, 19, C.ink, 27, true);
    text('FARM MANAGEMENT REPORT', 36, 59, 380, 9, C.muted);
    text(`${page} / 2`, 516, 35, 43, 10);
  };
  const table = (columns, rows, y, widths, max = 6) => {
    let x = 36;
    columns.forEach((c, i) => {
      text(c, x, y, widths[i] - 6, 8, C.muted, 22, true);
      x += widths[i];
    });
    rule(y + 23);
    rows.slice(0, max).forEach((row, j) => {
      x = 36;
      row.forEach((v, i) => {
        text(v, x, y + 29 + j * 25, widths[i] - 6, 8.5, C.ink, 22);
        x += widths[i];
      });
    });
    return y + 29 + Math.min(rows.length, max) * 25;
  };
  header(1);
  text(`Production: ${r.start} to ${r.end} | Finances: all records through ${r.end}`, 36, 80, 523, 8, C.muted);
  text(r.status, 36, 100, 523, 11, C.ink, 29, true);
  const cards = [['Latest complete collection', r.latest ? num(r.latest.eggs) + ' eggs' : 'Not yet recorded', r.latest?.date || 'No complete collection day'], ['Latest lay rate', pct(r.latest?.rate), 'Laying birds only | target 90%'], ['7-day average to ' + r.collectionEnd, r.average === null ? 'Incomplete week' : num(r.average) + ' eggs/day', r.average !== null && r.previousAverage !== null ? `${r.average > r.previousAverage ? 'UP' : r.average < r.previousAverage ? 'DOWN' : 'STEADY'} vs ${num(r.previousAverage)} previous 7 days` : 'Missing days are not zero'], ['Active birds', num(r.activeBirds), r.flocks.filter(f => f.status === 'Active').map(f => `${f.type}: ${num(f.birds)}`).join(' | ') + ' | Mortality ' + pct(r.flocks.reduce((n, f) => n + (f.mortality || 0), 0) / Math.max(1, r.flocks.reduce((n, f) => n + f.initial, 0)) * 100)], ['Sales / purchases', num(r.finance.sales) + ' / ' + num(r.finance.purchases), 'KES | owed: ' + num(r.finance.supplierOutstanding)], ['Customer outstanding', kes(r.finance.customerOutstanding), 'Collect unpaid customer balances']];
  cards.forEach(([label, value, sub], i) => {
    const x = 36 + i % 3 * 177,
      y = 139 + Math.floor(i / 3) * 75;
    d.roundedRect(x, y, 169, 67, 6).fill(C.wash);
    text(label, x + 9, y + 8, 151, 8, C.muted, 14);
    text(value, x + 9, y + 25, 151, 14, i === 1 && r.latest?.rate < 90 ? C.red : C.ink, 19, true);
    text(sub, x + 9, y + 47, 151, 7.5, C.muted, 17);
  });
  heading('Production | last 60 days', 303);
  const a = r.trend.rows,
    max = Math.max(1, ...a.map(v => v.eggs || 0)),
    xx = i => 66 + i * 478 / Math.max(1, a.length - 1),
    yy = v => 465 - v / max * 115;
  text('Eggs', 36, 337, 38, 8, C.muted);
  text(num(max), 36, 351, 35, 8, C.muted);
  text('0', 44, 457, 20, 8, C.muted);
  d.moveTo(65, 347).lineTo(65, 466).lineTo(550, 466).strokeColor(C.line).stroke();
  const line = (key, color) => {
    let open = false;
    d.strokeColor(color).lineWidth(key === 'average' ? 2 : 1);
    a.forEach((v, i) => {
      if (v[key] === null) {
        if (open) d.stroke();
        open = false;
        return;
      }
      if (!open) {
        d.moveTo(xx(i), yy(v[key]));
        open = true;
      } else d.lineTo(xx(i), yy(v[key]));
    });
    if (open) d.stroke();
  };
  line('eggs', C.green);
  line('average', C.amber);
  [0, 29, 59].forEach(i => text(a[i]?.date || '', xx(i) - 25, 474, 65, 7.5, C.muted));
  const first = a.findIndex(v => v.eggs > 0),
    last = a.findLastIndex(v => v.eggs !== null);
  if (first >= 0) {
    d.circle(xx(first), yy(a[first].eggs), 2).fill(C.green);
    text('First recorded output', Math.min(400, xx(first)), 332, 145, 7.5, C.muted);
  }
  if (last >= 0) {
    d.circle(xx(last), yy(a[last].eggs), 3).fill(C.green);
    text('Latest ' + num(a[last].eggs), 390, 332, 155, 8, C.green);
  }
  text('Green: daily eggs | Amber: 7-day moving average (complete days only)', 36, 497, 523, 8, C.muted);
  text('Gaps mean unrecorded collections. First output is not proof of the biological ramp-up date.', 36, 514, 523, 8, C.muted);
  heading('Flock performance', 542);
  const fy = table(['Flock / placed', 'Placed', 'Live', 'Deaths / %', 'Eggs 7d', 'Lay %'], r.flocks.map(f => [f.name + '\n' + f.placed, num(f.initial), num(f.birds), num(f.mortality) + ' / ' + pct(f.mortalityRate), num(f.eggs7), pct(f.rate)]), 574, [200, 49, 49, 85, 70, 70], 4);
  if (r.flocks.length > 4) text(`${r.flocks.length - 4} additional flocks: see report data appendix. Active total above includes all flocks.`, 36, fy, 523, 8, C.muted);
  text(`Damaged eggs: ${pct(r.damageAll)} all time | ${pct(r.damage7)} last 7 days.`, 36, 720, 523, 9, C.ink);
  text('Lay rate uses the latest complete day in the last 7 days for each flock. Historical rates are provisional.', 36, 741, 523, 8, C.muted);
  const stamp = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Nairobi'
  }).format(new Date(r.generatedAt));
  text(`Generated ${stamp} EAT | Voided records excluded | KES`, 36, 790, 523, 8, C.muted);
  d.addPage();
  header(2);
  heading('Finance | sales, purchase costs and balances', 83);
  const f = r.finance;
  const financeRows = [['Sales', f.sales], ['Less feed purchases', -f.feed], [f.expenses ? 'Less operating expenses' : 'No operating expenses recorded', -f.expenses], ['Operating result', f.operatingResult], ['Less bird purchases (investment)', -f.birds], ['Result after bird purchases', f.afterBirds], ['Less other purchases', -f.other], ['Result after all purchases', f.afterAllPurchases]];
  financeRows.forEach(([label, value], i) => {
    const col = i < 4 ? 0 : 1,
      j = i % 4,
      x = 36 + col * 270;
    text(label, x, 116 + j * 19, 174, 8.5);
    text(value === 0 ? '-' : kes(value), x + 168, 116 + j * 19, 93, 8.5, value < 0 ? C.red : C.ink, 18, true);
  });
  text(`Purchases reconcile to ${kes(f.purchases)}. Feed on hand (${num(r.feed.reduce((n, s) => n + s.kg, 0))} kg) is unvalued: expensing it understates inventory value. These are purchase-based results, not a bank balance.`, 36, 197, 523, 8, C.muted, 31);
  heading('Unpaid supplier invoices | oldest first', 237);
  let y = table(['Supplier / description', 'Invoice date', 'KES owed', 'Age days'], r.payables.map(p => [p.name + ' / ' + p.description, p.date, num(p.outstanding), p.days]), 265, [283, 88, 92, 60], r.payables.length > 5 ? 4 : 5);
  const hiddenPay = r.payables.slice(r.payables.length > 5 ? 4 : 5);
  if (hiddenPay.length) {
    text(`${hiddenPay.length} additional unpaid invoices: ${kes(hiddenPay.reduce((n, p) => n + p.outstanding, 0))}. See appendix.`, 36, y, 523, 8, C.muted);
    y += 17;
  }
  text(`TOTAL ${kes(f.supplierOutstanding)} | ${r.paidPurchases.count} invoices paid in full, ${kes(r.paidPurchases.total)}`, 36, 419, 523, 8.5, C.ink, 18, true);
  heading('Customer balances | invoice age, not overdue days', 448);
  table(['Customer', 'Invoice date', 'KES owed', 'Age days'], r.receivables.map(p => [p.name, p.date, num(p.outstanding), p.days]), 476, [283, 88, 92, 60], 2);
  const hiddenReceivables = r.receivables.slice(2);
  text(`${r.paidSales.count} sales paid in full, ${kes(r.paidSales.total)}.${hiddenReceivables.length ? ' Additional unpaid: ' + hiddenReceivables.length + ', ' + kes(hiddenReceivables.reduce((n, p) => n + p.outstanding, 0)) + ' (appendix).' : ''}`, 36, 559, 523, 8, C.muted);
  const s = r.insights;
  text(`${num(s.trays)} trays | Avg ${s.averagePrice === null ? 'N/A' : kes(s.averagePrice)}/tray | First to latest: ${num(s.firstPrice)} to ${num(s.lastPrice)} | Paid sales settle in ${num(s.daysToPay)} days on average.`, 36, 579, 523, 8, C.ink, 24);
  text(s.topCustomer ? `Top customer: ${s.topCustomer}, ${pct(s.topShare)} of revenue${s.topShare > 50 ? ' - concentration risk' : ''}.` : 'No sales recorded.', 36, 604, 523, 8, s.topShare > 50 ? C.amber : C.muted);
  text('FEED & STOCK', 36, 628, 110, 9, C.green, 17, true);
  text(r.feed.map(s => `${s.type}: ${num(s.kg)} kg (last ${s.lastPurchase || 'none'})`).join(' | '), 145, 628, 414, 8, C.ink, 25);
  text(`Consumed: ${num(r.consumed)} kg | Stock cover: ${r.stockDays === null ? 'insufficient usage data' : num(r.stockDays) + ' days at recorded usage'}`, 36, 657, 523, 8, C.muted);
  text('ATTENTION THIS WEEK', 36, 683, 523, 10, C.green, 17, true);
  const bullets = r.attention.length ? r.attention : [{
    level: 'green',
    text: 'No automatic alerts. Continue complete daily recording and review balances.'
  }];
  bullets.forEach((a, i) => text(`${i + 1}. ${a.text}`, 36, 705 + i * 13, 523, 8, C[a.level], 13));
  text('DATA NOTES: ' + [r.notes.find(n => n.includes('Bird count requires')) || r.notes.find(n => n.includes('duplicate')) || 'No identical production duplicates.', r.notes.find(n => n.includes('Recorded feed')) || ''].join(' ') + ' Full notes and invoice appendix: Reports > View report details.', 36, 776, 523, 7, C.muted, 39);
  d.end();
  return d;
}
module.exports = {
  renderReport
};
