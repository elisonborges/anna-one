'use strict';
const auth=require('./auth-api');
const count=x=>{const n=Number(x);return Number.isFinite(n)&&n>=0?Math.floor(n):0};
function totals(runtime,serviceIds){
 const state=runtime&&typeof runtime==='object'&&!Array.isArray(runtime)?runtime:{};
 const queue=Array.isArray(state.queue)?state.queue:[];
 const currents=state.currents&&typeof state.currents==='object'&&!Array.isArray(state.currents)?Object.values(state.currents):[];
 if(state.current?.destinationId&&!currents.some(x=>Number(x?.destinationId)===Number(state.current.destinationId)))currents.push(state.current);
 const allowed=new Set(serviceIds);
 const waiting=queue.filter(x=>allowed.has(Number(x?.serviceId))).length;
 const active=currents.filter(x=>x&&allowed.has(Number(x.serviceId))).length;
 return {waiting,active,completed:count(state.completed),queue};
}
async function handle(req,res,{pool,send}){
 if(req.method!=='GET')return send(res,405,{error:'Método não permitido'});
 try{
  const actor=await auth.session(req,pool);
  if(!actor||actor.role!=='admin')return send(res,403,{error:'Administrador institucional necessário'});
  const clientId=Number(actor.client_id);
  const q=await pool.query('SELECT id,name FROM flow_clients WHERE id=$1 AND active=true',[clientId]);
  if(!q.rowCount)return send(res,403,{error:'Instituição inativa'});
  const [unitsResult,servicesResult,panelsResult,devicesResult,runtimeResult]=await Promise.all([
   pool.query('SELECT id,name FROM flow_client_units WHERE client_id=$1 AND active=true ORDER BY name',[clientId]),
   pool.query('SELECT s.id,s.name,s.unit_id FROM flow_client_services s JOIN flow_client_units u ON u.id=s.unit_id AND u.client_id=s.client_id AND u.active=true WHERE s.client_id=$1 AND s.active=true ORDER BY s.name',[clientId]),
   pool.query('SELECT count(*)::int AS total FROM flow_signage_profiles p JOIN flow_client_units u ON u.id=p.unit_id AND u.client_id=p.client_id AND u.active=true WHERE p.client_id=$1 AND p.active=true',[clientId]),
   pool.query('SELECT count(*)::int AS total FROM flow_devices d JOIN flow_client_units u ON u.id=d.unit_id AND u.client_id=d.client_id AND u.active=true WHERE d.client_id=$1 AND d.active=true AND d.revoked_at IS NULL',[clientId]),
   pool.query('SELECT r.unit_id,r.state FROM flow_client_runtime r JOIN flow_client_units u ON u.id=r.unit_id WHERE u.client_id=$1 AND u.active=true',[clientId])
  ]);
  const services=servicesResult.rows,units=unitsResult.rows;
  const byUnit=new Map(runtimeResult.rows.map(x=>[Number(x.unit_id),x.state]));
  let waiting=0,active=0,completed=0;
  const queues=services.map(s=>({id:s.id,name:s.name,unitId:s.unit_id,unitName:units.find(u=>Number(u.id)===Number(s.unit_id))?.name||'Unidade',waiting:0}));
  for(const unit of units){
   const scoped=services.filter(s=>Number(s.unit_id)===Number(unit.id));
   const result=totals(byUnit.get(Number(unit.id)),scoped.map(s=>Number(s.id)));
   waiting+=result.waiting;active+=result.active;completed+=result.completed;
   const perService=new Map();
   for(const ticket of result.queue){const sid=Number(ticket?.serviceId);perService.set(sid,(perService.get(sid)||0)+1)}
   for(const item of queues.filter(x=>Number(x.unitId)===Number(unit.id)))item.waiting=perService.get(Number(item.id))||0;
  }
  return send(res,200,{institution:q.rows[0],totals:{waiting,active,completed,devices:count(devicesResult.rows[0]?.total),panels:count(panelsResult.rows[0]?.total),units:units.length,services:services.length},queues,completedLabel:'Concluídos desde a última reinicialização das filas'});
 }catch(e){return send(res,503,{error:'Não foi possível carregar os indicadores'})}
}
module.exports={handle,totals};
