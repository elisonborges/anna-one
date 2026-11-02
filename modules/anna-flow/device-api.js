'use strict';
const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const uid=s=>/^[0-9a-f-]{36}$/i.test(String(s||''));
const tokenOk=s=>/^fd_[a-f0-9]{64}$/.test(String(s||''));
const id=s=>{const n=Number(s);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n};
async function read(req){let s='';for await(const c of req){s+=c;if(s.length>4096)throw Error('Conteúdo excedido')}return JSON.parse(s)}
const scopes={tv:['tv'],totem:['totem'],recepcao:['recepcao'],terminal:['terminal']};
async function device(req,pool){const token=req.headers['x-flow-device']||'';if(!tokenOk(token))return null;const q=await pool.query("SELECT d.id,d.client_id,d.unit_id,d.kind,d.panel_id,d.destination_id FROM flow_devices d JOIN flow_clients c ON c.id=d.client_id JOIN flow_client_units u ON u.id=d.unit_id AND u.client_id=d.client_id WHERE d.credential_hash=$1 AND d.active=true AND d.revoked_at IS NULL AND c.active=true AND u.active=true",[hash(token)]);return q.rows[0]||null}
async function handle(req,res,{pool,auth,send,userAuth}){
const url=new URL(req.url,'http://localhost');const action=url.pathname;
try{
if(action==='/api/device/request'&&req.method==='POST'){
const data=await read(req);if(!tokenOk(data.credential))return send(res,400,{error:'Credencial inválida'});
const code=String(crypto.randomInt(0,100000000)).padStart(8,'0');const q=await pool.query('INSERT INTO flow_device_requests(code_hash,claim_hash) VALUES($1,$2) RETURNING id,expires_at',[hash(code),hash(data.credential)]);return send(res,201,{requestId:q.rows[0].id,code,expiresAt:q.rows[0].expires_at});
}
if(action==='/api/device/status'&&req.method==='GET'){
const requestId=url.searchParams.get('id'),cred=req.headers['x-flow-device'];if(!uid(requestId)||!tokenOk(cred))return send(res,400,{error:'Solicitação inválida'});
const q=await pool.query('SELECT r.expires_at,r.approved_at,d.id,d.kind,d.unit_id,d.panel_id,d.destination_id,p.public_key FROM flow_device_requests r LEFT JOIN flow_devices d ON d.id=r.device_id AND d.active=true AND d.revoked_at IS NULL LEFT JOIN flow_signage_profiles p ON p.id=d.panel_id WHERE r.id=$1 AND r.claim_hash=$2',[requestId,hash(cred)]);
if(!q.rowCount)return send(res,404,{error:'Código não encontrado'});const row=q.rows[0];
if(row.approved_at&&!row.id)return send(res,403,{error:'Dispositivo revogado'});
if(row.id)return send(res,200,{status:'active',kind:row.kind,unitId:row.unit_id,panelKey:row.public_key,destinationId:row.destination_id});
if(new Date(row.expires_at)<new Date())return send(res,410,{status:'expired'});
return send(res,200,{status:'pending'});
}
if(action==='/api/device/catalog'&&req.method==='GET'){const d=await device(req,pool);if(!d||!['totem','recepcao','terminal'].includes(d.kind))return send(res,403,{error:'Dispositivo não autorizado'});const q=await pool.query('SELECT id,name FROM flow_client_services WHERE unit_id=$1 AND client_id=$2 AND active=true ORDER BY name',[d.unit_id,d.client_id]);const ds=await pool.query('SELECT id,name FROM flow_client_destinations WHERE unit_id=$1 AND client_id=$2 AND active=true ORDER BY name',[d.unit_id,d.client_id]);await pool.query('UPDATE flow_devices SET last_seen=now() WHERE id=$1',[d.id]);return send(res,200,{kind:d.kind,unitId:d.unit_id,destinationId:d.destination_id,services:q.rows,destinations:ds.rows})}
if(action==='/api/device/me'&&req.method==='GET'){const d=await device(req,pool);if(!d)return send(res,401,{error:'Dispositivo sem autorização'});await pool.query('UPDATE flow_devices SET last_seen=now() WHERE id=$1',[d.id]);return send(res,200,{device:d})}
const user=await userAuth.session(req,pool);const central=auth(req);
if(action==='/api/device/options'&&req.method==='GET'){if(!central&&(!user||user.role!=='admin'))return send(res,403,{error:'Administrador necessário'});const client=central?id(url.searchParams.get('client')):Number(user.client_id);const scope=central?null:await pool.query('SELECT unit_id FROM flow_user_units WHERE user_id=$1 AND client_id=$2',[user.id,client]);const allowed=scope?scope.rows.map(x=>Number(x.unit_id)):null;const [us,ps,ds]=await Promise.all([pool.query('SELECT id,name FROM flow_client_units WHERE client_id=$1 AND active=true ORDER BY name',[client]),pool.query('SELECT id,unit_id,name FROM flow_signage_profiles WHERE client_id=$1 AND active=true ORDER BY name',[client]),pool.query('SELECT id,unit_id,name FROM flow_client_destinations WHERE client_id=$1 AND active=true ORDER BY name',[client])]);const filter=x=>allowed===null?x:x.filter(r=>allowed.includes(Number(r.unit_id||r.id)));return send(res,200,{clientId:client,units:filter(us.rows),panels:filter(ps.rows),destinations:filter(ds.rows)})}
if(action==='/api/device/list'&&req.method==='GET'){
if(!central&&(!user||user.role!=='admin'))return send(res,403,{error:'Administrador necessário'});
const client=id(url.searchParams.get('client'));if(!central&&Number(user.client_id)!==client)return send(res,403,{error:'Outra instituição'});
const q=await pool.query('SELECT d.id,d.name,d.kind,d.client_id,d.unit_id,d.panel_id,d.destination_id,d.active,d.last_seen,d.created_at,d.revoked_at FROM flow_devices d WHERE d.client_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM flow_user_units x WHERE x.user_id=$3 AND x.client_id=$1 AND x.unit_id=d.unit_id)) ORDER BY d.created_at DESC',[client,central,user?.id||0]);return send(res,200,{devices:q.rows});
}
if(action==='/api/device/approve'&&req.method==='POST'){
if(!central&&(!user||user.role!=='admin'))return send(res,403,{error:'Administrador necessário'});
const a=await read(req),client=id(a.clientId),unit=id(a.unitId),kind=String(a.kind||''),name=String(a.name||'').trim().slice(0,120);
if(!scopes[kind]||!name||!/^\d{8}$/.test(String(a.code||'')))return send(res,400,{error:'Cadastro inválido'});
if(!central&&Number(user.client_id)!==client)return send(res,403,{error:'Instituição não autorizada'});
if(!central){const access=await pool.query('SELECT 1 FROM flow_user_units WHERE user_id=$1 AND client_id=$2 AND unit_id=$3',[user.id,client,unit]);if(!access.rowCount)return send(res,403,{error:'Unidade não autorizada'})}
const panel=a.panelId?id(a.panelId):null,dest=a.destinationId?id(a.destinationId):null;
if(kind==='tv'&&!panel)return send(res,400,{error:'Selecione o painel de TV'});
if(kind==='terminal'&&!dest)return send(res,400,{error:'Selecione o guichê'});
const cx=await pool.connect();try{
await cx.query('BEGIN');
const request=await cx.query('SELECT id,claim_hash FROM flow_device_requests WHERE code_hash=$1 AND expires_at>now() AND approved_at IS NULL FOR UPDATE',[hash(a.code)]);
if(!request.rowCount)throw Error('Código expirado, utilizado ou inválido');
const u=await cx.query('SELECT id FROM flow_client_units WHERE id=$1 AND client_id=$2 AND active=true',[unit,client]);if(!u.rowCount)throw Error('Unidade inválida');
if(panel){const p=await cx.query('SELECT 1 FROM flow_signage_profiles WHERE id=$1 AND unit_id=$2 AND client_id=$3 AND active=true',[panel,unit,client]);if(!p.rowCount)throw Error('Painel não pertence à unidade')}
if(dest){const d=await cx.query('SELECT 1 FROM flow_client_destinations WHERE id=$1 AND unit_id=$2 AND client_id=$3 AND active=true',[dest,unit,client]);if(!d.rowCount)throw Error('Destino não pertence à unidade')}
const q=await cx.query('INSERT INTO flow_devices(client_id,unit_id,name,kind,panel_id,destination_id,credential_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[client,unit,name,kind,panel,dest,request.rows[0].claim_hash]);
await cx.query('UPDATE flow_device_requests SET approved_at=now(),device_id=$2 WHERE id=$1',[request.rows[0].id,q.rows[0].id]);
await cx.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['device_approve',client,unit,JSON.stringify({deviceId:q.rows[0].id,kind,name})]);
await cx.query('COMMIT');return send(res,201,{approved:true,deviceId:q.rows[0].id})
}catch(e){await cx.query('ROLLBACK');return send(res,400,{error:e.message})}finally{cx.release()}
}
if(action==='/api/device/revoke'&&req.method==='POST'){
if(!central&&(!user||user.role!=='admin'))return send(res,403,{error:'Administrador necessário'});const a=await read(req),client=id(a.clientId);
if(!central&&Number(user.client_id)!==client)return send(res,403,{error:'Outra instituição'});
if(!uid(a.deviceId))return send(res,400,{error:'ID inválido'});
const q=await pool.query("UPDATE flow_devices d SET active=false,revoked_at=now() WHERE d.id=$1 AND d.client_id=$2 AND d.active=true AND ($3::boolean OR EXISTS(SELECT 1 FROM flow_user_units x WHERE x.user_id=$4 AND x.client_id=$2 AND x.unit_id=d.unit_id)) RETURNING id,unit_id",[a.deviceId,client,central,user?.id||0]);if(!q.rowCount)return send(res,404,{error:'Dispositivo não encontrado ou sem autorização'});
await pool.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['device_revoke',client,q.rows[0].unit_id,JSON.stringify({deviceId:a.deviceId})]);
return send(res,200,{revoked:true});
}
return send(res,405,{error:'Operação não permitida'});
}catch(e){return send(res,400,{error:e.message||'Erro de dispositivo'})}
}
module.exports={handle,device};
