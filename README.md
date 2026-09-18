# Sonia 4.0 Farm — VS Code / GitHub Source

This repository contains the complete editable source for Sonia 4.0 Farm.

## Architecture
- `frontend/` — browser UI (HTML, CSS, JavaScript, images)
- `backend/server.js` — Node.js/Express API, authentication, business logic and SQLite access
- `data/` — runtime SQLite database (ignored by Git)
- `backups/` — local database backups (ignored by Git)
- `scripts/` — Windows start/backup helpers

## Run in VS Code
1. Install Node.js 22 or newer.
2. Open this folder in VS Code.
3. Open Terminal.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

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
The app automatically creates `data/sonia4.db` at runtime. The database is intentionally excluded from GitHub by `.gitignore`.

## Configuration
Copy `.env.example` to `.env` for local/private configuration. Never commit `.env`.
