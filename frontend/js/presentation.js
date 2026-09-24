// Presentation only: no financial or flock calculations belong here.
(function(root){
  const number=new Intl.NumberFormat('en-KE',{maximumFractionDigits:3});
  function currency(value,summary=false){
    const n=Number(value||0),digits=summary?0:2;
    return 'KSh '+new Intl.NumberFormat('en-KE',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(n);
  }
  function compact(value,unit=''){
    const full=unit==='currency'?currency(value,true):number.format(value)+(unit?' '+unit:'');
    if(full.length<=12)return {text:full,full};
    const short=new Intl.NumberFormat('en-KE',{notation:'compact',maximumFractionDigits:2}).format(Number(value));
    return {text:unit==='currency'?'KSh '+short:short+(unit?' '+unit:''),full};
  }
  function date(value,long=false){
    if(!value)return '—';const d=new Date(String(value).slice(0,10)+'T12:00:00Z');
    return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('en-GB',{day:'numeric',month:long?'long':'short',year:'numeric',timeZone:'UTC'}).format(d);
  }
  const moneyFields=new Set(['total','unit_cost','total_cost','cost_per_kg','price_per_tray','amount','amount_paid','outstanding','outstanding_balance','opening_debt','feed_credit','other_credit','paid','remaining']);
  function cell(key,value){if(value===null||value===undefined||value==='')return '—';if(moneyFields.has(key))return currency(value);if(['date','placement_date','closed_date'].includes(key))return date(value);if(key==='is_active')return value?'Active':'Inactive';if(key==='is_voided')return value?'Voided':'Active';if(key==='totp_enabled')return value?'Enabled':'Not enabled';return typeof value==='number'?number.format(value):String(value)}
  const api={currency,compact,date,cell,number:n=>number.format(n)};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SoniaPresentation=api;
})(typeof window!=='undefined'?window:globalThis);
