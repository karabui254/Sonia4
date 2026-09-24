const {config}=require('./config');
const {can}=require('./access-control');
const TYPES=['Chick Mash','Growers','Layers'];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
function number(value,label,min=0,integer=false){
  if(!['number','string'].includes(typeof value)||String(value).trim()==='') throw new Error(`${label} is required`);
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>1e12||(integer&&!Number.isSafeInteger(n))) throw new Error(`${label} must be ${integer?'a whole number':'a number'} of at least ${min}`);
  return n;
}
function date(value,label='Date'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>today()) throw new Error(`${label} must be a valid date, no later than today`);
  return value;
}
function text(value,label,required=false){const s=String(value??'').trim();if((required&&!s)||s.length>2000)throw new Error(`${label} is required and must be at most 2000 characters`);return s}
function choice(value,options,label){if(!options.includes(value))throw new Error(`Invalid ${label}`);return value}
function createOperations(db){
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}
  function audit(user,action,table,id,before,after,reason=''){run('INSERT INTO audit_log(user_id,action,table_name,record_id,old_values,new_values,reason) VALUES(?,?,?,?,?,?,?)',user?.id||null,action,table,id,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason)}
  const tables={flocks:'flocks',customers:'customers',suppliers:'suppliers',production:'production',feed:'feed_usage',purchases:'purchases',sales:'sales',expenses:'expenses'};
  function paid(kind,id){return money(get(`SELECT COALESCE(SUM(amount),0) n FROM payments WHERE ${kind==='sales'?'sale_id':'purchase_id'}=? AND is_voided=0`,id).n)}
  function enrich(kind,row){
    const r={...row};
    if(kind==='flocks'){r.current_bird_count=birdCount(row,today());r.opening_mortality=r.mortality}
    if(r.flock_id)r.flock_batch=get('SELECT batch FROM flocks WHERE id=?',r.flock_id)?.batch||'Historical flock';
    if(kind==='sales'||kind==='purchases'){
      r.amount_paid=paid(kind,r.id);r.outstanding=money(r.total-r.amount_paid);
      r.payment_status=r.amount_paid===0?'Unpaid':r.outstanding>0?'Partially Paid':'Paid';
      if(kind==='sales')r.customer=get('SELECT name FROM customers WHERE id=?',r.customer_id)?.name||'Historical customer';
      else r.supplier=get('SELECT name FROM suppliers WHERE id=?',r.supplier_id)?.name||r.supplier;
    }
    return r;
  }
  function birdCount(f,day,beforeDay=false){
    if(!f.mortality_reconciled)return Number(f.current_bird_count);
    const baseline=f.mortality_baseline_date;
    const deaths=get(`SELECT COALESCE(SUM(mortality),0) n FROM production WHERE flock_id=? AND is_voided=0 AND date${beforeDay?'<':'<='}? AND (? IS NULL OR date>?)`,f.id,day,baseline,baseline).n;
    return Number(f.initial_bird_count)-Number(f.mortality)-Number(f.culls)-deaths;
  }
  function reference(table,id,beforeId){
    const n=number(id,`Select ${table}`,1,true),r=get(`SELECT * FROM ${table} WHERE id=?`,n);
    if(!r||r.is_voided||(n!==beforeId&&r.status!=='Active'))throw new Error(`Select an active ${table}`);
    return r;
  }
  function normalize(kind,body,before,user){
    const v={...before,...body},r={};
    if(['production','feed','purchases','sales','expenses'].includes(kind))r.date=date(v.date||today());
    if(kind==='flocks'){
      r.batch=text(v.batch,'Batch',true);r.breed=text(v.breed,'Breed',true);
      r.placement_date=date(v.placement_date||v.date_received,'Placement date');r.date_received=r.placement_date;
      r.initial_bird_count=number(v.initial_bird_count??v.received,'Initial birds',1,true);r.received=r.initial_bird_count;
      r.mortality=number(v.mortality??0,'Opening mortality',0,true);r.culls=number(v.culls??0,'Culls',0,true);
      r.mortality_baseline_date=v.mortality_baseline_date?date(v.mortality_baseline_date):null;
      r.status=choice(v.status||'Active',['Active','Closed'],'status');r.stage=choice(v.stage||'Laying',['Laying','Growing'],'stage');
      r.closed_date=r.status==='Closed'?date(v.closed_date||today(),'Closure date'):null;
      if(r.closed_date&&r.closed_date<r.placement_date)throw new Error('Closure cannot precede placement');
      r.house=text(v.house,'House');r.supplier=text(v.supplier,'Supplier');r.cost_per_chick=number(v.cost_per_chick??0,'Cost per chick');
      if(r.mortality+r.culls>r.initial_bird_count)throw new Error('Losses exceed initial birds');
      r.current_bird_count=r.initial_bird_count-r.mortality-r.culls;
      if(before&&!before.mortality_reconciled){
        for(const key of ['initial_bird_count','mortality','culls','mortality_baseline_date'])if(r[key]!==before[key])throw new Error('Review historical opening values in Mortality Review first');
        r.current_bird_count=before.current_bird_count;
      }
      if(!before){r.mortality_reconciled=1;r.mortality_reconciled_by=user.id;r.mortality_reconciled_at=new Date().toISOString()}
    }
    if(kind==='customers'||kind==='suppliers'){
      r.name=text(v.name,'Name',true);r.phone=text(v.phone,'Phone');r.location=text(v.location,'Location');r.status=choice(v.status||'Active',['Active','Inactive'],'status');
      if(kind==='customers'){r.email=text(v.email,'Email');if(r.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))throw new Error('Invalid email')}
      else r.products=text(v.products,'Products');
    }
    if(kind==='production'||kind==='feed'){
      const f=reference('flocks',v.flock_id,before?.flock_id);r.flock_id=f.id;
      if(r.date<f.placement_date)throw new Error('Date cannot precede flock placement');
      if(f.closed_date&&r.date>f.closed_date)throw new Error('Date cannot follow flock closure');
      if(kind==='production'){
        r.trays=number(v.trays??0,'Trays',0,true);r.loose_eggs=number(v.loose_eggs??0,'Loose eggs',0,true);
        if(r.loose_eggs>29)throw new Error('Loose eggs must be between 0 and 29');
        r.damaged_eggs=number(v.damaged_eggs??0,'Damaged eggs',0,true);r.mortality=number(v.mortality??0,'Mortality',0,true);
        if(!f.mortality_reconciled&&(r.mortality>0||before?.mortality>0))throw new Error('Admin must reconcile this flock in Mortality Review before changing mortality');
        if(before?.mortality>0&&before.flock_id!==r.flock_id&&!get('SELECT mortality_reconciled FROM flocks WHERE id=?',before.flock_id)?.mortality_reconciled)throw new Error('Reconcile the original flock before moving mortality');
        if(r.damaged_eggs>r.trays*30+r.loose_eggs)throw new Error('Damaged eggs cannot exceed collected eggs');
        if(f.mortality_baseline_date&&r.mortality>0&&r.date<=f.mortality_baseline_date&&!before)throw new Error('This mortality is covered by the legacy baseline. Reconcile the flock baseline first.');
      }else{r.type=choice(v.type,TYPES,'feed type');r.consumed_kg=number(v.consumed_kg,'Feed consumed',0.001)}
    }
    if(kind==='purchases'){
      const supplier=reference('suppliers',v.supplier_id,before?.supplier_id);r.supplier_id=supplier.id;r.supplier=supplier.name;
      r.category=choice(v.category,['Feed','Chicks','Animal Health','Equipment','Labour / Services','Other'],'category');r.item=text(v.item,'Item',true);
      r.reference=text(v.reference,'Reference');r.quantity=number(v.quantity,'Quantity',0.001);
      r.total=money(number(v.total,'Purchase amount',0.01));r.unit_cost=r.total/r.quantity;
      r.feed_type=r.category==='Feed'?choice(v.feed_type,TYPES,'feed type'):null;
    }
    if(kind==='sales'){
      r.customer_id=reference('customers',v.customer_id,before?.customer_id).id;r.type='Eggs';r.quantity=number(v.quantity,'Trays sold',1,true);
      r.price_per_tray=before?before.price_per_tray:get("SELECT value FROM pricing WHERE name='egg_tray'").value;
      if(r.price_per_tray<=0)throw new Error('Ask the administrator to set a selling price first');
      if(body.price_per_tray!==undefined&&Number(body.price_per_tray)!==r.price_per_tray)throw new Error('Selling price is controlled by the administrator and historical prices are fixed');
      r.total=money(r.quantity*r.price_per_tray);
    }
    if(kind==='sales'||kind==='purchases'){
      if(before&&body.amount_paid!==undefined&&Number(body.amount_paid)!==paid(kind,before.id))throw new Error('Use the payment history to record or correct payments');
      r.amount_paid=before?paid(kind,before.id):money(number(v.amount_paid??0,'Amount paid'));
      if(r.amount_paid>r.total)throw new Error('Amount paid exceeds transaction total');
      if(before&&get(`SELECT id FROM payments WHERE ${kind==='sales'?'sale_id':'purchase_id'}=? AND is_voided=0 AND date<?`,before.id,r.date))throw new Error('Transaction cannot move after an existing payment date');
      r.payment_status=r.amount_paid===0?'Unpaid':r.amount_paid<r.total?'Partially Paid':'Paid';
    }
    if(kind==='expenses'){r.category=text(v.category,'Category',true);r.item=text(v.item,'Item',true);r.amount=money(number(v.amount,'Amount',0.01))}
    if(!['suppliers'].includes(kind))r.notes=text(v.notes,'Notes');
    if(user.role==='production_staff'&&before&&r.date!==before.date)throw new Error('Production Staff cannot move records to another date');
    return r;
  }
  function feedMovements(){
    return [
      ...all("SELECT id,date,feed_type type,quantity kg FROM purchases WHERE is_voided=0 AND category='Feed' AND feed_type IS NOT NULL").map(r=>({...r,order:0})),
      ...all('SELECT id,date,type,-consumed_kg kg FROM feed_usage WHERE is_voided=0').map(r=>({...r,order:1})),
      ...all('SELECT id,date,type,received_kg-consumed_kg kg FROM feed_entries WHERE is_voided=0').map(r=>({...r,order:0}))
    ].sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order||a.id-b.id);
  }
  function stock(){const result=Object.fromEntries(TYPES.map(t=>[t,0]));for(const r of feedMovements())result[r.type]=(result[r.type]||0)+r.kg;return TYPES.map(type=>({type,available_kg:Math.round(result[type]*1000)/1000}))}
  function validateState(kind){
    if(['production','flocks'].includes(kind))for(const f of all('SELECT * FROM flocks WHERE is_voided=0')){
      if(!f.mortality_reconciled)continue;
      if(birdCount(f,today())<0)throw new Error(`Mortality and culls exceed initial birds for ${f.batch}`);
      const outside=get('SELECT id FROM production WHERE flock_id=? AND is_voided=0 AND (date<? OR (? IS NOT NULL AND date>?))',f.id,f.placement_date,f.closed_date,f.closed_date);
      if(outside)throw new Error('Flock dates would exclude existing production');
      if(get('SELECT id FROM feed_usage WHERE flock_id=? AND is_voided=0 AND (date<? OR (? IS NOT NULL AND date>?))',f.id,f.placement_date,f.closed_date,f.closed_date))throw new Error('Flock dates would exclude existing feed usage');
      run('UPDATE flocks SET current_bird_count=? WHERE id=?',birdCount(f,today()),f.id);
    }
    if(['feed','purchases'].includes(kind)){
      const totals={};for(const r of feedMovements()){totals[r.type]=(totals[r.type]||0)+r.kg;if(totals[r.type]<-0.0001)throw new Error(`Insufficient ${r.type} stock on ${r.date}. Check earlier purchases and usage.`)}
    }
  }
  function correctable(user,kind,r){return can(user.role,`${kind}:write`)&&(user.role!=='production_staff'||(r.created_by===user.id&&r.date===today()))}
  function list(kind,user,includeVoided=false){
    let rows=all(`SELECT * FROM ${tables[kind]} ${includeVoided?'':'WHERE is_voided=0'} ORDER BY id DESC`).map(r=>({...enrich(kind,r),can_correct:!r.is_voided&&correctable(user,kind,r)}));
    if(kind==='customers')rows=rows.map(r=>({...r,outstanding_balance:money(all('SELECT * FROM sales WHERE customer_id=? AND is_voided=0',r.id).reduce((n,s)=>n+s.total-paid('sales',s.id),0))}));
    if(kind==='suppliers')rows=rows.map(r=>({...r,outstanding_balance:money(all('SELECT * FROM purchases WHERE supplier_id=? AND is_voided=0',r.id).reduce((n,p)=>n+p.total-paid('purchases',p.id),0))}));
    if(user.role==='production_staff'&&kind==='flocks')rows=rows.map(({cost_per_chick,supplier,...r})=>r);
    return rows;
  }
  function write(kind,body,user,id){return transaction(()=>{
    const table=tables[kind],before=id?get(`SELECT * FROM ${table} WHERE id=?`,id):null;
    if(id&&(!before||before.is_voided))throw new Error('Active record not found');
    if(before&&!correctable(user,kind,before))throw Object.assign(new Error('You cannot correct this record'),{status:403});
    const reason=before?text(body.reason,'Correction reason',true):'';
    const values=normalize(kind,body,before,user);
    if(before){const keys=Object.keys(values);run(`UPDATE ${table} SET ${keys.map(k=>k+'=?').join(',')},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,...Object.values(values),user.id,id)}
    else{
      values.created_by=user.id;values.updated_by=user.id;
      if(kind==='suppliers')values.supplier_code='SUP-'+require('node:crypto').randomUUID();
      const keys=Object.keys(values);id=Number(run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...Object.values(values)).lastInsertRowid);
      if(kind==='suppliers'||kind==='customers')run(`UPDATE ${table} SET ${kind==='suppliers'?'supplier_code':'customer_code'}=? WHERE id=?`,`${kind==='suppliers'?'SUP':'CUS'}-${String(id).padStart(4,'0')}`,id);
      if(['sales','purchases'].includes(kind)&&values.amount_paid>0){const paymentId=Number(run(`INSERT INTO payments(${kind==='sales'?'sale_id':'purchase_id'},date,amount,reference,created_by,updated_by) VALUES(?,?,?,?,?,?)`,id,values.date,values.amount_paid,'Initial payment',user.id,user.id).lastInsertRowid);audit(user,'create','payments',paymentId,null,get('SELECT * FROM payments WHERE id=?',paymentId))}
    }
    validateState(kind);
    const after=get(`SELECT * FROM ${table} WHERE id=?`,id);audit(user,before?'update':'create',table,id,before,after,reason);
    return enrich(kind,after);
  })}
  function voidRecord(kind,id,body,user){return transaction(()=>{
    const table=tables[kind],before=get(`SELECT * FROM ${table} WHERE id=?`,id),reason=text(body.reason,'Void reason',true);
    if(!before||before.is_voided)throw new Error('Active record not found');
    if(!correctable(user,kind,before))throw Object.assign(new Error('You cannot void this record'),{status:403});
    if(kind==='production'&&before.mortality>0&&!get('SELECT mortality_reconciled FROM flocks WHERE id=?',before.flock_id)?.mortality_reconciled)throw new Error('Admin must reconcile this flock before voiding mortality');
    if(['sales','purchases'].includes(kind)&&paid(kind,id)>0)throw new Error('Void the linked payments first; record any actual refund separately in your cash records');
    const dependencies={flocks:[['production','flock_id'],['feed_usage','flock_id'],['feed_entries','flock_id']],customers:[['sales','customer_id']],suppliers:[['purchases','supplier_id'],['feed_entries','supplier_id'],['supplier_debts','supplier_id']]};
    for(const [t,k] of dependencies[kind]||[])if(get(`SELECT id FROM ${t} WHERE ${k}=? AND is_voided=0`,id))throw new Error('This master record has active transactions. Close or deactivate it instead.');
    run(`UPDATE ${table} SET is_voided=1,void_reason=?,voided_by=?,voided_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,reason,user.id,user.id,id);
    validateState(kind);audit(user,'void',table,id,before,get(`SELECT * FROM ${table} WHERE id=?`,id),reason);return {ok:true};
  })}
  function payment(kind,id,body,user){return transaction(()=>{
    const row=get(`SELECT * FROM ${tables[kind]} WHERE id=? AND is_voided=0`,id);if(!row)throw new Error('Active transaction not found');
    const amount=money(number(body.amount,'Payment',0.01)),paymentDate=date(body.date||today());
    if(paymentDate<row.date)throw new Error('Payment cannot precede its transaction');
    if(money(paid(kind,id)+amount)>row.total)throw new Error('Payment exceeds outstanding balance');
    const pid=Number(run(`INSERT INTO payments(${kind==='sales'?'sale_id':'purchase_id'},date,amount,reference,created_by,updated_by) VALUES(?,?,?,?,?,?)`,id,paymentDate,amount,text(body.reference,'Reference'),user.id,user.id).lastInsertRowid);
    audit(user,'create','payments',pid,null,get('SELECT * FROM payments WHERE id=?',pid));return {id:pid};
  })}
  function voidPayment(id,body,user){return transaction(()=>{
    const before=get('SELECT * FROM payments WHERE id=? AND is_voided=0',id);if(!before)throw new Error('Payment not found');
    const kind=before.sale_id?'sales':'purchases';if(!can(user.role,`${kind}:write`))throw Object.assign(new Error('Forbidden'),{status:403});
    const reason=text(body.reason,'Void reason',true);run('UPDATE payments SET is_voided=1,voided_by=?,voided_at=CURRENT_TIMESTAMP,void_reason=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',user.id,reason,user.id,id);
    audit(user,'void','payments',id,before,get('SELECT * FROM payments WHERE id=?',id),reason);return {ok:true};
  })}
  function mortalityReport(){
    return all('SELECT f.*,u.username reconciled_by FROM flocks f LEFT JOIN users u ON u.id=f.mortality_reconciled_by WHERE f.is_voided=0 ORDER BY f.id').map(f=>{
      const production=all('SELECT id,date,mortality,is_voided FROM production WHERE flock_id=? ORDER BY date,id',f.id);
      const productionMortality=production.filter(p=>!p.is_voided).reduce((n,p)=>n+p.mortality,0);
      const applicable=production.filter(p=>!p.is_voided&&(!f.mortality_baseline_date||p.date>f.mortality_baseline_date)).reduce((n,p)=>n+p.mortality,0);
      const calculated=f.initial_bird_count-f.mortality-f.culls-applicable;
      return {...f,production,production_mortality:productionMortality,applicable_production_mortality:applicable,calculated_current_birds:calculated,existing_current_birds:f.current_bird_count,difference:calculated-f.current_bird_count};
    });
  }
  function reconcileMortality(id,body,user){return transaction(()=>{
    if(user.role!=='admin')throw Object.assign(new Error('Forbidden'),{status:403});
    const before=get('SELECT * FROM flocks WHERE id=? AND is_voided=0',id);
    if(!before)throw new Error('Flock not found');
    if(before.mortality_reconciled)throw new Error('This flock has already been reconciled. Use an audited flock correction if required.');
    if(body.confirmed!==true)throw new Error('Confirm that you reviewed the historical sources');
    const reason=text(body.reason,'Reconciliation reason',true);
    const initial=number(body.initial_bird_count,'Confirmed initial birds',1,true),opening=number(body.mortality,'Confirmed opening mortality',0,true),culls=number(body.culls,'Confirmed culls',0,true);
    const baseline=body.mortality_baseline_date?date(body.mortality_baseline_date,'Opening mortality cutoff'):null;
    if(baseline&&before.placement_date&&baseline<before.placement_date)throw new Error('Cutoff cannot precede placement');
    const deaths=get('SELECT COALESCE(SUM(mortality),0) n FROM production WHERE flock_id=? AND is_voided=0 AND (? IS NULL OR date>?)',id,baseline,baseline).n;
    const current=initial-opening-culls-deaths;if(current<0)throw new Error('Confirmed losses exceed initial birds');
    // An explicit expected count makes the administrator review the result, too.
    if(number(body.confirmed_current_birds,'Confirmed current birds',0,true)!==current)throw new Error('Confirmed current birds do not match the proposed opening values and applicable production mortality');
    run('UPDATE flocks SET initial_bird_count=?,received=?,mortality=?,culls=?,mortality_baseline_date=?,current_bird_count=?,mortality_reconciled=1,mortality_reconciled_by=?,mortality_reconciled_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',initial,initial,opening,culls,baseline,current,user.id,user.id,id);
    const after=get('SELECT * FROM flocks WHERE id=?',id);audit(user,'mortality-reconciliation','flocks',id,before,after,reason);return after;
  })}
  function productionTrend(period='7'){
    if(!['7','30','monthly'].includes(period))throw new Error('Invalid production period');
    const day=today(),start=new Date(day+'T00:00:00Z');
    if(period==='monthly'){start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-11)}else start.setUTCDate(start.getUTCDate()-Number(period)+1);
    const records=all('SELECT date,SUM(trays*30+loose_eggs) eggs,SUM(damaged_eggs) damaged,COUNT(*) records FROM production WHERE is_voided=0 AND date>=? AND date<=? GROUP BY date ORDER BY date',start.toISOString().slice(0,10),day);
    if(period!=='monthly')return {period,rows:records};
    const months=new Map();for(const r of records){const key=r.date.slice(0,7),row=months.get(key)||{date:key,eggs:0,damaged:0,records:0};row.eggs+=r.eggs;row.damaged+=r.damaged;row.records+=r.records;months.set(key,row)}return {period,rows:[...months.values()]};
  }
  function dashboard(user){
    const prod=list('production',user),flocks=list('flocks',user),usage=list('feed',user),day=today();
    const collected=p=>p.trays*30+p.loose_eggs;
    const eggsToday=prod.filter(p=>p.date===day).reduce((n,p)=>n+collected(p),0);
    const active=flocks.filter(f=>f.status==='Active');
    const allFlocks=all('SELECT * FROM flocks WHERE is_voided=0');
    const denominator=allFlocks.filter(f=>f.stage==='Laying'&&f.placement_date<=day&&(f.status==='Active'||(f.closed_date&&f.closed_date>=day))).reduce((n,f)=>n+Math.max(0,birdCount(f,day,true)),0);
    const layingIds=new Set(allFlocks.filter(f=>f.stage==='Laying').map(f=>f.id));
    const layingEggs=prod.filter(p=>p.date===day&&layingIds.has(p.flock_id)).reduce((n,p)=>n+collected(p),0);
    const trendMap=new Map();for(const p of prod){const row=trendMap.get(p.date)||{date:p.date,eggs:0,damaged:0};row.eggs+=collected(p);row.damaged+=p.damaged_eggs;trendMap.set(p.date,row)}
    const metrics={eggsToday,eggs:prod.reduce((n,p)=>n+collected(p),0),damagedEggs:prod.reduce((n,p)=>n+p.damaged_eggs,0),activeBirds:active.reduce((n,f)=>n+f.current_bird_count,0),mortality:allFlocks.reduce((n,f)=>n+f.initial_bird_count-f.culls-birdCount(f,day),0),productionRate:denominator?money(layingEggs/denominator*100):null,feedConsumed:usage.reduce((n,r)=>n+r.consumed_kg,0)+get('SELECT COALESCE(SUM(consumed_kg),0) n FROM feed_entries WHERE is_voided=0').n};
    const pending=allFlocks.filter(f=>!f.mortality_reconciled).length;
    const result={today:day,metrics,stock:stock(),trend:[...trendMap.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-14),production:prod.slice(0,10),notes:all('SELECT message FROM migration_notes').map(r=>r.message)};
    if(pending)result.notes.unshift('Historical mortality review pending for '+pending+' flock(s). Stored bird counts are preserved until Admin confirmation; population-based metrics are provisional.');
    if(can(user.role,'sales:read')){
      const sales=list('sales',user),purchases=list('purchases',user),expenses=list('expenses',user);
      Object.assign(metrics,{sales:money(sales.reduce((n,s)=>n+s.total,0)),purchases:money(purchases.reduce((n,p)=>n+p.total,0)),expenses:money(expenses.reduce((n,e)=>n+e.amount,0)),customerOutstanding:money(sales.reduce((n,s)=>n+s.outstanding,0)),supplierOutstanding:money(purchases.reduce((n,p)=>n+p.outstanding,0))});
      metrics.netProfit=money(metrics.sales-metrics.purchases-metrics.expenses);
      result.profitBasis='Sales minus recorded purchases and operating expenses. Feed purchases are counted once; usage and later payments do not change profit. This simplified measure does not value closing inventory or depreciation.';
      result.legacy=all('SELECT *,opening_debt+feed_credit+other_credit-paid remaining FROM supplier_debts WHERE is_voided=0');
    }
    return result;
  }
  return {tables,all,get,run,transaction,audit,list,write,voidRecord,payment,voidPayment,dashboard,paid,stock,correctable,mortalityReport,reconcileMortality,productionTrend};
}
module.exports={createOperations,today,number,date,text,money};
