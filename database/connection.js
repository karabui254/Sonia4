const {
  AsyncLocalStorage
} = require('node:async_hooks');
const wrappers = new WeakMap();
function adapt(raw) {
  if (raw.all && raw.transaction) return raw;
  if (wrappers.has(raw)) return wrappers.get(raw);
  const context = new AsyncLocalStorage();
  let pending = Promise.resolve();
  const queue = fn => {
    if (context.getStore()) return Promise.resolve().then(fn);
    const task = pending.then(() => context.run(true, fn));
    pending = task.catch(() => {});
    return task;
  };
  const db = {
    dialect: 'sqlite',
    all: (sql, ...args) => queue(() => raw.prepare(sql).all(...args)),
    get: (sql, ...args) => queue(() => raw.prepare(sql).get(...args)),
    run: (sql, ...args) => queue(() => raw.prepare(sql).run(...args)),
    transaction: fn => queue(async () => {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const value = await fn();
        raw.exec('COMMIT');
        return value;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    }),
    close: () => queue(() => raw.close())
  };
  wrappers.set(raw, db);
  return db;
}
// SQL comes from application code; preserve quoted literals while numbering parameters.
function postgresSql(sql) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === '?' ? '$' + ++index : token).replace(/(\$\d+) IS (NOT )?NULL/g, '$1::text IS $2NULL');
}
function postgres(pool) {
  const context = new AsyncLocalStorage();
  const query = (sql, args) => (context.getStore() || pool).query(postgresSql(sql), args);
  const normalize = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  return {
    dialect: 'postgres',
    pool,
    all: async (sql, ...args) => normalize((await query(sql, args)).rows),
    get: async (sql, ...args) => normalize((await query(sql, args)).rows)[0],
    run: async (sql, ...args) => {
      const insert = /^\s*INSERT\s+INTO\s+/i.test(sql);
      const result = await query(insert && !/\bRETURNING\b/i.test(sql) ? sql + ' RETURNING id' : sql, args);
      return {
        changes: result.rowCount,
        lastInsertRowid: result.rows?.[0]?.id
      };
    },
    transaction: async fn => {
      if (context.getStore()) throw new Error('Nested transactions are not supported');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(704004)');
        const result = await context.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}
async function connect(config) {
  if (!config.databaseUrl) return adapt(require('./migrate').migrate(config.databasePath));
  const {
    Pool,
    types
  } = require('pg');
  types.setTypeParser(20, value => {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe range');
    return number;
  });
  const pool = new Pool(poolOptions(config.databaseUrl));
  pool.on('error', () => console.error('Database pool connection interrupted'));
  const db = postgres(pool);
  try {
    await require('./postgres-migrate').migrate(db);
    return db;
  } catch (e) {
    await pool.end();
    throw e;
  }
}
function poolOptions(connectionString) {
  const url = new URL(connectionString);
  if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
  return {
    connectionString: url.toString(),
    enableChannelBinding: true,
    max: 5,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000
  };
}
module.exports = {
  adapt,
  postgresSql,
  postgres,
  connect,
  poolOptions
};
