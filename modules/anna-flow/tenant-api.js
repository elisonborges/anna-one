'use strict';
const id=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw Error('Identificador inválido');return n};
const safe=(v,n=100)=>typeof v==='string'?v.trim().slice(0,n):'';
const read=async req=>{let body='';for await(const c of req){body+=c;if(body.length>10000)throw Error('Corpo muito grande')}return JSON.parse(body)};
const initial=()=>({counters:{},queue:[],current:null,currents:{},history:[],completed:0,calls:0});
function migrate(state){
 if(!state.currents||typeof state.currents!=='object'||Array.isArray(state.currents))state.currents={};
 if(state.current?.destinationId&&!state.currents[String(state.current.destinationId)])state.currents[String(state.current.destinationId)]=state.current;
 state.current=null;
 return state;
}
const timezones=['America/Fortaleza','America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha'];
function ticketDay(now,zone){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;
}
function nextTicketNumber(state,key,now){
 const policy=state.ticketSettings||{};
 const zone=timezones.includes(policy.timezone)?policy.timezone:'America/Fortaleza';
 const day=ticketDay(now,zone);
 const start=Number.isSafeInteger(policy.startNumber)&&policy.startNumber>=1&&policy.startNumber<=999999?policy.startNumber:1;
 if(state.ticketDay!==day){
  // Na primeira migração, conservar a numeração atual; nas viradas seguintes,
  // iniciar o novo dia respeitando a política cadastrada.
  state.ticketDailyCounters=state.ticketDay?{}:{...state.counters};
  state.ticketDayStart=start;
  state.ticketDay=day;
 }
 if(!state.ticketDailyCounters||typeof state.ticketDailyCounters!=='object')state.ticketDailyCounters={};
 const old=Number(state.ticketDailyCounters[key])||0;
 // Evitar colisão com senhas antigas que ainda estejam na fila ou guichês.
 const outstanding=[...(Array.isArray(state.queue)?state.queue:[]),...Object.values(state.currents||{}),...(state.noShows||[])];
 const maxInUse=outstanding.reduce((max,t)=>t?.code?.startsWith((key.split(':')[1]==='preferencial'?'P':'A')+'-'+key.split(':')[0]+'-')?Math.max(max,Number(t.code.split('-').at(-1))||0):max,0);
 const effectiveStart=Number.isSafeInteger(state.ticketDayStart)&&state.ticketDayStart>=1&&state.ticketDayStart<=999999?state.ticketDayStart:start;
 const next=Math.max(effectiveStart-1,old,maxInUse)+1;
 if(next>9999999)throw Error('Limite de numeração atingido; procure o administrador');
 state.ticketDailyCounters[key]=next;
 state.counters[key]=Math.max(Number(state.counters?.[key])||0,next);
 return {number:next,day,zone,openingTime:/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.openingTime||'')?policy.openingTime:''};
}
function active(state,dest){return state.currents[String(dest)]||null}
function setActive(state,dest,ticket){if(ticket)state.currents[String(dest)]=ticket;else delete state.currents[String(dest)]}
function visibleState(state){return {...state,current:null,currents:state.currents||{}}}

async function handle(req,res,{pool,auth,send,deviceApi}){
 const user=await require('./auth-api').session(req,pool);
 const linked=await deviceApi.device(req,pool);
 if(!user&&!(await auth(req))&&!linked)return send(res,401,{error:'Autorização necessária'});
 try{
 const u=new URL(req.url,'http://localhost');const unit=id(u.searchParams.get('unit'));
 if(user){if(!['admin','atendente'].includes(user.role))return send(res,403,{error:'Perfil sem permissão operacional'});const access=await pool.query('SELECT 1 FROM flow_user_units a JOIN flow_client_units u ON u.id=a.unit_id JOIN flow_clients c ON c.id=u.client_id WHERE a.user_id=$1 AND a.client_id=$2 AND a.unit_id=$3 AND u.active=true AND c.active=true',[user.id,user.client_id,unit]);if(!access.rowCount)return send(res,403,{error:'Unidade não autorizada ou inativa'})}
 if(linked&&Number(linked.unit_id)!==unit)return send(res,403,{error:'Equipamento de outra unidade'});
 if(req.method==='GET'){
 const q=await pool.query('SELECT r.revision,r.state FROM flow_client_runtime r JOIN flow_client_units u ON u.id=r.unit_id WHERE u.id=$1',[unit]);
 if(q.rowCount)return send(res,200,{...q.rows[0],state:visibleState(migrate(q.rows[0].state))});
 const valid=await pool.query('SELECT id FROM flow_client_units WHERE id=$1 AND active=true',[unit]);
 return valid.rowCount?send(res,200,{revision:0,state:initial()}):send(res,404,{error:'Unidade não encontrada'});
 }
 if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
 const a=await read(req);
 if(linked){if(linked.kind==='tv')return send(res,403,{error:'TV somente leitura'});if(linked.kind==='terminal'){if(!user||!['admin','atendente'].includes(user.role))return send(res,403,{error:'Atendente precisa entrar com sua conta'});if(!['call','finish','transfer','recall','no_show','return_queue'].includes(a.type))return send(res,403,{error:'Operação não autorizada ao terminal'});if(a.type==='call'&&Number(a.destinationId)!==Number(linked.destination_id))return send(res,403,{error:'Guichê diferente do equipamento vinculado'})}else if(!['totem','recepcao'].includes(linked.kind)||a.type!=='issue')return send(res,403,{error:'Dispositivo permite somente emissão'});}else if(!user&&!(await auth(req)))return send(res,401,{error:'Vincule o dispositivo ou faça login'});
 const client=await pool.connect();
 try{
 await client.query('BEGIN');
 const unitResult=await client.query('SELECT u.id,u.client_id,u.name,c.name AS institution_name FROM flow_client_units u JOIN flow_clients c ON c.id=u.client_id WHERE u.id=$1 AND u.active=true AND c.active=true',[unit]);
 if(!unitResult.rowCount)throw Error('Unidade inexistente');
 const serviceResult=await client.query('SELECT id,name FROM flow_client_services WHERE unit_id=$1 AND active=true ORDER BY id',[unit]);
 await client.query('INSERT INTO flow_client_runtime(unit_id) VALUES($1) ON CONFLICT DO NOTHING',[unit]);
 const current=await client.query('SELECT revision,state FROM flow_client_runtime WHERE unit_id=$1 FOR UPDATE',[unit]);
 const state=migrate(current.rows[0].state),serviceIds=new Set(serviceResult.rows.map(s=>Number(s.id)));
 if(!Array.isArray(state.noShows))state.noShows=[];
 const deskActions=['recall','no_show','finish','transfer'];
 const destId=deskActions.includes(a.type)?id(linked?.kind==='terminal'?linked.destination_id:a.destinationId):null;
 if(linked?.kind==='terminal'&&deskActions.includes(a.type)&&a.destinationId&&Number(a.destinationId)!==Number(linked.destination_id))throw Error('Guichê diferente do terminal');
 if(destId){
  const d=await client.query('SELECT id FROM flow_client_destinations WHERE id=$1 AND unit_id=$2 AND active=true',[destId,unit]);
  if(!d.rowCount)throw Error('Guichê não autorizado');
 }

 let result;
 switch(a.type){
 case 'issue':{
 const serviceId=id(a.serviceId);if(!serviceIds.has(serviceId))throw Error('Serviço não pertence à unidade');
 const priority=a.priority==='preferencial'?'preferencial':'normal';const key=serviceId+':'+priority;
 const issuedAt=new Date(),numbering=nextTicketNumber(state,key,issuedAt);
 const code=(priority==='preferencial'?'P':'A')+'-'+serviceId+'-'+String(numbering.number).padStart(3,'0');
 state.queue.push({code,serviceId,priority,issuedAt:issuedAt.toISOString()});result={code,issuedAt:issuedAt.toISOString(),serviceName:serviceResult.rows.find(s=>Number(s.id)===serviceId)?.name||'',unitName:unitResult.rows[0].name,institutionName:unitResult.rows[0].institution_name,serviceStartLocal:numbering.openingTime?numbering.day+'T'+numbering.openingTime:null,timeZone:numbering.zone,paperWidth:['58','80','a4'].includes(state.ticketSettings?.paperWidth)?state.ticketSettings.paperWidth:'58'};break}
 case 'call':{
 if(active(state,id(a.destinationId)))throw Error('Conclua o atendimento deste guichê antes de chamar outra senha');
 const serviceId=id(a.serviceId);if(!serviceIds.has(serviceId))throw Error('Serviço não pertence à unidade');
 const dest=id(a.destinationId);
 const destination=await client.query('SELECT id,name FROM flow_client_destinations WHERE unit_id=$1 AND id=$2 AND active=true',[unit,dest]);
 if(!destination.rowCount)throw Error('Destino não pertence à unidade');
 let idx=state.queue.findIndex(q=>q.serviceId===serviceId&&q.priority==='preferencial');
 if(idx<0)idx=state.queue.findIndex(q=>q.serviceId===serviceId);
 if(idx<0)throw Error('Fila vazia');
 const called={...state.queue.splice(idx,1)[0],destinationId:dest,destination:destination.rows[0].name,calledAt:new Date().toISOString()};
 setActive(state,dest,called);state.lastCall={...called};
 state.history.unshift({...called,status:'chamado'});state.history=state.history.slice(0,30);state.calls++;result={code:called.code,destinationId:dest};break}
 case 'recall':{
  const ticket=active(state,destId);if(!ticket)throw Error('Não existe senha em atendimento neste guichê');
  const when=new Date().toISOString();ticket.recalledAt=when;ticket.recallCount=(Number(ticket.recallCount)||0)+1;
  const h=state.history.find(x=>x.code===ticket.code&&x.status==='chamado'&&Number(x.destinationId)===destId);
  if(h){h.recalledAt=when;h.recallCount=ticket.recallCount}
  state.lastCall={...ticket};state.calls++;
  result={code:ticket.code,destinationId:destId,recallCount:ticket.recallCount,recalledAt:when};
  break;
 }
 case 'no_show':{
  const ticket=active(state,destId);if(!ticket)throw Error('Não existe senha em atendimento neste guichê');
  const when=new Date().toISOString();
  if(state.noShows.some(x=>x.code===ticket.code))throw Error('Senha já registrada como não compareceu');
  const h=state.history.find(x=>x.code===ticket.code&&x.status==='chamado'&&Number(x.destinationId)===destId);
  if(h){h.status='nao_compareceu';h.noShowAt=when}
  state.noShows.unshift({...ticket,noShowAt:when});state.noShows=state.noShows.slice(0,50);
  setActive(state,destId,null);result={code:ticket.code,destinationId:destId,noShowAt:when};break;
 }
 case 'return_queue':{
  const code=safe(a.code,60);
  const index=state.noShows.findIndex(x=>x.code===code);
  if(index<0)throw Error('Senha não encontrada na lista de não comparecimento');
  const c=state.noShows[index];
  if(linked?.kind==='terminal'&&Number(c.destinationId)!==Number(linked.destination_id))throw Error('Senha de outro guichê');
  if(!serviceIds.has(Number(c.serviceId)))throw Error('Serviço original não está ativo');
  if(Object.values(state.currents).some(x=>x.code===code)||state.queue.some(x=>x.code===code))throw Error('Senha já está em atendimento ou na fila');
  state.noShows.splice(index,1);
  const when=new Date().toISOString();
  const {destinationId,destination,calledAt,recalledAt,recallCount,noShowAt,...pending}=c;
  // Retorno entra no fim da fila da mesma prioridade, preservando a senha.
  state.queue.push({...pending,returnedAt:when});
  const h=state.history.find(x=>x.code===code&&x.status==='nao_compareceu');
  if(h){h.status='retornou_fila';h.returnedAt=when}
  result={code,returnedAt:when};
  break;
 }
 case 'transfer':{
 if(!user||!['admin','atendente'].includes(user.role))throw Error('Funcionário autorizado necessário para encaminhar');
 const original=active(state,destId);if(!original)throw Error('Não há senha em atendimento neste guichê');
 const target=id(a.targetServiceId);
 if(!serviceIds.has(target))throw Error('O serviço de destino não pertence à unidade');
 if(Number(original.serviceId)===target)throw Error('Selecione um serviço diferente do atual');
 if(state.queue.some(q=>q.code===original.code))throw Error('Esta senha já está na fila');
 const transferAt=new Date().toISOString();
 const h=state.history.find(x=>x.code===original.code&&x.status==='chamado'&&Number(x.destinationId)===destId);
 if(h){h.status='encaminhado';h.transferredToServiceId=target;h.transferredAt=transferAt;}
 const trace=Array.isArray(original.transfers)?original.transfers:[];
 const moved={code:original.code,serviceId:target,priority:original.priority,issuedAt:original.issuedAt||transferAt,transfers:[...trace,{fromServiceId:original.serviceId,toServiceId:target,at:transferAt}]};
 // A política pertence à unidade e é definida pelo administrador institucional.
 // A prioridade continua respeitada pelo algoritmo de chamada do serviço.
 const policy=['start','end','original'].includes(state.transferPolicy)?state.transferPolicy:'end';
 const peers=state.queue.map((q,i)=>({q,i})).filter(x=>Number(x.q.serviceId)===target&&x.q.priority===moved.priority);
 if(policy==='end'||!peers.length)state.queue.push(moved);
 else if(policy==='start')state.queue.splice(peers[0].i,0,moved);
 else {
  const time=s=>{const n=Date.parse(s||'');return Number.isFinite(n)?n:Infinity};
  const at=time(moved.issuedAt);
  const newer=peers.find(x=>time(x.q.issuedAt)>at);
  if(newer)state.queue.splice(newer.i,0,moved);
  else state.queue.splice(peers[peers.length-1].i+1,0,moved);
 }
 setActive(state,destId,null);
 result={code:moved.code,fromServiceId:original.serviceId,toServiceId:target,policy,transferred:true};
 break;
 }
 case 'finish':{
 const ticket=active(state,destId);if(!ticket)throw Error('Sem atendimento ativo neste guichê');
 const h=state.history.find(x=>x.code===ticket.code&&x.status==='chamado'&&Number(x.destinationId)===destId);if(h)h.status='concluido';
 result={code:ticket.code,destinationId:destId};setActive(state,destId,null);state.completed++;break}
 default:throw Error('Operação inválida');
 }
 const revision=Number(current.rows[0].revision)+1;
 await client.query('UPDATE flow_client_runtime SET state=$2::jsonb,revision=$3,updated_at=now() WHERE unit_id=$1',[unit,JSON.stringify(state),revision]);
 await client.query('INSERT INTO flow_admin_audit(action,client_id,unit_id,details) VALUES($1,$2,$3,$4::jsonb)',[a.type,unitResult.rows[0].client_id,unit,JSON.stringify(result)]);
 await client.query('COMMIT');return send(res,200,{revision,state:visibleState(state),result});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});return send(res,400,{error:e.message})}finally{client.release()}
 }catch(e){return send(res,400,{error:e.message})}
}
module.exports=handle;
