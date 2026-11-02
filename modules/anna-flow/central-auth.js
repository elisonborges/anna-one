'use strict';
const crypto=require('node:crypto');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const email=s=>String(s||'').trim().toLowerCase();
const hash=(password,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
const match=(password,stored)=>{if(typeof stored!=='string'||!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored))return false;const [salt,expected]=stored.split(':');const actual=hash(password,salt).split(':')[1];return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'))};
const attempts=new Map();
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>4096)throw Error('Dados excessivos')}return JSON.parse(s)}
async function session(req,pool){const secret=/^Bearer (fc_[a-f0-9]{64})$/i.exec(req.headers.authorization||'')?.[1]||/(?:^|;\s*)flow_central_session=(fc_[a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];if(!secret)return null;const q=await pool.query('SELECT a.id,a.email,s.id AS session_id FROM flow_central_sessions s JOIN flow_central_admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.active=true',[digest(secret)]);return q.rows[0]||null}
function cookie(res,secret){res.setHeader('Set-Cookie','flow_central_session='+secret+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800')}
async function handle(req,res,{pool,send,legacyAuth}){try{
const path=new URL(req.url,'http://localhost').pathname;
if(path==='/api/central/bootstrap'&&req.method==='POST'){
// Initial account creation is possible only with the existing server-side central secret.
if(!legacyAuth(req))return send(res,401,{error:'Não autorizado'});
const a=await body(req),mail=email(a.email),password=String(a.password||'');
if(!/^\S+@\S+\.\S+$/.test(mail)||password.length<14||password.length>128)return send(res,400,{error:'E-mail válido e senha de 14 a 128 caracteres necessários'});
const cx=await pool.connect();try{await cx.query('BEGIN');await cx.query('SELECT pg_advisory_xact_lock(71001844)');const existing=await cx.query('SELECT COUNT(*)::int AS count FROM flow_central_admins');if(existing.rows[0].count!==0){await cx.query('ROLLBACK');return send(res,409,{error:'Conta central já configurada'})}await cx.query('INSERT INTO flow_central_admins(email,password_hash) VALUES($1,$2)',[mail,hash(password)]);await cx.query('COMMIT');return send(res,201,{created:true})}catch(e){await cx.query('ROLLBACK');throw e}finally{cx.release()}}
if(path==='/api/central/login'&&req.method==='POST'){
const a=await body(req),mail=email(a.email),password=String(a.password||'');if(!mail||password.length>128)return send(res,401,{error:'Credenciais inválidas'});
const ip=String(req.socket.remoteAddress||'unknown'),key=ip+':'+mail,now=Date.now();if(attempts.size>2000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const prior=attempts.get(key),rate=prior?.until>now?prior:{count:0,until:now+900000};if(rate.count>=5)return send(res,429,{error:'Muitas tentativas. Tente novamente mais tarde'});
const q=await pool.query('SELECT id,password_hash FROM flow_central_admins WHERE email=$1 AND active=true',[mail]);if(!q.rowCount||!match(password,q.rows[0].password_hash)){rate.count++;attempts.set(key,rate);return send(res,401,{error:'Credenciais inválidas'})}attempts.delete(key);
const secret='fc_'+crypto.randomBytes(32).toString('hex');await pool.query("INSERT INTO flow_central_sessions(admin_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[q.rows[0].id,digest(secret)]);cookie(res,secret);return send(res,200,{authorized:true})}
if(path==='/api/central/me'&&req.method==='GET'){const u=await session(req,pool);return u?send(res,200,{authorized:true,email:u.email}):send(res,401,{error:'Sessão inválida'})}
if(path==='/api/central/logout'&&req.method==='POST'){const u=await session(req,pool);if(u)await pool.query('UPDATE flow_central_sessions SET revoked_at=now() WHERE id=$1',[u.session_id]);res.setHeader('Set-Cookie','flow_central_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');return send(res,200,{ok:true})}
return send(res,405,{error:'Método não permitido'});
}catch{return send(res,503,{error:'Não foi possível concluir a operação'})}}
module.exports={session,handle};
