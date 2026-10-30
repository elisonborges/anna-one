'use strict';
const readBody=async req=>{let body='';for await(const c of req){body+=c;if(body.length>12000)throw Error('Requisição muito grande')}return JSON.parse(body)};
const str=(v,n=120)=>typeof v==='string'?v.trim().slice(0,n):'';
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw Error('Identificador inválido');return n};
const names={clients:'flow_clients',units:'flow_client_units',services:'flow_client_services',destinations:'flow_client_destinations',panels:'flow_signage_profiles'};
async function handle(req,res,{pool,auth,send}){
if(!auth(req))return send(res,401,{error:'Não autorizado'});
try{
if(req.method==='GET'){
const client=req.url.includes('?')?new URL(req.url,'http://localhost').searchParams.get('client'):null;
const clientId=client?id(client):null;
const c=await pool.query('SELECT id,name,segment,active FROM flow_clients ORDER BY id');
if(!clientId)return send(res,200,{clients:c.rows,units:[],services:[],destinations:[],panels:[]});
const found=c.rows.some(x=>Number(x.id)===clientId);if(!found)return send(res,404,{error:'Cliente não encontrado'});
const [units,services,destinations,panels]=await Promise.all([
pool.query('SELECT id,client_id,name,active FROM flow_client_units WHERE client_id=$1 ORDER BY id',[clientId]),
pool.query('SELECT id,unit_id,name,priority_enabled,active FROM flow_client_services WHERE client_id=$1 ORDER BY id',[clientId]),
pool.query('SELECT id,unit_id,name,destination_type,active FROM flow_client_destinations WHERE client_id=$1 ORDER BY id',[clientId]),
pool.query('SELECT id,unit_id,name,theme,notice,messages,active,public_key FROM flow_signage_profiles WHERE client_id=$1 ORDER BY id',[clientId])]);
return send(res,200,{clients:c.rows,units:units.rows,services:services.rows,destinations:destinations.rows,panels:panels.rows})}
if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
const a=await readBody(req);let result;
switch(a.type){
case 'client': {const name=str(a.name,160),segment=str(a.segment,32);if(!name||!['educacao','saude','empresa','publico','outro'].includes(segment))throw Error('Nome ou segmento inválido');result=await pool.query('INSERT INTO flow_clients(name,segment) VALUES($1,$2) RETURNING id,name,segment',[name,segment]);break}
case 'unit': {const name=str(a.name),client=id(a.clientId);if(!name)throw Error('Informe a unidade');result=await pool.query('INSERT INTO flow_client_units(client_id,name) VALUES($1,$2) RETURNING id,name',[client,name]);break}
case 'service': {const name=str(a.name,100),client=id(a.clientId),unit=id(a.unitId);if(!name)throw Error('Informe o serviço');result=await pool.query('INSERT INTO flow_client_services(client_id,unit_id,name) VALUES($1,$2,$3) RETURNING id,name',[client,unit,name]);break}
case 'destination': {const name=str(a.name,100),client=id(a.clientId),unit=id(a.unitId),kind=str(a.kind,24);if(!name||!['guiche','sala','consultorio','setor','outro'].includes(kind))throw Error('Destino inválido');result=await pool.query('INSERT INTO flow_client_destinations(client_id,unit_id,name,destination_type) VALUES($1,$2,$3,$4) RETURNING id,name',[client,unit,name,kind]);break}
case 'panel_services': {const panel=id(a.panelId),client=id(a.clientId);const ids=Array.isArray(a.serviceIds)?[...new Set(a.serviceIds.map(id))]:[];if(ids.length>60)throw Error('Excesso de serviços');const db=await pool.connect();try{await db.query('BEGIN');const found=await db.query('SELECT id,unit_id FROM flow_signage_profiles WHERE id=$1 AND client_id=$2 FOR UPDATE',[panel,client]);if(!found.rowCount)throw Error('Painel não encontrado');const unit=found.rows[0].unit_id;const allowed=await db.query('SELECT id FROM flow_client_services WHERE unit_id=$1 AND active=true',[unit]);const valid=new Set(allowed.rows.map(x=>Number(x.id)));if(ids.some(x=>!valid.has(x)))throw Error('Serviço de outra unidade');await db.query('DELETE FROM flow_panel_service_links WHERE panel_id=$1',[panel]);for(const sid of ids)await db.query('INSERT INTO flow_panel_service_links(panel_id,service_id) VALUES($1,$2)',[panel,sid]);await db.query('COMMIT');return send(res,200,{saved:true})}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
case 'panel': {const name=str(a.name,100),client=id(a.clientId),unit=id(a.unitId),theme=str(a.theme,24);if(!name||!['escuro','claro','acolhedor'].includes(theme))throw Error('Painel inválido');result=await pool.query('INSERT INTO flow_signage_profiles(client_id,unit_id,name,theme) VALUES($1,$2,$3,$4) RETURNING id,name',[client,unit,name,theme]);break}
default:throw Error('Operação não permitida')}
return send(res,201,{created:result.rows[0]})}
catch(e){const status=e.code==='23503'?400:e.code==='23505'?409:400;return send(res,status,{error:e.code==='23503'?'Unidade ou cliente inválido':e.code==='23505'?'Cadastro duplicado':e.message||'Falha na operação'})}
}
module.exports=handle;
