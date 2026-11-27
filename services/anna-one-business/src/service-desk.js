// Contrato real da API privada Service Desk v0.1. Sem endpoint público presumido.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid=x=>typeof x==='string'&&UUID.test(x);
const err=(status,message)=>Object.assign(new Error(message),{status});
const statuses=['open','analysis','in_progress','pending','resolved','closed','rejected','canceled'];
const priorities=['low','normal','high','critical'];
export function serviceDeskOrigin(value){
 if(typeof value!=='string'||!value)return null;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!/^([a-z0-9-]+\.)+annaone\.com\.br$/.test(u.hostname))return null;return u.origin;}catch{return null;}
}
async function get(origin,path,token,institution,fetcher){
 const base=serviceDeskOrigin(origin);if(!base)throw err(503,'API Service Desk ainda não configurada em domínio autorizado.');
 if(!valid(institution))throw err(400,'Informe o UUID da instituição Service Desk.');
 if(typeof token!=='string'||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||token.length>12000)throw err(401,'Sessão necessária.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetcher(base+path,{method:'GET',headers:{Authorization:token,'X-Institution-Id':institution,Accept:'application/json'},redirect:'error',signal:controller.signal});
  if([401,403,404].includes(r.status))throw err(403,'Service Desk não confirmou o acesso ao registro solicitado.');
  if(!r.ok||!/^application\/json(?:;|$)/i.test(r.headers.get('Content-Type')||''))throw err(503,'Service Desk indisponível ou resposta não confirmada.');
  const reader=r.body?.getReader();if(!reader)throw err(503,'Resposta vazia.');
  let raw='',size=0;const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw err(503,'Resposta excede o limite.');}raw+=decoder.decode(value,{stream:true});}
  return JSON.parse(raw+decoder.decode());
 }catch(e){if([403,503].includes(e?.status))throw e;throw err(503,'Não foi possível consultar o Service Desk.');}finally{clearTimeout(timer);}
}
const same=(a,b)=>valid(a)&&valid(b)&&a.toLowerCase()===b.toLowerCase();
async function session(origin,token,institution,fetcher){
 const d=await get(origin,'/v1/session',token,institution,fetcher);
 if(!valid(d?.membership?.id)||!same(d.membership.institution_id,institution))throw err(403,'Associação à instituição não confirmada.');
}
function ticket(x){
 if(!valid(x?.id)||!statuses.includes(x.status)||!priorities.includes(x.priority)||!['string','number'].includes(typeof x.ticket_number)||!String(x.ticket_number).trim()||String(x.ticket_number).length>100)throw err(503,'Chamado inválido na resposta.');
 return {id:x.id,number:String(x.ticket_number),status:x.status,priority:x.priority};
}
export async function serviceDeskTickets(origin,token,institution,fetcher=fetch){
 await session(origin,token,institution,fetcher);
 const d=await get(origin,'/v1/tickets?limit=100',token,institution,fetcher);
 if(!Array.isArray(d?.tickets)||d.tickets.length>100)throw err(503,'Listagem Service Desk inválida.');
 const rows=d.tickets.map(ticket);if(new Set(rows.map(x=>x.id.toLowerCase())).size!==rows.length)throw err(503,'Chamados duplicados na resposta.');return rows;
}
export async function verifyServiceDeskTicket(origin,token,institution,id,fetcher=fetch){
 if(!valid(id))throw err(400,'Informe o UUID do chamado.');
 await session(origin,token,institution,fetcher);
 const d=await get(origin,'/v1/tickets/'+encodeURIComponent(id),token,institution,fetcher);
 const row=ticket(d?.ticket);if(!same(row.id,id))throw err(503,'Chamado retornado não corresponde ao solicitado.');return row;
}
