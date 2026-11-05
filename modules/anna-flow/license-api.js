'use strict';
const crypto=require('node:crypto');
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const fields='id,client_id,status,plan,starts_at,expires_at,offline_grace_hours,max_units,max_devices,max_users,revision,updated_at';
const date=v=>{if(v===null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Data ISO inválida');return new Date(v).toISOString()};
const positive=v=>{if(v===null||v==='')return null;if(!Number.isSafeInteger(v)||v<1||v>100000)return null;return v};
function state(row){if(!row)return {state:'unconfigured',licensed:false};const now=Date.now(),start=row.starts_at?new Date(row.starts_at).getTime():null,end=row.expires_at?new Date(row.expires_at).getTime():null;let result=row.status;if(result==='active'&&start!==null&&now<start)result='scheduled';if(result==='active'&&end!==null&&now>=end)result='expired';return {...row,state:result,licensed:result==='active',serverTime:new Date().toISOString()}}
async function read(req){let raw='';for await(const part of req){raw+=part;if(raw.length>4096)throw Error('Dados excessivos')}return JSON.parse(raw)}
async function handle(req,res,{pool,send,auth,userAuth}){try{
const u=new URL(req.url,'http://localhost'),clientId=validId(u.searchParams.get('client'));const master=await auth(req);const user=master?null:await userAuth.session(req,pool);
if(req.method==='GET'){
if(!master&&(!user||user.role!=='admin'))return send(res,403,{error:'Acesso administrativo necessário'});
const cid=master?clientId:user.client_id;if(!cid)return send(res,400,{error:'Instituição inválida'});
if(!master&&clientId&&clientId!==cid)return send(res,403,{error:'Instituição não autorizada'});
const rows=await pool.query('SELECT '+fields+' FROM flow_licenses WHERE client_id=$1',[cid]);
return send(res,200,{license:state(rows.rows[0]),enforcementEnabled:false})}
if(req.method!=='PUT')return send(res,405,{error:'Método não permitido'});
if(!master)return send(res,403,{error:'Somente o Master pode definir licenças'});
const a=await read(req),cid=validId(a.clientId);
if(!cid||!['draft','active','suspended','revoked'].includes(a.status)||typeof a.plan!=='string'||!/^[a-z0-9_-]{1,32}$/.test(a.plan))return send(res,400,{error:'Configuração inválida'});
const starts=date(a.startsAt),expires=date(a.expiresAt);
if(starts&&expires&&Date.parse(expires)<=Date.parse(starts))return send(res,400,{error:'Validade inválida'});
if(!Number.isSafeInteger(a.offlineGraceHours)||a.offlineGraceHours<0||a.offlineGraceHours>720)return send(res,400,{error:'Tolerância inválida'});
for(const k of ['maxUnits','maxDevices','maxUsers'])if(a[k]!==null&&positive(a[k])===null)return send(res,400,{error:'Limite inválido: '+k});
if(a.status==='active'&&!starts)return send(res,400,{error:'Início da licença obrigatório'});
const cx=await pool.connect();try{await cx.query('BEGIN');const exists=await cx.query('SELECT id FROM flow_clients WHERE id=$1',[cid]);if(!exists.rowCount){await cx.query('ROLLBACK');return send(res,404,{error:'Instituição não cadastrada'})}
const changed=await cx.query(`INSERT INTO flow_licenses(client_id,status,plan,starts_at,expires_at,offline_grace_hours,max_units,max_devices,max_users)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT(client_id) DO UPDATE SET status=excluded.status,plan=excluded.plan,starts_at=excluded.starts_at,expires_at=excluded.expires_at,offline_grace_hours=excluded.offline_grace_hours,max_units=excluded.max_units,max_devices=excluded.max_devices,max_users=excluded.max_users,revision=flow_licenses.revision+1,updated_at=now()
RETURNING `+fields,[cid,a.status,a.plan,starts,expires,a.offlineGraceHours,a.maxUnits,a.maxDevices,a.maxUsers]);
await cx.query('INSERT INTO flow_admin_audit(action,client_id,details) VALUES($1,$2,$3::jsonb)',['license_updated',cid,JSON.stringify({licenseId:changed.rows[0].id,revision:changed.rows[0].revision,status:a.status})]);await cx.query('COMMIT');return send(res,200,{license:state(changed.rows[0]),enforcementEnabled:false})}catch(e){await cx.query('ROLLBACK');throw e}finally{cx.release()}
}catch(e){return send(res,e.message.includes('inválid')?400:503,{error:e.message.includes('inválid')?e.message:'Falha ao consultar licença'})}}
module.exports={handle,state};
