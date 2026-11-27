// Nexus: only explicit operator requests, fixed official origin, no database coupling.
const ORIGIN='https://nexus.annaone.com.br';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid=x=>typeof x==='string'&&UUID.test(x);
const label=x=>typeof x==='string'?x.trim().slice(0,200):'';
const err=(status,message)=>Object.assign(new Error(message),{status});
async function get(path,token,fetcher){
 if(typeof token!=='string'||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||token.length>12000)throw err(401,'Sessão necessária.');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetcher(ORIGIN+path,{method:'GET',headers:{Authorization:token,Accept:'application/json'},redirect:'error',signal:controller.signal});
  if(r.status===401||r.status===403)throw err(403,'Nexus não confirmou a sessão ou a concessão de acesso.');
  if(!r.ok||!/^application\/json(?:;|$)/i.test(r.headers.get('Content-Type')||''))throw err(503,'Nexus indisponível ou resposta não confirmada.');
  const reader=r.body?.getReader();if(!reader)throw err(503,'Resposta Nexus vazia.');
  const decoder=new TextDecoder();let raw='',size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw err(503,'Resposta Nexus excede o limite de consulta.');}raw+=decoder.decode(value,{stream:true});}
  return JSON.parse(raw+decoder.decode());
 }catch(e){if(e?.status===403||e?.status===503)throw e;throw err(503,'Não foi possível consultar o Nexus. Nenhum vínculo foi criado.');}finally{clearTimeout(timer);}
}
function items(rows,mapper){
 if(!Array.isArray(rows)||rows.length>500)throw err(503,'Listagem Nexus inválida ou acima do limite de 500 registros.');
 const output=rows.map(mapper);if(output.some(x=>!x)||new Set(output.map(x=>x.id)).size!==output.length)throw err(503,'Identificadores Nexus inválidos ou duplicados.');return output;
}
export async function nexusOrganizations(token,fetcher=fetch){
 const d=await get('/api/me',token,fetcher);
 return items(d?.organizations,x=>valid(x?.id)&&label(x.display_name||x.name)?{id:x.id,name:label(x.display_name||x.name)}:null);
}
export async function nexusProjects(token,org,fetcher=fetch){
 if(!valid(org))throw err(400,'Selecione uma organização Nexus válida.');
 const d=await get('/api/projects?org='+encodeURIComponent(org),token,fetcher);
 return items(d?.projects,x=>valid(x?.id)&&label(x.name)&&['project','production'].includes(x.card_type)?{id:x.id,name:label(x.name),kind:x.card_type,status:label(x.completion_status),paused:Boolean(x.paused_at)}:null).filter(x=>x.kind==='project');
}
export async function verifyNexusProject(token,org,project,fetcher=fetch){
 if(!valid(project))throw err(400,'Selecione um projeto Nexus válido.');
 const rows=await nexusProjects(token,org,fetcher);
 const row=rows.find(x=>x.id.toLowerCase()===project.toLowerCase());
 if(!row)throw err(409,'Projeto Nexus não localizado entre os projetos autorizados.');
 return row;
}
