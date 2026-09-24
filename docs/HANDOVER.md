# Implementation handover

## Location and branch

Completed working copy: `C:\Users\user\Documents\Codex\2026-09-24\i-ha\outputs\Sonia4`

Branch: `feature/complete-farm-workflow`, based on original `upload` commit `cf6ecc0`.

The original `C:\Users\user\Documents\Sonia4` checkout denied Git metadata writes, even after a permission grant. Implementation therefore uses a separate local clone. The original checkout, its runtime database, and the app on port 3000 were not changed. No remote push or Render deployment occurred.

## Try the workflow

The sample guide is `docs/SAMPLE-WORKFLOW.md`. From this completed working copy:

- `npm.cmd run demo`: separate blank farm, suitable for manually entering the sample guide.
- `npm.cmd run demo:sample`: separate pre-filled farm containing the guide's final state.

Both default to port 3016. Stop one before starting the other. `DEMO_PORT` can select another port. Use demo-admin, demo-manager or demo-production; password SoniaDemo-2026! for all three. These are local test accounts only.

The browser-test farm used during implementation is retained separately under `data/browser-test` and is not the blank demo. It contains intermediate checks and may not have the guide's final totals. It was served on port 3015.

## Verification completed

- `npm run check`: syntax checks across server, frontend, migrations and scripts.
- `npm test`: six passing groups, covering workflow calculations, validation/transaction rollback, role restrictions, historical pricing, payment corrections, migration preservation, WAL backup/restore, HTTP authentication/2FA and persistent sessions across process restart.
- Browser checks using all three demo roles: login/logout, master entry, purchase cost calculation, supplier settlement, structured edit dialog, production/mortality, separate feed use, staff privacy, sale calculation, expense submission and Reports navigation.
- Responsive check at 390px width: page-level overflow corrected. Tables scroll within their containers.
- PDF inspection: all pages of sample farm and production reports rendered and visually inspected; sample financial totals match the dashboard.

CI has not run on GitHub yet. Linux CI, real Render configuration, and a real Render disk/redeploy test remain deployment verification tasks. No claim is made that live Render persistence has been proven.

## Bring the branch into the original checkout

Run from your normal PowerShell account, which owns the original repository, after checking it has no uncommitted work:

```powershell
cd C:\Users\user\Documents\Sonia4
git status --short --branch
git fetch 'C:\Users\user\Documents\Codex\2026-09-24\i-ha\outputs\Sonia4' feature/complete-farm-workflow:feature/complete-farm-workflow
git switch feature/complete-farm-workflow
npm.cmd ci
npm.cmd test
```

This imports and checks out a LOCAL feature branch. It does not push to upload or contact Render. If the feature branch already exists or your worktree is dirty, stop and reconcile it; do not force/reset it.

Do not start the new server against your real database until a verified WAL-safe backup and restored-copy migration rehearsal are complete. The new backup script can be run from this completed checkout with DATABASE_PATH pointing to the existing database and BACKUP_DIR pointing to a safe backup location. It does not migrate the source database.

## Accounting and legacy-data boundaries

Net profit is explicitly purchase-expensed: sales minus purchases minus expenses. It does not value closing inventory or depreciation. Feed is not charged again on use, and payments do not alter profit.

Migration 007 preserves ambiguous legacy feed/debt data for reconciliation rather than guessing which rows duplicate each other. Legacy feed quantities count toward stock. Legacy supplier debts are displayed separately from purchase-linked balances. Existing flock-level mortality uses a baseline date where needed; verify actual birds before adding deaths around that baseline. These are data-reconciliation requirements before production rollout, not grounds for deleting old data.

## Release controls

Render remains connected to upload. Obtain explicit approval before any push/merge into upload. Configure CI gating, disk paths, secrets and Node runtime on Render, verify a restored backup, and then rehearse restart/redeploy and rollback on staging. Do not switch absolute database paths without locating and transferring the old effective database first.
