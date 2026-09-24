const express=require('express');
const path=require('node:path');
const fs=require('node:fs');
const bcrypt=require('bcryptjs');
const session=require('express-session');
const {generateSecret,generateURI,verifySync}=require('otplib');
const QRCode=require('qrcode');
const PDFDocument=require('pdfkit');
const helmet=require('helmet');
const {rateLimit}=require('express-rate-limit');
const {config,createDevelopmentSecret}=require('./config');
const {ROLES,permissionsForRole,can}=require('./access-control');
const {migrate}=require('../database/migrate');
const SQLiteSessionStore=require('./session-store');
const {createOperations,today,number,text}=require('./operations');
fs.mkdirSync(config.dataDir,{recursive:true});
function sessionSecret(){
  if(config.sessionSecret)return config.sessionSecret;
  const filename=path.join(config.dataDir,'.session-secret');
  if(fs.existsSync(filename))return fs.readFileSync(filename,'utf8').trim();
  const secret=createDevelopmentSecret();fs.writeFileSync(filename,secret,{mode:0o600});return secret;
}
const secret=sessionSecret();
const database=migrate(config.databasePath);
const op=createOperations(database);
const store=new SQLiteSessionStore(config.sessionPath);
const app=express();
// Cookies are scoped to hosts, not ports: isolate demos from the real local farm.
const cookieName=config.environment==='test'?`sonia.demo.${config.port}.sid`:'sonia.sid';
app.set('trust proxy',1);
app.use(helmet());
app.get('/health',(req,res)=>{try{database.prepare('SELECT 1').get();res.json({ok:true,service:'sonia-4-farm'})}catch{res.status(503).json({ok:false})}});
app.use(express.json({limit:'1mb'}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:config.environment==='test'?10000:2000,standardHeaders:'draft-8',legacyHeaders:false}));
app.use(session({name:cookieName,secret,store,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'strict',secure:config.isProduction,maxAge:8*60*60*1000}}));
app.use('/api',(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    const origin=req.get('origin');
    if(origin&&origin!==`${req.protocol}://${req.get('host')}`)return res.status(403).json({error:'Cross-origin request denied'});
    if(!req.is('application/json'))return res.status(415).json({error:'Send JSON'});
  }
  next();
});
function auth(req,res,next){
  const s=req.session.user;if(!s)return res.status(401).json({error:'Authentication required'});
  const user=op.get('SELECT id,username,role,is_active,session_version,totp_enabled FROM users WHERE id=?',s.id);
  if(!user||!user.is_active||s.session_version!==user.session_version)return req.session.destroy(()=>res.status(401).json({error:'Session expired. Sign in again.'}));
  req.user=user;next();
}
function permit(permission){return (req,res,next)=>{if(can(req.user.role,permission))return next();op.audit(req.user,'denied','authorization',null,null,null,permission);res.status(403).json({error:'Forbidden'})}}
function route(fn){return async(req,res,next)=>{try{await fn(req,res)}catch(e){if(e.code?.startsWith('SQLITE'))console.error('Database request failed:',e.message);const message=e.message?.includes('UNIQUE constraint')?'That record already exists':e.message;res.status(e.status||400).json({error:message||'Request failed'})}}}
const saveSession=req=>new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
const regenerate=req=>new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
const userSession=u=>({id:u.id,username:u.username,role:u.role,session_version:u.session_version});
const safeUser=u=>({id:u.id,username:u.username,role:u.role,totp_enabled:u.totp_enabled});
function validPassword(p){if(typeof p!=='string'||p.length<12||Buffer.byteLength(p)>72)throw new Error('Password must be at least 12 characters and at most 72 UTF-8 bytes');return p}
function verifyOtp(token,secret){try{return verifySync({token:String(token||''),secret}).valid}catch{return false}}
app.post('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:config.environment==='test'?1000:30,skipSuccessfulRequests:true}),route(async(req,res)=>{
  const {username,password,otp}=req.body||{};
  const u=op.get('SELECT * FROM users WHERE username=?',typeof username==='string'?username:'');
  if(!u||!u.is_active||typeof password!=='string'||!bcrypt.compareSync(password,u.password_hash))return res.status(401).json({error:'Invalid username or password'});
  if(u.totp_enabled&&!otp)return res.json({requires2fa:true});
  if(u.totp_enabled&&!verifyOtp(otp,u.totp_secret))return res.status(401).json({error:'Invalid two-factor code'});
  await regenerate(req);req.session.user=userSession(u);await saveSession(req);
  res.json({user:safeUser(u),permissions:permissionsForRole(u.role)});
}));
app.get('/api/auth/me',(req,res,next)=>{if(!req.session.user)return res.json({user:null,permissions:[]});auth(req,res,()=>res.json({user:safeUser(req.user),permissions:permissionsForRole(req.user.role)}))});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(e=>{res.clearCookie(cookieName);res.status(e?500:200).json(e?{error:'Unable to sign out'}:{ok:true})}));
app.post('/api/auth/password',auth,route(async(req,res)=>{
  const u=op.get('SELECT * FROM users WHERE id=?',req.user.id);
  if(typeof req.body.current_password!=='string'||!bcrypt.compareSync(req.body.current_password,u.password_hash))throw new Error('Current password is incorrect');
  const hash=bcrypt.hashSync(validPassword(req.body.new_password),12);
  op.transaction(()=>{op.run('UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=?',hash,u.id);op.audit(req.user,'password-change','users',u.id,null,null)});
  await regenerate(req);req.session.user=userSession(op.get('SELECT * FROM users WHERE id=?',u.id));await saveSession(req);res.json({ok:true});
}));
app.post('/api/auth/2fa/setup',auth,route(async(req,res)=>{
  if(req.user.totp_enabled)throw new Error('Two-factor authentication is already enabled');
  const secret=generateSecret(),uri=generateURI({issuer:'Sonia 4.0 Farm',label:req.user.username,secret});
  req.session.pendingTotp={secret,expires:Date.now()+10*60*1000};await saveSession(req);
  res.json({secret,qr:await QRCode.toDataURL(uri)});
}));
app.post('/api/auth/2fa/confirm',auth,route(async(req,res)=>{
  const pending=req.session.pendingTotp;
  if(!pending||pending.expires<Date.now())throw new Error('Setup expired. Start again.');
  if(!verifyOtp(req.body.token,pending.secret))throw new Error('Invalid authenticator code');
  op.transaction(()=>{op.run('UPDATE users SET totp_secret=?,totp_enabled=1,session_version=session_version+1 WHERE id=?',pending.secret,req.user.id);op.audit(req.user,'enable-2fa','users',req.user.id,null,null)});
  await regenerate(req);req.session.user=userSession(op.get('SELECT * FROM users WHERE id=?',req.user.id));await saveSession(req);res.json({ok:true});
}));
app.post('/api/auth/2fa/disable',auth,route(async(req,res)=>{
  const u=op.get('SELECT * FROM users WHERE id=?',req.user.id);
  if(!u.totp_enabled||typeof req.body.password!=='string'||!bcrypt.compareSync(req.body.password,u.password_hash)||!verifyOtp(req.body.token,u.totp_secret))throw new Error('Password and current authenticator code required');
  op.transaction(()=>{op.run('UPDATE users SET totp_enabled=0,totp_secret=NULL,session_version=session_version+1 WHERE id=?',u.id);op.audit(req.user,'disable-2fa','users',u.id,null,null)});
  await regenerate(req);req.session.user=userSession(op.get('SELECT * FROM users WHERE id=?',u.id));await saveSession(req);res.json({ok:true});
}));
app.get('/api/dashboard',auth,permit('dashboard:read'),route((req,res)=>res.json(op.dashboard(req.user))));
app.get('/api/feed-stock',auth,permit('feed:read'),route((req,res)=>res.json(op.stock())));
for(const kind of Object.keys(op.tables)){
  app.get('/api/'+kind,auth,permit(`${kind}:read`),route((req,res)=>{let rows=op.list(kind,req.user,req.query.include_voided==='1');if(req.query.active_only==='1')rows=rows.filter(r=>r.status==='Active'&&!r.is_voided);res.json(rows)}));
  app.post('/api/'+kind,auth,permit(`${kind}:write`),route((req,res)=>res.json(op.write(kind,req.body,req.user))));
  app.put('/api/'+kind+'/:id',auth,permit(`${kind}:write`),route((req,res)=>res.json(op.write(kind,req.body,req.user,number(req.params.id,'ID',1,true)))));
  app.post('/api/'+kind+'/:id/void',auth,permit(`${kind}:write`),route((req,res)=>res.json(op.voidRecord(kind,number(req.params.id,'ID',1,true),req.body,req.user))));
}
for(const kind of ['sales','purchases']){
  const key=kind==='sales'?'sale_id':'purchase_id';
  app.get(`/api/${kind}/:id/payments`,auth,permit(`${kind}:read`),route((req,res)=>res.json(op.all(`SELECT p.*,u.username FROM payments p LEFT JOIN users u ON u.id=p.created_by WHERE ${key}=? ORDER BY p.date,p.id`,number(req.params.id,'ID',1,true)))));
  app.post(`/api/${kind}/:id/payments`,auth,permit(`${kind}:write`),route((req,res)=>res.json(op.payment(kind,number(req.params.id,'ID',1,true),req.body,req.user))));
}
app.post('/api/payments/:id/void',auth,route((req,res)=>res.json(op.voidPayment(number(req.params.id,'ID',1,true),req.body,req.user))));
for(const master of ['customers','suppliers'])app.get(`/api/${master}/:id/history`,auth,permit(`${master}:read`),route((req,res)=>{
  const kind=master==='customers'?'sales':'purchases',key=master==='customers'?'customer_id':'supplier_id',id=number(req.params.id,'ID',1,true);
  const records=op.list(kind,req.user,true).filter(r=>r[key]===id);
  const payments=op.all(`SELECT p.* FROM payments p JOIN ${kind} t ON t.id=p.${kind==='sales'?'sale_id':'purchase_id'} WHERE t.${key}=? ORDER BY p.date,p.id`,id);
  res.json({records,payments});
}));
app.get('/api/legacy',auth,permit('audit:read'),route((req,res)=>res.json({feed:op.all('SELECT * FROM feed_entries'),debts:op.all('SELECT *,opening_debt+feed_credit+other_credit-paid remaining FROM supplier_debts'),notes:op.all('SELECT * FROM migration_notes')})));
app.get('/api/pricing',auth,permit('pricing:read'),route((req,res)=>res.json(op.all('SELECT name,value FROM pricing'))));
app.put('/api/pricing/:name',auth,permit('pricing:manage'),route((req,res)=>{
  const value=number(req.body.value,'Price',0.01);if(Number(value.toFixed(2))!==value)throw new Error('Use at most two decimal places');
  op.transaction(()=>{const before=op.get('SELECT * FROM pricing WHERE name=?',req.params.name);if(!before)throw new Error('Price not found');op.run('UPDATE pricing SET value=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE name=?',value,req.user.id,req.params.name);op.audit(req.user,'update','pricing',before.id,before,op.get('SELECT * FROM pricing WHERE id=?',before.id),text(req.body.reason,'Reason',true))});res.json({ok:true});
}));
app.get('/api/audit-log',auth,permit('audit:read'),route((req,res)=>res.json(op.all('SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500'))));
app.get('/api/users',auth,permit('users:manage'),route((req,res)=>res.json(op.all('SELECT id,username,role,is_active,totp_enabled FROM users'))));
app.post('/api/users',auth,permit('users:manage'),route((req,res)=>{
  const username=text(req.body.username,'Username',true),password=validPassword(req.body.password),role=req.body.role;
  if(!Object.values(ROLES).includes(role))throw new Error('Invalid role');
  const id=op.transaction(()=>{const id=Number(op.run('INSERT INTO users(username,password_hash,role,created_by) VALUES(?,?,?,?)',username,bcrypt.hashSync(password,12),role,req.user.id).lastInsertRowid);op.audit(req.user,'create','users',id,null,{username,role});return id});res.json({id});
}));
app.put('/api/users/:id',auth,permit('users:manage'),route((req,res)=>{
  const id=number(req.params.id,'ID',1,true),reason=text(req.body.reason,'Reason',true);
  op.transaction(()=>{
    const before=op.get('SELECT id,username,role,is_active,totp_enabled FROM users WHERE id=?',id);if(!before)throw new Error('User not found');
    const role=req.body.role??before.role;let active=before.is_active;
    if(!Object.values(ROLES).includes(role))throw new Error('Invalid role');
    if(req.body.is_active!==undefined){if(typeof req.body.is_active!=='boolean')throw new Error('Active must be true or false');active=Number(req.body.is_active)}
    if(id===req.user.id&&!active)throw new Error('Cannot deactivate yourself');
    if(before.role==='admin'&&before.is_active&&(role!=='admin'||!active)&&op.get("SELECT COUNT(*) n FROM users WHERE role='admin' AND is_active=1").n<=1)throw new Error('At least one active administrator is required');
    op.run('UPDATE users SET role=?,is_active=?,session_version=session_version+1 WHERE id=?',role,active,id);
    if(req.body.password)op.run('UPDATE users SET password_hash=? WHERE id=?',bcrypt.hashSync(validPassword(req.body.password),12),id);
    if(req.body.reset_2fa===true)op.run('UPDATE users SET totp_enabled=0,totp_secret=NULL WHERE id=?',id);
    op.audit(req.user,'update','users',id,before,{role,is_active:active,password_reset:!!req.body.password,reset_2fa:req.body.reset_2fa===true},reason);
  });res.json({ok:true});
}));
for(const name of ['report','production-report'])app.get(`/api/${name}.pdf`,auth,permit('reports:read'),route((req,res)=>{
  const d=op.dashboard(req.user),rows=op.list('production',req.user),doc=new PDFDocument({margin:40,bufferPages:true});
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="sonia-${name}.pdf"`);doc.pipe(res);
  const heading=title=>{if(doc.y>680)doc.addPage();doc.moveDown().fontSize(13).fillColor('#087b6b').text(title).moveDown(0.4).fontSize(10).fillColor('#173c35')};
  const kes=n=>'KES '+Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
  doc.fontSize(22).fillColor('#075e54').text('Sonia 4.0 Farm');
  doc.fontSize(12).text(name==='report'?'Farm Management Report':'Production Output Report');
  doc.fontSize(9).fillColor('#52736d').text(`Generated ${d.today} (${config.timezone}) | Voided records excluded`);
  heading('Production and flock summary');
  const m=d.metrics;
  for(const [label,value] of [['Eggs collected today',m.eggsToday],['Eggs collected - all time',m.eggs],['Damaged eggs - all time',m.damagedEggs],['Active birds',m.activeBirds],['Mortality',m.mortality],['Production rate today',m.productionRate===null?'Not available':m.productionRate+'%'],['Feed consumed - all time',m.feedConsumed+' kg']])doc.text(label+': '+value);
  if(name==='report'){
    heading('Financial summary');
    for(const [label,key] of [['Sales','sales'],['Purchases','purchases'],['Operating expenses','expenses'],['Customer outstanding','customerOutstanding'],['Supplier outstanding','supplierOutstanding'],['Net profit - simplified','netProfit']])doc.text(label+': '+kes(m[key]));
    doc.moveDown().fontSize(9).text(d.profitBasis);heading('Feed stock');
    for(const row of d.stock)doc.text(row.type+': '+row.available_kg+' kg available');
    if(d.notes.length){heading('Reconciliation notes');for(const note of d.notes)doc.text(note)}
  }
  heading('Production history');
  for(const row of rows)doc.fontSize(9).text(`${row.date} | ${row.flock_batch} | ${row.trays*30+row.loose_eggs} collected | ${row.damaged_eggs} damaged | mortality ${row.mortality}`);
  if(!rows.length)doc.text('No production recorded.');
  if(name==='report'){
    for(const kind of ['sales','purchases','expenses']){
      doc.addPage();heading(kind==='sales'?'Sales and customer balances':kind==='purchases'?'Purchases and supplier balances':'Operating expenses');
      const records=op.list(kind,req.user);
      if(!records.length)doc.text('No records.');
      for(const r of records){
        if(kind==='expenses')doc.text(`#${r.id} | ${r.date} | ${r.category} | ${r.item} | ${kes(r.amount)}`);
        else{
          doc.text(`#${r.id} | ${r.date} | ${r.customer||r.supplier} | ${kind==='sales'?r.quantity+' trays at '+kes(r.price_per_tray):r.item}`);
          doc.text(`Total ${kes(r.total)} | Paid ${kes(r.amount_paid)} | Outstanding ${kes(r.outstanding)} | ${r.payment_status}`);
          const payments=op.all(`SELECT * FROM payments WHERE ${kind==='sales'?'sale_id':'purchase_id'}=? AND is_voided=0 ORDER BY date,id`,r.id);
          for(const p of payments)doc.fontSize(9).text(`Payment #${p.id}: ${p.date} | ${kes(p.amount)} | ${p.reference}`);
          doc.moveDown(0.5).fontSize(10);
        }
      }
    }
  }
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#52736d').text(`Sonia 4.0 Farm | Page ${i+1} of ${range.count}`,40,doc.page.height-30,{lineBreak:false})}
  doc.end();
}));
app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found'}));
app.use(express.static(path.join(config.rootDir,'frontend')));
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(config.rootDir,'frontend','index.html')));
app.use((err,req,res,next)=>{console.error('Request error:',err.message);if(!res.headersSent)res.status(err.status||500).json({error:err.status===400?'Invalid JSON request':'Service error'})});
function ensureAdmin(){
  if(op.get("SELECT id FROM users WHERE role='admin' AND is_active=1"))return;
  if(op.get('SELECT id FROM users LIMIT 1'))throw new Error('No active administrator. Restore an administrator using a verified database recovery.');
  if(config.isProduction&&!config.adminPassword)throw new Error('ADMIN_PASSWORD is required for first production startup');
  const password=config.adminPassword||createDevelopmentSecret();
  op.run('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)',config.adminUsername,bcrypt.hashSync(password,12),'admin');
  if(!config.adminPassword)fs.writeFileSync(path.join(config.dataDir,'FIRST_LOGIN.txt'),`Sonia 4.0 Farm\nUsername: ${config.adminUsername}\nPassword: ${password}\nChange this password in Settings after signing in.\n`,{mode:0o600});
}
ensureAdmin();
const server=app.listen(config.port,config.host,()=>console.log(`Sonia 4.0 Farm listening on ${config.port}`));
function shutdown(){server.close(()=>{store.close();database.close();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
