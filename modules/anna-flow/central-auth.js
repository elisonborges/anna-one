'use strict';
const crypto=require('node:crypto');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const email=s=>String(s||'').trim().toLowerCase();
const hash=(password,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
const match=(password,stored)=>{if(typeof stored!=='string'||!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored))return false;const [salt,expected]=stored.split(':');const actual=hash(password,salt).split(':')[1];return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'))};
const attempts=new Map();
// Exchange a verified AnnA One Master session for a local Flow session.
// The bearer token is validated by Supabase Auth and Master authorization by RLS.
async function verifyMaster(jwt){
if(typeof jwt!=='string'||jwt.length<32||jwt.length>8192)return null;
const base='https://tnvghprwltbziivlxeod.supabase.co',key='sb_publishable_yI9_7tD4RwGrjolPjiq9vg_oSGpxxFR';
const headers={apikey:key,authorization:'Bearer '+jwt};
const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),8000);
try{
const u=await fetch(base+'/auth/v1/user',{headers,signal:ctrl.signal});
if(!u.ok)return null;const user=await u.json();if(!/^[a-f0-9-]{36}$/i.test(String(user.id||''))||!user.email)return null;
const r=await fetch(base+'/rest/v1/platform_admins?select=user_id&user_id=eq.'+encodeURIComponent(user.id)+'&limit=1',{headers,signal:ctrl.signal});
if(!r.ok)return null;const rows=await r.json();if(!Array.isArray(rows)||rows.length!==1||rows[0].user_id!==user.id)return null;
return {id:user.id,email:email(user.email)};
}finally{clearTimeout(timer)}
}

async function body(req){let s='';for await(const c of req){s+=c;if(s.length>4096)throw Error('Dados excessivos')}return JSON.parse(s)}
async function session(req,pool){const secret=/^Bearer (fc_[a-f0-9]{64})$/i.exec(req.headers.authorization||'')?.[1]||/(?:^|;\s*)flow_central_session=(fc_[a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];if(!secret)return null;const q=await pool.query('SELECT s.supabase_user_id AS id,s.id AS session_id,s.email FROM flow_master_sessions s WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()',[digest(secret)]);return q.rows[0]||null}
function cookie(res,secret){res.setHeader('Set-Cookie','flow_central_session='+secret+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800')}
async function handle(req,res,{pool,send,legacyAuth}){try{
const path=new URL(req.url,'http://localhost').pathname;
if(path==='/api/central/login'&&req.method==='POST'){
const a=await body(req),mail=email(a.email),password=String(a.password||'');
if(!/^\S+@\S+\.\S+$/.test(mail)||!password||password.length>128)return send(res,401,{error:'Credenciais inválidas'});
const key=String(req.socket.remoteAddress||'')+':'+mail,now=Date.now();
if(attempts.size>2000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
const prior=attempts.get(key),rate=prior?.until>now?prior:{count:0,until:now+900000};
if(rate.count>=5)return send(res,429,{error:'Muitas tentativas. Tente novamente mais tarde'});
rate.count++;attempts.set(key,rate);
const base='https://tnvghprwltbziivlxeod.supabase.co',keyPublic='sb_publishable_yI9_7tD4RwGrjolPjiq9vg_oSGpxxFR';
const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
let result;
try{const r=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:keyPublic,'Content-Type':'application/json'},body:JSON.stringify({email:mail,password}),signal:ctrl.signal});if(!r.ok)return send(res,401,{error:'Credenciais inválidas ou perfil Master ausente'});result=await r.json()}finally{clearTimeout(timer)}
const master=await verifyMaster(result.access_token);
if(!master||master.email!==mail)return send(res,403,{error:'Acesso exclusivo ao Administrador Geral da AnnA One'});
attempts.delete(key);
const secret='fc_'+crypto.randomBytes(32).toString('hex');
await pool.query("INSERT INTO flow_master_sessions(supabase_user_id,token_hash,email,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[master.id,digest(secret),master.email]);
cookie(res,secret);return send(res,200,{authorized:true});
}
if(path==='/api/central/exchange'&&req.method==='POST'){
const a=await body(req);const master=await verifyMaster(a.accessToken);
if(!master)return send(res,403,{error:'Faça login como Administrador Geral na AnnA One'});
const secret='fc_'+crypto.randomBytes(32).toString('hex');
await pool.query('INSERT INTO flow_master_sessions(supabase_user_id,token_hash,email,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')',[master.id,digest(secret),master.email]);
cookie(res,secret);return send(res,200,{authorized:true,email:master.email});
}
if(path==='/api/central/me'&&req.method==='GET'){const u=await session(req,pool);return u?send(res,200,{authorized:true,email:u.email||null}):send(res,401,{error:'Sessão inválida'})}
if(path==='/api/central/logout'&&req.method==='POST'){const u=await session(req,pool);if(u)await pool.query('UPDATE flow_master_sessions SET revoked_at=now() WHERE id=$1',[u.session_id]);res.setHeader('Set-Cookie','flow_central_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return send(res,200,{ok:true})}
return send(res,405,{error:'Método não permitido'});
}catch{return send(res,503,{error:'Não foi possível concluir a operação'})}}
module.exports={session,handle,verifyMaster};
