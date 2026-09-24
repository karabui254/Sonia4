# Sonia 4.0 Farm

Express + SQLite farm operations with role-controlled production, feed, sales, payments, corrections and reporting.

## Local start

Use the Node 24 version in `.node-version`. Run `npm ci` then `npm start` (PowerShell: `npm.cmd`). Development creates `data/FIRST_LOGIN.txt` only for a new farm. Change the initial password in Settings. Do not copy demo accounts into production.

Use the role checklist in [Sample workflow](docs/SAMPLE-WORKFLOW.md) against a separate disposable test farm. No demo accounts or sample rows are bundled in production.

## Roles

- Admin: users, flocks, customers, suppliers, pricing and every operational workflow.
- Manager: production, feed usage, purchases/payments, sales/receipts, expenses, reports and audit. Master data is read-only.
- Production Staff: production and feed usage; no cost, financial, supplier or customer endpoints. Corrections are restricted to their own same-day records. All roles can change their own password and manage their own 2FA.

## Operational rules

Collected eggs = full trays × 30 + loose eggs. Damaged eggs are INCLUDED in collection; usable eggs = collected − damaged. Daily mortality automatically reduces the flock count. Current birds = initial birds − opening mortality − culls − production mortality after the optional baseline date. Leave the baseline date blank for a fresh flock. Close a flock to exclude it from active-bird totals; its history remains available. Production rate is collected eggs in laying flocks today divided by opening live birds today. Stage is a current classification, not a historical stage ledger.

Feed purchases are entered once in Purchases with category Feed and a feed type. Quantity is kg; total ÷ kg gives cost per kg. Feed Usage reduces stock against a flock. Backdated use/corrections cannot create negative stock on any date. Same-day purchases are available before same-day usage.

A sale uses the Admin price at creation. Its stored price never changes, including when editing quantity or notes. Payments are separate rows linked to a sale or purchase. Paid/Partially Paid/Unpaid and outstanding balances are derived from active payments; later payments do not create sales or expenses. Overpayment is rejected. To correct a payment, void it with a reason and record the replacement. To void a paid transaction, first void its payment records. Voiding erroneous bookkeeping is not a cash refund.

Every record edit and void requires a reason. Record updates, calculations and audit snapshots share one SQLite transaction. Masters with operational history should be deactivated/closed, not voided.

Net profit is a **simplified purchase-expensed measure**: sales − purchases − operating expenses. Feed purchases are deducted once, not again on consumption. Payments do not change profit. This is not inventory-valued accounting and does not include depreciation, flock valuation or tax adjustments. Keep asset purchases and expense classifications under review; reports disclose this basis.

## Existing installations

Migrations 001–006 are preserved. Migration 007 adds payment histories and independent feed usage without deleting existing data. Existing amount-paid values become opening payment entries. Legacy feed entries continue contributing to stock; legacy debts remain read-only and separate from new supplier balances because they may duplicate purchase liabilities. Inspect Legacy Records before importing opening balances. Migration 008 preserves the stored population of legacy flocks and marks them for Admin review. Use Mortality Review to confirm opening values and the historical cutoff before recording further deaths. Production history remains intact. New flocks use the authoritative calculation immediately.

Always back up and rehearse against a restored copy before applying migrations to a real farm. The original running application is not automatically restarted or migrated by development work.

## Tests

`npm run check` checks JavaScript syntax. `npm test` runs isolated workflow, permissions, validation, audit rollback, migration, online backup/restore, PDF response, authentication/2FA and session-restart tests. Tests create temporary databases and never target the running farm. Historical test script names redirect to this maintained suite.

## Render

The existing deployment branch is `upload`. Work on feature branches. **Do not push or merge into upload without explicit release approval.** GitHub Pages automation is removed; Actions run CI, while Render performs deployment. Configure Render to wait for the required CI checks rather than assuming Actions gate auto-deploy.

Use `npm ci`, `npm start`, `/health`, the pinned Node version, `NODE_ENV=production`, a strong stable `SESSION_SECRET`, and a real first-run `ADMIN_PASSWORD`. Let Render supply PORT. Attach a persistent disk and configure:

```
DATA_DIR=/var/data/sonia
DATABASE_PATH=/var/data/sonia/sonia4.db
SESSION_PATH=/var/data/sonia/sessions.db
BACKUP_DIR=/var/data/sonia/backups
FARM_TIMEZONE=Africa/Nairobi
```

The disk must contain database sidecars as well as the database. It is available at runtime, so migrations run at server startup, not during the build. Inventory the old effective database location before switching paths: the former absolute-path bug could have written data inside the checkout. Restore/transfer a verified backup before changing DATABASE_PATH. Otherwise startup can create an empty farm.

A Render service with a disk runs as a single instance and has deployment downtime. A shared session store alone would not make local SQLite scalable. Render settings and a real restart/redeploy persistence test must be verified separately; the repository cannot prove them.

## Backup and restore

Run `npm run backup` against the configured database. It uses the SQLite online backup API and integrity/foreign-key checks, including committed WAL data. Failed backups return a nonzero exit code. Windows shortcut: `scripts/BACKUP_SONIA_4.bat`.

Restore to a NEW path: `node scripts/restore.js BACKUP.db NEW_DATABASE.db`. Existing destinations are refused. Verify the restored application in an isolated process, then stop production and switch its database path in a controlled maintenance window. Restore is not a code rollback: do not run older code against newer schema without validation. Session restoration is intentionally separate; stable sessions remain in their own disk file.

Backups do not delete themselves. Monitor disk usage, retain a documented number of verified generations (recommended starting policy: 7 daily and 4 weekly), and copy backups to protected off-disk storage before removing old generations. Scheduling/off-disk credentials must be configured on the hosting service; no external backup destination has been assumed.

## MVP hardening

Sessions persist across browser restarts within a 45-minute idle timeout and a 10-hour absolute lifetime. Security-sensitive account changes invalidate prior sessions; older sessions without policy timestamps require one fresh sign-in. Production cookies are Secure, HTTP-only and SameSite=Strict. Browser password managers remain under user control.

`npm run build:production` creates a new allowlisted runtime directory under `dist/`. It excludes local databases, secrets, demo scripts, test fixtures and sample documentation. Automated tests, CI, migrations and backup/restore tools remain in source. See docs/MVP-READINESS.md before release.
