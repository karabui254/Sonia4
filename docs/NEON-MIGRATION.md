# Neon database setup and deployment

The PostgreSQL migration is prepared on `feature/postgresql-storage`. Setting up
Neon does not update the version running on Render; deploy this code and configure
DATABASE_URL to complete the switch.

## Behavior

- DATABASE_URL selects PostgreSQL for both farm records and sessions. A connection
  failure aborts startup; there is no fallback to a new SQLite database.
- On Render, production startup requires DATABASE_URL. Local development without
  it continues to use SQLite.
- Farm writes use one PostgreSQL connection and a transaction-level advisory lock
  so simultaneous payments and stock changes cannot bypass balance checks.
- Sessions retain the 45-minute idle and 10-hour absolute deadlines. Keep the same
  strong SESSION_SECRET between deployments. This does not store login passwords
  in the browser. Accounts store bcrypt hashes in PostgreSQL.
- Schema creation is transactional and checksummed. SQLite migration history is
  unchanged; adding DATABASE_URL does not automatically copy a SQLite database.

## Data prepared on 29 September 2026

The owner chose to restore other information manually from their backup. Only
flock 2026-04-KC and its approved production history were reconstructed:

- Placement: 7 April 2026; initial birds: 704; opening deaths: 45; current birds: 659.
- Opening mortality cutoff: 28 September 2026, the date the baseline was observed.
  Earlier zero-mortality production does not subtract the opening deaths again.
- 45 entries from 14 August through 27 September: 11,827 collected, 2 damaged,
  11,825 usable, and no daily mortality.
- The ten daily entries for 14–23 August are explicitly marked estimates.
- No second flock, customers, suppliers, purchases, sales, expenses or price was
  invented. Set the egg price before entering sales. Importing a complete older
  backup over these records would duplicate or replace data: reconcile first.

A new administrator was initialized with a randomly generated password. The
private local `data/NEON_FIRST_LOGIN.txt` contains that password; it is excluded
from Git and deployment artifacts. Change it after signing in. The old Render
administrator password does not automatically transfer to this new database.

## Validation

`npm run check` and `npm test` check the local code. Tests include SQLite workflow
regressions, PostgreSQL behavior through PGlite, import rollback and repeat safety,
and checksummed backup restoration into an empty PostgreSQL schema.

The PostgreSQL workflow was also exercised against Neon in an isolated temporary
schema, including concurrent payment rejection. Those temporary records were
removed. For an optional live test, set NEON_TEST_URL and run `npm run test:postgres`.
The test uses Neon's direct endpoint for its isolated search_path; the deployed
application uses the supplied pooled endpoint.

## Render cutover

1. In the existing Render web service, set DATABASE_URL to the Neon connection
   string. Store it only as a secret environment variable. Retain SESSION_SECRET,
   NODE_ENV=production, the Node 24 runtime and `npm start` command.
2. Save the environment without redeploying if Render offers that choice. Once
   the reviewed commit is on the upload branch, deploy that commit. The old
   SQLite-only code ignores DATABASE_URL; the new code requires it on Render.
3. Sign in with the new Neon administrator, change its password, then create the
   required Manager and Production Staff accounts with individual passwords.
4. Confirm 45 production entries, 11,827 collected eggs, two damaged eggs and 659
   active birds. Eggs Today can be zero because these are historical entries.
5. Verify a restart retains farm records and sessions, and inspect Render logs
   for errors. Do not enter extra data until the running release is confirmed.
6. Restore the remaining records manually from the owner's backup. Do not enter
   the same 45 production rows twice or count the 45 opening deaths a second time.

A URL pasted into chat should have its password rotated through Neon. Update the
local ignored connection file and Render DATABASE_URL to the replacement value.

## Backup and recovery

The existing `backup`, `db:restore`, and `db:migrate` commands are SQLite-specific.
For PostgreSQL use:

```powershell
node --env-file=.env.neon.local scripts/postgres-snapshot.js export data/neon-backup.json
node --env-file=.env.recovery.local scripts/postgres-snapshot.js restore-empty data/neon-backup.json
```

The export captures Sonia tables and schema checksums in one locked transaction,
including account hashes and audit history. Sessions are excluded deliberately;
restored accounts must sign in again. Protect this file as confidential and keep
verified copies outside the host. Exports refuse to overwrite existing files.

Restore only into a separate empty PostgreSQL database/branch: the command rejects
nonempty Sonia tables, differing schema checksums, invalid columns and corrupt
snapshots. It restores references and resets identity sequences. Compare row
counts, balances and flock totals before changing a deployment's connection URL.
An initial post-import snapshot was saved in the ignored local data directory.
