const {
  Store
} = require('express-session');
const policy = require('./session-policy');
class PostgresSessionStore extends Store {
  constructor(pool) {
    super();
    this.pool = pool;
    this.lastCleanup = 0;
  }
  get(sid, cb) {
    this.pool.query('SELECT data FROM sessions WHERE sid=$1 AND expires>$2', [sid, Date.now()]).then(r => cb(null, r.rows[0] ? JSON.parse(r.rows[0].data) : null)).catch(cb);
  }
  set(sid, value, cb = () => {}) {
    this.pool.query('INSERT INTO sessions(sid,data,expires) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET data=excluded.data,expires=excluded.expires', [sid, JSON.stringify(value), policy.expiry(value)]).then(() => {
      cb();
      this.cleanup();
    }).catch(cb);
  }
  destroy(sid, cb = () => {}) {
    this.pool.query('DELETE FROM sessions WHERE sid=$1', [sid]).then(() => cb()).catch(cb);
  }
  touch(sid, value, cb) {
    this.set(sid, value, cb);
  }
  cleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < 300000) return;
    this.lastCleanup = now;
    this.pool.query('DELETE FROM sessions WHERE expires<=$1', [now]).catch(() => console.error('Session cleanup failed'));
  }
  close() {}
}
module.exports = PostgresSessionStore;
