const IDLE_MS=45*60*1000;
const ABSOLUTE_MS=10*60*60*1000;
function expired(session,now=Date.now()){
  return !Number.isFinite(session.authenticatedAt)||!Number.isFinite(session.lastActivityAt)||
    session.authenticatedAt>now||session.lastActivityAt>now||
    now-session.lastActivityAt>=IDLE_MS||now-session.authenticatedAt>=ABSOLUTE_MS;
}
function start(session,now=Date.now(),authenticatedAt=now){
  session.authenticatedAt=authenticatedAt;
  touch(session,now);
}
function touch(session,now=Date.now()){
  session.lastActivityAt=now;
  session.cookie.maxAge=Math.max(0,Math.min(IDLE_MS,session.authenticatedAt+ABSOLUTE_MS-now));
}
function expiry(session){
  if(!session.user)return new Date(session.cookie.expires).getTime();
  return Math.min(session.lastActivityAt+IDLE_MS,session.authenticatedAt+ABSOLUTE_MS);
}
module.exports={IDLE_MS,ABSOLUTE_MS,expired,start,touch,expiry};
