const fs=require('node:fs');
const path=require('node:path');
const {spawnSync,spawn}=require('node:child_process');
const sample=process.argv.includes('--sample');
const dir=path.resolve(__dirname,'..','data',sample?'demo-sample':'demo');
const filename=path.join(dir,'sonia4.db');
const fresh=!fs.existsSync(filename);
const env={...process.env,NODE_ENV:'test',PORT:process.env.DEMO_PORT||'3016',DATA_DIR:dir,DATABASE_PATH:filename,SESSION_PATH:path.join(dir,'sessions.db'),BACKUP_DIR:path.join(dir,'backups'),FARM_TIMEZONE:'Africa/Nairobi'};
if(fresh){const result=spawnSync(process.execPath,[path.join(__dirname,'seed-database.js'),filename],{env,stdio:'inherit'});if(result.status)process.exit(result.status)}
if(sample&&fresh){
  Object.assign(process.env,env);
  const {migrate}=require('../database/migrate');const {createOperations,today}=require('../backend/operations');
  const db=migrate(filename),op=createOperations(db);
  try{
    const a={id:1,role:'admin'},m={id:2,role:'manager'},s={id:3,role:'production_staff'},date=today();
    const f=op.write('flocks',{batch:'TEST-LAYERS-001',breed:'Layers',placement_date:date,initial_bird_count:100},a);
    const supplier=op.write('suppliers',{name:'TEST Feed Supplier',products:'Layers feed'},a);
    const customer=op.write('customers',{name:'TEST Egg Customer'},a);
    op.run("UPDATE pricing SET value=450 WHERE name='egg_tray'");
    const p=op.write('purchases',{date,supplier_id:supplier.id,category:'Feed',feed_type:'Layers',item:'Layers feed',quantity:100,total:6000,amount_paid:2000},m);
    op.write('production',{date,flock_id:f.id,trays:3,loose_eggs:4,damaged_eggs:2,mortality:1},s);
    op.write('feed',{date,flock_id:f.id,type:'Layers',consumed_kg:12},s);
    const sale=op.write('sales',{date,customer_id:customer.id,quantity:2,amount_paid:400},m);
    op.write('expenses',{date,category:'Transport',item:'Egg delivery',amount:150},m);
    op.run("UPDATE pricing SET value=500 WHERE name='egg_tray'");
    op.write('sales',{date,customer_id:customer.id,quantity:1,amount_paid:500},m);
    op.payment('sales',sale.id,{date,amount:500,reference:'Remaining customer payment'},m);
    op.payment('purchases',p.id,{date,amount:4000,reference:'Remaining supplier payment'},m);
  }finally{db.close()}
}
console.log(`\nLOCAL DEMO ONLY: http://localhost:${env.PORT}\nDatabase: ${filename}\nAccounts: demo-admin / demo-manager / demo-production\nPassword: SoniaDemo-2026!\n${sample?'Sample workflow is already recorded.':'Enter the examples in docs/SAMPLE-WORKFLOW.md.'}\nExisting demo data is preserved on restart. Ctrl+C stops this demo.\n`);
const child=spawn(process.execPath,[path.join(__dirname,'../backend/server.js')],{env,stdio:'inherit'});
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code||0));
