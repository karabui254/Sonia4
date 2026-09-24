# Sonia 4.0: full manual workflow test

Use a blank isolated demo: `npm.cmd run demo`, then open http://localhost:3016. Do not enter these records into a real farm. A pre-filled version of the final scenario is available with `npm.cmd run demo:sample` (stop the blank demo first).

Accounts: **demo-admin**, **demo-manager**, **demo-production**. Demo password for all three: **SoniaDemo-2026!**. These accounts are created only in a new demo database. Existing demo databases are preserved; changing between blank and sample demos uses different database files.

Use TODAY as shown on the Dashboard for all dates. Run each step once on an empty demo; duplicate names/batches indicate it has already been used.

## 1. Admin sets up the farm

Sign in as demo-admin.

| Section | Enter |
|---|---|
| Flocks | Batch TEST-LAYERS-001; breed Layers; placement TODAY; initial birds 100; stage Laying; status Active; opening mortality 0; culls 0; leave baseline/closure dates blank |
| Suppliers | Name TEST Feed Supplier; products Layers feed; status Active |
| Customers | Name TEST Egg Customer; status Active |
| Settings → Egg selling price | 450; reason Sample starting price |

Expected: current birds 100; unique SUP/CUS identifiers; no operational transactions yet. User controls are available to Admin only. Optional: create a temporary Production Staff account with a 12+ character password, then verify its restricted navigation.

## 2. Manager buys feed

Sign out; sign in as demo-manager. Purchases & Payments:

| Field | Value |
|---|---|
| Date | TODAY |
| Supplier | TEST Feed Supplier |
| Category | Feed |
| Item | Layers feed |
| Feed type | Layers |
| Quantity | 100 kg |
| Total purchase cost | 6,000 |
| Initial amount paid | 2,000 |
| Invoice reference | TEST-FEED-001 |

Expected cost per kg: **60**. Status: **Partially Paid**. Supplier outstanding: **4,000**. Layers stock: **100 kg**. Payments shows the initial 2,000 entry. Do not record this purchase again in Expenses or Feed Usage.

## 3. Production Staff records the day

Sign out; sign in as demo-production.

Production: select TEST-LAYERS-001; TODAY; **3 full trays + 4 loose eggs**, **2 damaged eggs**, **1 death**. Collected eggs are 94, usable eggs 92.

Feed Usage & Stock: TODAY; flock TEST-LAYERS-001; feed type Layers; consumed **12 kg**.

Expected: **94 Eggs Today**, **94% production rate**, **99 active birds**, **1 mortality**, **88 kg Layers stock**, **12 kg consumed**. No supplier/customer/sales/cost screens or financial metrics should be visible. Settings remains available for personal password/2FA.

## 4. Manager records sale and expense

Sign in as demo-manager.

Sales & Receipts: TODAY; customer TEST Egg Customer; **2 trays**; initial receipt **400**.

Expected: price is automatically **450**, total **900**, outstanding **500**, status Partially Paid. Manager has no price-entry field.

Expenses: TODAY; Transport; description Egg delivery; amount **150**.

Expected dashboard: Sales 900; Purchases 6,000; Expenses 150; simplified Net Profit **−5,250**; customer outstanding 500; supplier outstanding 4,000. The negative profit is expected because all feed purchase cost is expensed immediately.

## 5. Prove historical pricing

Admin: change price to **500**, reason New sample price.

Manager: edit the first sale's Notes to Original price retained, reason Verify price history. It must still total **900 at 450/tray**.

Create another sale: TODAY; same customer; **1 tray**; initial receipt **500**. New sale totals **500 at 500/tray**, status Paid.

Expected aggregate sales: **1,400**. Existing sale remains 900. Simplified profit: **−4,750**.

## 6. Settle existing transactions

Open Payments on the first sale. Add receipt: TODAY; amount **500**; reference TEST-CUSTOMER-BALANCE.

Open Payments on the feed purchase. Add payment: TODAY; amount **4,000**; reference TEST-SUPPLIER-BALANCE.

Expected: both fully paid; customer and supplier outstanding **0**; sale count stays **2** and purchase count **1**. Sales/profit do not change. Customer/Supplier History shows the original transactions and both payment entries.

## 7. Corrections and audit

Use demo-production to edit the production entry from 4 loose eggs to **3**, with reason Recount: one egg overreported. Dashboard must show **93 collected eggs**, **93% rate**, unchanged mortality/stock. Edit back to 4 with reason Restore sample count.

As Manager, add expense Other / Duplicate example / **25**. Void it with reason Duplicate test entry. It disappears from active totals; Show voided displays it and Audit Log contains the reason and old/new values. Net profit returns to **−4,750**.

For a payment correction test: void the first sale's later 500 receipt with reason Wrong receipt reference. Its outstanding becomes 500. Add replacement 500 with reference TEST-CORRECTED. Outstanding returns to zero and both original and replacement remain in payment history. This changes bookkeeping only, not actual cash movement.

## 8. Rejection and access tests

- Try consuming 1,000 kg: rejected; Layers stock stays 88 kg.
- Try another payment of 1 on a fully paid sale: rejected; no overpayment.
- Try production with damaged eggs greater than collected eggs, negative numbers, or fractional mortality: rejected.
- Try a correction with no reason: rejected.
- Staff cannot correct another user's production record; no action is offered for it.
- Managers cannot create/edit master records or pricing.
- Void a paid purchase before voiding payments: rejected. This protects payment history.
- Close the flock as Admin (reason Test closure): active birds become 0 and it disappears from new-entry selections. Reopen it (reason Restore demo) to return to 99 active birds. History stays available.
- Deactivate and reactivate the customer/supplier as Admin with reasons. Inactive masters disappear from NEW selections but remain readable in history.

## 9. Final expected dashboard

| Metric | Expected after restoring corrections |
|---|---:|
| Eggs today / collected | 94 |
| Damaged eggs | 2 |
| Production rate | 94% |
| Active birds | 99 |
| Mortality | 1 |
| Layers stock | 88 kg |
| Feed consumed | 12 kg |
| Sales | KES 1,400 |
| Purchases | KES 6,000 |
| Operating expenses | KES 150 |
| Simplified net profit | KES −4,750 |
| Customer outstanding | KES 0 |
| Supplier outstanding | KES 0 |

Production rate uses opening live birds (100), not closing birds (99). All-day metrics change when the farm date changes; all-time totals remain.

## 10. Reports and persistence

Download both reports and compare production/history and financial totals with the dashboard. Search finds sections, not record contents. Test at narrow browser width and using Tab/Enter.

Stop the demo with Ctrl+C and restart the SAME demo command. Data should remain; a still-valid session should remain signed in. Demo sessions and farm data use separate SQLite files. `npm.cmd test` separately verifies WAL backup/restoration and HTTP session persistence on isolated fixtures.
