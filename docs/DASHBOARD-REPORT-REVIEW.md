# Dashboard and executive report review

Development branch: `development/dashboard-reports`. Do not merge to `upload`
until the farm owner approves the preview. `upload` is the existing Render branch;
there is no remote `main` branch in this repository at the time of preparation.

## Changes

- A flock selector scopes production, operational bird counts, mortality, usage
  and recent production. Stock and finances stay explicitly labelled whole-farm.
- A daily percentage chart has a 90% target, red below-target points, green
  90–100% points, amber above-100% points, and hollow estimated points. Switch to
  egg counts or change between 7, 30, 60 and 365 days. Missing entries leave gaps.
- The farm PDF is a maximum two-page A4 executive report. The Reports page holds
  the expanded invoice appendix and full data notes. The existing detailed
  production PDF remains available separately.
- `backend/analytics.js` contains reusable pure calculations;
  `backend/executive-pdf.js` contains the PDF layout. `/api/report-data` returns
  computed values using the same permission as the management report.

## Assumptions and calculation limits

- A completed collection day means every eligible laying flock has an entry;
  the application does not have an explicit completion flag. A saved zero is 0%,
  but a missing entry never becomes a zero in the chart. A growing flock is not
  part of the laying denominator.
- Opening birds are calculated before that day's mortality. Flock audit edits
  reconstruct earlier stage values when available; there is no dated laying-start
  ledger. An opening-mortality cutoff cannot establish the precise population
  before that cutoff, so those historical rates are labelled estimates.
- The 90% target is the owner's chosen threshold, not an age-adjusted biological
  benchmark. Rates above 100% are flagged for data review.
- Exact duplicate operational values (date, flock, eggs, damage, mortality,
  birds sold and weight) are removed only in analytics. Source data is untouched.
  Separate legitimate same-day mortality events could look identical: review
  flagged rows before correcting stored data. When this changes report bird
  counts, Data Notes explicitly reconcile against stored-entry counts. Normal
  flock screens continue to show the stored-entry counts.
- Seven-day production comparisons end on the latest complete collection day;
  the chart covers 60 days through report generation. Financial totals are
  all-time through the report date, including only payments through that date.
- There are no invoice due dates. Show invoice age, not overdue claims. Days to
  payment uses the final receipt date for paid-in-full sales only.
- Operating result deducts feed and expenses. Bird investment and other purchases
  are shown separately, with an additional fully reconciled result. This is not
  bank cash or inventory-valued profit. Feed on hand is computed, never hard-coded.
- Names are normalised for display, not merged. Feed typos are corrected for
  display only. Customer identity and amounts retain their original associations.
- Large tables remain bounded in the PDF. Overflow is explicitly counted and
  totalled; the complete table is available in the collapsed Reports appendix.

## Review checklist

1. Select each flock and All flocks; verify bird counts, production and feed use
   change together. Whole-farm finance and stock should retain their labels.
2. Switch chart measures and date ranges. Compare tooltip values and the expanded
   daily table. Verify today's unrecorded collection is a gap, not zero.
3. Check that 90% is green, 89% red and above 100% amber using test fixtures.
4. Download the executive PDF. Confirm two A4 pages, readable layout and no daily
   row dump. Compare the finance section against report JSON and source balances.
5. Review duplicate mortality notes before editing any live data. The development
   preview uses its own SQLite copy and cannot modify Neon.
6. Test production-staff access: the performance chart is available, but report
   JSON and financial PDF are forbidden. Manager/Admin may read both reports.

Run `npm run check`, `npm test` and `npm run build:production` before merging.
