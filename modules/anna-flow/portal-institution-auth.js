'use strict';
const crypto=require('node:crypto');
const portalAccessUrl=process.env.FLOW_PORTAL_INSTITUTION_URL||null;
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const workerRoot='https://anna-one-auditoria.elisonborg.workers.dev';
async function worker(path,jwt){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
 try{
  const response=await fetch(path,{headers:{Authorization:'Bearer '+jwt},signal:controller.signal,redirect:'error'});
  const data=await response.json().catch(()=>null);
  if(response.status===401||response.status===403)throw Object.assign(Error('Sua conta precisa estar autorizada no Portal AnnA One'),{status:401});
  if(!response.ok)throw Object.assign(Error('Validação do Portal indisponível'),{status:response.status});
  return data;
 }finally{clearTimeout(timer)}
}
async function verify(req){
 const jwt=/^Bearer (eyJ[A-Za-z0-9_.-]+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!jwt||jwt.length>8192)throw Object.assign(Error('Sessão Neon Auth necessária'),{status:401});
 let data;
 // O Worker publicado ainda não disponibiliza flow-access.
 // Evita a ida a uma rota 404 antes de consultar as rotas válidas.
 if(portalAccessUrl){
  data=await worker(portalAccessUrl,jwt);
 }else{
  const [identity,access]=await Promise.all([
   worker(workerRoot+'/v1/auth/verify',jwt),
   worker(workerRoot+'/v1/institution/me',jwt)
  ]);
  if(identity?.authenticated!==true||!/^[a-f0-9-]{36}$/i.test(identity.user_id||'')||access?.authorized!==true)
   throw Object.assign(Error('Identidade institucional não confirmada'),{status:403});
  const allowed=Array.isArray(access.institutions)?access.institutions:[];
  const modules=Array.isArray(access.modules)?access.modules:[];
  // Rotas legadas agregam módulos, logo múltiplas instituições não permitem identificação segura.
  if(allowed.length!==1||!modules.some(m=>m.code==='anna-flow'))
   throw Object.assign(Error('Autorização específica do Flow indisponível para múltiplas instituições'),{status:403});
  data={user_id:identity.user_id,user_email:'neon-'+identity.user_id+'@auth.annaone.invalid',
   institutions:allowed.map(i=>({institution_id:i.id,name:i.name,flow_client_id:null})),legacyFallback:true};
 }
 if(!/^[a-f0-9-]{36}$/i.test(data?.user_id||'')||typeof data.user_email!=='string'||!Array.isArray(data.institutions))
  throw Error('Resposta institucional inválida');
 return data;
}
async function read(req){let v='';for await(const c of req){v+=c;if(v.length>2048)throw Error('Dados excessivos')}return JSON.parse(v)}
async function handle(req,res,{pool,send}){
if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
try{
const authorized=await verify(req);
const a=await read(req);
if(a.action==='lookup')return send(res,200,{institutions:authorized.institutions.map(i=>({id:i.institution_id,name:i.name,configured:i.flow_client_id!==null}))});
if(a.action!=='login')return send(res,400,{error:'Operação inválida'});
const chosen=authorized.institutions.find(i=>i.institution_id===a.portalInstitutionId);
if(!chosen)return send(res,403,{error:'Instituição não autorizada'});
const cidResult=await pool.query('SELECT l.client_id FROM flow_portal_institution_links l JOIN flow_clients c ON c.id=l.client_id WHERE l.portal_institution_id=$1 AND c.active=true',[chosen.institution_id]);
if(!cidResult.rowCount)return send(res,409,{error:'O Master precisa concluir a ativação desta instituição no AnnA Flow.'});
const cid=Number(cidResult.rows[0].client_id);
if(!Number.isSafeInteger(cid)||cid<1)return send(res,503,{error:'ID institucional inválido'});
if(chosen.flow_client_id!==null&&chosen.flow_client_id!==undefined&&Number(chosen.flow_client_id)!==cid)
 return send(res,403,{error:'O vínculo Portal/Flow é inconsistente. Solicite revisão ao Master.'});
const cx=await pool.connect();
try{
await cx.query('BEGIN');
const link=await cx.query('SELECT c.id FROM flow_portal_institution_links l JOIN flow_clients c ON c.id=l.client_id WHERE l.portal_institution_id=$1 AND l.client_id=$2 AND c.active=true',[chosen.institution_id,cid]);
if(!link.rowCount){await cx.query('ROLLBACK');return send(res,409,{error:'Vínculo da instituição ainda não foi sincronizado com o Flow'})}
let user=await cx.query("SELECT u.id,u.active,u.role FROM flow_portal_admin_links pl JOIN flow_users u ON u.id=pl.flow_user_id WHERE pl.portal_user_id=$1 AND pl.client_id=$2 FOR UPDATE",[authorized.user_id,cid]);
let uid;
if(user.rowCount){if(user.rows[0].active!==true||user.rows[0].role!=='admin'){await cx.query('ROLLBACK');return send(res,403,{error:'Administrador bloqueado no Flow'})}uid=user.rows[0].id}
else{
const portalEmail=authorized.user_email.trim().toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(portalEmail))throw Error('E-mail inválido');
const conflict=await cx.query('SELECT id FROM flow_users WHERE client_id=$1 AND email=$2 FOR UPDATE',[cid,portalEmail]);
if(conflict.rowCount){await cx.query('ROLLBACK');return send(res,409,{error:'Conta Flow existente requer conciliação pelo Master'})}
const salt=crypto.randomBytes(16).toString('hex'),secret=crypto.randomBytes(48).toString('hex');
const hash=salt+':'+crypto.scryptSync(secret,salt,64).toString('hex');
const insert=await cx.query("INSERT INTO flow_users(client_id,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",[cid,portalEmail,hash]);
uid=insert.rows[0].id;
await cx.query('INSERT INTO flow_portal_admin_links(portal_user_id,client_id,flow_user_id) VALUES($1,$2,$3)',[authorized.user_id,cid,uid]);
await cx.query("INSERT INTO flow_admin_audit(action,client_id,details) VALUES('portal_admin_linked',$1,$2::jsonb)",[cid,JSON.stringify({portalUserId:authorized.user_id,flowUserId:uid})]);
}
const sessionToken='f_'+crypto.randomBytes(32).toString('hex');
await cx.query("INSERT INTO flow_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[uid,digest(sessionToken)]);
await cx.query('COMMIT');
res.setHeader('Set-Cookie','flow_admin_session='+sessionToken+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600');
return send(res,200,{role:'admin',clientId:cid,token:sessionToken});
}catch(e){await cx.query('ROLLBACK').catch(()=>{});throw e}finally{cx.release()}
}catch(e){const status=e.status||(/inválid/.test(e.message)?400:503);return send(res,status,{error:status===503?'Não foi possível validar o acesso institucional':e.message})}
}
module.exports={handle};
