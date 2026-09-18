# Sonia 4.0 Farm

This repository contains the complete editable source for Sonia 4.0 Farm.

## Architecture
- `frontend/` — browser UI (HTML, CSS, JavaScript, images)
- `backend/server.js` — Node.js/Express API, authentication and business logic
- `backend/config.js` — environment-aware runtime configuration
- `database/` — numbered SQLite migrations and migration runner
- `data/` — runtime SQLite database (ignored by Git)
- `backups/` — local database backups (ignored by Git)
- `scripts/` — Windows start/backup helpers

## Run in VS Code
1. Install Node.js 22 or newer.
2. Open this folder in VS Code.
3. Open Terminal.
4. Copy `.env.development.example` to `.env.development` (or use `.env.example` as `.env`).
5. Run `npm.cmd install` on PowerShell if the `npm` script is blocked by execution policy.
6. Run `npm.cmd start`.
7. Open `http://localhost:3000`.

On Windows you can instead double-click `START_SONIA_4.bat`.

## Important: GitHub Pages
GitHub Pages can publish only the static frontend. Sonia 4.0's login, SQLite database and API require the Node backend. Do not publish the `data/` directory or secrets. Use GitHub for source control, and run the complete app on your VM/server.

## Where to edit
- Overall page/layout: `frontend/index.html`
- Turquoise theme/UI: `frontend/css/main.css`
- Browser functionality/API calls/charts/forms: `frontend/js/app.js`
- API/database/authentication/business logic: `backend/server.js`
- Logo and hen artwork: `frontend/assets/`

## Database
The app creates `data/sonia4.db` and applies all pending migrations at startup. Migration history is stored in `schema_migrations`; future upgrades must add a numbered file under `database/migrations/` rather than deleting the database.

Create a disposable fixture with `npm.cmd run db:seed`. It writes `data/sonia4.seed.db`, which is ignored by Git.

The access-control smoke test uses the seeded Admin, Manager, and Production Staff accounts. Start the app against the seed database, then run `npm.cmd run test:access-control`.

The correction smoke test uses the same seeded accounts and verifies edit, required-reason void, dashboard exclusion, audit snapshots, same-day staff corrections, and hard-delete rejection: `npm.cmd run test:audit-void`.

The master-data smoke test verifies Admin-only flock/customer/supplier creation, generated IDs, flock lifecycle and counts, active lookup filtering, supplier references, balances, and history: `npm.cmd run test:master-data`.

## Master data
Flocks, customers, and suppliers are reusable master records. Flocks have unique batch numbers, placement dates, initial/current bird counts, and Active/Closed status. Customers receive `CUS-0001`-style IDs and suppliers receive `SUP-0001`-style IDs. New production, feed, sales, and purchase entries can only select active master records; inactive or closed records remain available in history but do not appear in new-entry lookups.

## Access control
Roles and permissions are defined centrally in `backend/access-control.js` and enforced by the API. Admin has full access, including users, master records, and pricing. Manager records production, sales, purchases, and expenses, but cannot create flocks, customers, or suppliers or change pricing. Production Staff records production and feed intake only and has no financial access. Denied requests are written to `audit_log`, and inactive sessions are rejected.

## Configuration
Copy `.env.development.example` to `.env.development` for local configuration. Use `.env.production.example` as the production template. Never commit `.env`, environment-specific files, database files, backups, or generated first-login credentials.

## GitHub baseline
The source repository is `Sonia 4.0 Farm`. Keep `main` as the production baseline and use feature branches for changes. Create the baseline tag after review with `git tag -a v4.0.0-baseline -m "Sonia 4.0 Farm development baseline"` and push it with `git push origin main --tags`.
