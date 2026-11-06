'use strict';
const auth=require('./auth-api');
const id=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null};
const zones=['America/Fortaleza','America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha'];
const validClock=v=>typeof v==='string'&&(/^([01]\d|2[0-3]):[0-5]\d$/).test(v);
const settings=state=>({startNumber:Number.isSafeInteger(state?.ticketSettings?.startNumber)?state.ticketSettings.startNumber:1,openingTime:state?.ticketSettings?.openingTime||'',timezone:zones.includes(state?.ticketSettings?.timezone)?state.ticketSettings.timezone:'America/Fortaleza'});
const stateOf=r=>(r&&typeof r==='object'&&!Array.isArray(r))?r:{};
async function read(req){let s='';for await(const p of req){s+=p;if(s.length>2000)throw Error('Corpo excessivo')}return JSON.parse(s)}
async function handle(req,res,{pool,send}){
 try{
  const actor=await auth.session(req,pool);
  if(!actor||actor.role!=='admin')return send(res,403,{error:'Administrador institucional necessário'});
  const clientId=id(actor.client_id),unitId=id(new URL(req.url,'http://localhost').searchParams.get('unit'));
  if(!clientId)return send(res,403,{error:'Instituição inválida'});
  const base=await pool.query('SELECT u.id,u.name FROM flow_client_units u JOIN flow_clients c ON c.id=u.client_id WHERE u.client_id=$1 AND u.active=true AND c.active=true AND EXISTS(SELECT 1 FROM flow_user_units x WHERE x.user_id=$2 AND x.client_id=$1 AND x.unit_id=u.id) ORDER BY u.name',[clientId,actor.id]);
  const units=base.rows;
  if(req.method==='GET'&&!unitId)return send(res,200,{units});
  if(!unitId||!units.some(x=>Number(x.id)===unitId))return send(res,403,{error:'Unidade não autorizada'});
  if(req.method==='GET'){
   const [services,desks,runtime]=await Promise.all([
    pool.query('SELECT id,name FROM flow_client_services WHERE client_id=$1 AND unit_id=$2 AND active=true ORDER BY name',[clientId,unitId]),
    pool.query('SELECT id,name FROM flow_client_destinations WHERE client_id=$1 AND unit_id=$2 AND active=true ORDER BY name',[clientId,unitId]),
    pool.query('SELECT state,revision FROM flow_client_runtime WHERE unit_id=$1',[unitId])
   ]);
   const state=stateOf(runtime.rows[0]?.state),svc=services.rows,dest=desks.rows;
   const queue=Array.isArray(state.queue)?state.queue:[];
   const currents=state.currents&&typeof state.currents==='object'&&!Array.isArray(state.currents)?Object.values(state.currents).filter(Boolean):[];
   if(state.current?.destinationId&&!currents.some(x=>Number(x.destinationId)===Number(state.current.destinationId)))currents.push(state.current);
   const serviceIds=new Set(svc.map(s=>Number(s.id))),destinationIds=new Set(dest.map(d=>Number(d.id)));
   const waiting=queue.filter(x=>serviceIds.has(Number(x.serviceId)));
   const active=currents.filter(x=>serviceIds.has(Number(x.serviceId))&&destinationIds.has(Number(x.destinationId)));
   const servicesView=svc.map(s=>{const q=waiting.filter(x=>Number(x.serviceId)===Number(s.id));return {...s,normal:q.filter(x=>x.priority!=='preferencial').length,preferential:q.filter(x=>x.priority==='preferencial').length}});
   const desksView=dest.map(d=>{const ticket=active.find(x=>Number(x.destinationId)===Number(d.id));return {id:d.id,name:d.name,code:ticket?.code||null,serviceId:ticket?.serviceId||null}});
   const history=(Array.isArray(state.history)?state.history:[]).filter(x=>serviceIds.has(Number(x.serviceId))).slice(0,15).map(x=>({code:x.code,destination:x.destination||'',status:x.status||'chamado',calledAt:x.calledAt||null}));
   return send(res,200,{unit:units.find(x=>Number(x.id)===unitId),totals:{waiting:waiting.length,active:active.length,completed:Number(state.completed)||0},services:servicesView,desks:desksView,history,settings:settings(state),dayKey:state.ticketDay||null,revision:runtime.rows[0]?.revision||0});
  }
  if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
  const data=await read(req);
  if(data.type!=='ticket_settings'||!Number.isSafeInteger(data.startNumber)||data.startNumber<1||data.startNumber>999999||!zones.includes(data.timezone)||!(data.openingTime===''||validClock(data.openingTime)))
   return send(res,400,{error:'Configuração inválida: número inicial de 1 a 999999 e horário HH:MM'});
  const cx=await pool.connect();
  try{
   await cx.query('BEGIN');
   await cx.query('INSERT INTO flow_client_runtime(unit_id) VALUES($1) ON CONFLICT DO NOTHING',[unitId]);
   const old=await cx.query('SELECT state,revision FROM flow_client_runtime WHERE unit_id=$1 FOR UPDATE',[unitId]);
   const state=stateOf(old.rows[0].state);
   state.ticketSettings={startNumber:data.startNumber,openingTime:data.openingTime,timezone:data.timezone};
   await cx.query('UPDATE flow_client_runtime SET state=$2::jsonb,revision=revision+1,updated_at=now() WHERE unit_id=$1',[unitId,JSON.stringify(state)]);
   await cx.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',['ticket_settings',clientId,unitId,JSON.stringify(state.ticketSettings)]);
   await cx.query('COMMIT');
   return send(res,200,{saved:true,settings:state.ticketSettings,notice:'O número inicial será usado no próximo dia de emissão; senhas já emitidas não mudam.'});
  }catch(e){await cx.query('ROLLBACK').catch(()=>{});return send(res,503,{error:'Não foi possível salvar a configuração'})}finally{cx.release()}
 }catch(e){return send(res,503,{error:'Falha ao consultar atendimento'})}
}
module.exports={handle,settings};
