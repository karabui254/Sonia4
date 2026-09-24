# Sonia 4.0 MVP readiness — 24 September 2026

This is a local release candidate on `feature/mvp-hardening`. No push, Render deployment, or live database migration was performed. The working source is the isolated Sonia4 checkout supplied with this report; the original Documents/Sonia4 checkout and its running farm were not changed.

## Scope completed

The existing implementation already provided role-controlled master data, production, independent feed usage, purchases, sales using stored Admin pricing, linked payments, expenses, audited corrections, PDFs, SQLite sessions, and WAL-safe backup/restore. This pass hardens that implementation without replacing its business model.

| Files | Changes in this pass |
|---|---|
| `database/migrations/008_mortality_reconciliation.js` | Adds reconciliation status, confirming user/time, and the pre-review stored population. No production rows are deleted or rewritten. |
| `database/migrate.js` | Captures pre-upgrade counts and applies all pending migrations atomically, so upgrading through an earlier count migration cannot silently replace the stored baseline or leave a partial upgrade. |
| `backend/operations.js` | Preserves pending flock populations, blocks mortality changes until review, implements explicit Admin reconciliation and its audit entry, and provides real daily/monthly trend aggregation. New flocks use the normal authoritative count immediately. |
| `backend/session-policy.js`, `backend/session-store.js` | Enforces a 45-minute idle deadline and 10-hour absolute deadline in the persisted session store. |
| `backend/server.js` | Adds authorized mortality/trend routes, applies session policy, retains security-version invalidation and optional 2FA, and sanitizes database errors. |
| `frontend/index.html`, `frontend/js/presentation.js`, `frontend/js/app.js`, `frontend/css/main.css` | Shared formatting and forms; grouped dashboard; aligned responsive cards; loss/debt/warning colours; large-value formatting; real trend controls; mortality review; readable cancellation labels; friendly expired-session sign-in. |
| `scripts/workflow.test.js`, `scripts/mvp.test.js`, `package.json` | Maintained regression suite plus mortality, migration rollback, trend, session deadline and presentation tests. |
| `scripts/build-production.js`, `.gitignore` | Allowlisted runtime build and broader local-data/secret exclusions. |
| `README.md`, `docs/HANDOVER.md`, `docs/SAMPLE-WORKFLOW.md`, this report | Current deployment, role testing, mortality review, and handover instructions without fixed demo credentials. |

## Historical mortality procedure

1. Back up the real farm and rehearse its upgrade on a restored copy before any release.
2. Admin opens **Mortality Review**. Every non-voided flock shows initial birds, opening mortality, total and applicable production deaths, culls, cutoff, calculated population, stored population, and difference.
3. Pending legacy flocks retain their stored count. Zero-mortality production can still be entered, but changes involving deaths are blocked until review. Counts and production rates remain provisional while review is pending.
4. Review the original ledger and all displayed production records. Enter confirmed opening values. Use a cutoff only when the opening figure includes deaths through that date; otherwise leave it blank.
5. Enter the expected current count, the evidence/reason, and explicitly confirm. The server rejects a count that disagrees with the proposed baseline and applicable production deaths.
6. After confirmation, current birds = initial birds − opening mortality − culls − active production mortality after the cutoff. Production edits and voids update this result transactionally. Subsequent baseline corrections use the existing audited flock edit.

The tool does not infer which historical source is right. Admin confirmation is required even if the comparison already matches. Historical production records, including voided rows, remain available.

## Audit and financial behaviour retained

Completed records have **Edit** and **Void / Cancel Record**, not physical deletion. Reasons, actor, timestamp and before/after snapshots remain in audit history. Voided records are excluded from totals and remain visible through Show voided and Audit Log. Payment corrections retain the existing void-and-replacement procedure; a later payment stays attached to its original sale or purchase. Voiding bookkeeping does not issue a cash refund.

Admin controls the current egg price. Existing sales retain their stored unit price. Managers cannot change master data or pricing. Production Staff cannot access financial APIs and can correct only their own same-day operational entries.

Simplified Net Profit remains sales minus purchases minus operating expenses. It is not full accrual accounting, inventory valuation, or depreciation accounting.

## Session policy

Sessions survive a browser close/reopen within their 45-minute idle and 10-hour absolute deadlines. Activity cannot extend the absolute deadline. Production cookies are Secure, HTTP-only and SameSite=Strict. Password changes, deactivation, role changes and Admin security resets invalidate prior sessions. Optional 2FA is retained.

Existing sessions without the new timestamps require a fresh sign-in once after upgrade. Expiry during work returns the user to login with a clear message. Unsaved form values are not retained after expiry. The application does not control browser password-manager preferences or store a reusable login password in the frontend.

## Repository cleanup

Removed from this branch:

- `scripts/demo.js` and `scripts/seed-database.js`, including their fixed demo password and automatic sample population.
- `.vscode/launch.json`, a local editor launcher.
- `frontend/assets/layer-hen-header.png`, an unused generated asset.

Updated old documentation to remove demo credentials and obsolete demo commands. No farm database was removed.

Ignored: node_modules, actual `.env` files, local data and backups, `.db`/WAL/SHM files, SQLite variants, session-secret files, FIRST_LOGIN.txt, logs, editor settings, work files and dist output. Environment templates remain tracked. Old demo credentials remain in historical Git commits; they are disposable development credentials, not production secrets. This pass does not rewrite Git history.

Migrations **001–007 are retained unchanged in this pass**; migration 008 is added. The migration runner, production configuration, backup/restore tools, automated tests, GitHub Actions CI, `.env.example`, `.gitignore` and deployment README remain. The obsolete GitHub Pages workflow was already removed in the preceding implementation; only CI checks remain.

`npm run build:production` creates a fresh allowlisted runtime under `dist/`. It does not inspect or delete any farm database. The runtime excludes test/sample scripts and documents, local environment files, databases, backups, node_modules and Git history. Source still retains automated tests and CI. Dependencies are installed with `npm ci` at the deployment build stage; migrations run at runtime when the persistent disk is mounted.

## Verification

Automated: `npm test` — **13 tests passed, 0 failed**. `npm run check` — JavaScript syntax checks passed.

Coverage includes complete daily operations, historical sale pricing, payments and balances, stock validation, transactional audit rollback, role permissions, same-day correction restrictions, repeatable migrations, legacy mortality/debt preservation, WAL backup/restore, PDF response, optional 2FA, session restart persistence, idle/absolute HTTP expiry, password/role/deactivation/reset invalidation, production Secure/HTTP-only/SameSite cookies, explicit mortality confirmation, retained history, culls, mortality edit/void, migration rollback and real trend aggregation.

Browser verification used a separate disposable farm on localhost:3018 and unique temporary credentials outside the repository. No sample records were inserted into a deployment database.

| Role | Verified interactively |
|---|---|
| Admin | Create flock/customer/supplier, set egg price, view finances, edit and void an expense, view cancelled history and audit, review and confirm a legacy mortality overlap. |
| Manager | Production, feed purchase and calculated unit cost, supplier payment, feed usage, sale with locked price, customer payment, expense, reports. Flock master data is read-only and mortality review is unavailable. |
| Production Staff | Production and feed usage; own same-day production correction; Manager-owned record has no correction buttons; no financial navigation or dashboard. API denial is also covered by automated tests. |

Dashboard checked at **1920, 1366, 820 and 390 pixels**: no KPI overflow or horizontal page overflow; equal main-value offsets, including warning cards. A large test loss displayed as `KSh -987.66M`, retained its full amount in the accessible label/tooltip, and stayed red on one line. Detailed screens retain cents. The deliberately abnormal 196% production rate remained visible with a warning; it returned below 100% after the test flock population changed, without capping the rate.

The mortality dialog was completed at 390px. Major screens use shared forms, tables, spacing, loading/save/error states and responsive containers. Wide tables scroll within their own region. Empty dashboard and no-trend-data states were checked. Mobile pages checked: Flocks, Production, Feed, Purchases, Sales, Customers, Suppliers, Expenses, Reports, Audit and Settings (including Users and Egg Pricing). A rejected mortality entry showed a readable validation message; keyboard focus had a visible 3px outline. Forced session expiry returned to mobile login with the friendly expiry message. Trend controls use real active records for 7 days, 30 days and the last 12 months. Browser checking supplements automated tests; this is not a full assistive-technology certification or cross-browser device lab.

Use `docs/SAMPLE-WORKFLOW.md` for repeatable role-based manual entries and expected totals on a blank test farm. Do not run those entries against production.

## Production work still required

No Render settings were changed or proven by these local checks. Before approving release:

1. Confirm which database file the live service actually uses. Take an online backup, verify integrity and restore it to an isolated path. Never substitute a blank database by changing paths without transferring the real data.
2. Review the upgraded restored copy with Admin, especially pending mortality and legacy debts. Retain audit evidence and a verified rollback backup.
3. Verify Render's persistent disk mount and runtime paths for the farm database, its WAL/SHM sidecars, sessions and backups. Use a single instance for this local SQLite design.
4. Set `NODE_ENV=production`, stable strong `SESSION_SECRET`, correct `FARM_TIMEZONE`, Node 24, and the real first-run Admin password only when creating a new farm. Let Render provide PORT. Confirm HTTPS proxy behaviour and secure cookies.
5. Configure backup scheduling, retention and protected off-disk copies. Local disk backups alone do not protect against loss of the disk.
6. Require successful CI and explicit approval before merging/pushing to `upload`. Schedule the deployment window and then perform real restart/redeploy persistence and login checks.

Known limits retained: simplified purchase-expensed profit, legacy debts requiring human review, current flock stage rather than a historical stage ledger, and a single SQLite service with deployment downtime. Audit/record listings are not paginated and should be assessed against the farm's actual historical volume. The preserved Recent Production list follows the existing record order rather than being redesigned in this UI pass. No unrelated accounting modules were added.

Recommendation: ready for review and a restored-production-data rehearsal; not yet a verified live Render release.
