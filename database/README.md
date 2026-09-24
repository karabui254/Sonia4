# Database operations

The server and migration CLI share backend/config.js. All new schema changes must be numbered migrations; never change an applied migration or delete a farm database to upgrade it.

Migration 007 adds operational workflow tables and preserves legacy records. See README.md for reconciliation rules and scripts/backup.js and scripts/restore.js for verified WAL-safe backup and non-overwriting restoration. Rehearse migrations against a restored copy before touching production.
