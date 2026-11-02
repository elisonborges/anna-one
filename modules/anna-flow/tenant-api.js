'use strict';
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n};
const safe=(v,n=100)=>typeof v==='string'?v.trim().slice(0,n):'';
const read=async req=>{let body='';for await(const c of req){body+=c;if(body.length>10000)throw Error('Corpo muito grande')}return JSON.parse(body)};
const initial=()=>({counters:{},queue:[],current:null,history:[],completed:0,calls:0});
async function handle(req,res,{pool,auth,send,deviceApi}){
 const user=await require('./auth-api').session(req,pool);
 const linked=await deviceApi.device(req,pool);
 if(!user&&!auth(req)&&!linked)return send(res,401,{error:'Autorização necessária'});
 try{
 const u=new URL(req.url,'http://localhost');const unit=id(u.searchParams.get('unit'));
 if(user){if(!['admin','atendente'].includes(user.role))return send(res,403,{error:'Perfil sem permissão operacional'});const access=await pool.query('SELECT 1 FROM flow_user_units a JOIN flow_client_units u ON u.id=a.unit_id JOIN flow_clients c ON c.id=u.client_id WHERE a.user_id=$1 AND a.client_id=$2 AND a.unit_id=$3 AND u.active=true AND c.active=true',[user.id,user.client_id,unit]);if(!access.rowCount)return send(res,403,{error:'Unidade não autorizada ou inativa'})}
 if(linked&&Number(linked.unit_id)!==unit)return send(res,403,{error:'Equipamento de outra unidade'});
 if(req.method==='GET'){
 const q=await pool.query('SELECT r.revision,r.state FROM flow_client_runtime r JOIN flow_client_units u ON u.id=r.unit_id WHERE u.id=$1',[unit]);
 if(q.rowCount)return send(res,200,q.rows[0]);
 const valid=await pool.query('SELECT id FROM flow_client_units WHERE id=$1 AND active=true',[unit]);
 return valid.rowCount?send(res,200,{revision:0,state:initial()}):send(res,404,{error:'Unidade não encontrada'});
 }
 if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
 const a=await read(req);
 if(linked){if(linked.kind==='tv')return send(res,403,{error:'TV somente leitura'});if(linked.kind==='terminal'){if(!user||!['admin','atendente'].includes(user.role))return send(res,403,{error:'Atendente precisa entrar com sua conta'});if(!['call','finish'].includes(a.type))return send(res,403,{error:'Operação não autorizada ao terminal'});if(a.type==='call'&&Number(a.destinationId)!==Number(linked.destination_id))return send(res,403,{error:'Guichê diferente do equipamento vinculado'})}else if(!['totem','recepcao'].includes(linked.kind)||a.type!=='issue')return send(res,403,{error:'Dispositivo permite somente emissão'});}else if(!user&&!auth(req))return send(res,401,{error:'Vincule o dispositivo ou faça login'});
 const client=await pool.connect();
 try{
 await client.query('BEGIN');
 const unitResult=await client.query('SELECT u.id,u.client_id FROM flow_client_units u JOIN flow_clients c ON c.id=u.client_id WHERE u.id=$1 AND u.active=true AND c.active=true',[unit]);
 if(!unitResult.rowCount)throw Error('Unidade inexistente');
 const serviceResult=await client.query('SELECT id,name FROM flow_client_services WHERE unit_id=$1 AND active=true ORDER BY id',[unit]);
 await client.query('INSERT INTO flow_client_runtime(unit_id) VALUES($1) ON CONFLICT DO NOTHING',[unit]);
 const current=await client.query('SELECT revision,state FROM flow_client_runtime WHERE unit_id=$1 FOR UPDATE',[unit]);
 const state=current.rows[0].state,serviceIds=new Set(serviceResult.rows.map(s=>Number(s.id)));
 let result;
 switch(a.type){
 case 'issue':{
 const serviceId=id(a.serviceId);if(!serviceIds.has(serviceId))throw Error('Serviço não pertence à unidade');
 const priority=a.priority==='preferencial'?'preferencial':'normal';const key=serviceId+':'+priority;
 state.counters[key]=(state.counters[key]||0)+1;const code=(priority==='preferencial'?'P':'A')+'-'+serviceId+'-'+String(state.counters[key]).padStart(3,'0');
 state.queue.push({code,serviceId,priority,issuedAt:new Date().toISOString()});result={code};break}
 case 'call':{
 if(state.current)throw Error('Conclua o atendimento anterior');
 const serviceId=id(a.serviceId);if(!serviceIds.has(serviceId))throw Error('Serviço não pertence à unidade');
 const dest=id(a.destinationId);
 const destination=await client.query('SELECT id,name FROM flow_client_destinations WHERE unit_id=$1 AND id=$2 AND active=true',[unit,dest]);
 if(!destination.rowCount)throw Error('Destino não pertence à unidade');
 let idx=state.queue.findIndex(q=>q.serviceId===serviceId&&q.priority==='preferencial');
 if(idx<0)idx=state.queue.findIndex(q=>q.serviceId===serviceId);
 if(idx<0)throw Error('Fila vazia');
 state.current={...state.queue.splice(idx,1)[0],destinationId:dest,destination:destination.rows[0].name,calledAt:new Date().toISOString()};
 state.history.unshift({...state.current,status:'chamado'});state.history=state.history.slice(0,30);state.calls++;result={code:state.current.code};break}
 case 'finish':{
 if(!state.current)throw Error('Sem atendimento ativo');
 const h=state.history.find(x=>x.code===state.current.code);if(h)h.status='concluido';
 result={code:state.current.code};state.current=null;state.completed++;break}
 default:throw Error('Operação inválida');
 }
 const revision=Number(current.rows[0].revision)+1;
 await client.query('UPDATE flow_client_runtime SET state=$2::jsonb,revision=$3,updated_at=now() WHERE unit_id=$1',[unit,JSON.stringify(state),revision]);
 await client.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',[a.type,unitResult.rows[0].client_id,unit,JSON.stringify(result)]);
 await client.query('COMMIT');return send(res,200,{revision,state,result});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});return send(res,400,{error:e.message})}finally{client.release()}
 }catch(e){return send(res,400,{error:e.message})}
}
module.exports=handle;
