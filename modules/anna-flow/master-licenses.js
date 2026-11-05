'use strict';
const {verifyMaster}=require('./central-auth');
const {state}=require('./license-api');
const originAllow=new Set(['https://annaone.com.br','https://www.annaone.com.br']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const num=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const fields='id,client_id,status,plan,starts_at,expires_at,offline_grace_hours,max_units,max_devices,max_users,revision,updated_at';
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>4096)throw Error('Requisição excessiva')}return JSON.parse(s)}
function date(v){if(v===null||v==='')return null;if(typeof v!=='string'||!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Data inválida');return new Date(v).toISOString()}
async function handle(req,res,{pool,send}){
const origin=req.headers.origin||'';
if(origin&&!originAllow.has(origin))return send(res,403,{error:'Origem não autorizada'});
if(originAllow.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');res.setHeader('Access-Control-Max-Age','600')}
if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
const jwt=/^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1];
let master;try{master=await verifyMaster(jwt)}catch{return send(res,503,{error:'Falha ao validar Administrador Geral'})}
if(!master)return send(res,403,{error:'Permissão Master necessária'});
try{
if(req.method==='GET'){
const [clients,links,licenses]=await Promise.all([
pool.query('SELECT id,name,active FROM flow_clients ORDER BY name'),
pool.query('SELECT portal_institution_id,client_id FROM flow_portal_institution_links'),
pool.query('SELECT '+fields+' FROM flow_licenses')]);
return send(res,200,{clients:clients.rows,links:links.rows,licenses:licenses.rows.map(state),enforcementEnabled:false})}
if(req.method!=='POST'&&req.method!=='PUT')return send(res,405,{error:'Método não permitido'});
const a=await body(req),portalId=String(a.portalInstitutionId||''),clientId=num(a.clientId);
if(!uuid.test(portalId)||!clientId)return send(res,400,{error:'Identificadores inválidos'});
// The supplied portal ID must resolve to a real institution visible to the authenticated Master.
const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
try{const r=await fetch('https://tnvghprwltbziivlxeod.supabase.co/rest/v1/institutions?select=id&limit=1&id=eq.'+encodeURIComponent(portalId),{headers:{apikey:'sb_publishable_yI9_7tD4RwGrjolPjiq9vg_oSGpxxFR',Authorization:'Bearer '+jwt},signal:ctrl.signal});if(!r.ok)return send(res,503,{error:'Não foi possível conferir a instituição no Portal'});const rows=await r.json();if(rows.length!==1||rows[0].id!==portalId)return send(res,404,{error:'Instituição não encontrada no Portal'})}finally{clearTimeout(timer)}
if(req.method==='POST'){
const cx=await pool.connect();try{await cx.query('BEGIN');const c=await cx.query('SELECT id FROM flow_clients WHERE id=$1 AND active=true',[clientId]);if(!c.rowCount){await cx.query('ROLLBACK');return send(res,404,{error:'Cliente Flow inexistente ou inativo'})}
const existing=await cx.query('SELECT portal_institution_id,client_id FROM flow_portal_institution_links WHERE portal_institution_id=$1 OR client_id=$2 FOR UPDATE',[portalId,clientId]);
if(existing.rowCount){await cx.query('ROLLBACK');return send(res,409,{error:'A instituição ou cliente Flow já está vinculado. Não é permitido substituir o vínculo automaticamente'})}
await cx.query('INSERT INTO flow_portal_institution_links(portal_institution_id,client_id,created_by) VALUES($1,$2,$3)',[portalId,clientId,master.id]);
await cx.query('INSERT INTO flow_admin_audit(action,client_id,details) VALUES($1,$2,$3::jsonb)',['portal_link_created',clientId,JSON.stringify({portalInstitutionId:portalId,masterId:master.id})]);
await cx.query('COMMIT');return send(res,201,{linked:true})}catch(e){await cx.query('ROLLBACK');if(e.code==='23505')return send(res,409,{error:'Vínculo já cadastrado'});throw e}finally{cx.release()}}
const linked=await pool.query('SELECT 1 FROM flow_portal_institution_links WHERE portal_institution_id=$1 AND client_id=$2',[portalId,clientId]);if(!linked.rowCount)return send(res,403,{error:'Cliente não vinculado a essa instituição no Portal'});
if(!['draft','active','suspended','revoked'].includes(a.status)||typeof a.plan!=='string'||!/^[a-z0-9_-]{1,32}$/.test(a.plan))return send(res,400,{error:'Plano ou status inválido'});
const start=date(a.startsAt),end=date(a.expiresAt);
if(start&&end&&Date.parse(end)<=Date.parse(start))return send(res,400,{error:'Período inválido'});
if(a.status==='active'&&!start)return send(res,400,{error:'Defina o início da licença'});
if(!Number.isSafeInteger(a.offlineGraceHours)||a.offlineGraceHours<0||a.offlineGraceHours>720)return send(res,400,{error:'Tolerância inválida'});
const limits=[a.maxUnits,a.maxDevices,a.maxUsers];if(limits.some(v=>v!==null&&(!Number.isSafeInteger(v)||v<1||v>100000)))return send(res,400,{error:'Limites inválidos'});
const cx=await pool.connect();try{await cx.query('BEGIN');const q=await cx.query(`INSERT INTO flow_licenses(client_id,status,plan,starts_at,expires_at,offline_grace_hours,max_units,max_devices,max_users) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(client_id) DO UPDATE SET status=excluded.status,plan=excluded.plan,starts_at=excluded.starts_at,expires_at=excluded.expires_at,offline_grace_hours=excluded.offline_grace_hours,max_units=excluded.max_units,max_devices=excluded.max_devices,max_users=excluded.max_users,revision=flow_licenses.revision+1,updated_at=now() RETURNING `+fields,[clientId,a.status,a.plan,start,end,a.offlineGraceHours,...limits]);
await cx.query('INSERT INTO flow_admin_audit(action,client_id,details) VALUES($1,$2,$3::jsonb)',['portal_license_updated',clientId,JSON.stringify({portalInstitutionId:portalId,masterId:master.id,revision:q.rows[0].revision,status:a.status})]);await cx.query('COMMIT');return send(res,200,{license:state(q.rows[0]),enforcementEnabled:false})}catch(e){await cx.query('ROLLBACK');throw e}finally{cx.release()}
}catch(e){return send(res,503,{error:'Não foi possível completar a operação de licenciamento'})}}
module.exports={handle};
