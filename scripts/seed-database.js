const fs=require('node:fs');
const path=require('node:path');
const bcrypt=require('bcryptjs');
const {migrate}=require('../database/migrate');
const target=process.argv[2];
if(!target)throw new Error('Provide a NEW disposable database path, e.g. node scripts/seed-database.js data/demo/sonia4.db');
const output=path.resolve(target);
if(fs.existsSync(output))throw new Error('Refusing to overwrite an existing database');
const db=migrate(output);
try{db.exec('BEGIN');for(const [name,role] of [['demo-admin','admin'],['demo-manager','manager'],['demo-production','production_staff']])db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(name,bcrypt.hashSync('SoniaDemo-2026!',12),role);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}finally{db.close()}
console.log(`Empty demo farm ready: ${output}\nUsers: demo-admin, demo-manager, demo-production\nDemo password: SoniaDemo-2026!\nUse only for isolated local testing.`);
