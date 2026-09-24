const {Store}=require('express-session');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
class SQLiteSessionStore extends Store {
  constructor(filename){
    super(); fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires)');
    this.timer=setInterval(()=>{try{this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now())}catch(e){console.error('Session cleanup failed:',e.message)}},60000).unref();
  }
  get(sid,cb){try{const row=this.db.prepare('SELECT data FROM sessions WHERE sid=? AND expires>?').get(sid,Date.now()); cb(null,row?JSON.parse(row.data):null)}catch(e){cb(e)}}
  set(sid,value,cb=()=>{}){try{this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(sid,JSON.stringify(value),new Date(value.cookie.expires).getTime());cb()}catch(e){cb(e)}}
  destroy(sid,cb=()=>{}){try{this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);cb()}catch(e){cb(e)}}
  touch(sid,value,cb){this.set(sid,value,cb)}
  close(){clearInterval(this.timer);this.db.close()}
}
module.exports=SQLiteSessionStore;
