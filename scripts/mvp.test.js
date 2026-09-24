const {test}=require('node:test');
const assert=require('node:assert/strict');
const {migrate}=require('../database/migrate');
const {createOperations,today}=require('../backend/operations');
const policy=require('../backend/session-policy');
const admin={id:1,role:'admin'};
for(const [opening,deaths,culls] of [[3,0,0],[0,3,0],[3,3,2]])test(`legacy reconciliation ${opening}/${deaths}/${culls} preserves history`,()=>{
 const db=migrate(':memory:');try{
 db.exec("INSERT INTO users(id,username,password_hash,role) VALUES(1,'reviewer','unused','admin')");
 db.prepare("INSERT INTO flocks(batch,initial_bird_count,received,mortality,culls,current_bird_count) VALUES('Legacy',100,100,?,?,97)").run(opening,culls);
 db.prepare("INSERT INTO production(date,flock_id,mortality) VALUES('2026-01-01',1,?)").run(deaths);
 const op=createOperations(db),history=op.all('SELECT * FROM production');
 assert.equal(op.list('flocks',admin)[0].current_bird_count,97);
 assert.equal(op.mortalityReport()[0].mortality_reconciled,0);
 assert.throws(()=>op.write('production',{flock_id:1,date:today(),mortality:1},admin),/review|reconcil/i);
 const cutoff=opening&&deaths?'2026-01-01':null;
 const current=100-opening-culls-(cutoff?0:deaths);
 const body={confirmed:true,initial_bird_count:100,mortality:opening,culls,mortality_baseline_date:cutoff,confirmed_current_birds:current,reason:'Reviewed original opening ledger'};
 assert.throws(()=>op.reconcileMortality(1,body,{id:1,role:'manager'}),/Forbidden/);
 assert.throws(()=>op.reconcileMortality(1,{...body,confirmed:false},admin),/Confirm/);
 assert.throws(()=>op.reconcileMortality(1,{...body,confirmed_current_birds:1},admin),/do not match/);
 op.reconcileMortality(1,body,admin);
 assert.deepEqual(op.all('SELECT * FROM production'),history);

 assert.equal(op.list('flocks',admin)[0].current_bird_count,current);
 const p=op.write('production',{date:today(),flock_id:1,mortality:2},admin);
 assert.equal(op.list('flocks',admin)[0].current_bird_count,current-2);
 op.write('production',{mortality:1,reason:'Correct count'},admin,p.id);
 assert.equal(op.list('flocks',admin)[0].current_bird_count,current-1);
 op.voidRecord('production',p.id,{reason:'Duplicate'},admin);
 assert.equal(op.list('flocks',admin)[0].current_bird_count,current);
 assert.equal(op.all("SELECT * FROM audit_log WHERE action='mortality-reconciliation'").length,1);
 }finally{db.close()}
});
test('session idle and absolute deadlines cannot be extended beyond policy',()=>{
 const now=100000000,session={user:{id:1},cookie:{}};
 policy.start(session,now);assert.equal(policy.expired(session,now+policy.IDLE_MS-1),false);
 assert.equal(policy.expired(session,now+policy.IDLE_MS),true);
 policy.touch(session,now+policy.ABSOLUTE_MS-1000);
 assert.equal(session.cookie.maxAge,1000);
 assert.equal(policy.expiry(session),now+policy.ABSOLUTE_MS);
 assert.equal(policy.expired(session,now+policy.ABSOLUTE_MS),true);
 assert.equal(policy.expired({cookie:{}},now),true);
});
test('summary currency preserves negative sign and detailed precision',()=>{
 const p=require('../frontend/js/presentation');
 assert.equal(p.currency(-6000,true),'KSh -6,000');
 assert.equal(p.currency(6000),'KSh 6,000.00');
});
test('failed upgrade rolls back earlier migrations and stored counts',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {DatabaseSync}=require('node:sqlite');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sonia-atomic-')),file=path.join(dir,'farm.db');
 const migration=require('../database/migrations/008_mortality_reconciliation'),original=migration.up;
 try{
  migration.up=()=>{throw new Error('Injected migration failure')};
  assert.throws(()=>migrate(file),/008.*Injected/);
  const db=new DatabaseSync(file);try{assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,0);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='flocks'").get(),undefined)}finally{db.close()}
  migration.up=original;const fixed=migrate(file);fixed.close();
 }finally{migration.up=original;fs.rmSync(dir,{recursive:true,force:true})}
});
test('trend aggregates real active records and excludes voided production',()=>{
 const db=migrate(':memory:');try{
 db.exec("INSERT INTO users(id,username,password_hash,role) VALUES(1,'reviewer','unused','admin')");
 const op=createOperations(db),f=op.write('flocks',{batch:'Trend',breed:'Layers',initial_bird_count:100,placement_date:today()},admin);
 const first=op.write('production',{flock_id:f.id,date:today(),trays:2},admin);
 op.write('production',{flock_id:f.id,date:today(),trays:1},admin);
 assert.equal(op.productionTrend('7').rows[0].eggs,90);
 assert.equal(op.productionTrend('30').rows[0].records,2);
 op.voidRecord('production',first.id,{reason:'Duplicate'},admin);
 assert.equal(op.productionTrend('monthly').rows[0].eggs,30);
 assert.throws(()=>op.productionTrend('invalid'),/Invalid/);
 }finally{db.close()}
});
