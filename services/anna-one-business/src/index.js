import { neon } from '@neondatabase/serverless';

const ORIGIN='https://annaone.com.br';
const AUTHZ='https://anna-one-auditoria.elisonborg.workers.dev/v1/admin/authorize';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin','X-Content-Type-Options':'nosniff'};
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(s,m)=>{throw new ApiError(s,m);};
function cleanDoc(v){return String(v??'').trim().toUpperCase().replace(/[.\-\/\s]/g,'');}
function name(v,required=true){if(typeof v!=='string'&&v!=null)fail(400,'Nome inválido.');const x=(v??'').trim();if((required&&!x)||x.length>200)fail(400,'Nome deve conter entre 1 e 200 caracteres.');return x||null;}
function digit(s,cyclic){const n=[...s].reduce((a,c,i)=>a+(c.charCodeAt(0)-48)*(cyclic?((s.length-i-1)%8)+2:s.length-i+1),0)%11;return n<2?0:11-n;}
export function validCpf(s){return /^[0-9]{11}$/.test(s)&&!/^([0-9])\1{10}$/.test(s)&&s[9]===String(digit(s.slice(0,9),false))&&s[10]===String(digit(s.slice(0,10),false));}
export function validCnpj(s){return /^[A-Z0-9]{12}[0-9]{2}$/.test(s)&&!/^([0-9])\1{13}$/.test(s)&&s[12]===String(digit(s.slice(0,12),true))&&s[13]===String(digit(s.slice(0,13),true));}
export async function actor(request,env){
 const token=request.headers.get('Authorization')||'';
 if(!/^Bearer [A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token)||token.length>12000)fail(401,'Sessão necessária.');
 // Valida exatamente o mesmo bearer no serviço Master, sem aceitar identidade enviada no JSON.
 if(!env.MASTER_AUTH||typeof env.MASTER_AUTH.fetch!=='function')fail(503,'Vínculo de autorização central não configurado.');
 let check;try{check=await env.MASTER_AUTH.fetch(new Request(AUTHZ,{method:'GET',headers:{Authorization:token,Origin:ORIGIN},redirect:'manual'}));}catch{fail(503,'Autorização central indisponível.');}
 if(!check.ok)fail(check.status===401?401:check.status===403?403:503,'Autorização central não confirmada.');
 let result;try{result=await check.json();}catch{fail(503,'Resposta inválida da autorização central.');}
 if(result?.authenticated!==true||result?.admin_authorized!==true)fail(403,'Acesso Master não autorizado.');
 // O sub só é usado depois da verificação do mesmo JWT pelo Worker existente.
 // A associação explícita na base deve corresponder ao UUID; nenhuma associação por e-mail.
 let sub;try{const p=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');sub=JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,'='))).sub;}catch{fail(401,'Credencial inválida.');}
 if(typeof sub!=='string'||!UUID.test(sub))fail(403,'Identidade não vinculada ao cadastro interno.');
 return sub;
}
async function body(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'Envie JSON.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Corpo obrigatório.');
 let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();fail(413,'Dados excedem o limite.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Dados inválidos.');return value;}catch{fail(400,'JSON inválido.');}
}
function requestId(b){if(typeof b.request_id!=='string'||!UUID.test(b.request_id))fail(400,'Identificador da solicitação inválido.');return b.request_id;}
function queryContext(sql,tenant,user){
 return sql.query("SELECT set_config('anna.tenant_id',$1,true),set_config('anna.actor_id',$2,true)",[tenant,user]);
}
const membershipSQL="SELECT m.role FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1::uuid AND m.user_id=$2::uuid AND m.active AND t.kind='internal' AND t.status='active'";
async function execute(sql,tenant,user,statement,params=[]){
 const roleCheck=await sql.query("SELECT current_user AS role, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user");
 if(roleCheck[0]?.role!=='anna_business_runtime'||roleCheck[0]?.rolbypassrls!==false||roleCheck[0]?.rolsuper!==false)fail(503,'Credencial de serviço não autorizada.');
 const lockScope=sql.query("SELECT set_config('anna.tenant_id',CASE WHEN EXISTS ("+membershipSQL+") THEN ($1::uuid)::text ELSE '00000000-0000-0000-0000-000000000000' END,true)",[tenant,user]);
 const results=await sql.transaction([queryContext(sql,tenant,user),sql.query(membershipSQL,[tenant,user]),lockScope,sql.query(statement,params)]);
 if(!results[1]?.length)fail(403,'Acesso Business ainda não concedido.');
 return {role:results[1][0].role,rows:results[3]};
}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin');
 if(origin&&origin!==ORIGIN)return send({error:'Origem não permitida.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
 const path=new URL(request.url).pathname;
 if(path==='/health'&&request.method==='GET')return send({service:'anna-one-business',version:'0.1.0-dev',status:'online'});
 try{
  if(!env.DATABASE_URL||!UUID.test(env.INTERNAL_TENANT_ID||''))fail(503,'Serviço cadastral ainda não configurado.');
  const user=await actor(request,env),tenant=env.INTERNAL_TENANT_ID;
  const sql=neon(env.DATABASE_URL);
  if(path==='/v1/context'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT id,name FROM business.tenants WHERE id=$1::uuid AND kind='internal' AND status='active'",[tenant]);
   return send({tenant:r.rows[0],role:r.role,can_write:['owner','registry_editor'].includes(r.role)});
  }
  if(path==='/v1/parties'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT p.id,p.code::text AS code,p.kind,p.legal_name,p.display_name,p.cnpj_root,p.status,EXISTS(SELECT 1 FROM business.companies c WHERE c.tenant_id=p.tenant_id AND c.party_id=p.id) AS own_company FROM core.parties p WHERE p.tenant_id=$1::uuid ORDER BY p.legal_name,p.id LIMIT 500",[tenant]);
   return send({items:r.rows,limit:500});
  }
  if(path==='/v1/parties'&&request.method==='POST'){
   const b=await body(request),kind=b.kind,legal=name(b.legal_name),display=name(b.display_name,false),id=requestId(b);
   if(!['PF','PJ'].includes(kind))fail(400,'Selecione PF ou PJ.');
   const doc=cleanDoc(b.document);
   if(kind==='PF'&&!validCpf(doc))fail(400,'Informe um CPF válido.');
   if(kind==='PJ'&&!validCnpj(doc))fail(400,'Informe um CNPJ completo válido, numérico ou alfanumérico.');
   const root=kind==='PJ'?doc.slice(0,8):null,cpf=kind==='PF'?doc||null:null;
   // Política de INSERT também verifica associação e role. Não permitir papéis via payload.
   const r=await execute(sql,tenant,user,"SELECT party_id,party_code::text AS party_code FROM business.create_party($1,$2,$3,$4,$5,$6::uuid)",[kind,legal,display,cpf,root,id]);
   return send({item:r.rows[0]},201);
  }
  const match=path.match(/^\/v1\/parties\/([^/]+)\/establishments$/);
  if(match&&UUID.test(match[1])){
   const party=match[1];
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,cnpj,name,kind,status FROM core.establishments WHERE tenant_id=$1::uuid AND party_id=$2::uuid ORDER BY kind DESC,name",[tenant,party]);
    return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request),cnpj=cleanDoc(b.cnpj),label=name(b.name),kind=b.kind,id=requestId(b);
    if(!validCnpj(cnpj))fail(400,'CNPJ inválido.');
    if(!['matrix','branch'].includes(kind))fail(400,'Classificação inválida.');
    const r=await execute(sql,tenant,user,"SELECT establishment_id FROM business.create_establishment($1::uuid,$2,$3,$4,$5::uuid)",[party,cnpj,label,kind,id]);
    return send({item:r.rows[0]},201);
   }
  }
  return send({error:'Rota não encontrada.'},404);
 }catch(e){
  if(e instanceof ApiError)return send({error:e.message},e.status);
  if(e?.code==='42501')return send({error:'Operação não autorizada.'},403);
  if(e?.code==='23505')return send({error:'Cadastro existente ou conflito de unicidade. Consulte antes de repetir.'},409);
  if(['23514','23503','23502','22P02'].includes(e?.code))return send({error:'Dados incompatíveis com as regras cadastrais.'},422);
  return send({error:'Serviço cadastral indisponível. Não reenvie sem consultar o cadastro.'},503);
 }
}};
