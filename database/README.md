# Database

SQLite runtime files live in `data/` and are ignored by Git. Schema changes are applied in order by `database/migrate.js` and recorded in `schema_migrations`.

Add a new numbered migration under `migrations/` for every future schema change. Do not delete `sonia4.db` to upgrade an installation.
