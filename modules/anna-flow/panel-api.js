'use strict';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function handle(req,res,{pool,send,deviceApi}){
 if(req.method!=='GET')return send(res,405,{error:'Método não permitido'});
 const url=new URL(req.url,'http://localhost'),key=url.searchParams.get('key')||'';
 if(!uuid.test(key))return send(res,400,{error:'Painel inválido'});
 try{
 const p=await pool.query('SELECT p.id,p.unit_id,p.name,p.theme,p.notice,p.messages,u.name AS unit_name,c.name AS client_name FROM flow_signage_profiles p JOIN flow_client_units u ON u.id=p.unit_id JOIN flow_clients c ON c.id=u.client_id WHERE p.public_key=$1 AND p.active=true AND u.active=true AND c.active=true',[key]);
 if(!p.rowCount)return send(res,404,{error:'Painel indisponível'});
 const row=p.rows[0];
 const guarded=await pool.query("SELECT id FROM flow_devices WHERE panel_id=$1 AND kind='tv' AND active=true AND revoked_at IS NULL LIMIT 1",[row.id]);
 if(guarded.rowCount){const linked=await deviceApi.device(req,pool);if(!linked||linked.kind!=='tv'||Number(linked.panel_id)!==Number(row.id))return send(res,403,{error:'Painel vinculado a dispositivo autorizado'});await pool.query('UPDATE flow_devices SET last_seen=now() WHERE id=$1',[linked.id])}
 const links=await pool.query('SELECT s.id,s.name FROM flow_panel_service_links l JOIN flow_client_services s ON s.id=l.service_id WHERE l.panel_id=$1 AND s.unit_id=$2 AND s.active=true ORDER BY s.name',[row.id,row.unit_id]);
 const media=await pool.query('SELECT video_url,enabled FROM flow_signage_media WHERE panel_id=$1',[row.id]);
 const runtime=await pool.query('SELECT revision,state FROM flow_client_runtime WHERE unit_id=$1',[row.unit_id]);
 const state=runtime.rows[0]?.state||{queue:[],current:null,history:[]},revision=runtime.rows[0]?.revision||0;
 const allowed=new Set(links.rows.map(x=>Number(x.id)));
 const queue=(state.queue||[]).filter(x=>allowed.has(Number(x.serviceId)));
 const current=allowed.has(Number(state.current?.serviceId))?state.current:null;
 const history=(state.history||[]).filter(x=>allowed.has(Number(x.serviceId))).slice(0,6).map(x=>({code:x.code,status:x.status,destination:x.destination,serviceId:x.serviceId}));
 return send(res,200,{revision,profile:{name:row.name,theme:row.theme,notice:row.notice,messages:row.messages,unit:row.unit_name,client:row.client_name},media:media.rows[0]||{video_url:'',enabled:false},services:links.rows,waiting:queue.length,byService:links.rows.map(s=>({id:s.id,name:s.name,waiting:queue.filter(x=>Number(x.serviceId)===Number(s.id)).length})),current:current?{code:current.code,destination:current.destination,serviceId:current.serviceId}:null,history});
 }catch(e){return send(res,503,{error:'Consulta indisponível'})}
}
module.exports=handle;
