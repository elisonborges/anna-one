'use strict';
const crypto=require('node:crypto');
const base='https://tnvghprwltbziivlxeod.supabase.co';
const key='sb_publishable_yI9_7tD4RwGrjolPjiq9vg_oSGpxxFR';
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>12000)throw Error('Excesso de dados')}return JSON.parse(raw)}
async function get(path,jwt){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8500);try{const response=await fetch(base+path,{headers:{apikey:key,Authorization:'Bearer '+jwt},signal:ctrl.signal});if(!response.ok)throw Error('Portal indisponível ou autorização insuficiente');return response.json()}finally{clearTimeout(timer)}}
async function memberships(jwt){
if(typeof jwt!=='string'||jwt.length<32||jwt.length>8192)throw Error('Sessão inválida');
const user=await get('/auth/v1/user',jwt);
if(!/^[0-9a-f-]{36}$/i.test(user.id||'')||!user.email)throw Error('Sessão inválida');
const rows=await get('/rest/v1/memberships?select=institution_id,role,active,institutions(id,name,status)&user_id=eq.'+encodeURIComponent(user.id)+'&active=eq.true&role=eq.institution_admin',jwt);
if(!Array.isArray(rows))throw Error('Permissões indisponíveis');
return {user,allowed:rows.filter(r=>r.active===true&&r.role==='institution_admin'&&r.institutions?.status==='active'&&r.institutions?.id===r.institution_id)};
}
async function handle(req,res,{pool,send}){
if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
try{
const a=await body(req),verified=await memberships(a.accessToken);
const rows=verified.allowed,options=rows.map(r=>({id:r.institution_id,name:r.institutions.name}));
if(a.action==='lookup')return send(res,200,{institutions:options});
if(a.action!=='login')return send(res,400,{error:'Operação inválida'});
const selected=rows.find(r=>r.institution_id===a.portalInstitutionId);
if(!selected)return send(res,403,{error:'Administrador não autorizado para esta instituição'});
const mapping=await pool.query('SELECT c.id,c.name FROM flow_portal_institution_links l JOIN flow_clients c ON c.id=l.client_id WHERE l.portal_institution_id=$1 AND c.active=true',[selected.institution_id]);
if(!mapping.rowCount)return send(res,409,{error:'Instituição identificada no Portal, mas o Master ainda não ativou seu vínculo com o AnnA Flow.'});
const cid=mapping.rows[0].id;const cx=await pool.connect();try{
await cx.query('BEGIN');
let found=await cx.query('SELECT u.id,u.role,u.active FROM flow_portal_admin_links l JOIN flow_users u ON u.id=l.flow_user_id WHERE l.portal_user_id=$1 AND l.client_id=$2 FOR UPDATE',[verified.user.id,cid]);
let uid;
if(found.rowCount){const u=found.rows[0];if(!u.active||u.role!=='admin')throw Error('Administrador Flow bloqueado');uid=u.id}
else{
const conflict=await cx.query('SELECT id FROM flow_users WHERE client_id=$1 AND email=lower($2) FOR UPDATE',[cid,verified.user.email]);
if(conflict.rowCount)throw Error('Há um usuário Flow com esse e-mail. Solicite vinculação administrativa para evitar assumir uma conta existente.');
const salt=crypto.randomBytes(16).toString('hex'),randomSecret=crypto.randomBytes(48).toString('hex'),hash=salt+':'+crypto.scryptSync(randomSecret,salt,64).toString('hex');
const inserted=await cx.query("INSERT INTO flow_users(client_id,email,password_hash,role,active) VALUES($1,lower($2),$3,'admin',true) RETURNING id",[cid,verified.user.email,hash]);
uid=inserted.rows[0].id;
await cx.query('INSERT INTO flow_portal_admin_links(portal_user_id,client_id,flow_user_id) VALUES($1,$2,$3)',[verified.user.id,cid,uid]);
await cx.query('INSERT INTO flow_admin_audit(action,client_id,details) VALUES($1,$2,$3::jsonb)',['portal_admin_linked',cid,JSON.stringify({portalUserId:verified.user.id,userId:uid})])
}
const secret='f_'+crypto.randomBytes(32).toString('hex');
await cx.query("INSERT INTO flow_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[uid,digest(secret)]);
await cx.query('COMMIT');
res.setHeader('Set-Cookie','flow_admin_session='+secret+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600');
return send(res,200,{role:'admin',clientId:cid,token:secret})
}catch(e){await cx.query('ROLLBACK').catch(()=>{});if(e.message.includes('bloqueado')||e.message.includes('vinculação'))return send(res,403,{error:e.message});throw e}finally{cx.release()}
}catch(e){return send(res,e.message==='Sessão inválida'?401:503,{error:e.message==='Sessão inválida'?'Sessão do Portal inválida': 'Não foi possível validar a conta institucional no Portal'})}
}
module.exports={handle,memberships};
