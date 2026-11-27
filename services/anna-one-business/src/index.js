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
export function validWorkTimestamp(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00-03:00$/.test(v)||!validReportRange(v.slice(0,10),v.slice(0,10)))return false;return Number.isFinite(Date.parse(v));}
export function validReportRange(start,end){const parse=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return NaN;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v?d.getTime():NaN;};const a=parse(start),b=parse(end);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a&&(b-a)/86400000<=365;}
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
async function masterInstitutions(request,env){
 const url=new URL('/v1/admin/institutions',AUTHZ);
 let response;try{response=await env.MASTER_AUTH.fetch(new Request(url,{method:'GET',headers:{Authorization:request.headers.get('Authorization'),Origin:ORIGIN},redirect:'manual'}));}catch{fail(503,'Cadastro operacional indisponível.');}
 if(!response.ok)fail(response.status===401?401:response.status===403?403:503,'Consulta ao Master não autorizada ou indisponível.');
 let data;try{data=await response.json();}catch{fail(503,'Resposta inválida do Master.');}
 if(!Array.isArray(data?.items))fail(503,'Lista de instituições não confirmada.');
 return new Set(data.items.filter(i=>typeof i?.id==='string'&&UUID.test(i.id)).map(i=>i.id.toLowerCase()));
}
async function masterLicenseModules(request,env){
 const url=new URL('/v1/admin/modules',AUTHZ);
 let response;try{response=await env.MASTER_AUTH.fetch(new Request(url,{method:'GET',headers:{Authorization:request.headers.get('Authorization'),Origin:ORIGIN},redirect:'manual'}));}catch{fail(503,'Catálogo de módulos Master indisponível.');}
 if(!response.ok)fail(response.status===401?401:response.status===403?403:503,'Catálogo Master não autorizado ou indisponível.');
 let data;try{data=await response.json();}catch{fail(503,'Resposta inválida do Master.');}
 if(!Array.isArray(data?.items))fail(503,'Lista de módulos não confirmada.');
 return data.items.filter(m=>typeof m?.id==='string'&&UUID.test(m.id)&&typeof m.code==='string'&&m.code.length>0&&m.code.length<=100&&typeof m.name==='string'&&m.status==='available').map(m=>({id:m.id,code:m.code,name:m.name}));
}
async function body(request,limit=8192){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'Envie JSON.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Corpo obrigatório.');
 let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,'Dados excedem o limite.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Dados inválidos.');return value;}catch{fail(400,'JSON inválido.');}
}
function requestId(b){if(typeof b.request_id!=='string'||!UUID.test(b.request_id))fail(400,'Identificador da solicitação inválido.');return b.request_id;}
function queryContext(sql,tenant,user){
 return sql.query("SELECT set_config('anna.tenant_id',$1,true),set_config('anna.actor_id',$2,true)",[tenant,user]);
}
const membershipSQL="SELECT m.role FROM business.tenant_memberships m JOIN business.tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1::uuid AND m.user_id=$2::uuid AND m.active AND t.kind='internal' AND t.status='active'";
async function execute(sql,tenant,user,statement,params=[],serializable=false){
 const roleCheck=await sql.query("SELECT current_user AS role, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user");
 if(roleCheck[0]?.role!=='anna_business_runtime'||roleCheck[0]?.rolbypassrls!==false||roleCheck[0]?.rolsuper!==false)fail(503,'Credencial de serviço não autorizada.');
 const lockScope=sql.query("SELECT set_config('anna.tenant_id',CASE WHEN EXISTS ("+membershipSQL+") THEN ($1::uuid)::text ELSE '00000000-0000-0000-0000-000000000000' END,true)",[tenant,user]);
 const results=await sql.transaction([queryContext(sql,tenant,user),sql.query(membershipSQL,[tenant,user]),lockScope,sql.query(statement,params)],serializable?{isolationLevel:'Serializable'}:undefined);
 if(!results[1]?.length)fail(403,'Acesso Business ainda não concedido.');
 return {role:results[1][0].role,rows:results[3]};
}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin');
 if(origin&&origin!==ORIGIN)return send({error:'Origem não permitida.'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
 const path=new URL(request.url).pathname;
 if(path==='/health'&&request.method==='GET')return send({service:'anna-one-business',version:'1.2.0-dev.105',status:'online'});
 try{
  if(!env.DATABASE_URL||!UUID.test(env.INTERNAL_TENANT_ID||''))fail(503,'Serviço cadastral ainda não configurado.');
  const portalDownload=path.match(/^\/v1\/portal\/publications\/([^/]+)\/download$/);
  if(((path==='/v1/portal/me'||(portalDownload&&UUID.test(portalDownload[1])))&&request.method==='GET')||(path==='/v1/portal/services'&&['GET','POST'].includes(request.method))){
   const token=request.headers.get('Authorization')||'';
   if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||token.length>12000)fail(401,'Sessão necessária.');
   if(!env.MASTER_AUTH||typeof env.MASTER_AUTH.fetch!=='function')fail(503,'Identidade central indisponível.');
   let verified;try{verified=await env.MASTER_AUTH.fetch(new Request(new URL('/v1/auth/verify',AUTHZ),{method:'GET',headers:{Authorization:token,Origin:ORIGIN},redirect:'manual'}));}catch{fail(503,'Identidade central indisponível.');}
   if(!verified.ok)fail(verified.status===401?401:503,'Identidade não confirmada.');
   let identity;try{identity=await verified.json();}catch{fail(503,'Resposta de identidade inválida.');}
   if(identity?.authenticated!==true||typeof identity.user_id!=='string'||!UUID.test(identity.user_id))fail(401,'Identidade inválida.');
   const tenant=env.INTERNAL_TENANT_ID,user=identity.user_id,db=neon(env.DATABASE_URL);
   const role=await db.query("SELECT current_user AS role,rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user");
   if(role[0]?.role!=='anna_business_runtime'||role[0]?.rolbypassrls!==false||role[0]?.rolsuper!==false)fail(503,'Credencial de serviço não autorizada.');
   if(path==='/v1/portal/services'){
    if(request.method==='POST'){
     const b=await body(request),op=requestId(b),title=typeof b.title==='string'?b.title.trim():'',description=typeof b.description==='string'?b.description.trim():'';
     if(typeof b.grant_id!=='string'||!UUID.test(b.grant_id)||!title||title.length>200||!description||description.length>1500)fail(400,'Confira concessão, título e descrição.');
     const r=await db.transaction([queryContext(db,tenant,user),db.query("SELECT set_config('anna.portal_read','yes',true)"),db.query("SELECT * FROM business.create_portal_service_case($1::uuid,NULL,$2,$3,$4::uuid,'customer')",[b.grant_id,title,description,op])],{isolationLevel:'Serializable'});
     if(!r[2].length)fail(409,'Concessão indisponível ou solicitação já registrada.');return send({item:r[2][0]},201);
    }
    const r=await db.transaction([queryContext(db,tenant,user),db.query("SELECT set_config('anna.portal_read','yes',true)"),db.query("SELECT c.id,c.grant_id,c.contract_reference,c.origin,c.title,c.description,c.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('seq',u.seq,'status',u.status,'message',u.message,'created_at',u.created_at) ORDER BY u.seq) FROM business.portal_service_updates u WHERE u.tenant_id=c.tenant_id AND u.case_id=c.id),'[]'::jsonb) AS updates FROM business.portal_service_cases c JOIN business.portal_grants g ON g.tenant_id=c.tenant_id AND g.id=c.grant_id WHERE c.tenant_id=$1::uuid AND g.user_id=$2::uuid AND business.service_portal_customer(c.tenant_id,c.grant_id) ORDER BY c.created_at DESC,c.id LIMIT 500",[tenant,user])]);
    return send({items:r[2],limit:500});
   }
   if(portalDownload){
    const result=await db.transaction([queryContext(db,tenant,user),db.query("SELECT set_config('anna.portal_read','yes',true)"),db.query("SELECT p.filename,replace(encode(p.content,'base64'),chr(10),'') AS content,p.sha256_hex,p.size_bytes FROM business.portal_publications p JOIN business.portal_grants g ON g.tenant_id=p.tenant_id AND g.id=p.grant_id JOIN business.tenants t ON t.id=g.tenant_id AND t.kind='internal' AND t.status='active' WHERE p.tenant_id=$1::uuid AND p.id=$2::uuid AND g.user_id=$3::uuid AND p.revoked_at IS NULL AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until",[tenant,portalDownload[1],user])]);
    if(!result[2].length)fail(404,'Publicação indisponível.');
    const x=result[2][0],bytes=Uint8Array.from(atob(x.content),c=>c.charCodeAt(0)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==x.sha256_hex||bytes.length!==x.size_bytes)fail(500,'Integridade do arquivo não confirmada.');return send({item:x});
   }
   const result=await db.transaction([queryContext(db,tenant,user),db.query("SELECT set_config('anna.portal_read','yes',true)"),db.query("SELECT g.id,g.company_id,g.party_id,g.portal_role,g.valid_from::text AS valid_from,g.valid_until::text AS valid_until FROM business.portal_grants g JOIN business.tenants t ON t.id=g.tenant_id AND t.kind='internal' AND t.status='active' WHERE g.tenant_id=$1::uuid AND g.user_id=$2::uuid AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until ORDER BY g.portal_role,g.id",[tenant,user]),db.query("SELECT p.id,p.grant_id,p.company_name,p.party_name,p.category,p.title,p.reference,p.version_no,p.filename,p.size_bytes,p.sha256_hex,p.created_at,p.accounting_competence::text AS accounting_competence,p.accounting_kind FROM business.portal_publications p JOIN business.portal_grants g ON g.tenant_id=p.tenant_id AND g.id=p.grant_id JOIN business.tenants t ON t.id=g.tenant_id AND t.kind='internal' AND t.status='active' WHERE p.tenant_id=$1::uuid AND g.user_id=$2::uuid AND p.revoked_at IS NULL AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until ORDER BY p.created_at DESC,p.id",[tenant,user]),db.query("SELECT p.id,p.grant_id,p.competence::text AS competence,p.title,p.description,p.due_on::text AS due_on,p.closed_at,p.closure_reason FROM business.accounting_pendencies p JOIN business.portal_grants g ON g.tenant_id=p.tenant_id AND g.id=p.grant_id JOIN business.tenants t ON t.id=g.tenant_id AND t.kind='internal' AND t.status='active' WHERE p.tenant_id=$1::uuid AND g.user_id=$2::uuid AND g.portal_role='accountant' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until ORDER BY p.competence DESC,p.created_at DESC,p.id",[tenant,user])]);
   return send({grants:result[2],publications:result[3],accounting_pendencies:result[4]});
  }
  const user=await actor(request,env),tenant=env.INTERNAL_TENANT_ID;
  const sql=neon(env.DATABASE_URL);
  if(path==='/v1/context'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT id,name FROM business.tenants WHERE id=$1::uuid AND kind='internal' AND status='active'",[tenant]);
   return send({tenant:r.rows[0],role:r.role,can_write:['owner','registry_editor'].includes(r.role),classifications:true,institution_links:true,corporate_structure:true,ownership:true,brands_franchises:true,organogram:true,maintenance:true,proposal_workflow:true,contract_lifecycle:true,contract_amendments:true,finance:r.role==='owner',financial_settlements:r.role==='owner',treasury:r.role==='owner',finance_recurring:r.role==='owner',cashflow:r.role==='owner',finance_dashboard:r.role==='owner',ged:r.role==='owner',fiscal_registry:r.role==='owner',fiscal_documents:r.role==='owner',fiscal_agenda:r.role==='owner',fiscal_dashboard:r.role==='owner',management_dimensions:r.role==='owner',management_allocations:r.role==='owner',management_budgets:r.role==='owner',management_results:r.role==='owner',management_periods:r.role==='owner',management_dashboard:r.role==='owner',assets:r.role==='owner',asset_lifecycle:r.role==='owner',stock_foundation:r.role==='owner',stock_movements:r.role==='owner',stock_controls:r.role==='owner',patrimony_dashboard:r.role==='owner',portal_grants:r.role==='owner',portal_publications:r.role==='owner',connect_events:r.role==='owner',service_portal:r.role==='owner',executive_dashboard:r.role==='owner',management_indicators:r.role==='owner',business_integrity:r.role==='owner',business_flows:r.role==='owner',business_settings:r.role==='owner',purchase_dashboard:['owner','registry_editor'].includes(r.role),purchase_requests:['owner','registry_editor'].includes(r.role),contract_dashboard:['owner','registry_editor'].includes(r.role),license_allocations:['owner','registry_editor'].includes(r.role),license_rights:['owner','registry_editor'].includes(r.role),contracts:['owner','registry_editor'].includes(r.role),commercial_dashboard:['owner','registry_editor'].includes(r.role),proposals:['owner','registry_editor'].includes(r.role),price_lists:['owner','registry_editor'].includes(r.role),catalog:['owner','registry_editor'].includes(r.role),crm:['owner','registry_editor'].includes(r.role),audit:r.role==='owner',company_contacts:['owner','registry_editor'].includes(r.role)});
  }
  if(path==='/v1/parties'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT p.id,p.code::text AS code,p.kind,p.legal_name,p.display_name,p.cnpj_root,p.status,EXISTS(SELECT 1 FROM business.companies c WHERE c.tenant_id=p.tenant_id AND c.party_id=p.id) AS own_company,ARRAY(SELECT pr.role FROM business.party_roles pr WHERE pr.tenant_id=p.tenant_id AND pr.party_id=p.id AND pr.active ORDER BY pr.role) AS roles FROM core.parties p WHERE p.tenant_id=$1::uuid ORDER BY p.legal_name,p.id LIMIT 500",[tenant]);
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
  const crmDate=v=>{if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||! /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)||v.slice(0,4)==='0000'||Number.isNaN(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail(400,'Data inválida.');return v;};
  const crmValue=v=>{if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||! /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(v))fail(400,'Valor estimado inválido.');return v;};
  if(path==='/v1/commercial-dashboard'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH opp AS (
 SELECT stage,estimated_value,next_followup FROM business.opportunities WHERE tenant_id=$1::uuid
), proposals AS (
 SELECT p.id,p.status,p.valid_until,COALESCE(sum(l.net),0) AS total FROM business.proposals p LEFT JOIN business.proposal_lines l ON l.tenant_id=p.tenant_id AND l.proposal_id=p.id WHERE p.tenant_id=$1::uuid GROUP BY p.id
), orders AS (
 SELECT o.id,o.code,o.total,o.status,o.created_at,p.code AS proposal_code,p.title,p.customer_name,p.seller_name FROM business.commercial_orders o JOIN business.proposals p ON p.tenant_id=o.tenant_id AND p.id=o.proposal_id WHERE o.tenant_id=$1::uuid
), funnel AS (
 SELECT stage,count(*) AS count,COALESCE(sum(estimated_value),0)::text AS value,count(*) FILTER(WHERE estimated_value IS NULL) AS unestimated FROM opp GROUP BY stage
), proposal_stages AS (
 SELECT status,count(*) AS count,COALESCE(sum(total),0)::text AS value FROM proposals GROUP BY status
), monthly AS (
 SELECT to_char(date_trunc('month',created_at AT TIME ZONE 'America/Fortaleza'),'YYYY-MM') AS month,count(*) AS count,sum(total)::text AS value FROM orders WHERE created_at >= (date_trunc('month',now() AT TIME ZONE 'America/Fortaleza')-interval '11 months') AT TIME ZONE 'America/Fortaleza' GROUP BY 1
)
SELECT jsonb_build_object(
 'as_of',(now() AT TIME ZONE 'America/Fortaleza')::date::text,
 'opportunities',jsonb_build_object('total',(SELECT count(*) FROM opp),'open',(SELECT count(*) FROM opp WHERE stage NOT IN ('won','lost')),'won',(SELECT count(*) FROM opp WHERE stage='won'),'lost',(SELECT count(*) FROM opp WHERE stage='lost'),'open_value',(SELECT COALESCE(sum(estimated_value),0)::text FROM opp WHERE stage NOT IN ('won','lost')),'unestimated_open',(SELECT count(*) FROM opp WHERE stage NOT IN ('won','lost') AND estimated_value IS NULL),'overdue',(SELECT count(*) FROM opp WHERE stage NOT IN ('won','lost') AND next_followup<(now() AT TIME ZONE 'America/Fortaleza')::date),'followup_today',(SELECT count(*) FROM opp WHERE stage NOT IN ('won','lost') AND next_followup=(now() AT TIME ZONE 'America/Fortaleza')::date)),
 'proposals',jsonb_build_object('total',(SELECT count(*) FROM proposals),'converted',(SELECT count(*) FROM proposals WHERE status='converted'),'accepted_pending',(SELECT count(*) FROM proposals WHERE status='accepted'),'awaiting_approval',(SELECT count(*) FROM proposals WHERE status='submitted'),'expired_issued',(SELECT count(*) FROM proposals WHERE status='issued' AND valid_until<(now() AT TIME ZONE 'America/Fortaleza')::date)),
 'orders',jsonb_build_object('total',(SELECT count(*) FROM orders),'value',(SELECT COALESCE(sum(total),0)::text FROM orders),'pending',(SELECT count(*) FROM orders WHERE status='pending_contract'),'pending_value',(SELECT COALESCE(sum(total),0)::text FROM orders WHERE status='pending_contract')),
 'funnel',COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM funnel f),'[]'::jsonb),
 'proposal_stages',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM proposal_stages s),'[]'::jsonb),
 'monthly_orders',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.month) FROM monthly m),'[]'::jsonb),
 'recent_orders',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.code_num DESC) FROM (SELECT code AS code_num,code::text AS code,proposal_code::text AS proposal_code,title,customer_name,seller_name,total::text AS total,status,created_at FROM orders ORDER BY code DESC LIMIT 20) r),'[]'::jsonb)
) AS dashboard`,[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Indicadores restritos à equipe comercial.');
   return send(r.rows[0]?.dashboard||{});
  }
  if(path==='/v1/proposals'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT p.id,p.code::text AS code,p.customer_id,p.seller_id,p.list_id,p.opportunity_id,p.title,p.customer_name,p.seller_name,p.list_name,p.payment_terms,p.notes,p.issued_on::text AS issued_on,p.valid_until::text AS valid_until,p.status,p.revision,p.emitted_at,p.currency,COALESCE(sum(l.gross),0)::text AS gross,COALESCE(sum(l.discount),0)::text AS discount,COALESCE(sum(l.net),0)::text AS total,COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'item_code',l.item_code::text,'item_name',l.item_name,'unit',l.unit,'quantity',l.quantity::text,'unit_price',l.unit_price::text,'discount_pct',l.discount_pct::text,'gross',l.gross::text,'discount',l.discount::text,'net',l.net::text) ORDER BY l.item_code) FILTER (WHERE l.id IS NOT NULL),'[]'::jsonb) AS lines FROM business.proposals p LEFT JOIN business.proposal_lines l ON l.tenant_id=p.tenant_id AND l.proposal_id=p.id WHERE p.tenant_id=$1::uuid GROUP BY p.id ORDER BY p.code DESC",[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Propostas restritas à equipe comercial.');
   return send({items:r.rows});
  }
  const workflowMatch=path.match(/^\/v1\/proposals\/([^/]+)\/(advance|history)$/);
  if(workflowMatch&&UUID.test(workflowMatch[1])){
   const proposal=workflowMatch[1],operation=workflowMatch[2];
   if(operation==='history'&&request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,from_status,to_status,reference,created_by,created_at FROM business.proposal_events WHERE tenant_id=$1::uuid AND proposal_id=$2::uuid ORDER BY created_at,id",[tenant,proposal]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'Histórico restrito à equipe comercial.');
    return send({items:r.rows});
   }
   if(operation==='advance'&&request.method==='POST'){
    const b=await body(request),id=requestId(b),next=b.status,reference=typeof b.reference==='string'?b.reference.trim():'';
    if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646||!['submitted','approved','rejected','issued','accepted','declined','converted'].includes(next)||reference.length>300||(['rejected','accepted','declined'].includes(next)&&!reference))fail(400,'Informe etapa, revisão e referência quando exigida.');
    const r=await execute(sql,tenant,user,"SELECT proposal_id,new_status,new_revision,order_id,order_code::text AS order_code FROM business.advance_proposal($1::uuid,$2::integer,$3,$4,$5::uuid)",[proposal,b.revision,next,reference||null,id],true);
    if(!r.rows.length)fail(409,'Transição não autorizada, proposta vencida, revisão desatualizada ou oportunidade já encerrada.');
    return send({item:r.rows[0]});
   }
  }
  if(path==='/v1/payroll'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('admin',business.hr_admin($1::uuid),'actor_id',$2::uuid,'companies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.party_id,'name',p.legal_name,'allowed',business.payroll_allowed(c.tenant_id,c.party_id)) ORDER BY p.legal_name) FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND business.hr_admin(c.tenant_id)),'[]'::jsonb),'grants',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'company_id',g.company_id,'user_id',g.user_id,'reason',g.reason,'revoked_at',g.revoked_at) ORDER BY g.created_at DESC) FROM (SELECT * FROM business.payroll_grants WHERE tenant_id=$1::uuid ORDER BY created_at DESC LIMIT 500)g),'[]'::jsonb)) AS data`,[tenant,user]);if(r.role!=='owner')fail(403,'Folha restrita ao proprietário com concessão específica.');return send(r.rows[0].data);
  }
  if(path==='/v1/payroll/grants'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),company=b.company_id,recipient=b.user_id,reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!UUID.test(company||'')||!UUID.test(recipient||'')||!reason||reason.length>300)fail(400,'Confira concessão.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.payroll_grants(tenant_id,company_id,user_id,reason,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid WHERE business.hr_admin($1::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,company,recipient,reason,op,user],true);if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível.');return send({item:r.rows[0]},201);
  }
  const payrollRevoke=path.match(/^\/v1\/payroll\/grants\/([^/]+)\/revoke$/);
  if(payrollRevoke&&UUID.test(payrollRevoke[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>300)fail(400,'Informe justificativa.');
   const r=await execute(sql,tenant,user,"UPDATE business.payroll_grants SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) RETURNING id",[tenant,payrollRevoke[1],user,reason,op],true);if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/payroll/records'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.payroll_allowed($1::uuid,$2::uuid),'periods',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.competence DESC) FROM (SELECT id,competence::text AS competence FROM business.payroll_periods WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY competence DESC LIMIT 120)x),'[]'::jsonb),'batches',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT b.id,b.period_id,b.source_reference,b.source_hash,b.lines,b.total::text AS total,b.status,b.decision_reason,b.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('line_no',l.line_no,'obligation_id',l.obligation_id,'code',o.code::text) ORDER BY l.line_no) FROM business.payroll_finance_links l JOIN business.financial_obligations o ON o.tenant_id=l.tenant_id AND o.id=l.obligation_id WHERE l.tenant_id=b.tenant_id AND l.batch_id=b.id),'[]'::jsonb) AS obligations,COALESCE((SELECT jsonb_agg(jsonb_build_object('grant_id',l.grant_id,'pendency_id',l.pendency_id)) FROM business.payroll_accounting_links l WHERE l.tenant_id=b.tenant_id AND l.batch_id=b.id),'[]'::jsonb) AS handoffs FROM business.payroll_batches b WHERE b.tenant_id=$1::uuid AND b.company_id=$2::uuid ORDER BY b.created_at DESC LIMIT 100)x),'[]'::jsonb),'payees',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (SELECT id,legal_name AS name FROM core.parties WHERE tenant_id=$1::uuid AND id<>$2::uuid AND kind='PJ' AND status='active' AND business.payroll_allowed($1::uuid,$2::uuid) ORDER BY legal_name LIMIT 500)x),'[]'::jsonb),'accountants',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (SELECT g.id,p.legal_name AS name,g.user_id FROM business.portal_grants g JOIN core.parties p ON p.tenant_id=g.tenant_id AND p.id=g.party_id WHERE g.tenant_id=$1::uuid AND g.company_id=$2::uuid AND g.portal_role='accountant' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until AND business.payroll_allowed($1::uuid,$2::uuid))x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão específica de folha necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/payroll/periods'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),company=b.company_id,month=b.competence;
   if(!UUID.test(company||'')||typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!validReportRange(month+'-01',month+'-01'))fail(400,'Confira empresa e competência.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.payroll_periods(tenant_id,company_id,competence,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3::date,$4::uuid,$5::uuid WHERE business.payroll_allowed($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,company,month+'-01',op,user],true);if(!r.rows.length)fail(409,'Competência duplicada ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/payroll/batches'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),period=b.period_id,ref=typeof b.source_reference==='string'?b.source_reference.trim():'',lines=b.lines;
   if(!UUID.test(period||'')||!ref||ref.length>120||!Array.isArray(lines)||lines.length<1||lines.length>100||!lines.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===5&&['net_pay','tax','social_charge','benefit','other'].includes(x.kind)&&typeof x.payee_id==='string'&&UUID.test(x.payee_id)&&typeof x.amount==='string'&&/^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/.test(x.amount)&&Number(x.amount)>0&&validReportRange(x.issued_on,x.issued_on)&&validReportRange(x.due_on,x.due_on)&&x.issued_on<=x.due_on))fail(400,'Importe de 1 a 100 linhas agregadas válidas, sem dados individuais.');
   const normalized=lines.map(x=>({kind:x.kind,payee_id:x.payee_id.toLowerCase(),amount:x.amount,issued_on:x.issued_on,due_on:x.due_on}));
   const encoded=JSON.stringify(normalized),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded))),b=>b.toString(16).padStart(2,'0')).join('');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.import_payroll_batch($1::uuid,$2,$3,$4::jsonb,$5::uuid)",[period,ref,hash,encoded,op],true);if(!r.rows.length)fail(409,'Lote inválido, duplicado, beneficiário incompatível ou autorização indisponível.');return send({item:r.rows[0]},201);
  }
  const payrollAction=path.match(/^\/v1\/payroll\/batches\/([^/]+)\/(decision|integrate|handoff)$/);
  if(payrollAction&&UUID.test(payrollAction[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),id=payrollAction[1],action=payrollAction[2];let r;
   if(action==='decision'){const reason=typeof b.reason==='string'?b.reason.trim():'';if(!['approved','cancelled'].includes(b.status)||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme decisão e justificativa.');r=await execute(sql,tenant,user,"SELECT * FROM business.decide_payroll_batch($1::uuid,$2,$3,$4::uuid)",[id,b.status,reason,op],true);}
   else if(action==='integrate'){if(b.confirmed!==true)fail(400,'Confirme os beneficiários, valores e lançamento financeiro.');r=await execute(sql,tenant,user,"SELECT * FROM business.integrate_payroll_batch($1::uuid,$2::uuid)",[id,op],true);}
   else{if(!UUID.test(b.grant_id||'')||b.confirmed!==true)fail(400,'Confirme a concessão de contador.');r=await execute(sql,tenant,user,"SELECT * FROM business.handoff_payroll_batch($1::uuid,$2::uuid,$3::uuid)",[id,b.grant_id,op],true);}
   if(!r.rows.length)fail(409,'Estado, autorização ou operação indisponível.');return send({item:r.rows[0]});
  }
  const workScope=path.match(/^\/v1\/(timeclock|access)$/);
  if(workScope&&request.method==='GET'){
   const module=workScope[1];
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('admin',business.hr_admin($1::uuid),'actor_id',$2::uuid,'companies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.party_id,'name',p.legal_name,'allowed',business.work_allowed(c.tenant_id,c.party_id,$3)) ORDER BY p.legal_name) FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND (business.hr_admin(c.tenant_id) OR business.work_allowed(c.tenant_id,c.party_id,$3))),'[]'::jsonb),'grants',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT id,company_id,user_id,reason,created_at,revoked_at FROM business.work_access_grants WHERE tenant_id=$1::uuid AND module=$3 AND business.hr_admin(tenant_id) ORDER BY created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data`,[tenant,user,module]);return send(r.rows[0]?.data||{});
  }
  const workGrant=path.match(/^\/v1\/(timeclock|access)\/grants$/);
  if(workGrant&&request.method==='POST'){
   const b=await body(request),op=requestId(b),company=b.company_id,recipient=b.user_id,reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!UUID.test(company||'')||!UUID.test(recipient||'')||!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme empresa, destinatário e justificativa.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.work_access_grants(tenant_id,company_id,user_id,module,reason,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid WHERE business.hr_admin($1::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,company,recipient,workGrant[1],reason,op,user],true);if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível.');return send({item:r.rows[0]},201);
  }
  const workRevoke=path.match(/^\/v1\/(timeclock|access)\/grants\/([^/]+)\/revoke$/);
  if(workRevoke&&UUID.test(workRevoke[2])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200)fail(400,'Informe justificativa.');
   const r=await execute(sql,tenant,user,"UPDATE business.work_access_grants SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND module=$6 AND revoked_at IS NULL AND business.hr_admin(tenant_id) RETURNING id",[tenant,workRevoke[2],user,reason,op,workRevoke[1]],true);if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível.');return send({item:r.rows[0]});
  }
  const workPeople=path.match(/^\/v1\/(timeclock|access)\/people$/);
  if(workPeople&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company'),q=(u.searchParams.get('q')||'').trim();if(!UUID.test(company||'')||q.length<2||q.length>80)fail(400,'Informe empresa e ao menos dois caracteres.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.work_allowed($1::uuid,$2::uuid,$3),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (SELECT id,legal_name AS name FROM core.parties WHERE tenant_id=$1::uuid AND kind='PF' AND status='active' AND business.work_allowed($1::uuid,$2::uuid,$3) AND strpos(lower(legal_name),lower($4))>0 ORDER BY legal_name LIMIT 50)x),'[]'::jsonb)) AS data`,[tenant,company,workPeople[1],q]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão específica necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/timeclock/records'&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company'),start=u.searchParams.get('start'),end=u.searchParams.get('end');
   if(!UUID.test(company||'')||!validReportRange(start,end))fail(400,'Selecione empresa e período de até 366 dias.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.work_allowed($1::uuid,$2::uuid,'timeclock'),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC) FROM (SELECT e.id,p.legal_name AS name,e.started_at,e.ended_at,extract(epoch FROM e.ended_at-e.started_at)::bigint AS seconds,e.reference,e.created_at,e.voided_at,e.void_reason FROM business.timeclock_entries e JOIN core.parties p ON p.tenant_id=e.tenant_id AND p.id=e.party_id WHERE e.tenant_id=$1::uuid AND e.company_id=$2::uuid AND (e.started_at AT TIME ZONE 'America/Fortaleza')::date BETWEEN $3::date AND $4::date ORDER BY e.started_at DESC LIMIT 500)x),'[]'::jsonb)) AS data`,[tenant,company,start,end]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão TimeClock necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/timeclock/records'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'';
   if(![b.company_id,b.party_id].every(x=>typeof x==='string'&&UUID.test(x))||!validWorkTimestamp(b.started_at)||!validWorkTimestamp(b.ended_at)||!ref||ref.length>120||b.confirmed!==true)fail(400,'Confirme pessoa, intervalo e referência.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.record_timeclock($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,$5,$6::uuid)",[b.company_id,b.party_id,b.started_at,b.ended_at,ref,op],true);if(!r.rows.length)fail(409,'Intervalo sobreposto, inválido ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  const timeVoid=path.match(/^\/v1\/timeclock\/records\/([^/]+)\/void$/);
  if(timeVoid&&UUID.test(timeVoid[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme a anulação e justifique.');
   const r=await execute(sql,tenant,user,"UPDATE business.timeclock_entries SET voided_at=now(),voided_by=$3::uuid,void_reason=$4,void_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND voided_at IS NULL AND business.work_allowed(tenant_id,company_id,'timeclock') RETURNING id",[tenant,timeVoid[1],user,reason,op],true);if(!r.rows.length)fail(409,'Registro indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/access/records'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.work_allowed($1::uuid,$2::uuid,'access'),'zones',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT id,code,label FROM business.access_zones WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY code LIMIT 500)x),'[]'::jsonb),'authorizations',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT a.id,a.zone_id,p.legal_name AS name,a.valid_from,a.valid_until,a.reference,a.revoked_at,a.revoke_reason,a.created_at FROM business.access_authorizations a JOIN core.parties p ON p.tenant_id=a.tenant_id AND p.id=a.party_id WHERE a.tenant_id=$1::uuid AND a.company_id=$2::uuid ORDER BY a.created_at DESC LIMIT 500)x),'[]'::jsonb),'checks',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT a.id,a.zone_id,p.legal_name AS name,a.decision,a.created_at FROM business.access_checks a JOIN core.parties p ON p.tenant_id=a.tenant_id AND p.id=a.party_id WHERE a.tenant_id=$1::uuid AND a.company_id=$2::uuid ORDER BY a.created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão Access necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/access/zones'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),code=typeof b.code==='string'?b.code.trim().toUpperCase():'',label=typeof b.label==='string'?b.label.trim():'';
   if(!UUID.test(b.company_id||'')||!/^[A-Z0-9_-]{1,30}$/.test(code)||!label||label.length>120)fail(400,'Confira empresa, código e área.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.access_zones(tenant_id,company_id,code,label,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid WHERE business.work_allowed($1::uuid,$2::uuid,'access') ON CONFLICT DO NOTHING RETURNING id",[tenant,b.company_id,code,label,op,user],true);if(!r.rows.length)fail(409,'Área duplicada ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/access/authorizations'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'';
   if(![b.company_id,b.zone_id,b.party_id].every(x=>typeof x==='string'&&UUID.test(x))||!validWorkTimestamp(b.valid_from)||!validWorkTimestamp(b.valid_until)||!ref||ref.length>120||b.confirmed!==true)fail(400,'Confirme pessoa, área, vigência e referência.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.create_access_authorization($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::timestamptz,$6,$7::uuid)",[b.company_id,b.zone_id,b.party_id,b.valid_from,b.valid_until,ref,op],true);if(!r.rows.length)fail(409,'Autorização sobreposta, inválida ou indisponível.');return send({item:r.rows[0]},201);
  }
  const accessRevoke=path.match(/^\/v1\/access\/authorizations\/([^/]+)\/revoke$/);
  if(accessRevoke&&UUID.test(accessRevoke[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme revogação e justificativa.');
   const r=await execute(sql,tenant,user,"UPDATE business.access_authorizations SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.work_allowed(tenant_id,company_id,'access') RETURNING id",[tenant,accessRevoke[1],user,reason,op],true);if(!r.rows.length)fail(409,'Autorização indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/access/checks'&&request.method==='POST'){
   const b=await body(request),op=requestId(b);if(![b.company_id,b.zone_id,b.party_id].every(x=>typeof x==='string'&&UUID.test(x)))fail(400,'Selecione pessoa e área.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.record_access_check($1::uuid,$2::uuid,$3::uuid,$4::uuid)",[b.company_id,b.zone_id,b.party_id,op],true);if(!r.rows.length)fail(409,'Consulta indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/people-consolidation'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.party_id,'name',p.legal_name,'hr',business.hr_allowed(c.tenant_id,c.party_id),'payroll',business.payroll_allowed(c.tenant_id,c.party_id),'timeclock',business.work_allowed(c.tenant_id,c.party_id,'timeclock'),'access',business.work_allowed(c.tenant_id,c.party_id,'access'),'active_relationships',CASE WHEN business.hr_allowed(c.tenant_id,c.party_id) THEN (SELECT count(*) FROM business.hr_relationships x WHERE x.tenant_id=c.tenant_id AND x.company_id=c.party_id AND NOT EXISTS(SELECT 1 FROM business.hr_movements m WHERE m.tenant_id=x.tenant_id AND m.relationship_id=x.id AND m.kind='end')) END,'open_assignments',CASE WHEN business.hr_allowed(c.tenant_id,c.party_id) THEN (SELECT count(*) FROM business.dp_assignments x WHERE x.tenant_id=c.tenant_id AND x.company_id=c.party_id AND x.closed_on IS NULL) END,'open_payroll',CASE WHEN business.payroll_allowed(c.tenant_id,c.party_id) THEN (SELECT count(*) FROM business.payroll_batches x WHERE x.tenant_id=c.tenant_id AND x.company_id=c.party_id AND x.status IN ('imported','approved')) END,'time_records',CASE WHEN business.work_allowed(c.tenant_id,c.party_id,'timeclock') THEN (SELECT count(*) FROM business.timeclock_entries x WHERE x.tenant_id=c.tenant_id AND x.company_id=c.party_id AND x.voided_at IS NULL) END,'access_authorizations',CASE WHEN business.work_allowed(c.tenant_id,c.party_id,'access') THEN (SELECT count(*) FROM business.access_authorizations x WHERE x.tenant_id=c.tenant_id AND x.company_id=c.party_id AND x.revoked_at IS NULL AND now()>=x.valid_from AND now()<x.valid_until) END) ORDER BY p.legal_name),'[]'::jsonb) AS items FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND (business.hr_allowed(c.tenant_id,c.party_id) OR business.payroll_allowed(c.tenant_id,c.party_id) OR business.work_allowed(c.tenant_id,c.party_id,'timeclock') OR business.work_allowed(c.tenant_id,c.party_id,'access'))`,[tenant]);return send({items:r.rows[0]?.items||[]});
  }
  const opsIntegration=path.match(/^\/v1\/operations\/orders\/([^/]+)\/integration$/);
  if(opsIntegration&&UUID.test(opsIntegration[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('id',o.id,'contracts',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT c.id,c.code::text,c.title,c.revision FROM business.contracts c WHERE c.tenant_id=o.tenant_id AND c.seller_id=o.company_id AND c.customer_id=o.customer_id AND c.status='active' AND c.valid_from<=o.planned_on AND (c.valid_until IS NULL OR c.valid_until>=o.due_on) ORDER BY c.code LIMIT 100)x),'[]'::jsonb),
   'contract_links',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT l.id,c.code::text,c.title,c.status,l.contract_revision,c.revision AS current_revision,l.reason,l.created_at,l.revoked_at,l.revoke_reason,(c.status='active' AND c.valid_from<=o.planned_on AND (c.valid_until IS NULL OR c.valid_until>=o.due_on) AND c.seller_id=o.company_id AND c.customer_id=o.customer_id) AS compatible FROM business.ops_contract_links l JOIN business.contracts c ON c.tenant_id=l.tenant_id AND c.id=l.contract_id WHERE l.tenant_id=o.tenant_id AND l.order_id=o.id ORDER BY l.created_at DESC LIMIT 100)x),'[]'::jsonb),
   'costs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.reference) FROM (SELECT c.id,c.reference,c.amount::text FROM business.ops_costs c WHERE c.tenant_id=o.tenant_id AND c.order_id=o.id AND c.kind='actual' AND c.voided_at IS NULL AND NOT EXISTS(SELECT 1 FROM business.ops_finance_links l WHERE l.tenant_id=c.tenant_id AND l.cost_id=c.id AND l.revoked_at IS NULL) ORDER BY c.created_at DESC LIMIT 500)x),'[]'::jsonb),
   'payables',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT f.id,f.code::text,f.title,f.counterparty_name,f.amount::text,f.first_due::text FROM business.financial_obligations f WHERE f.tenant_id=o.tenant_id AND f.company_id=o.company_id AND f.direction='payable' AND f.currency='BRL' AND EXISTS(SELECT 1 FROM business.ops_costs c WHERE c.tenant_id=o.tenant_id AND c.order_id=o.id AND c.kind='actual' AND c.voided_at IS NULL AND c.amount=f.amount) AND NOT EXISTS(SELECT 1 FROM business.cost_obligation_claims z WHERE z.tenant_id=f.tenant_id AND z.obligation_id=f.id) ORDER BY f.created_at DESC LIMIT 500)x),'[]'::jsonb),
   'finance_links',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT l.id,c.reference,f.code::text,f.title,f.counterparty_name,l.amount::text,COALESCE((SELECT sum(i.remaining) FROM business.financial_installments i WHERE i.tenant_id=f.tenant_id AND i.obligation_id=f.id),0)::text AS remaining,l.reason,l.created_at,l.revoked_at,l.revoke_reason,c.voided_at AS cost_voided_at FROM business.ops_finance_links l JOIN business.ops_costs c ON c.id=l.cost_id AND c.tenant_id=l.tenant_id AND c.order_id=l.order_id JOIN business.financial_obligations f ON f.tenant_id=l.tenant_id AND f.id=l.obligation_id WHERE l.tenant_id=o.tenant_id AND l.order_id=o.id ORDER BY l.created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data FROM business.ops_orders o WHERE o.tenant_id=$1::uuid AND o.id=$2::uuid AND business.hr_admin(o.tenant_id) AND business.ops_allowed(o.tenant_id,o.company_id)`,[tenant,opsIntegration[1]]);if(!r.rows.length)fail(403,'Integração exige proprietário com concessão operacional.');return send(r.rows[0].data);
  }
  const opsLink=path.match(/^\/v1\/operations\/orders\/([^/]+)\/(contract-link|finance-link)$/);
  if(opsLink&&UUID.test(opsLink[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme o vínculo e justifique.');
   const contract=opsLink[2]==='contract-link';if(contract?!UUID.test(b.contract_id||''):![b.cost_id,b.obligation_id].every(x=>typeof x==='string'&&UUID.test(x)))fail(400,'Selecione os registros.');
   const r=contract?await execute(sql,tenant,user,"SELECT * FROM business.ops_link_contract($1::uuid,$2::uuid,$3,$4::uuid)",[opsLink[1],b.contract_id,reason,op],true):await execute(sql,tenant,user,"SELECT * FROM business.ops_link_finance($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid)",[opsLink[1],b.cost_id,b.obligation_id,reason,op],true);
   if(r.role!=='owner')fail(403,'Integração restrita ao proprietário.');if(!r.rows.length)fail(409,'Vínculo incompatível, já existente ou não autorizado.');return send({item:r.rows[0]},201);
  }
  const opsUnlink=path.match(/^\/v1\/operations\/(contract-links|finance-links)\/([^/]+)\/revoke$/);
  if(opsUnlink&&UUID.test(opsUnlink[2])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme desvinculação e justifique.');
   const table=opsUnlink[1]==='contract-links'?'ops_contract_links':'ops_finance_links';
   const r=await execute(sql,tenant,user,"UPDATE business."+table+" SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,opsUnlink[2],user,reason,op],true);if(!r.rows.length)fail(409,'Vínculo indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/operations/consolidation'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`WITH orders AS (SELECT id,business.ops_order_status(id) AS status,due_on FROM business.ops_orders WHERE tenant_id=$1::uuid AND company_id=$2::uuid), tasks AS (SELECT t.id,business.ops_task_status(t.id) AS status FROM business.ops_tasks t JOIN orders o ON o.id=t.order_id WHERE t.tenant_id=$1::uuid AND t.company_id=$2::uuid)
   SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),'integration_allowed',business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid),'orders',(SELECT count(*) FROM orders),'open_orders',(SELECT count(*) FROM orders WHERE status IN ('draft','planned','in_progress')),'overdue_orders',(SELECT count(*) FROM orders WHERE status IN ('draft','planned','in_progress') AND due_on<(now() AT TIME ZONE 'America/Fortaleza')::date),'completed_orders',(SELECT count(*) FROM orders WHERE status='completed'),'cancelled_orders',(SELECT count(*) FROM orders WHERE status='cancelled'),'open_tasks',(SELECT count(*) FROM tasks WHERE status IN ('pending','in_progress')),'resources',(SELECT count(*) FROM business.ops_resources WHERE tenant_id=$1::uuid AND company_id=$2::uuid),'reservations_on_closed_tasks',(SELECT count(*) FROM business.ops_allocations a JOIN tasks t ON t.id=a.task_id WHERE a.tenant_id=$1::uuid AND a.company_id=$2::uuid AND a.voided_at IS NULL AND a.end_on>=(now() AT TIME ZONE 'America/Fortaleza')::date AND t.status IN ('completed','cancelled')),
   'contract_links',CASE WHEN business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid) THEN (SELECT count(*) FROM business.ops_contract_links WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND revoked_at IS NULL) END,
   'finance_links',CASE WHEN business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid) THEN (SELECT count(*) FROM business.ops_finance_links WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND revoked_at IS NULL) END,
   'cost_voided_links',CASE WHEN business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid) THEN (SELECT count(*) FROM business.ops_finance_links l JOIN business.ops_costs c ON c.id=l.cost_id AND c.tenant_id=l.tenant_id WHERE l.tenant_id=$1::uuid AND l.company_id=$2::uuid AND l.revoked_at IS NULL AND c.voided_at IS NOT NULL) END) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/asset-links'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid),
   'assets',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tag) FROM (SELECT a.id,a.tag,a.title,a.ownership,CASE WHEN e.kind='maintenance_start' THEN 'maintenance' WHEN e.kind IN ('retired','returned') THEN e.kind ELSE 'active' END AS state FROM business.assets a LEFT JOIN LATERAL(SELECT kind FROM business.asset_lifecycle_events WHERE tenant_id=a.tenant_id AND asset_id=a.id AND kind<>'warranty' ORDER BY revision DESC LIMIT 1)e ON true WHERE a.tenant_id=$1::uuid AND a.company_id=$2::uuid AND business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid) ORDER BY a.tag LIMIT 500)x),'[]'::jsonb),
   'links',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT l.id,l.resource_id,l.asset_id,r.code,r.label,a.tag,a.title,l.reason,l.created_at,l.revoked_at,l.revoke_reason,CASE WHEN e.kind='maintenance_start' THEN 'maintenance' WHEN e.kind IN ('retired','returned') THEN e.kind ELSE 'active' END AS state FROM business.ops_asset_links l JOIN business.ops_resources r ON r.tenant_id=l.tenant_id AND r.company_id=l.company_id AND r.id=l.resource_id JOIN business.assets a ON a.tenant_id=l.tenant_id AND a.company_id=l.company_id AND a.id=l.asset_id LEFT JOIN LATERAL(SELECT kind FROM business.asset_lifecycle_events WHERE tenant_id=a.tenant_id AND asset_id=a.id AND kind<>'warranty' ORDER BY revision DESC LIMIT 1)e ON true WHERE l.tenant_id=$1::uuid AND l.company_id=$2::uuid ORDER BY (l.revoked_at IS NULL) DESC,l.created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional e acesso patrimonial necessários.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/asset-links'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(![b.company_id,b.resource_id,b.asset_id].every(x=>typeof x==='string'&&UUID.test(x))||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme equipamento, bem e justificativa.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.ops_asset_links(tenant_id,company_id,resource_id,asset_id,reason,operation_id,created_by) SELECT $1::uuid,$2::uuid,r.id,a.id,$5,$6::uuid,$7::uuid FROM business.ops_resources r JOIN business.assets a ON a.tenant_id=r.tenant_id AND a.company_id=r.company_id WHERE r.tenant_id=$1::uuid AND r.company_id=$2::uuid AND r.id=$3::uuid AND a.id=$4::uuid AND r.kind='equipment' AND a.ownership='owned' AND business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid) AND COALESCE((SELECT e.kind FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id AND e.kind<>'warranty' ORDER BY e.revision DESC LIMIT 1),'active') IN ('active','maintenance_finish') ON CONFLICT DO NOTHING RETURNING id`,[tenant,b.company_id,b.resource_id,b.asset_id,reason,op,user],true);if(!r.rows.length)fail(409,'Vínculo duplicado, bem indisponível ou acesso não autorizado.');return send({item:r.rows[0]},201);
  }
  const assetLinkRevoke=path.match(/^\/v1\/operations\/asset-links\/([^/]+)\/revoke$/);
  if(assetLinkRevoke&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!UUID.test(assetLinkRevoke[1])||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme a desvinculação e justificativa.');
   const r=await execute(sql,tenant,user,"UPDATE business.ops_asset_links SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_operation_id=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,assetLinkRevoke[1],user,reason,op],true);if(!r.rows.length)fail(409,'Vínculo indisponível ou já encerrado.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/operations/resources'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT id,code,kind,label FROM business.ops_resources WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY code LIMIT 500)x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/resources'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),code=typeof b.code==='string'?b.code.trim().toUpperCase():'',label=typeof b.label==='string'?b.label.trim():'',party=b.party_id||null;
   if(!UUID.test(b.company_id||'')||!/^[A-Z0-9_-]{1,30}$/.test(code)||!label||label.length>120||!['team','person','equipment','other'].includes(b.kind)||(b.kind==='person'?!UUID.test(party||''):party!==null))fail(400,'Confira código, tipo, identificação e pessoa.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.ops_resources(tenant_id,company_id,code,kind,label,party_id,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,CASE WHEN $4='person' THEN p.legal_name ELSE $5 END,$6::uuid,$7::uuid,$8::uuid FROM (SELECT 1) q LEFT JOIN core.parties p ON p.tenant_id=$1::uuid AND p.id=$6::uuid AND p.kind='PF' AND p.status='active' WHERE business.ops_allowed($1::uuid,$2::uuid) AND ($4<>'person' OR p.id IS NOT NULL) ON CONFLICT DO NOTHING RETURNING id",[tenant,b.company_id,code,b.kind,label,party,op,user],true);if(!r.rows.length)fail(409,'Recurso duplicado, pessoa inválida ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/operations/allocations'&&request.method==='POST'){
   const b=await body(request),op=requestId(b);if(![b.task_id,b.resource_id].every(x=>typeof x==='string'&&UUID.test(x))||!validReportRange(b.start_on,b.end_on)||b.confirmed!==true)fail(400,'Confirme recurso, atividade e intervalo.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.ops_allocate($1::uuid,$2::uuid,$3::date,$4::date,$5::uuid)",[b.task_id,b.resource_id,b.start_on,b.end_on,op],true);if(!r.rows.length)fail(409,'Reserva sobreposta, prazo inválido ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/operations/costs'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'';
   if(!UUID.test(b.order_id||'')||!['planned','actual'].includes(b.kind)||!['labor','materials','equipment','travel','third_party','other'].includes(b.category)||!ref||ref.length>120||typeof b.amount!=='string'||!/^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/.test(b.amount)||Number(b.amount)<=0||!validReportRange(b.incurred_on,b.incurred_on)||b.confirmed!==true)fail(400,'Confirme categoria, valor, data e referência.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.ops_add_cost($1::uuid,$2,$3,$4,$5::numeric,$6::date,$7::uuid)",[b.order_id,b.kind,b.category,ref,b.amount,b.incurred_on,op],true);if(!r.rows.length)fail(409,'Custo duplicado, situação incompatível ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/operations/effort'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'';
   if(!UUID.test(b.task_id||'')||!validReportRange(b.work_on,b.work_on)||!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>525600||!ref||ref.length>120||b.confirmed!==true)fail(400,'Confirme atividade, esforço, data e referência.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.ops_add_effort($1::uuid,$2::date,$3::integer,$4,$5::uuid)",[b.task_id,b.work_on,b.minutes,ref,op],true);if(!r.rows.length)fail(409,'Esforço duplicado, situação incompatível ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  const opsVoid=path.match(/^\/v1\/operations\/(allocations|costs|effort)\/([^/]+)\/void$/);
  if(opsVoid&&UUID.test(opsVoid[2])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme a anulação e justifique.');
   const table={allocations:'ops_allocations',costs:'ops_costs',effort:'ops_effort'}[opsVoid[1]];
   const r=await execute(sql,tenant,user,"UPDATE business."+table+" SET voided_at=now(),voided_by=$3::uuid,void_reason=$4,void_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND voided_at IS NULL AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,opsVoid[2],user,reason,op],true);if(!r.rows.length)fail(409,'Registro indisponível.');return send({item:r.rows[0]});
  }
  const opsResourcesDetail=path.match(/^\/v1\/operations\/orders\/([^/]+)\/resources$/);
  if(opsResourcesDetail&&UUID.test(opsResourcesDetail[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('id',o.id,'status',business.ops_order_status(o.id),
   'allocations',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.start_on) FROM (SELECT a.id,a.task_id,r.code AS resource_code,r.label AS resource_label,a.start_on::text,a.end_on::text,a.voided_at,a.void_reason FROM business.ops_allocations a JOIN business.ops_tasks t ON t.tenant_id=a.tenant_id AND t.id=a.task_id JOIN business.ops_resources r ON r.tenant_id=a.tenant_id AND r.id=a.resource_id WHERE t.tenant_id=o.tenant_id AND t.order_id=o.id ORDER BY a.created_at DESC LIMIT 500)x),'[]'::jsonb),
   'costs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.incurred_on) FROM (SELECT id,kind,category,reference,amount::text,incurred_on::text,voided_at,void_reason FROM business.ops_costs WHERE tenant_id=o.tenant_id AND order_id=o.id ORDER BY created_at DESC LIMIT 500)x),'[]'::jsonb),
   'effort',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.work_on) FROM (SELECT e.id,e.task_id,e.work_on::text,e.minutes,e.reference,e.voided_at,e.void_reason FROM business.ops_effort e JOIN business.ops_tasks t ON t.tenant_id=e.tenant_id AND t.id=e.task_id WHERE t.tenant_id=o.tenant_id AND t.order_id=o.id ORDER BY e.created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data FROM business.ops_orders o WHERE o.tenant_id=$1::uuid AND o.id=$2::uuid`,[tenant,opsResourcesDetail[1]]);if(!r.rows.length)fail(404,'Ordem indisponível.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/indicators'&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company'),start=u.searchParams.get('start'),end=u.searchParams.get('end');if(!UUID.test(company||'')||!validReportRange(start,end))fail(400,'Selecione empresa e período de até 366 dias.');
   const r=await execute(sql,tenant,user,`WITH orders AS (SELECT o.id,business.ops_order_status(o.id) AS status,o.due_on,(SELECT max(e.created_at) FROM business.ops_order_events e WHERE e.tenant_id=o.tenant_id AND e.order_id=o.id AND e.status='completed') AS completed_at FROM business.ops_orders o WHERE o.tenant_id=$1::uuid AND o.company_id=$2::uuid AND o.due_on BETWEEN $3::date AND $4::date), tasks AS (SELECT t.id,t.estimated_minutes,business.ops_task_status(t.id) AS status FROM business.ops_tasks t JOIN orders o ON o.id=t.order_id WHERE t.tenant_id=$1::uuid AND t.company_id=$2::uuid), costs AS (SELECT c.kind,c.amount FROM business.ops_costs c JOIN orders o ON o.id=c.order_id WHERE c.tenant_id=$1::uuid AND c.company_id=$2::uuid AND c.voided_at IS NULL), effort AS (SELECT e.minutes FROM business.ops_effort e JOIN tasks t ON t.id=e.task_id WHERE e.tenant_id=$1::uuid AND e.company_id=$2::uuid AND e.voided_at IS NULL)
   SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),'orders',(SELECT count(*) FROM orders),'completed',(SELECT count(*) FROM orders WHERE status='completed'),'on_time',(SELECT count(*) FROM orders WHERE status='completed' AND (completed_at AT TIME ZONE 'America/Fortaleza')::date<=due_on),'overdue_open',(SELECT count(*) FROM orders WHERE status NOT IN ('completed','cancelled') AND due_on<(now() AT TIME ZONE 'America/Fortaleza')::date),'tasks',(SELECT count(*) FROM tasks),'tasks_completed',(SELECT count(*) FROM tasks WHERE status='completed'),'estimated_minutes',(SELECT COALESCE(sum(estimated_minutes),0) FROM tasks WHERE status<>'cancelled'),'reported_minutes',(SELECT COALESCE(sum(minutes),0) FROM effort),'planned_cost',(SELECT COALESCE(sum(amount),0)::text FROM costs WHERE kind='planned'),'actual_cost',(SELECT COALESCE(sum(amount),0)::text FROM costs WHERE kind='actual'),'actual_cost_records',(SELECT count(*) FROM costs WHERE kind='actual')) AS data`,[tenant,company,start,end]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/external-links'&&request.method==='GET'){
   const q=new URL(request.url).searchParams,company=q.get('company'),project=q.get('project'),order=q.get('order');
   if(!UUID.test(company||'')||Boolean(project)===Boolean(order)||!UUID.test(project||order||''))fail(400,'Selecione empresa e projeto ou ordem.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT id,provider,external_scope,external_ref,reason,created_at,revoked_at,revoke_reason FROM business.external_work_links WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND (project_id=$3::uuid OR order_id=$4::uuid) ORDER BY (revoked_at IS NULL) DESC,created_at DESC LIMIT 100)x),'[]'::jsonb)) AS data`,[tenant,company,project||null,order||null]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional e proprietário necessários.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/external-links'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),scope=typeof b.external_scope==='string'?b.external_scope.trim():'',ref=typeof b.external_ref==='string'?b.external_ref.trim():'',reason=typeof b.reason==='string'?b.reason.trim():'',project=b.project_id||null,order=b.order_id||null;
   if(!UUID.test(b.company_id||'')||!['nexus','service_desk'].includes(b.provider)||!(/^[A-Za-z0-9._:-]{1,100}$/).test(scope)||!(/^[A-Za-z0-9._:-]{1,100}$/).test(ref)||!reason||reason.length>200||b.confirmed!==true||(b.provider==='nexus'?(!UUID.test(project||'')||order!==null||!UUID.test(ref)):(!UUID.test(order||'')||project!==null)))fail(400,'Confirme referência externa, organização/instituição e justificativa.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.external_work_links(tenant_id,company_id,project_id,order_id,provider,external_scope,external_ref,reason,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::uuid,$10::uuid WHERE business.hr_admin($1::uuid) AND business.ops_allowed($1::uuid,$2::uuid) AND (($3::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM business.projects WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND id=$3::uuid)) OR ($4::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM business.ops_orders WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND id=$4::uuid)) ) ON CONFLICT DO NOTHING RETURNING id`,[tenant,b.company_id,project,order,b.provider,scope,ref,reason,op,user],true);if(!r.rows.length)fail(409,'Referência duplicada, registro incompatível ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  const externalLinkRevoke=path.match(/^\/v1\/operations\/external-links\/([^/]+)\/revoke$/);
  if(externalLinkRevoke&&UUID.test(externalLinkRevoke[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme desvinculação.');
   const r=await execute(sql,tenant,user,"UPDATE business.external_work_links SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,externalLinkRevoke[1],user,reason,op],true);if(!r.rows.length)fail(409,'Vínculo indisponível.');return send({item:r.rows[0]},201);
  }
  const projectFinance=path.match(/^\/v1\/projects\/([^/]+)\/finance$/);
  if(projectFinance&&UUID.test(projectFinance[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('id',p.id,'costs',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT c.id,c.reference,c.amount::text FROM business.project_costs c WHERE c.tenant_id=p.tenant_id AND c.project_id=p.id AND c.kind='actual' AND c.voided_at IS NULL AND NOT EXISTS(SELECT 1 FROM business.project_finance_links l WHERE l.tenant_id=c.tenant_id AND l.cost_id=c.id AND l.revoked_at IS NULL) ORDER BY c.created_at DESC LIMIT 500)x),'[]'::jsonb),'payables',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT f.id,f.code::text,f.title,f.counterparty_name,f.amount::text FROM business.financial_obligations f WHERE f.tenant_id=p.tenant_id AND f.company_id=p.company_id AND f.direction='payable' AND f.currency='BRL' AND EXISTS(SELECT 1 FROM business.project_costs c WHERE c.tenant_id=p.tenant_id AND c.project_id=p.id AND c.kind='actual' AND c.voided_at IS NULL AND c.amount=f.amount) AND NOT EXISTS(SELECT 1 FROM business.cost_obligation_claims z WHERE z.tenant_id=f.tenant_id AND z.obligation_id=f.id) ORDER BY f.created_at DESC LIMIT 500)x),'[]'::jsonb),'links',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT l.id,c.reference,f.code::text,f.title,f.counterparty_name,l.amount::text,COALESCE((SELECT sum(i.remaining) FROM business.financial_installments i WHERE i.tenant_id=f.tenant_id AND i.obligation_id=f.id),0)::text AS remaining,l.reason,l.revoked_at,l.revoke_reason,c.voided_at AS cost_voided_at FROM business.project_finance_links l JOIN business.project_costs c ON c.id=l.cost_id AND c.tenant_id=l.tenant_id JOIN business.financial_obligations f ON f.tenant_id=l.tenant_id AND f.id=l.obligation_id WHERE l.tenant_id=p.tenant_id AND l.project_id=p.id ORDER BY l.created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data FROM business.projects p WHERE p.tenant_id=$1::uuid AND p.id=$2::uuid AND business.hr_admin(p.tenant_id) AND business.ops_allowed(p.tenant_id,p.company_id)`,[tenant,projectFinance[1]]);if(!r.rows.length)fail(403,'Integração exige proprietário com concessão operacional.');return send(r.rows[0].data);
  }
  if(projectFinance&&UUID.test(projectFinance[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(![b.cost_id,b.obligation_id].every(x=>typeof x==='string'&&UUID.test(x))||!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme custo, obrigação e justificativa.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.project_finance_links(tenant_id,company_id,project_id,cost_id,obligation_id,amount,reason,operation_id,created_by) SELECT c.tenant_id,c.company_id,c.project_id,c.id,f.id,c.amount,$5,$6::uuid,$7::uuid FROM business.project_costs c JOIN business.financial_obligations f ON f.tenant_id=c.tenant_id AND f.company_id=c.company_id AND f.amount=c.amount WHERE c.tenant_id=$1::uuid AND c.project_id=$2::uuid AND c.id=$3::uuid AND f.id=$4::uuid AND c.kind='actual' AND c.voided_at IS NULL AND f.direction='payable' AND f.currency='BRL' AND business.hr_admin(c.tenant_id) AND business.ops_allowed(c.tenant_id,c.company_id) AND NOT EXISTS(SELECT 1 FROM business.cost_obligation_claims z WHERE z.tenant_id=f.tenant_id AND z.obligation_id=f.id) ON CONFLICT DO NOTHING RETURNING id`,[tenant,projectFinance[1],b.cost_id,b.obligation_id,reason,op,user],true);if(!r.rows.length)fail(409,'Custo ou obrigação incompatível, já vinculada ou sem autorização.');return send({item:r.rows[0]},201);
  }
  const projectFinanceRevoke=path.match(/^\/v1\/projects\/finance-links\/([^/]+)\/revoke$/);
  if(projectFinanceRevoke&&UUID.test(projectFinanceRevoke[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme a desvinculação.');
   const r=await execute(sql,tenant,user,"UPDATE business.project_finance_links SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,projectFinanceRevoke[1],user,reason,op],true);if(!r.rows.length)fail(409,'Vínculo indisponível.');return send({item:r.rows[0]},201);
  }
  const projectResources=path.match(/^\/v1\/projects\/([^/]+)\/resources$/);
  if(projectResources&&UUID.test(projectResources[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('id',p.id,'status',business.project_status(p.id),'planned_total',COALESCE((SELECT sum(amount) FROM business.project_costs WHERE tenant_id=p.tenant_id AND project_id=p.id AND kind='planned' AND voided_at IS NULL),0)::text,'actual_total',COALESCE((SELECT sum(amount) FROM business.project_costs WHERE tenant_id=p.tenant_id AND project_id=p.id AND kind='actual' AND voided_at IS NULL),0)::text,'actual_count',(SELECT count(*) FROM business.project_costs WHERE tenant_id=p.tenant_id AND project_id=p.id AND kind='actual' AND voided_at IS NULL),'allocations',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.start_on) FROM (SELECT a.id,a.item_id,i.title,r.code,r.label,a.start_on::text,a.end_on::text,a.voided_at,a.void_reason FROM business.project_allocations a JOIN business.project_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id JOIN business.ops_resources r ON r.tenant_id=a.tenant_id AND r.id=a.resource_id WHERE a.tenant_id=p.tenant_id AND a.project_id=p.id ORDER BY a.created_at DESC LIMIT 500)x),'[]'::jsonb),'costs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.incurred_on) FROM (SELECT id,kind,category,reference,amount::text,incurred_on::text,voided_at,void_reason FROM business.project_costs WHERE tenant_id=p.tenant_id AND project_id=p.id ORDER BY created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data FROM business.projects p WHERE p.tenant_id=$1::uuid AND p.id=$2::uuid`,[tenant,projectResources[1]]);if(!r.rows.length)fail(404,'Projeto indisponível.');return send(r.rows[0].data);
  }
  if(path==='/v1/projects/allocations'&&request.method==='POST'){
   const b=await body(request),op=requestId(b);if(![b.item_id,b.resource_id].every(x=>typeof x==='string'&&UUID.test(x))||!validReportRange(b.start_on,b.end_on)||b.confirmed!==true)fail(400,'Confirme recurso, item e período.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.project_allocate($1::uuid,$2::uuid,$3::date,$4::date,$5::uuid)",[b.item_id,b.resource_id,b.start_on,b.end_on,op],true);if(!r.rows.length)fail(409,'Reserva incompatível, sobreposta ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/projects/costs'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'';
   if(!UUID.test(b.project_id||'')||!['planned','actual'].includes(b.kind)||!['labor','materials','equipment','travel','third_party','other'].includes(b.category)||!ref||ref.length>120||typeof b.amount!=='string'||!/^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/.test(b.amount)||Number(b.amount)<=0||!validReportRange(b.incurred_on,b.incurred_on)||b.confirmed!==true)fail(400,'Confirme valor, categoria, data e referência.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.project_add_cost($1::uuid,$2,$3,$4,$5::numeric,$6::date,$7::uuid)",[b.project_id,b.kind,b.category,ref,b.amount,b.incurred_on,op],true);if(!r.rows.length)fail(409,'Custo duplicado, situação incompatível ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  const projectVoid=path.match(/^\/v1\/projects\/(allocations|costs)\/([^/]+)\/void$/);
  if(projectVoid&&UUID.test(projectVoid[2])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme anulação e justificativa.');
   const table=projectVoid[1]==='allocations'?'project_allocations':'project_costs';
   const r=await execute(sql,tenant,user,"UPDATE business."+table+" SET voided_at=now(),voided_by=$3::uuid,void_reason=$4,void_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND voided_at IS NULL AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,projectVoid[2],user,reason,op],true);if(!r.rows.length)fail(409,'Registro indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/rentals'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),'overdue',(SELECT count(*) FROM business.rentals r WHERE r.tenant_id=$1::uuid AND r.company_id=$2::uuid AND r.end_on<(now() AT TIME ZONE 'America/Fortaleza')::date AND business.rental_status(r.id)='delivered'),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT r.id,r.reference,r.start_on::text,r.end_on::text,r.agreed_amount::text,r.created_at,e.code,e.label,p.legal_name AS customer_name,business.rental_status(r.id) AS status,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',v.status,'reason',v.reason,'created_at',v.created_at) ORDER BY v.seq) FROM business.rental_events v WHERE v.tenant_id=r.tenant_id AND v.rental_id=r.id),'[]'::jsonb) AS events FROM business.rentals r JOIN business.ops_resources e ON e.tenant_id=r.tenant_id AND e.id=r.resource_id JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=r.customer_id WHERE r.tenant_id=$1::uuid AND r.company_id=$2::uuid ORDER BY r.created_at DESC,r.id LIMIT 100)x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/rentals'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'';
   if(![b.company_id,b.resource_id,b.customer_id].every(x=>typeof x==='string'&&UUID.test(x))||!ref||ref.length>60||!validReportRange(b.start_on,b.end_on)||typeof b.agreed_amount!=='string'||!/^(0|[1-9][0-9]{0,11})([.][0-9]{1,2})?$/.test(b.agreed_amount)||b.confirmed!==true)fail(400,'Confirme equipamento, destinatário, período e valor acordado.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.rental_create($1::uuid,$2::uuid,$3::uuid,$4,$5::date,$6::date,$7::numeric,$8::uuid)",[b.company_id,b.resource_id,b.customer_id,ref,b.start_on,b.end_on,b.agreed_amount,op],true);if(!r.rows.length)fail(409,'Locação duplicada, período indisponível ou acesso inválido.');return send({item:r.rows[0]},201);
  }
  const rentalBilling=path.match(/^\/v1\/rentals\/([^/]+)\/billing$/);
  if(rentalBilling&&UUID.test(rentalBilling[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('id',r.id,'contracts',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT c.id,c.code::text,c.title,c.revision,c.payer_name,c.total::text FROM business.contracts c WHERE c.tenant_id=r.tenant_id AND c.seller_id=r.company_id AND c.customer_id=r.customer_id AND c.status='active' AND c.signed_on IS NOT NULL AND c.contract_kind IN ('service','mixed') AND c.currency='BRL' AND c.valid_from<=r.start_on AND (c.valid_until IS NULL OR c.valid_until>=r.end_on) AND c.total=r.agreed_amount AND business.rental_status(r.id)<>'cancelled' AND NOT EXISTS(SELECT 1 FROM business.rental_billing_links l WHERE l.tenant_id=c.tenant_id AND l.contract_id=c.id AND l.revoked_at IS NULL) ORDER BY c.code LIMIT 500)x),'[]'::jsonb),
   'receivables',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT f.id,f.code::text,f.title,f.contract_id,f.contract_revision,f.counterparty_name,f.amount::text FROM business.financial_obligations f JOIN business.contracts c ON c.tenant_id=f.tenant_id AND c.id=f.contract_id WHERE f.tenant_id=r.tenant_id AND f.company_id=r.company_id AND c.seller_id=r.company_id AND c.customer_id=r.customer_id AND f.direction='receivable' AND f.currency='BRL' AND f.counterparty_id=c.payer_id AND f.contract_revision=c.revision AND f.amount=r.agreed_amount AND NOT EXISTS(SELECT 1 FROM business.rental_billing_links l WHERE l.tenant_id=f.tenant_id AND l.obligation_id=f.id AND l.revoked_at IS NULL) ORDER BY f.code LIMIT 500)x),'[]'::jsonb),
   'links',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT l.id,c.code::text AS contract_code,c.title,c.payer_name,l.contract_revision,c.revision AS current_revision,c.status AS contract_status,l.amount::text,f.code::text AS obligation_code,CASE WHEN f.id IS NOT NULL THEN COALESCE((SELECT sum(i.remaining) FROM business.financial_installments i WHERE i.tenant_id=f.tenant_id AND i.obligation_id=f.id),0)::text END AS remaining,l.reason,l.created_at,l.revoked_at,l.revoke_reason,(c.status<>'active' OR c.revision<>l.contract_revision OR c.valid_from>r.start_on OR (c.valid_until IS NOT NULL AND c.valid_until<r.end_on) OR c.total<>l.amount OR business.rental_status(r.id)='cancelled') AS needs_review FROM business.rental_billing_links l JOIN business.contracts c ON c.tenant_id=l.tenant_id AND c.id=l.contract_id LEFT JOIN business.financial_obligations f ON f.tenant_id=l.tenant_id AND f.id=l.obligation_id WHERE l.tenant_id=r.tenant_id AND l.rental_id=r.id ORDER BY (l.revoked_at IS NULL) DESC,l.created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data FROM business.rentals r WHERE r.tenant_id=$1::uuid AND r.id=$2::uuid AND business.hr_admin(r.tenant_id) AND business.ops_allowed(r.tenant_id,r.company_id)`,[tenant,rentalBilling[1]]);if(!r.rows.length)fail(403,'Integração exige proprietário com concessão operacional.');return send(r.rows[0].data);
  }
  if(rentalBilling&&UUID.test(rentalBilling[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'',ob=b.obligation_id||null;
   if(typeof b.contract_id!=='string'||!UUID.test(b.contract_id)||(ob!==null&&(typeof ob!=='string'||!UUID.test(ob)))||!Number.isInteger(b.contract_revision)||b.contract_revision<1||!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme contrato, revisão, obrigação opcional e justificativa.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.rental_billing_links(tenant_id,company_id,rental_id,contract_id,contract_revision,obligation_id,amount,reason,operation_id,created_by) SELECT r.tenant_id,r.company_id,r.id,c.id,c.revision,$4::uuid,r.agreed_amount,$6,$7::uuid,$8::uuid FROM business.rentals r JOIN business.contracts c ON c.tenant_id=r.tenant_id AND c.seller_id=r.company_id AND c.customer_id=r.customer_id WHERE r.tenant_id=$1::uuid AND r.id=$2::uuid AND c.id=$3::uuid AND c.revision=$5::integer AND c.status='active' AND c.signed_on IS NOT NULL AND c.contract_kind IN ('service','mixed') AND c.currency='BRL' AND c.valid_from<=r.start_on AND (c.valid_until IS NULL OR c.valid_until>=r.end_on) AND c.total=r.agreed_amount AND business.rental_status(r.id)<>'cancelled' AND business.hr_admin(r.tenant_id) AND business.ops_allowed(r.tenant_id,r.company_id) AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM business.financial_obligations f WHERE f.tenant_id=r.tenant_id AND f.company_id=r.company_id AND f.id=$4::uuid AND f.direction='receivable' AND f.currency='BRL' AND f.contract_id=c.id AND f.contract_revision=c.revision AND f.counterparty_id=c.payer_id AND f.amount=r.agreed_amount)) ON CONFLICT DO NOTHING RETURNING id`,[tenant,rentalBilling[1],b.contract_id,ob,b.contract_revision,reason,op,user],true);if(!r.rows.length)fail(409,'Locação, contrato ou obrigação incompatível, já vinculada ou sem autorização.');return send({item:r.rows[0]},201);
  }
  const rentalBillingRevoke=path.match(/^\/v1\/rentals\/billing-links\/([^/]+)\/revoke$/);
  if(rentalBillingRevoke&&UUID.test(rentalBillingRevoke[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme a desvinculação.');
   const r=await execute(sql,tenant,user,"UPDATE business.rental_billing_links SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,rentalBillingRevoke[1],user,reason,op],true);if(!r.rows.length)fail(409,'Vínculo indisponível.');return send({item:r.rows[0]},201);
  }
  const rentalEvent=path.match(/^\/v1\/rentals\/([^/]+)\/events$/);
  if(rentalEvent&&UUID.test(rentalEvent[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!['delivered','returned','cancelled'].includes(b.status)||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme situação e justificativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.rental_change($1::uuid,$2,$3,$4::uuid)",[rentalEvent[1],b.status,reason,op],true);if(!r.rows.length)fail(409,'Transição inválida, equipamento ainda entregue ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/field-operations'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),
   'vehicles',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.vehicle_ref) FROM (SELECT v.id,v.vehicle_ref,r.label FROM business.fleet_vehicles v JOIN business.ops_resources r ON r.tenant_id=v.tenant_id AND r.id=v.resource_id WHERE v.tenant_id=$1::uuid AND v.company_id=$2::uuid ORDER BY v.vehicle_ref LIMIT 500)x),'[]'::jsonb),
   'sites',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT id,code,label,location_ref FROM business.facility_sites WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY code LIMIT 500)x),'[]'::jsonb),
   'jobs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT j.id,j.kind,j.reference,j.title,j.details,j.start_on::text,j.end_on::text,j.created_at,r.label AS resource_label,s.label AS site_label,p.code AS project_code,o.reference AS order_reference,business.field_job_status(j.id) AS status,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',e.status,'reason',e.reason,'created_at',e.created_at) ORDER BY e.seq) FROM business.field_job_events e WHERE e.tenant_id=j.tenant_id AND e.job_id=j.id),'[]'::jsonb) AS events FROM business.field_jobs j LEFT JOIN business.ops_resources r ON r.tenant_id=j.tenant_id AND r.id=j.resource_id LEFT JOIN business.facility_sites s ON s.tenant_id=j.tenant_id AND s.id=j.site_id LEFT JOIN business.projects p ON p.tenant_id=j.tenant_id AND p.id=j.project_id LEFT JOIN business.ops_orders o ON o.tenant_id=j.tenant_id AND o.id=j.order_id WHERE j.tenant_id=$1::uuid AND j.company_id=$2::uuid ORDER BY j.created_at DESC,j.id LIMIT 100)x),'[]'::jsonb),
   'summary',jsonb_build_object('projects',(SELECT count(*) FROM business.projects WHERE tenant_id=$1::uuid AND company_id=$2::uuid),'open_projects',(SELECT count(*) FROM business.projects p WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND business.project_status(p.id) IN ('draft','active')),'orders',(SELECT count(*) FROM business.ops_orders WHERE tenant_id=$1::uuid AND company_id=$2::uuid),'rentals_open',(SELECT count(*) FROM business.rentals r WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND business.rental_status(r.id) IN ('reserved','delivered')),'rentals_overdue',(SELECT count(*) FROM business.rentals r WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND business.rental_status(r.id)='delivered' AND end_on<(now() AT TIME ZONE 'America/Fortaleza')::date),'trips_open',(SELECT count(*) FROM business.field_jobs j WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND kind='trip' AND business.field_job_status(j.id) IN ('planned','in_progress')),'maintenance_open',(SELECT count(*) FROM business.field_jobs j WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND kind='maintenance' AND business.field_job_status(j.id) IN ('planned','in_progress')),'jobs_overdue',(SELECT count(*) FROM business.field_jobs j WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND business.field_job_status(j.id) IN ('planned','in_progress') AND end_on<(now() AT TIME ZONE 'America/Fortaleza')::date),'linked_jobs',(SELECT count(*) FROM business.field_jobs j WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND (project_id IS NOT NULL OR order_id IS NOT NULL) AND business.field_job_status(j.id)<>'cancelled'))) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/field-operations/vehicles'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.vehicle_ref==='string'?b.vehicle_ref.trim():'';
   if(![b.company_id,b.resource_id].every(x=>typeof x==='string'&&UUID.test(x))||!ref||ref.length>60||b.confirmed!==true)fail(400,'Confirme equipamento e identificação do veículo.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.fleet_vehicles(tenant_id,company_id,resource_id,vehicle_ref,operation_id,created_by) SELECT tenant_id,company_id,id,$4,$5::uuid,$6::uuid FROM business.ops_resources WHERE tenant_id=$1::uuid AND company_id=$2::uuid AND id=$3::uuid AND kind='equipment' AND business.ops_allowed(tenant_id,company_id) ON CONFLICT DO NOTHING RETURNING id",[tenant,b.company_id,b.resource_id,ref,op,user],true);if(!r.rows.length)fail(409,'Veículo duplicado, equipamento inválido ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/field-operations/sites'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),code=typeof b.code==='string'?b.code.trim().toUpperCase():'',label=typeof b.label==='string'?b.label.trim():'',ref=typeof b.location_ref==='string'?b.location_ref.trim():'';
   if(!UUID.test(b.company_id||'')||!/^[A-Z0-9_-]{1,30}$/.test(code)||!label||label.length>120||!ref||ref.length>200)fail(400,'Confira código, nome e localização administrativa.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.facility_sites(tenant_id,company_id,code,label,location_ref,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid WHERE business.ops_allowed($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,b.company_id,code,label,ref,op,user],true);if(!r.rows.length)fail(409,'Instalação duplicada ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/field-operations/jobs'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'',title=typeof b.title==='string'?b.title.trim():'',details=typeof b.details==='string'?b.details.trim():'',ids=['vehicle_id','site_id','resource_id','project_id','order_id'].map(k=>b[k]||null);
   if(!UUID.test(b.company_id||'')||!['trip','maintenance'].includes(b.kind)||!ref||ref.length>60||!title||title.length>120||!details||details.length>500||ids.some(x=>x!==null&&(typeof x!=='string'||!UUID.test(x)))||!validReportRange(b.start_on,b.end_on)||b.confirmed!==true)fail(400,'Confirme atividade, referência, recursos e período.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.field_create_job($1::uuid,$2,$3,$4,$5,$6::uuid,$7::uuid,$8::uuid,$9::uuid,$10::uuid,$11::date,$12::date,$13::uuid)",[b.company_id,b.kind,ref,title,details,...ids,b.start_on,b.end_on,op],true);if(!r.rows.length)fail(409,'Atividade incompatível, recurso indisponível ou vínculo inválido.');return send({item:r.rows[0]},201);
  }
  const fieldEvent=path.match(/^\/v1\/field-operations\/jobs\/([^/]+)\/events$/);
  if(fieldEvent&&UUID.test(fieldEvent[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!['in_progress','completed','cancelled'].includes(b.status)||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme situação e justificativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.field_change_job($1::uuid,$2,$3,$4::uuid)",[fieldEvent[1],b.status,reason,op],true);if(!r.rows.length)fail(409,'Transição inválida, vínculo ou equipamento indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/projects'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT p.id,p.code,p.title,p.description,p.planned_on::text,p.due_on::text,p.created_at,business.project_status(p.id) AS status,(SELECT count(*) FROM business.project_items i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id AND i.kind<>'phase') AS item_count,(SELECT count(*) FROM business.project_items i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id AND i.kind<>'phase' AND business.project_item_status(i.id)='completed') AS completed_count FROM business.projects p WHERE p.tenant_id=$1::uuid AND p.company_id=$2::uuid ORDER BY p.created_at DESC,p.id LIMIT 100)x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/projects'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),code=typeof b.code==='string'?b.code.trim().toUpperCase():'',title=typeof b.title==='string'?b.title.trim():'',description=typeof b.description==='string'?b.description.trim():'';
   if(!UUID.test(b.company_id||'')||!/^[A-Z0-9_-]{1,30}$/.test(code)||!title||title.length>120||!description||description.length>1000||!validReportRange(b.planned_on,b.planned_on)||!validReportRange(b.due_on,b.due_on)||b.due_on<b.planned_on||Date.parse(b.due_on)-Date.parse(b.planned_on)>1095*86400000||b.confirmed!==true)fail(400,'Confirme os dados e o período do projeto (até 1095 dias de diferença).');
   const r=await execute(sql,tenant,user,"INSERT INTO business.projects(tenant_id,company_id,code,title,description,planned_on,due_on,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,$5,$6::date,$7::date,$8::uuid,$9::uuid WHERE business.ops_allowed($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,b.company_id,code,title,description,b.planned_on,b.due_on,op,user],true);if(!r.rows.length)fail(409,'Projeto duplicado ou acesso indisponível.');return send({item:r.rows[0]},201);
  }
  const projectDetail=path.match(/^\/v1\/projects\/([^/]+)$/);
  if(projectDetail&&UUID.test(projectDetail[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('id',p.id,'status',business.project_status(p.id),'item_count',(SELECT count(*) FROM business.project_items i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id),'dependency_count',(SELECT count(*) FROM business.project_dependencies d WHERE d.tenant_id=p.tenant_id AND d.project_id=p.id),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.planned_on,x.id) FROM (SELECT i.id,i.phase_id,i.kind,i.title,i.planned_on::text,i.due_on::text,business.project_item_status(i.id) AS status,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',e.status,'reason',e.reason,'created_at',e.created_at) ORDER BY e.seq) FROM business.project_item_events e WHERE e.tenant_id=i.tenant_id AND e.item_id=i.id),'[]'::jsonb) AS events FROM business.project_items i WHERE i.tenant_id=p.tenant_id AND i.project_id=p.id ORDER BY i.planned_on,i.id LIMIT 500)x),'[]'::jsonb),'dependencies',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT predecessor_id,successor_id FROM business.project_dependencies WHERE tenant_id=p.tenant_id AND project_id=p.id ORDER BY created_at,id LIMIT 2000)x),'[]'::jsonb),'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',e.status,'reason',e.reason,'created_at',e.created_at) ORDER BY e.seq) FROM business.project_events e WHERE e.tenant_id=p.tenant_id AND e.project_id=p.id),'[]'::jsonb)) AS data FROM business.projects p WHERE p.tenant_id=$1::uuid AND p.id=$2::uuid`,[tenant,projectDetail[1]]);if(!r.rows.length)fail(404,'Projeto indisponível.');return send(r.rows[0].data);
  }
  const projectItem=path.match(/^\/v1\/projects\/([^/]+)\/items$/);
  if(projectItem&&UUID.test(projectItem[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),title=typeof b.title==='string'?b.title.trim():'',phase=b.phase_id||null;
   if(!['phase','task','deliverable','milestone'].includes(b.kind)||(b.kind==='phase'?phase!==null:!UUID.test(phase||''))||!title||title.length>120||!validReportRange(b.planned_on,b.planned_on)||!validReportRange(b.due_on,b.due_on)||b.due_on<b.planned_on)fail(400,'Confira etapa, tipo, título e datas.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.project_add_item($1::uuid,$2::uuid,$3,$4,$5::date,$6::date,$7::uuid)",[projectItem[1],phase,b.kind,title,b.planned_on,b.due_on,op],true);if(!r.rows.length)fail(409,'Planejamento encerrado, datas ou etapa incompatíveis.');return send({item:r.rows[0]},201);
  }
  const projectDep=path.match(/^\/v1\/projects\/([^/]+)\/dependencies$/);
  if(projectDep&&UUID.test(projectDep[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b);if(![b.predecessor_id,b.successor_id].every(x=>typeof x==='string'&&UUID.test(x))||b.confirmed!==true)fail(400,'Confirme predecessora e sucessora.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.project_add_dependency($1::uuid,$2::uuid,$3::uuid,$4::uuid)",[projectDep[1],b.predecessor_id,b.successor_id,op],true);if(!r.rows.length)fail(409,'Dependência inválida, duplicada ou datas incompatíveis.');return send({item:r.rows[0]},201);
  }
  const projectEvent=path.match(/^\/v1\/(projects|project-items)\/([^/]+)\/events$/);
  if(projectEvent&&UUID.test(projectEvent[2])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!['active','in_progress','completed','cancelled'].includes(b.status)||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme situação e justificativa.');
   const r=await execute(sql,tenant,user,projectEvent[1]==='projects'?"SELECT * FROM business.project_change($1::uuid,$2,$3,$4::uuid)":"SELECT * FROM business.project_change_item($1::uuid,$2,$3,$4::uuid)",[projectEvent[2],b.status,reason,op],true);if(!r.rows.length)fail(409,'Transição inválida, dependência ou item pendente.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/operations'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('admin',business.hr_admin($1::uuid),'actor_id',$2::uuid,'companies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.party_id,'name',p.legal_name,'allowed',business.ops_allowed(c.tenant_id,c.party_id)) ORDER BY p.legal_name) FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND (business.hr_admin(c.tenant_id) OR business.ops_allowed(c.tenant_id,c.party_id))),'[]'::jsonb),'grants',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT id,company_id,user_id,reason,created_at,revoked_at FROM business.ops_grants WHERE tenant_id=$1::uuid AND business.hr_admin(tenant_id) ORDER BY created_at DESC LIMIT 500)x),'[]'::jsonb)) AS data`,[tenant,user]);return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/operations/grants'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(![b.company_id,b.user_id].every(x=>typeof x==='string'&&UUID.test(x))||!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme destinatário, empresa e justificativa.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.ops_grants(tenant_id,company_id,user_id,reason,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid WHERE business.hr_admin($1::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,b.company_id,b.user_id,reason,op,user],true);if(r.role!=='owner')fail(403,'Concessão restrita ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível.');return send({item:r.rows[0]},201);
  }
  const opsGrantRevoke=path.match(/^\/v1\/operations\/grants\/([^/]+)\/revoke$/);
  if(opsGrantRevoke&&UUID.test(opsGrantRevoke[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme revogação e justificativa.');
   const r=await execute(sql,tenant,user,"UPDATE business.ops_grants SET revoked_at=now(),revoked_by=$3::uuid,revoke_reason=$4,revoke_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) RETURNING id",[tenant,opsGrantRevoke[1],user,reason,op],true);if(r.role!=='owner')fail(403,'Concessão restrita ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/operations/customers'&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company'),q=(u.searchParams.get('q')||'').trim();if(!UUID.test(company||'')||q.length<2||q.length>80)fail(400,'Informe empresa e ao menos dois caracteres.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (SELECT id,legal_name AS name FROM core.parties WHERE tenant_id=$1::uuid AND status='active' AND business.ops_allowed($1::uuid,$2::uuid) AND strpos(lower(legal_name),lower($3))>0 ORDER BY legal_name LIMIT 50)x),'[]'::jsonb)) AS data`,[tenant,company,q]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/records'&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.ops_allowed($1::uuid,$2::uuid),'catalog',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT id,code,title,description,estimated_minutes,retired_at,retire_reason FROM business.ops_catalog WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY code LIMIT 500)x),'[]'::jsonb),'orders',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT o.id,o.service_id,o.reference,o.title,o.description,o.planned_on::text AS planned_on,o.due_on::text AS due_on,o.created_at,p.legal_name AS customer_name,business.ops_order_status(o.id) AS status,(SELECT count(*) FROM business.ops_tasks t WHERE t.tenant_id=o.tenant_id AND t.order_id=o.id) AS task_count FROM business.ops_orders o JOIN core.parties p ON p.tenant_id=o.tenant_id AND p.id=o.customer_id WHERE o.tenant_id=$1::uuid AND o.company_id=$2::uuid ORDER BY o.created_at DESC,o.id LIMIT 100)x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão operacional necessária.');return send(r.rows[0].data);
  }
  const opsDetail=path.match(/^\/v1\/operations\/orders\/([^/]+)$/);
  if(opsDetail&&UUID.test(opsDetail[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('id',o.id,'status',business.ops_order_status(o.id),'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',e.status,'reason',e.reason,'created_at',e.created_at) ORDER BY e.seq) FROM business.ops_order_events e WHERE e.tenant_id=o.tenant_id AND e.order_id=o.id),'[]'::jsonb),'tasks',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.planned_on,x.id) FROM (SELECT t.id,t.title,t.planned_on::text AS planned_on,t.due_on::text AS due_on,t.estimated_minutes,business.ops_task_status(t.id) AS status,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',e.status,'reason',e.reason,'created_at',e.created_at) ORDER BY e.seq) FROM business.ops_task_events e WHERE e.tenant_id=t.tenant_id AND e.task_id=t.id),'[]'::jsonb) AS events FROM business.ops_tasks t WHERE t.tenant_id=o.tenant_id AND t.order_id=o.id ORDER BY t.planned_on,t.id LIMIT 500)x),'[]'::jsonb)) AS data FROM business.ops_orders o WHERE o.tenant_id=$1::uuid AND o.id=$2::uuid`,[tenant,opsDetail[1]]);if(!r.rows.length)fail(404,'Ordem indisponível.');return send(r.rows[0].data);
  }
  if(path==='/v1/operations/catalog'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),code=typeof b.code==='string'?b.code.trim().toUpperCase():'',title=typeof b.title==='string'?b.title.trim():'',description=typeof b.description==='string'?b.description.trim():'';
   if(!UUID.test(b.company_id||'')||!/^[A-Z0-9_-]{1,30}$/.test(code)||!title||title.length>120||!description||description.length>500||!Number.isInteger(b.estimated_minutes)||b.estimated_minutes<1||b.estimated_minutes>525600)fail(400,'Confira os dados do serviço.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.ops_catalog(tenant_id,company_id,code,title,description,estimated_minutes,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,$5,$6::integer,$7::uuid,$8::uuid WHERE business.ops_allowed($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,b.company_id,code,title,description,b.estimated_minutes,op,user],true);if(!r.rows.length)fail(409,'Código ou autorização indisponível.');return send({item:r.rows[0]},201);
  }
  const opsRetire=path.match(/^\/v1\/operations\/catalog\/([^/]+)\/retire$/);
  if(opsRetire&&UUID.test(opsRetire[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>200||b.confirmed!==true)fail(400,'Confirme desativação e justificativa.');
   const r=await execute(sql,tenant,user,"UPDATE business.ops_catalog SET retired_at=now(),retired_by=$3::uuid,retire_reason=$4,retire_op=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND retired_at IS NULL AND business.ops_allowed(tenant_id,company_id) RETURNING id",[tenant,opsRetire[1],user,reason,op],true);if(!r.rows.length)fail(409,'Serviço indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/operations/orders'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'',title=typeof b.title==='string'?b.title.trim():'',description=typeof b.description==='string'?b.description.trim():'';
   if(![b.company_id,b.service_id,b.customer_id].every(x=>typeof x==='string'&&UUID.test(x))||!ref||ref.length>60||!title||title.length>120||!description||description.length>1000||!validReportRange(b.planned_on,b.due_on)||b.confirmed!==true)fail(400,'Confirme os dados e o período da ordem.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.ops_create_order($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::date,$8::date,$9::uuid)",[b.company_id,b.service_id,b.customer_id,ref,title,description,b.planned_on,b.due_on,op],true);if(!r.rows.length)fail(409,'Ordem, serviço ou autorização indisponível.');return send({item:r.rows[0]},201);
  }
  const opsTask=path.match(/^\/v1\/operations\/orders\/([^/]+)\/tasks$/);
  if(opsTask&&UUID.test(opsTask[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),title=typeof b.title==='string'?b.title.trim():'';
   if(!title||title.length>120||!validReportRange(b.planned_on,b.due_on)||!Number.isInteger(b.estimated_minutes)||b.estimated_minutes<1||b.estimated_minutes>525600)fail(400,'Confira atividade, estimativa e período.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.ops_add_task($1::uuid,$2,$3::date,$4::date,$5::integer,$6::uuid)",[opsTask[1],title,b.planned_on,b.due_on,b.estimated_minutes,op],true);if(!r.rows.length)fail(409,'Atividade fora do período, ordem encerrada ou autorização indisponível.');return send({item:r.rows[0]},201);
  }
  const opsEvent=path.match(/^\/v1\/operations\/(orders|tasks)\/([^/]+)\/events$/);
  if(opsEvent&&UUID.test(opsEvent[2])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!['planned','in_progress','completed','cancelled'].includes(b.status)||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme situação e justificativa.');
   const statement=opsEvent[1]==='orders'?"SELECT * FROM business.ops_change_order($1::uuid,$2,$3,$4::uuid)":"SELECT * FROM business.ops_change_task($1::uuid,$2,$3,$4::uuid)";
   const r=await execute(sql,tenant,user,statement,[opsEvent[2],b.status,reason,op],true);if(!r.rows.length)fail(409,'Transição inválida, atividades pendentes ou autorização indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/dp'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.hr_allowed($1::uuid,$2::uuid),
 'relationships',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.reference) FROM (SELECT r.id,r.reference,p.legal_name AS party_name,r.kind,r.start_on::text AS start_on,NOT EXISTS(SELECT 1 FROM business.hr_movements m WHERE m.tenant_id=r.tenant_id AND m.relationship_id=r.id AND m.kind='end') AS active FROM business.hr_relationships r JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=r.party_id WHERE r.tenant_id=$1::uuid AND r.company_id=$2::uuid ORDER BY r.reference LIMIT 500)x),'[]'::jsonb),
 'profiles',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.revision DESC) FROM (SELECT id,relationship_id,revision,effective_on::text AS effective_on,work_model,weekly_minutes,schedule_label,reference FROM business.dp_profiles WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY created_at DESC,id LIMIT 500)x),'[]'::jsonb),
 'assignments',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.start_on DESC) FROM (SELECT id,relationship_id,kind,label,reference,start_on::text AS start_on,closed_on::text AS closed_on,close_reason FROM business.dp_assignments WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY created_at DESC,id LIMIT 500)x),'[]'::jsonb),
 'absences',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.start_on DESC) FROM (SELECT id,relationship_id,kind,start_on::text AS start_on,end_on::text AS end_on,reference,resolved_on::text AS resolved_on,resolution FROM business.dp_absences WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY created_at DESC,id LIMIT 500)x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão específica de RH necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/dp/profiles'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),rel=b.relationship_id,date=b.effective_on,model=b.work_model,minutes=b.weekly_minutes===null||b.weekly_minutes===''?null:b.weekly_minutes,schedule=typeof b.schedule_label==='string'?b.schedule_label.trim():'',ref=typeof b.reference==='string'?b.reference.trim():'';
   if(!UUID.test(rel||'')||!validReportRange(date,date)||!['onsite','hybrid','remote','other'].includes(model)||(minutes!==null&&(!Number.isInteger(minutes)||minutes<0||minutes>10080))||!schedule||schedule.length>120||!ref||ref.length>120)fail(400,'Confira vínculo, data, jornada informada e referência.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.dp_add_profile($1::uuid,$2::date,$3,$4::integer,$5,$6,$7::uuid)",[rel,date,model,minutes,schedule,ref,op],true);if(!r.rows.length)fail(409,'Vínculo, autorização ou revisão indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/dp/assignments'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),rel=b.relationship_id,kind=b.kind,date=b.start_on,label=typeof b.label==='string'?b.label.trim():'',ref=typeof b.reference==='string'?b.reference.trim():'';
   if(!UUID.test(rel||'')||!['benefit','equipment'].includes(kind)||!validReportRange(date,date)||!label||label.length>120||!ref||ref.length>120)fail(400,'Confira vínculo, tipo, descrição, referência e data.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.dp_add_assignment($1::uuid,$2,$3,$4,$5::date,$6::uuid)",[rel,kind,label,ref,date,op],true);if(!r.rows.length)fail(409,'Vínculo, autorização ou registro duplicado.');return send({item:r.rows[0]},201);
  }
  const dpClose=path.match(/^\/v1\/dp\/assignments\/([^/]+)\/close$/);
  if(dpClose&&UUID.test(dpClose[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),date=b.closed_on,reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!validReportRange(date,date)||!reason||reason.length>200)fail(400,'Confira data e justificativa administrativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.dp_close_assignment($1::uuid,$2::date,$3,$4::uuid)",[dpClose[1],date,reason,op],true);if(!r.rows.length)fail(409,'Registro indisponível, encerrado ou data inválida.');return send({item:r.rows[0]});
  }
  if(path==='/v1/dp/absences'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),rel=b.relationship_id,kind=b.kind,start=b.start_on,end=b.end_on,ref=typeof b.reference==='string'?b.reference.trim():'';
   if(!UUID.test(rel||'')||!['vacation','administrative_leave'].includes(kind)||!validReportRange(start,end)||!ref||ref.length>120)fail(400,'Confira vínculo, período e referência administrativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.dp_add_absence($1::uuid,$2,$3::date,$4::date,$5,$6::uuid)",[rel,kind,start,end,ref,op],true);if(!r.rows.length)fail(409,'Período sobreposto, vínculo, autorização ou operação indisponível.');return send({item:r.rows[0]},201);
  }
  const dpResolve=path.match(/^\/v1\/dp\/absences\/([^/]+)\/resolve$/);
  if(dpResolve&&UUID.test(dpResolve[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b);if(!['completed','cancelled'].includes(b.resolution))fail(400,'Informe a resolução.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.dp_resolve_absence($1::uuid,$2,$3::uuid)",[dpResolve[1],b.resolution,op],true);if(!r.rows.length)fail(409,'Registro encerrado, indisponível ou período ainda não concluído.');return send({item:r.rows[0]});
  }
  if(path==='/v1/hr'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('admin',business.hr_admin($1::uuid),'companies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.party_id,'name',p.legal_name,'allowed',business.hr_allowed(c.tenant_id,c.party_id)) ORDER BY p.legal_name) FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND (business.hr_admin(c.tenant_id) OR business.hr_allowed(c.tenant_id,c.party_id))),'[]'::jsonb),'grants',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'company_id',g.company_id,'user_id',g.user_id,'reason',g.reason,'created_at',g.created_at,'revoked_at',g.revoked_at) ORDER BY g.created_at DESC) FROM (SELECT * FROM business.hr_access_grants WHERE tenant_id=$1::uuid AND business.hr_admin(tenant_id) ORDER BY created_at DESC LIMIT 500) g),'[]'::jsonb),'actor_id',$2::uuid) AS data`,[tenant,user]);return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/hr/grants'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),company=b.company_id,recipient=b.user_id,reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!UUID.test(company||'')||!UUID.test(recipient||'')||!reason||reason.length>300)fail(400,'Informe empresa, usuário Business e justificativa.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.hr_access_grants(tenant_id,company_id,user_id,reason,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid WHERE business.hr_admin($1::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,company,recipient,reason,op,user],true);
   if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão já registrada ou indisponível.');return send({item:r.rows[0]},201);
  }
  const hrRevoke=path.match(/^\/v1\/hr\/grants\/([^/]+)\/revoke$/);
  if(hrRevoke&&UUID.test(hrRevoke[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>300)fail(400,'Informe a justificativa.');
   const r=await execute(sql,tenant,user,"UPDATE business.hr_access_grants SET revoked_at=now(),revoked_by=$3::uuid,revocation_reason=$4,revocation_operation_id=$5::uuid WHERE tenant_id=$1::uuid AND id=$2::uuid AND revoked_at IS NULL AND business.hr_admin(tenant_id) RETURNING id",[tenant,hrRevoke[1],user,reason,op],true);
   if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível ou revogada.');return send({item:r.rows[0]});
  }
  if(path==='/v1/hr/records'&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company');if(!UUID.test(company||''))fail(400,'Selecione uma empresa.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.hr_allowed($1::uuid,$2::uuid),'positions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM (SELECT id,code,title,department FROM business.hr_positions WHERE tenant_id=$1::uuid AND company_id=$2::uuid ORDER BY code LIMIT 500) x),'[]'::jsonb),'relationships',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.reference) FROM (SELECT r.id,r.reference,r.kind,r.start_on::text AS start_on,p.legal_name AS party_name,r.position_id,COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',m.kind,'position_id',m.position_id,'effective_on',m.effective_on,'reason',m.reason) ORDER BY m.seq) FROM business.hr_movements m WHERE m.tenant_id=r.tenant_id AND m.relationship_id=r.id),'[]'::jsonb) AS movements FROM business.hr_relationships r JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=r.party_id WHERE r.tenant_id=$1::uuid AND r.company_id=$2::uuid ORDER BY r.reference LIMIT 500) x),'[]'::jsonb)) AS data`,[tenant,company]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão específica de RH necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/hr/parties'&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company'),q=(u.searchParams.get('q')||'').trim();if(!UUID.test(company||'')||q.length<2||q.length>80)fail(400,'Informe empresa e ao menos dois caracteres.');
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('allowed',business.hr_allowed($1::uuid,$2::uuid),'items',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.legal_name) FROM (SELECT id,legal_name,kind FROM core.parties WHERE tenant_id=$1::uuid AND status='active' AND business.hr_allowed($1::uuid,$2::uuid) AND strpos(lower(legal_name),lower($3))>0 ORDER BY legal_name LIMIT 50) x),'[]'::jsonb)) AS data`,[tenant,company,q]);if(r.rows[0]?.data?.allowed!==true)fail(403,'Concessão específica de RH necessária.');return send(r.rows[0].data);
  }
  if(path==='/v1/hr/positions'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),company=b.company_id,code=typeof b.code==='string'?b.code.trim().toUpperCase():'',title=typeof b.title==='string'?b.title.trim():'',department=typeof b.department==='string'?b.department.trim():'';
   if(!UUID.test(company||'')||!/^[A-Z0-9_-]{1,30}$/.test(code)||!title||title.length>120||!department||department.length>120)fail(400,'Confira empresa, código, cargo e setor.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.hr_positions(tenant_id,company_id,code,title,department,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid WHERE business.hr_allowed($1::uuid,$2::uuid) ON CONFLICT DO NOTHING RETURNING id",[tenant,company,code,title,department,op,user],true);if(!r.rows.length)fail(409,'Acesso, código ou operação indisponível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/hr/relationships'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),company=b.company_id,party=b.party_id,position=b.position_id,reference=typeof b.reference==='string'?b.reference.trim():'',kind=b.kind,date=b.start_on;
   if(![company,party,position].every(x=>typeof x==='string'&&UUID.test(x))||!reference||reference.length>60||!['clt','intern','apprentice','self_employed','pj','partner','outsourced','representative','volunteer'].includes(kind)||!validReportRange(date,date))fail(400,'Confira empresa, pessoa, cargo, referência, vínculo e data.');
   const r=await execute(sql,tenant,user,"INSERT INTO business.hr_relationships(tenant_id,company_id,party_id,position_id,reference,kind,start_on,operation_id,created_by) SELECT $1::uuid,$2::uuid,p.id,h.id,$5,$6,$7::date,$8::uuid,$9::uuid FROM core.parties p JOIN business.hr_positions h ON h.tenant_id=p.tenant_id AND h.id=$4::uuid AND h.company_id=$2::uuid WHERE p.tenant_id=$1::uuid AND p.id=$3::uuid AND p.status='active' AND business.hr_allowed($1::uuid,$2::uuid) AND $7::date<=(now() AT TIME ZONE 'America/Fortaleza')::date AND (($6='pj' AND p.kind='PJ') OR ($6 IN ('clt','intern','apprentice','self_employed','volunteer') AND p.kind='PF') OR $6 IN ('partner','outsourced','representative')) ON CONFLICT DO NOTHING RETURNING id",[tenant,company,party,position,reference,kind,date,op,user],true);if(!r.rows.length)fail(409,'Vínculo, cargo, pessoa ou autorização indisponível.');return send({item:r.rows[0]},201);
  }
  const hrMove=path.match(/^\/v1\/hr\/relationships\/([^/]+)\/movements$/);
  if(hrMove&&UUID.test(hrMove[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),kind=b.kind,position=b.position_id||null,date=b.effective_on,reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!['position','end'].includes(kind)||(kind==='position'?!UUID.test(position||''):position!==null)||!validReportRange(date,date)||!reason||reason.length>300)fail(400,'Confira movimentação, data e justificativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.add_hr_movement($1::uuid,$2,$3::uuid,$4::date,$5,$6::uuid)",[hrMove[1],kind,position,date,reason,op],true);if(!r.rows.length)fail(409,'Movimentação inválida, duplicada ou sem autorização.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/management-indicators'&&request.method==='GET'){
   const u=new URL(request.url),company=u.searchParams.get('company')||null,start=u.searchParams.get('start'),end=u.searchParams.get('end');
   if(company&&!UUID.test(company))fail(400,'Empresa inválida.');
   if(!validReportRange(start,end))fail(400,'Informe um período válido de até 366 dias.');
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today), range_dates AS (SELECT $3::date AS start_on,$4::date AS end_on),
 companies AS (SELECT p.id,p.legal_name AS name FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id WHERE b.tenant_id=$1::uuid),
 orders AS (SELECT o.id,o.total,o.created_at,p.seller_id AS company_id FROM business.commercial_orders o JOIN business.proposals p ON p.tenant_id=o.tenant_id AND p.id=o.proposal_id WHERE o.tenant_id=$1::uuid AND ($2::uuid IS NULL OR p.seller_id=$2::uuid)),
 installments AS (SELECT o.company_id,o.direction,i.remaining,i.due_on FROM business.financial_installments i JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id WHERE i.tenant_id=$1::uuid AND ($2::uuid IS NULL OR o.company_id=$2::uuid)),
 settlements AS (SELECT o.direction,s.cash_amount,s.settled_on FROM business.financial_settlements s JOIN business.financial_installments i ON i.tenant_id=s.tenant_id AND i.id=s.installment_id JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id WHERE s.tenant_id=$1::uuid AND ($2::uuid IS NULL OR o.company_id=$2::uuid) AND NOT EXISTS(SELECT 1 FROM business.financial_reversals r WHERE r.tenant_id=s.tenant_id AND r.settlement_id=s.id)),
 months AS (SELECT generate_series(date_trunc('month',(SELECT start_on FROM range_dates)),date_trunc('month',(SELECT end_on FROM range_dates)),interval '1 month')::date AS month_start),
 series AS (SELECT to_char(m.month_start,'YYYY-MM') AS month,
 (SELECT count(*) FROM orders o WHERE (o.created_at AT TIME ZONE 'America/Fortaleza')::date BETWEEN GREATEST(m.month_start,d.start_on) AND LEAST((m.month_start+interval '1 month -1 day')::date,d.end_on)) AS orders,
 (SELECT COALESCE(sum(o.total),0)::text FROM orders o WHERE (o.created_at AT TIME ZONE 'America/Fortaleza')::date BETWEEN GREATEST(m.month_start,d.start_on) AND LEAST((m.month_start+interval '1 month -1 day')::date,d.end_on)) AS order_value,
 (SELECT COALESCE(sum(x.cash_amount),0)::text FROM settlements x WHERE x.direction='receivable' AND x.settled_on BETWEEN GREATEST(m.month_start,d.start_on) AND LEAST((m.month_start+interval '1 month -1 day')::date,d.end_on)) AS received,
 (SELECT COALESCE(sum(x.cash_amount),0)::text FROM settlements x WHERE x.direction='payable' AND x.settled_on BETWEEN GREATEST(m.month_start,d.start_on) AND LEAST((m.month_start+interval '1 month -1 day')::date,d.end_on)) AS paid FROM months m CROSS JOIN range_dates d)
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM companies c),'[]'::jsonb),'series',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.month) FROM series s),'[]'::jsonb),'scope_valid',($2::uuid IS NULL OR EXISTS(SELECT 1 FROM companies WHERE id=$2::uuid)),
 'receivable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='receivable' AND remaining>0),
 'payable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='payable' AND remaining>0),
 'overdue_receivable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='receivable' AND remaining>0 AND due_on<(SELECT today FROM clock)),
 'overdue_payable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='payable' AND remaining>0 AND due_on<(SELECT today FROM clock))) AS data`,[tenant,company,start,end]);if(r.role!=='owner')fail(403,'Indicadores restritos ao proprietário.');const data=r.rows[0]?.data;if(!data?.scope_valid)fail(404,'Empresa não disponível.');return send(data);
  }
  if(path==='/v1/business-integrity'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('as_of',(now() AT TIME ZONE 'America/Fortaleza')::date::text,
 'orders_without_contract',(SELECT count(*) FROM business.commercial_orders o WHERE o.tenant_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM business.contracts c WHERE c.tenant_id=o.tenant_id AND c.order_id=o.id)),
 'active_contracts_without_obligation',(SELECT count(*) FROM business.contracts c WHERE c.tenant_id=$1::uuid AND c.status='active' AND NOT EXISTS(SELECT 1 FROM business.financial_obligations f WHERE f.tenant_id=c.tenant_id AND f.contract_id=c.id)),
 'matched_receipts_without_obligation',(SELECT count(*) FROM business.purchase_receipts r WHERE r.tenant_id=$1::uuid AND r.status='matched' AND NOT EXISTS(SELECT 1 FROM business.financial_obligations f WHERE f.tenant_id=r.tenant_id AND f.purchase_receipt_id=r.id)),
 'stale_contract_revision',(SELECT count(*) FROM business.financial_obligations f JOIN business.contracts c ON c.tenant_id=f.tenant_id AND c.id=f.contract_id WHERE f.tenant_id=$1::uuid AND f.contract_revision IS DISTINCT FROM c.revision),
 'publications_with_revoked_grant',(SELECT count(*) FROM business.portal_publications p JOIN business.portal_grants g ON g.tenant_id=p.tenant_id AND g.id=p.grant_id WHERE p.tenant_id=$1::uuid AND p.revoked_at IS NULL AND g.revoked_at IS NOT NULL),
 'connect_failed',(SELECT count(*) FROM business.connect_events WHERE tenant_id=$1::uuid AND status='failed'),
 'active_memberships',(SELECT count(*) FROM business.tenant_memberships WHERE tenant_id=$1::uuid AND active),
 'audit_events',(SELECT count(*) FROM business.audit_events WHERE tenant_id=$1::uuid),
 'recent_portal_audit',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM (SELECT entity_type,action,created_at FROM business.audit_events WHERE tenant_id=$1::uuid AND entity_type IN ('portal_grant','portal_publication','accounting_pendency') ORDER BY created_at DESC,id DESC LIMIT 30) a),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Integridade restrita ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/business-flows'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('commercial',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.order_code DESC) FROM (SELECT o.code AS order_code,p.code AS proposal_code,c.code AS contract_code,c.status AS contract_status,o.total::text AS order_total,(SELECT count(*) FROM business.financial_obligations f WHERE f.tenant_id=c.tenant_id AND f.contract_id=c.id) AS obligations,(SELECT count(*) FROM business.license_rights l WHERE l.tenant_id=c.tenant_id AND l.contract_id=c.id) AS rights FROM business.commercial_orders o JOIN business.proposals p ON p.tenant_id=o.tenant_id AND p.id=o.proposal_id LEFT JOIN business.contracts c ON c.tenant_id=o.tenant_id AND c.order_id=o.id WHERE o.tenant_id=$1::uuid ORDER BY o.code DESC LIMIT 100) x),'[]'::jsonb),
 'purchases',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.receipt_code DESC) FROM (SELECT r.code AS receipt_code,o.code AS order_code,q.code AS request_code,r.status AS receipt_status,r.expected_total::text AS expected_total,(SELECT count(*) FROM business.financial_obligations f WHERE f.tenant_id=r.tenant_id AND f.purchase_receipt_id=r.id) AS obligations FROM business.purchase_receipts r JOIN business.purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id JOIN business.purchase_requests q ON q.tenant_id=o.tenant_id AND q.id=o.request_id WHERE r.tenant_id=$1::uuid ORDER BY r.code DESC LIMIT 100) x),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Fluxos restritos ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/business-settings'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT jsonb_build_object('tenant',(SELECT jsonb_build_object('name',t.name,'code',t.code,'status',t.status) FROM business.tenants t WHERE t.id=$1::uuid),'roles',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.role) FROM (SELECT role,count(*) FILTER(WHERE active) AS active,count(*) FILTER(WHERE NOT active) AS inactive FROM business.tenant_memberships WHERE tenant_id=$1::uuid GROUP BY role) x),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Administração restrita ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/executive-dashboard'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 installments AS (SELECT o.direction,i.remaining,i.due_on FROM business.financial_installments i JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id WHERE i.tenant_id=$1::uuid),
 service_states AS (SELECT c.id,COALESCE((SELECT u.status FROM business.portal_service_updates u WHERE u.tenant_id=c.tenant_id AND u.case_id=c.id ORDER BY u.seq DESC LIMIT 1),'requested') AS status FROM business.portal_service_cases c JOIN business.portal_grants g ON g.tenant_id=c.tenant_id AND g.id=c.grant_id WHERE c.tenant_id=$1::uuid AND g.revoked_at IS NULL AND (SELECT today FROM clock) BETWEEN g.valid_from AND g.valid_until)
 SELECT jsonb_build_object(
 'as_of',(SELECT today::text FROM clock),
 'companies',(SELECT count(*) FROM business.companies WHERE tenant_id=$1::uuid),
 'open_opportunities',(SELECT count(*) FROM business.opportunities WHERE tenant_id=$1::uuid AND stage NOT IN ('won','lost')),
 'pipeline_value',(SELECT COALESCE(sum(estimated_value),0)::text FROM business.opportunities WHERE tenant_id=$1::uuid AND stage NOT IN ('won','lost')),
 'active_contracts',(SELECT count(*) FROM business.contracts WHERE tenant_id=$1::uuid AND status='active' AND valid_from<=(SELECT today FROM clock) AND (valid_until IS NULL OR valid_until>=(SELECT today FROM clock))),
 'receivable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='receivable' AND remaining>0),
 'payable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='payable' AND remaining>0),
 'overdue_receivable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='receivable' AND remaining>0 AND due_on<(SELECT today FROM clock)),
 'overdue_payable',(SELECT COALESCE(sum(remaining),0)::text FROM installments WHERE direction='payable' AND remaining>0 AND due_on<(SELECT today FROM clock)),
 'purchase_approval',(SELECT count(*) FROM business.purchase_requests WHERE tenant_id=$1::uuid AND status='submitted'),
 'assets',(SELECT count(*) FROM business.assets WHERE tenant_id=$1::uuid),
 'stock_movements',(SELECT count(*) FROM business.stock_movements WHERE tenant_id=$1::uuid),
 'fiscal_documents',(SELECT count(*) FROM business.fiscal_documents WHERE tenant_id=$1::uuid),
 'accounting_open',(SELECT count(*) FROM business.accounting_pendencies p JOIN business.portal_grants g ON g.tenant_id=p.tenant_id AND g.id=p.grant_id WHERE p.tenant_id=$1::uuid AND p.closed_at IS NULL AND g.revoked_at IS NULL AND (SELECT today FROM clock) BETWEEN g.valid_from AND g.valid_until),
 'portal_grants',(SELECT count(*) FROM business.portal_grants WHERE tenant_id=$1::uuid AND revoked_at IS NULL AND (SELECT today FROM clock) BETWEEN valid_from AND valid_until),
 'services_open',(SELECT count(*) FROM service_states WHERE status NOT IN ('completed','cancelled')),
 'connect_queued',(SELECT count(*) FROM business.connect_events WHERE tenant_id=$1::uuid AND status='queued'),
 'connect_failed',(SELECT count(*) FROM business.connect_events WHERE tenant_id=$1::uuid AND status='failed')
 ) AS dashboard`,[tenant]);if(r.role!=='owner')fail(403,'Painel executivo restrito ao proprietário.');return send(r.rows[0]?.dashboard||{});
  }
  if(path==='/v1/service-portal'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH grants AS (SELECT g.id,g.company_id,g.party_id,co.legal_name AS company_name,pa.legal_name AS party_name,g.user_id FROM business.portal_grants g JOIN core.parties co ON co.tenant_id=g.tenant_id AND co.id=g.company_id JOIN core.parties pa ON pa.tenant_id=g.tenant_id AND pa.id=g.party_id WHERE g.tenant_id=$1::uuid AND g.portal_role='customer' AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until),
   contracts AS (SELECT c.id,c.code::text AS code,c.seller_id,c.customer_id,c.status FROM business.contracts c WHERE c.tenant_id=$1::uuid),
   cases AS (SELECT c.id,c.grant_id,c.contract_reference,c.origin,c.title,c.description,c.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('seq',u.seq,'status',u.status,'message',u.message,'created_at',u.created_at) ORDER BY u.seq) FROM business.portal_service_updates u WHERE u.tenant_id=c.tenant_id AND u.case_id=c.id),'[]'::jsonb) AS updates FROM business.portal_service_cases c WHERE c.tenant_id=$1::uuid ORDER BY c.created_at DESC,c.id LIMIT 500)
   SELECT jsonb_build_object('grants',COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.company_name,g.party_name) FROM grants g),'[]'::jsonb),'contracts',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code) FROM contracts c WHERE EXISTS(SELECT 1 FROM grants g WHERE g.company_id=c.seller_id AND g.party_id=c.customer_id)),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC,c.id) FROM cases c),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Serviços externos restritos ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/service-portal'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),title=typeof b.title==='string'?b.title.trim():'',description=typeof b.description==='string'?b.description.trim():'',contract=b.contract_id||null;
   if(typeof b.grant_id!=='string'||!UUID.test(b.grant_id)||(contract&&(typeof contract!=='string'||!UUID.test(contract)))||!title||title.length>200||!description||description.length>1500)fail(400,'Confira concessão, contrato, título e descrição.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.create_portal_service_case($1::uuid,$2::uuid,$3,$4,$5::uuid,'owner')",[b.grant_id,contract,title,description,op],true);if(r.role!=='owner')fail(403,'Serviços externos restritos ao proprietário.');if(!r.rows.length)fail(409,'Concessão, contrato ou operação indisponível.');return send({item:r.rows[0]},201);
  }
  const serviceUpdateMatch=path.match(/^\/v1\/service-portal\/([^/]+)\/updates$/);
  if(serviceUpdateMatch&&UUID.test(serviceUpdateMatch[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),message=typeof b.message==='string'?b.message.trim():'';
   if(!['accepted','in_progress','waiting_customer','completed','cancelled'].includes(b.status)||!message||message.length>1500)fail(400,'Informe situação e mensagem compartilhável.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.add_portal_service_update($1::uuid,$2,$3,$4::uuid)",[serviceUpdateMatch[1],b.status,message,op],true);if(r.role!=='owner')fail(403,'Serviços externos restritos ao proprietário.');if(!r.rows.length)fail(409,'Transição inválida ou atualização duplicada.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/connect/events'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT e.id,e.source,e.event_type,e.event_key,e.entity_id,e.reference,e.status,e.attempt,e.created_at,e.updated_at,e.result_reference FROM business.connect_events e WHERE e.tenant_id=$1::uuid ORDER BY e.created_at DESC,e.id LIMIT 500",[tenant]);if(r.role!=='owner')fail(403,'AnnA Connect restrito ao proprietário.');return send({items:r.rows,limit:500,automatic_delivery:false});
  }
  if(path==='/v1/connect/events'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),source=b.source,type=b.event_type,key=typeof b.event_key==='string'?b.event_key.trim():'',reference=typeof b.reference==='string'?b.reference.trim():'',entity=b.entity_id||null;
   if(!['master','service_desk','teamhub','accounting','payments','mail','other'].includes(source)||typeof type!=='string'||!/^[a-z][a-z0-9_.-]{1,79}$/.test(type)||!key||key.length>180||!reference||reference.length>200||(entity&&(typeof entity!=='string'||!UUID.test(entity))))fail(400,'Informe origem, tipo, chave idempotente e referência sem dados sensíveis.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.enqueue_connect_event($1,$2,$3,$4::uuid,$5,$6::uuid)",[source,type,key,entity,reference,op],true);if(r.role!=='owner')fail(403,'AnnA Connect restrito ao proprietário.');if(!r.rows.length)fail(409,'Chave ou operação já registrada.');return send({item:r.rows[0]},201);
  }
  const connectHistory=path.match(/^\/v1\/connect\/events\/([^/]+)\/history$/);
  if(connectHistory&&UUID.test(connectHistory[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT a.id,a.action,a.attempt,a.note,a.operation_id,a.created_at FROM business.connect_event_actions a WHERE a.tenant_id=$1::uuid AND a.event_id=$2::uuid ORDER BY a.created_at,a.id",[tenant,connectHistory[1]]);if(r.role!=='owner')fail(403,'AnnA Connect restrito ao proprietário.');return send({items:r.rows});
  }
  const connectTransition=path.match(/^\/v1\/connect\/events\/([^/]+)\/transition$/);
  if(connectTransition&&UUID.test(connectTransition[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),note=typeof b.note==='string'?b.note.trim():'';
   if(!['fail','retry','reconcile'].includes(b.action)||!note||note.length>300)fail(400,'Informe ação e referência/justificativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.transition_connect_event($1::uuid,$2,$3,$4::uuid)",[connectTransition[1],b.action,note,op],true);if(r.role!=='owner')fail(403,'AnnA Connect restrito ao proprietário.');if(!r.rows.length)fail(409,'Transição inválida, operação duplicada ou evento indisponível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/accounting-pendencies'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT p.id,p.grant_id,p.competence::text AS competence,p.title,p.description,p.due_on::text AS due_on,p.closed_at,p.closure_reason,p.created_at,g.revoked_at AS grant_revoked_at FROM business.accounting_pendencies p JOIN business.portal_grants g ON g.tenant_id=p.tenant_id AND g.id=p.grant_id WHERE p.tenant_id=$1::uuid ORDER BY p.competence DESC,p.created_at DESC,p.id LIMIT 500",[tenant]);if(r.role!=='owner')fail(403,'Central contábil restrita ao proprietário.');return send({items:r.rows,limit:500});
  }
  if(path==='/v1/accounting-pendencies'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),title=typeof b.title==='string'?b.title.trim():'',description=typeof b.description==='string'?b.description.trim():'',competence=b.competence||'',due=b.due_on||null;
   if(typeof b.grant_id!=='string'||!UUID.test(b.grant_id)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)||!title||title.length>200||!description||description.length>1000||(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due)))fail(400,'Confira concessão, competência, descrição e prazo.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.create_accounting_pendency($1::uuid,$2::date,$3,$4,$5::date,$6::uuid)",[b.grant_id,competence+'-01',title,description,due,op],true);if(r.role!=='owner')fail(403,'Central contábil restrita ao proprietário.');if(!r.rows.length)fail(409,'Concessão indisponível ou operação duplicada.');return send({item:r.rows[0]},201);
  }
  const accountingClose=path.match(/^\/v1\/accounting-pendencies\/([^/]+)\/close$/);
  if(accountingClose&&UUID.test(accountingClose[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>500)fail(400,'Informe a justificativa do encerramento.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.close_accounting_pendency($1::uuid,$2,$3::uuid)",[accountingClose[1],reason,op],true);if(r.role!=='owner')fail(403,'Central contábil restrita ao proprietário.');if(!r.rows.length)fail(409,'Pendência inexistente ou já encerrada.');return send({item:r.rows[0]});
  }
  if(path==='/v1/portal-publications'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH grants AS (SELECT g.id,g.company_id,g.party_id,g.user_id,g.portal_role,co.legal_name AS company_name,pa.legal_name AS party_name,g.valid_until::text AS valid_until FROM business.portal_grants g JOIN core.parties co ON co.tenant_id=g.tenant_id AND co.id=g.company_id JOIN core.parties pa ON pa.tenant_id=g.tenant_id AND pa.id=g.party_id AND pa.status='active' WHERE g.tenant_id=$1::uuid AND g.revoked_at IS NULL AND (now() AT TIME ZONE 'America/Fortaleza')::date BETWEEN g.valid_from AND g.valid_until),
   versions AS (SELECT v.id,d.company_id,d.party_id,d.category,d.title,d.reference,v.version_no,v.filename,v.size_bytes FROM business.document_versions v JOIN business.documents d ON d.tenant_id=v.tenant_id AND d.id=v.document_id WHERE v.tenant_id=$1::uuid),
   history AS (SELECT p.id,p.grant_id,p.company_name,p.party_name,g.portal_role,p.title,p.category,p.reference,p.version_no,p.filename,p.size_bytes,p.sha256_hex,p.reason,p.accounting_competence::text AS accounting_competence,p.accounting_kind,p.created_at,p.revoked_at,p.revocation_reason,CASE WHEN p.revoked_at IS NOT NULL THEN 'revoked' WHEN g.revoked_at IS NOT NULL OR (now() AT TIME ZONE 'America/Fortaleza')::date NOT BETWEEN g.valid_from AND g.valid_until THEN 'unavailable' ELSE 'active' END AS status FROM business.portal_publications p JOIN business.portal_grants g ON g.tenant_id=p.tenant_id AND g.id=p.grant_id WHERE p.tenant_id=$1::uuid)
   SELECT jsonb_build_object('grants',COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.company_name,g.party_name,g.id) FROM grants g),'[]'::jsonb),'versions',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.title,v.version_no DESC) FROM versions v),'[]'::jsonb),'history',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC,h.id) FROM history h),'[]'::jsonb),'used_bytes',COALESCE((SELECT sum(size_bytes) FROM history),0)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Publicações restritas ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/portal-publications'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(![b.grant_id,b.version_id].every(v=>typeof v==='string'&&UUID.test(v))||!reason||reason.length>500)fail(400,'Confira concessão, versão e justificativa.');
   const competence=b.accounting_competence||'',kind=b.accounting_kind||'';
   if((competence||kind)&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)||!['document','statement','reconciliation','pending'].includes(kind)))fail(400,'Informe competência e classificação contábil válidas.');
   const r=competence?await execute(sql,tenant,user,"SELECT * FROM business.publish_accounting_document($1::uuid,$2::uuid,$3,$4::uuid,$5::date,$6)",[b.grant_id,b.version_id,reason,op,competence+'-01',kind],true):await execute(sql,tenant,user,"SELECT * FROM business.publish_portal_document($1::uuid,$2::uuid,$3,$4::uuid)",[b.grant_id,b.version_id,reason,op],true);if(r.role!=='owner')fail(403,'Publicações restritas ao proprietário.');if(!r.rows.length)fail(409,'Versão ou concessão incompatível, publicação duplicada ou limite atingido.');return send({item:r.rows[0]},201);
  }
  const ppMatch=path.match(/^\/v1\/portal-publications\/([^/]+)\/revoke$/);
  if(ppMatch&&UUID.test(ppMatch[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>500)fail(400,'Justificativa obrigatória.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.revoke_portal_document($1::uuid,$2,$3::uuid)",[ppMatch[1],reason,op],true);if(r.role!=='owner')fail(403,'Publicações restritas ao proprietário.');if(!r.rows.length)fail(409,'Publicação inexistente ou já revogada.');return send({item:r.rows[0]});
  }
  if(path==='/v1/portal-grants'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND p.status='active'),
   parties AS (SELECT p.id,p.legal_name AS name,ARRAY(SELECT r.role FROM business.party_roles r WHERE r.tenant_id=p.tenant_id AND r.party_id=p.id AND r.active) AS roles FROM core.parties p WHERE p.tenant_id=$1::uuid AND p.status='active'),
   grants AS (SELECT g.id,g.company_id,co.legal_name AS company_name,g.party_id,pa.legal_name AS party_name,g.user_id,g.portal_role,g.valid_from::text AS valid_from,g.valid_until::text AS valid_until,g.reason,g.revoked_at,g.revocation_reason,CASE WHEN g.revoked_at IS NOT NULL THEN 'revoked' WHEN g.valid_until<(now() AT TIME ZONE 'America/Fortaleza')::date THEN 'expired' WHEN g.valid_from>(now() AT TIME ZONE 'America/Fortaleza')::date THEN 'future' ELSE 'active' END AS status FROM business.portal_grants g JOIN core.parties co ON co.tenant_id=g.tenant_id AND co.id=g.company_id JOIN core.parties pa ON pa.tenant_id=g.tenant_id AND pa.id=g.party_id WHERE g.tenant_id=$1::uuid)
   SELECT jsonb_build_object('companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM companies c),'[]'::jsonb),'parties',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM parties p),'[]'::jsonb),'grants',COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.valid_from DESC,g.id) FROM grants g),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/portal-grants'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),from=crmDate(b.valid_from),until=crmDate(b.valid_until),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(![b.company_id,b.party_id,b.user_id].every(v=>typeof v==='string'&&UUID.test(v))||!['customer','accountant'].includes(b.portal_role)||!from||!until||until<from||!reason||reason.length>500)fail(400,'Confira identidade, escopo, vigência e justificativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.create_portal_grant($1::uuid,$2::uuid,$3::uuid,$4,$5::date,$6::date,$7,$8::uuid)",[b.company_id,b.party_id,b.user_id,b.portal_role,from,until,reason,op],true);if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão duplicada ou vínculo inválido.');return send({item:r.rows[0]},201);
  }
  const pgMatch=path.match(/^\/v1\/portal-grants\/([^/]+)\/revoke$/);
  if(pgMatch&&UUID.test(pgMatch[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>500)fail(400,'Justificativa obrigatória.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.revoke_portal_grant($1::uuid,$2,$3::uuid)",[pgMatch[1],reason,op],true);if(r.role!=='owner')fail(403,'Concessões restritas ao proprietário.');if(!r.rows.length)fail(409,'Concessão inexistente ou já revogada.');return send({item:r.rows[0]});
  }
  if(path==='/v1/patrimony-dashboard'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid),
 assets AS (SELECT a.id,a.company_id,a.tag,a.title,a.ownership,a.acquisition_value,COALESCE(m.condition,a.condition) AS condition,CASE WHEN e.kind='maintenance_start' THEN 'maintenance' WHEN e.kind IN ('retired','returned') THEN e.kind ELSE 'active' END AS state FROM business.assets a LEFT JOIN LATERAL(SELECT m.condition FROM business.asset_movements m WHERE m.tenant_id=a.tenant_id AND m.asset_id=a.id ORDER BY m.revision DESC LIMIT 1) m ON true LEFT JOIN LATERAL(SELECT e.kind FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id AND e.kind<>'warranty' ORDER BY e.revision DESC LIMIT 1) e ON true WHERE a.tenant_id=$1::uuid),
 warranties AS (SELECT a.company_id,a.tag,a.title,e.provider,e.reference,e.warranty_until::text AS due_on FROM assets a JOIN business.asset_lifecycle_events e ON e.tenant_id=$1::uuid AND e.asset_id=a.id CROSS JOIN clock WHERE a.state IN ('active','maintenance') AND e.kind='warranty' AND e.warranty_from<=clock.today AND e.warranty_until BETWEEN clock.today AND clock.today+30),
 products AS (SELECT p.id,p.company_id,p.sku,p.name,p.unit,p.tracking,i.status AS catalog_status,i.unit AS catalog_unit FROM business.stock_products p JOIN business.catalog_items i ON i.tenant_id=p.tenant_id AND i.id=p.catalog_item_id WHERE p.tenant_id=$1::uuid),
 warehouses AS (SELECT w.id,w.company_id,w.code,w.name,e.status AS establishment_status FROM business.warehouses w JOIN core.establishments e ON e.tenant_id=w.tenant_id AND e.id=w.establishment_id WHERE w.tenant_id=$1::uuid),
 legs AS (SELECT product_id,destination_warehouse_id AS warehouse_id,trace_key,quantity FROM business.stock_movements WHERE tenant_id=$1::uuid AND destination_warehouse_id IS NOT NULL UNION ALL SELECT product_id,source_warehouse_id,trace_key,-quantity FROM business.stock_movements WHERE tenant_id=$1::uuid AND source_warehouse_id IS NOT NULL),
 balances AS (SELECT product_id,warehouse_id,trace_key,sum(quantity) AS quantity FROM legs GROUP BY product_id,warehouse_id,trace_key HAVING sum(quantity)<>0),
 stock_rows AS (SELECT p.company_id,p.id AS product_id,p.sku,p.name,p.unit,p.tracking,p.catalog_status,p.catalog_unit,COALESCE(sum(b.quantity),0)::text AS quantity,count(DISTINCT b.warehouse_id) FILTER(WHERE b.quantity>0) AS warehouses,count(*) FILTER(WHERE b.quantity<0) AS negative_positions FROM products p LEFT JOIN balances b ON b.product_id=p.id GROUP BY p.company_id,p.id,p.sku,p.name,p.unit,p.tracking,p.catalog_status,p.catalog_unit),
 warehouse_rows AS (SELECT w.company_id,w.id,w.code,w.name,w.establishment_status,count(DISTINCT b.product_id) FILTER(WHERE b.quantity>0) AS skus,count(*) FILTER(WHERE b.quantity<>0) AS positions FROM warehouses w LEFT JOIN balances b ON b.warehouse_id=w.id GROUP BY w.company_id,w.id,w.code,w.name,w.establishment_status),
 serial_conflicts AS (SELECT p.company_id,p.id,b.trace_key FROM balances b JOIN products p ON p.id=b.product_id WHERE p.tracking='serial' GROUP BY p.company_id,p.id,b.trace_key HAVING sum(b.quantity)>1 OR count(*) FILTER(WHERE b.quantity>0)>1),
 receipt_lines AS (SELECT o.company_id,r.id AS receipt_id,r.code::text AS receipt_code,r.reference,r.received_on::text AS received_on,r.status,rl.item_name,rl.unit,p.sku,(l->>'quantity')::numeric AS physical,COALESCE((SELECT sum(c.actual_quantity) FROM business.stock_controls c WHERE c.tenant_id=r.tenant_id AND c.receipt_id=r.id AND c.receipt_line_id=(l->>'line_id')::uuid),0) AS integrated
 FROM business.purchase_receipts r JOIN business.purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id CROSS JOIN LATERAL jsonb_array_elements(r.lines) l JOIN business.purchase_request_lines rl ON rl.tenant_id=o.tenant_id AND rl.request_id=o.request_id AND rl.id=(l->>'line_id')::uuid JOIN business.catalog_items ci ON ci.tenant_id=rl.tenant_id AND ci.id=rl.item_id AND ci.kind='product' LEFT JOIN business.stock_products p ON p.tenant_id=o.tenant_id AND p.company_id=o.company_id AND p.catalog_item_id=rl.item_id AND p.unit=rl.unit WHERE r.tenant_id=$1::uuid AND (l->>'quantity')::numeric>0),
 receipt_alerts AS (SELECT company_id,receipt_id,receipt_code,reference,received_on,item_name,unit,sku,physical::text AS physical,integrated::text AS integrated,(physical-integrated)::text AS remaining,CASE WHEN status<>'matched' THEN 'divergent' WHEN sku IS NULL THEN 'missing_sku' ELSE 'pending' END AS reason FROM receipt_lines WHERE physical>integrated),
 control_counts AS (SELECT c.company_id,count(*) FILTER(WHERE c.kind='inventory') AS counts,count(*) FILTER(WHERE c.kind='inventory' AND c.expected_quantity<>c.actual_quantity) AS adjustments,count(*) FILTER(WHERE c.kind='receipt') AS receipts FROM business.stock_controls c WHERE c.tenant_id=$1::uuid GROUP BY c.company_id),
 summaries AS (SELECT c.id,c.name,(SELECT count(*) FROM assets a WHERE a.company_id=c.id AND a.state='active') AS active_assets,(SELECT count(*) FROM assets a WHERE a.company_id=c.id AND a.state='maintenance') AS maintenance_assets,(SELECT count(*) FROM assets a WHERE a.company_id=c.id AND a.state IN ('retired','returned')) AS closed_assets,(SELECT count(*) FROM assets a WHERE a.company_id=c.id AND a.state IN ('active','maintenance') AND a.ownership='custody') AS custody_assets,(SELECT count(*) FROM assets a WHERE a.company_id=c.id AND a.state IN ('active','maintenance') AND a.condition='damaged') AS damaged_assets,COALESCE((SELECT sum(a.acquisition_value) FROM assets a WHERE a.company_id=c.id AND a.state IN ('active','maintenance') AND a.ownership='owned'),0)::text AS declared_value,(SELECT count(*) FROM warranties w WHERE w.company_id=c.id) AS warranty_due,(SELECT count(*) FROM products p WHERE p.company_id=c.id) AS skus,(SELECT count(*) FROM warehouses w WHERE w.company_id=c.id) AS warehouses,(SELECT count(*) FROM stock_rows s WHERE s.company_id=c.id AND s.quantity::numeric=0) AS zero_skus,(SELECT count(*) FROM serial_conflicts s WHERE s.company_id=c.id) AS serial_conflicts,(SELECT count(*) FROM receipt_alerts r WHERE r.company_id=c.id AND r.reason='pending') AS pending_receipts,(SELECT count(*) FROM receipt_alerts r WHERE r.company_id=c.id AND r.reason='divergent') AS divergent_receipts,(SELECT count(*) FROM receipt_alerts r WHERE r.company_id=c.id AND r.reason='missing_sku') AS missing_sku_receipts,COALESCE(cc.counts,0) AS inventory_counts,COALESCE(cc.adjustments,0) AS inventory_adjustments,COALESCE(cc.receipts,0) AS receipt_entries FROM companies c LEFT JOIN control_counts cc ON cc.company_id=c.id)
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM summaries s),'[]'::jsonb),'products',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.company_id,s.sku) FROM stock_rows s),'[]'::jsonb),'warehouses',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.company_id,w.code) FROM warehouse_rows w),'[]'::jsonb),'warranties',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.due_on,w.tag) FROM warranties w),'[]'::jsonb),'receipt_alerts',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.received_on,r.receipt_code,r.item_name) FROM receipt_alerts r),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Painel de patrimônio e estoque restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/stock-controls'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
   products AS (SELECT p.id,p.company_id,c.legal_name AS company_name,p.sku,p.name,p.unit,p.tracking,COALESCE((SELECT max(m.revision) FROM business.stock_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id),0) AS revision,(SELECT max(m.moved_on)::text FROM business.stock_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id) AS last_on FROM business.stock_products p JOIN core.parties c ON c.tenant_id=p.tenant_id AND c.id=p.company_id WHERE p.tenant_id=$1::uuid),
   warehouses AS (SELECT w.id,w.company_id,w.code,w.name FROM business.warehouses w WHERE w.tenant_id=$1::uuid),
   legs AS (SELECT product_id,destination_warehouse_id AS warehouse_id,trace_key,quantity FROM business.stock_movements WHERE tenant_id=$1::uuid AND destination_warehouse_id IS NOT NULL UNION ALL SELECT product_id,source_warehouse_id,trace_key,-quantity FROM business.stock_movements WHERE tenant_id=$1::uuid AND source_warehouse_id IS NOT NULL),
   balances AS (SELECT product_id,warehouse_id,trace_key,sum(quantity)::text AS quantity FROM legs GROUP BY product_id,warehouse_id,trace_key HAVING sum(quantity)<>0),
   receipts AS (SELECT r.id AS receipt_id,r.code::text AS receipt_code,r.reference,r.received_on::text AS received_on,(l->>'line_id')::uuid AS line_id,p.id AS product_id,p.company_id,(l->>'quantity') AS quantity,((l->>'quantity')::numeric-COALESCE((SELECT sum(c.actual_quantity) FROM business.stock_controls c WHERE c.tenant_id=r.tenant_id AND c.receipt_id=r.id AND c.receipt_line_id=(l->>'line_id')::uuid),0))::text AS remaining FROM business.purchase_receipts r JOIN business.purchase_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id AND o.status='approved' CROSS JOIN LATERAL jsonb_array_elements(r.lines) l JOIN business.purchase_request_lines rl ON rl.tenant_id=o.tenant_id AND rl.request_id=o.request_id AND rl.id=(l->>'line_id')::uuid JOIN business.stock_products p ON p.tenant_id=o.tenant_id AND p.company_id=o.company_id AND p.catalog_item_id=rl.item_id AND p.unit=rl.unit WHERE r.tenant_id=$1::uuid AND r.status='matched' AND (l->>'quantity')::numeric>0),
   history AS (SELECT c.id,c.kind,c.checked_on::text AS checked_on,c.product_id,c.warehouse_id,c.trace_key,c.expected_quantity::text AS expected_quantity,c.actual_quantity::text AS actual_quantity,c.receipt_id,c.receipt_line_id,c.movement_id,c.reason,c.created_at FROM business.stock_controls c WHERE c.tenant_id=$1::uuid ORDER BY c.created_at DESC LIMIT 200)
   SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'products',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.company_name,p.sku) FROM products p),'[]'::jsonb),'warehouses',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.code,w.id) FROM warehouses w),'[]'::jsonb),'balances',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM balances b),'[]'::jsonb),'receipts',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.received_on,r.receipt_code,r.line_id) FROM receipts r WHERE r.remaining::numeric>0),'[]'::jsonb),'history',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC) FROM history h),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Inventário restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/stock-controls'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),date=crmDate(b.checked_on),trace=typeof b.trace_key==='string'?b.trace_key.trim():'',reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!UUID.test(b.product_id||'')||!UUID.test(b.warehouse_id||'')||!Number.isInteger(b.revision)||b.revision<0||b.revision>2147483646||!date||!['inventory','receipt'].includes(b.kind)||trace.length>100||!reason||reason.length>500||typeof b.quantity!=='string'||!/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,3})?$/.test(b.quantity)||(b.kind==='receipt'?(!UUID.test(b.receipt_id||'')||!UUID.test(b.receipt_line_id||'')||Number(b.quantity)<=0):!!(b.receipt_id||b.receipt_line_id)))fail(400,'Confira produto, depósito, contagem ou recebimento e justificativa.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.record_stock_control($1::uuid,$2::integer,$3::uuid,$4,$5::date,$6,$7::numeric,$8::uuid,$9::uuid,$10,$11::uuid)",[b.product_id,b.revision,b.warehouse_id,b.kind,date,trace,b.quantity,b.receipt_id||null,b.receipt_line_id||null,reason,op],true);
   if(r.role!=='owner')fail(403,'Inventário restrito ao proprietário.');if(!r.rows.length)fail(409,'Conferência incompatível, revisão desatualizada, quantidade indisponível ou operação duplicada.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/stock-movements'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
   products AS (SELECT p.id,p.company_id,c.legal_name AS company_name,p.sku,p.name,p.unit,p.tracking,i.status AS catalog_status,i.unit AS catalog_unit,COALESCE((SELECT max(m.revision) FROM business.stock_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id),0) AS revision,(SELECT max(m.moved_on)::text FROM business.stock_movements m WHERE m.tenant_id=p.tenant_id AND m.product_id=p.id) AS last_on FROM business.stock_products p JOIN core.parties c ON c.tenant_id=p.tenant_id AND c.id=p.company_id JOIN business.catalog_items i ON i.tenant_id=p.tenant_id AND i.id=p.catalog_item_id WHERE p.tenant_id=$1::uuid),
   warehouses AS (SELECT w.id,w.company_id,w.code,w.name,e.status AS establishment_status FROM business.warehouses w JOIN core.establishments e ON e.tenant_id=w.tenant_id AND e.id=w.establishment_id WHERE w.tenant_id=$1::uuid),
   docs AS (SELECT id,company_id,code::text AS code,title FROM business.documents WHERE tenant_id=$1::uuid),
   legs AS (SELECT product_id,destination_warehouse_id AS warehouse_id,trace_key,quantity FROM business.stock_movements WHERE tenant_id=$1::uuid AND destination_warehouse_id IS NOT NULL UNION ALL SELECT product_id,source_warehouse_id,trace_key,-quantity FROM business.stock_movements WHERE tenant_id=$1::uuid AND source_warehouse_id IS NOT NULL),
   balances AS (SELECT product_id,warehouse_id,trace_key,sum(quantity)::text AS quantity FROM legs GROUP BY product_id,warehouse_id,trace_key HAVING sum(quantity)<>0)
   SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'products',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.company_name,p.sku) FROM products p),'[]'::jsonb),'warehouses',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.code,w.id) FROM warehouses w),'[]'::jsonb),'documents',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code::bigint DESC) FROM docs d),'[]'::jsonb),'balances',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.product_id,b.warehouse_id,b.trace_key) FROM balances b),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Estoque restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  const stockMatch=path.match(/^\/v1\/stock-movements\/([^/]+)$/);
  if(stockMatch&&UUID.test(stockMatch[1])){
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,`SELECT m.id,m.revision,m.kind,m.moved_on::text AS moved_on,s.code AS source_code,d.code AS destination_code,m.trace_key,m.quantity::text AS quantity,m.reference,m.reason,doc.code::text AS document_code,m.created_at FROM business.stock_movements m LEFT JOIN business.warehouses s ON s.tenant_id=m.tenant_id AND s.id=m.source_warehouse_id LEFT JOIN business.warehouses d ON d.tenant_id=m.tenant_id AND d.id=m.destination_warehouse_id LEFT JOIN business.documents doc ON doc.tenant_id=m.tenant_id AND doc.id=m.document_id WHERE m.tenant_id=$1::uuid AND m.product_id=$2::uuid ORDER BY m.revision DESC`,[tenant,stockMatch[1]]);if(r.role!=='owner')fail(403,'Estoque restrito ao proprietário.');return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request),op=requestId(b),date=crmDate(b.moved_on),trace=typeof b.trace_key==='string'?b.trace_key.trim():'',reference=typeof b.reference==='string'?b.reference.trim():'',reason=typeof b.reason==='string'?b.reason.trim():'';
    if(!Number.isInteger(b.revision)||b.revision<0||b.revision>2147483646||!date||!['entry','exit','transfer'].includes(b.kind)||[b.source_warehouse_id,b.destination_warehouse_id,b.document_id].some(v=>v&&!UUID.test(v))||trace.length>100||!reference||reference.length>200||!reason||reason.length>500||typeof b.quantity!=='string'||!/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,3})?$/.test(b.quantity)||Number(b.quantity)<=0)fail(400,'Confira movimento, quantidade, rastreabilidade, data e referência.');
    const r=await execute(sql,tenant,user,"SELECT * FROM business.create_stock_movement($1::uuid,$2::integer,$3,$4::date,$5::uuid,$6::uuid,$7,$8::numeric,$9,$10,$11::uuid,$12::uuid)",[stockMatch[1],b.revision,b.kind,date,b.source_warehouse_id||null,b.destination_warehouse_id||null,trace,b.quantity,reference,reason,b.document_id||null,op],true);
    if(r.role!=='owner')fail(403,'Estoque restrito ao proprietário.');if(!r.rows.length)fail(409,'Saldo insuficiente, série duplicada, vínculo incompatível, data ou revisão desatualizada.');return send({item:r.rows[0]},201);
   }
  }
  if(path==='/v1/stock-foundation'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND p.status='active'),
   establishments AS (SELECT e.id,e.party_id AS company_id,e.name,e.cnpj FROM core.establishments e JOIN companies c ON c.id=e.party_id WHERE e.tenant_id=$1::uuid AND e.status='active'),
   catalog AS (SELECT i.id,i.code::text AS code,i.name,i.unit FROM business.catalog_items i WHERE i.tenant_id=$1::uuid AND i.kind='product' AND i.status='active'),
   products AS (SELECT s.id,s.company_id,p.legal_name AS company_name,s.catalog_item_id,s.sku,s.name,s.unit,s.tracking,s.barcode,i.status AS catalog_status,i.name AS catalog_name,i.unit AS catalog_unit FROM business.stock_products s JOIN core.parties p ON p.tenant_id=s.tenant_id AND p.id=s.company_id JOIN business.catalog_items i ON i.tenant_id=s.tenant_id AND i.id=s.catalog_item_id WHERE s.tenant_id=$1::uuid),
   warehouses AS (SELECT w.id,w.company_id,p.legal_name AS company_name,w.establishment_id,e.name AS establishment_name,e.status AS establishment_status,w.code,w.name,w.location,w.responsible FROM business.warehouses w JOIN core.parties p ON p.tenant_id=w.tenant_id AND p.id=w.company_id JOIN core.establishments e ON e.tenant_id=w.tenant_id AND e.id=w.establishment_id WHERE w.tenant_id=$1::uuid)
   SELECT jsonb_build_object('companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name,c.id) FROM companies c),'[]'::jsonb),'establishments',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.name,e.id) FROM establishments e),'[]'::jsonb),'catalog',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.name,i.id) FROM catalog i),'[]'::jsonb),'products',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.company_name,s.sku) FROM products s),'[]'::jsonb),'warehouses',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.company_name,w.code) FROM warehouses w),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Estoque restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if((path==='/v1/stock-products'||path==='/v1/warehouses')&&request.method==='POST'){
   const b=await body(request),op=requestId(b);
   const clean=(key,max,required=true)=>{const v=b[key];if(v!=null&&typeof v!=='string')fail(400,'Campo inválido.');const x=(v||'').trim();if(x.length>max||(required&&!x))fail(400,'Campo obrigatório ou excede o limite.');return x||null;};
   if(!UUID.test(b.company_id||''))fail(400,'Empresa inválida.');
   if(path==='/v1/stock-products'){
    const sku=clean('sku',40).toUpperCase(),barcode=clean('barcode',100,false);
    if(!UUID.test(b.catalog_item_id||'')||!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku)||!['none','lot','serial'].includes(b.tracking))fail(400,'Confira produto, SKU e rastreabilidade.');
    const r=await execute(sql,tenant,user,"SELECT product_id FROM business.create_stock_product($1::uuid,$2::uuid,$3,$4,$5,$6::uuid)",[b.company_id,b.catalog_item_id,sku,b.tracking,barcode,op],true);
    if(r.role!=='owner')fail(403,'Estoque restrito ao proprietário.');if(!r.rows.length)fail(409,'SKU, produto ou código de barras duplicado, ou vínculo/rastreabilidade incompatível.');return send({item:r.rows[0]},201);
   }
   const code=clean('code',40).toUpperCase(),name=clean('name',200),location=clean('location',200),responsible=clean('responsible',120);
   if(!UUID.test(b.establishment_id||'')||!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code))fail(400,'Confira código e estabelecimento.');
   const r=await execute(sql,tenant,user,"SELECT warehouse_id FROM business.create_warehouse($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid)",[b.company_id,b.establishment_id,code,name,location,responsible,op],true);
   if(r.role!=='owner')fail(403,'Estoque restrito ao proprietário.');if(!r.rows.length)fail(409,'Código duplicado ou estabelecimento incompatível.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/asset-lifecycle'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today), items AS (
   SELECT a.id,a.company_id,p.legal_name AS company_name,a.tag,a.title,a.ownership,COALESCE(e.revision,0) AS revision,GREATEST(a.registered_on,e.event_on,m.moved_on)::text AS last_on,CASE WHEN state.kind='maintenance_start' THEN 'maintenance' WHEN state.kind IN ('retired','returned') THEN state.kind ELSE 'active' END AS state,
   (SELECT count(*) FROM business.asset_lifecycle_events w WHERE w.tenant_id=a.tenant_id AND w.asset_id=a.id AND w.kind='warranty' AND w.warranty_from<=clock.today AND w.warranty_until>=clock.today) AS warranties_active,
   (SELECT count(*) FROM business.asset_lifecycle_events w WHERE w.tenant_id=a.tenant_id AND w.asset_id=a.id AND w.kind='warranty' AND w.warranty_from<=clock.today AND w.warranty_until BETWEEN clock.today AND clock.today+30) AS warranties_due,
   COALESCE((SELECT sum(w.maintenance_cost) FROM business.asset_lifecycle_events w WHERE w.tenant_id=a.tenant_id AND w.asset_id=a.id),0)::text AS maintenance_cost
   FROM business.assets a JOIN core.parties p ON p.tenant_id=a.tenant_id AND p.id=a.company_id CROSS JOIN clock
   LEFT JOIN LATERAL(SELECT e.revision,e.event_on FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id ORDER BY e.revision DESC LIMIT 1) e ON true
   LEFT JOIN LATERAL(SELECT e.kind FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id AND e.kind<>'warranty' ORDER BY e.revision DESC LIMIT 1) state ON true
   LEFT JOIN LATERAL(SELECT m.moved_on FROM business.asset_movements m WHERE m.tenant_id=a.tenant_id AND m.asset_id=a.id ORDER BY m.revision DESC LIMIT 1) m ON true WHERE a.tenant_id=$1::uuid),
   docs AS (SELECT id,company_id,code::text AS code,title FROM business.documents WHERE tenant_id=$1::uuid)
   SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.company_name,i.tag) FROM items i),'[]'::jsonb),'documents',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code::bigint DESC) FROM docs d),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'Patrimônio restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  const assetLifecycleMatch=path.match(/^\/v1\/asset-lifecycle\/([^/]+)$/);
  if(assetLifecycleMatch&&UUID.test(assetLifecycleMatch[1])){
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT e.revision,e.kind,e.event_on::text AS event_on,e.description,e.provider,e.warranty_from::text AS warranty_from,e.warranty_until::text AS warranty_until,e.reference,e.maintenance_cost::text AS maintenance_cost,e.document_id,d.code::text AS document_code,e.created_at FROM business.asset_lifecycle_events e LEFT JOIN business.documents d ON d.tenant_id=e.tenant_id AND d.id=e.document_id WHERE e.tenant_id=$1::uuid AND e.asset_id=$2::uuid ORDER BY e.revision DESC",[tenant,assetLifecycleMatch[1]]);if(r.role!=='owner')fail(403,'Patrimônio restrito ao proprietário.');return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request),op=requestId(b),date=crmDate(b.event_on),from=crmDate(b.warranty_from),until=crmDate(b.warranty_until);
    const clean=(key,max,required=false)=>{const v=b[key];if(v!=null&&typeof v!=='string')fail(400,'Campo inválido.');const x=(v||'').trim();if(x.length>max||(required&&!x))fail(400,'Campo obrigatório ou excede o limite.');return x||null;};
    const desc=clean('description',500,true),provider=clean('provider',200),ref=clean('reference',200),cost=b.maintenance_cost===''||b.maintenance_cost==null?null:b.maintenance_cost;
    if(!Number.isInteger(b.revision)||b.revision<0||b.revision>2147483646||!date||!['warranty','maintenance_start','maintenance_finish','retired','returned'].includes(b.kind)||(b.document_id&&!UUID.test(b.document_id))||(b.kind==='warranty'?(!from||!until||until<from||!provider||!ref):!!(from||until))||(cost!==null&&(b.kind!=='maintenance_finish'||typeof cost!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(cost))))fail(400,'Confira tipo, data, garantia, valor e revisão.');
    const r=await execute(sql,tenant,user,"SELECT * FROM business.record_asset_event($1::uuid,$2::integer,$3,$4::date,$5,$6,$7::date,$8::date,$9,$10::numeric,$11::uuid,$12::uuid)",[assetLifecycleMatch[1],b.revision,b.kind,date,desc,provider,from,until,ref,cost,b.document_id||null,op],true);if(r.role!=='owner')fail(403,'Patrimônio restrito ao proprietário.');if(!r.rows.length)fail(409,'Evento incompatível, bem encerrado, data inválida ou revisão desatualizada.');return send({item:r.rows[0]},201);
   }
  }
  if(path==='/v1/assets'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND p.status='active'),
   establishments AS (SELECT e.id,e.party_id AS company_id,e.name,e.cnpj FROM core.establishments e WHERE e.tenant_id=$1::uuid AND e.status='active'),
   parties AS (SELECT id,legal_name AS name FROM core.parties WHERE tenant_id=$1::uuid AND status='active'),
   documents AS (SELECT id,company_id,code::text AS code,title FROM business.documents WHERE tenant_id=$1::uuid),
   items AS (SELECT a.id,a.company_id,p.legal_name AS company_name,a.tag,a.title,a.category,a.ownership,a.owner_party_id,op.legal_name AS owner_name,a.serial_number,a.registered_on::text AS registered_on,a.acquisition_value::text AS acquisition_value,a.document_id,a.source_reference,CASE WHEN lifecycle.kind='maintenance_start' THEN 'maintenance' WHEN lifecycle.kind IN ('retired','returned') THEN lifecycle.kind ELSE 'active' END AS lifecycle_state,COALESCE(m.revision,0) AS revision,COALESCE(m.moved_on,a.registered_on)::text AS last_on,COALESCE(m.establishment_id,a.establishment_id) AS establishment_id,e.name AS establishment_name,COALESCE(m.location,a.location) AS location,COALESCE(m.responsible,a.responsible) AS responsible,COALESCE(m.condition,a.condition) AS condition FROM business.assets a JOIN core.parties p ON p.tenant_id=a.tenant_id AND p.id=a.company_id LEFT JOIN core.parties op ON op.tenant_id=a.tenant_id AND op.id=a.owner_party_id LEFT JOIN LATERAL(SELECT e.kind FROM business.asset_lifecycle_events e WHERE e.tenant_id=a.tenant_id AND e.asset_id=a.id AND e.kind<>'warranty' ORDER BY e.revision DESC LIMIT 1) lifecycle ON true LEFT JOIN LATERAL(SELECT m.* FROM business.asset_movements m WHERE m.tenant_id=a.tenant_id AND m.asset_id=a.id ORDER BY revision DESC LIMIT 1) m ON true JOIN core.establishments e ON e.tenant_id=a.tenant_id AND e.id=COALESCE(m.establishment_id,a.establishment_id) WHERE a.tenant_id=$1::uuid)
   SELECT jsonb_build_object('companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name,c.id) FROM companies c),'[]'::jsonb),'establishments',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.name,e.id) FROM establishments e),'[]'::jsonb),'parties',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name,p.id) FROM parties p),'[]'::jsonb),'documents',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code::bigint DESC) FROM documents d),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.company_name,i.tag) FROM items i),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Patrimônio restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/assets'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),date=crmDate(b.registered_on);
   const clean=(key,max,required=true)=>{const v=b[key];if(v!=null&&typeof v!=='string')fail(400,'Campo patrimonial inválido.');const x=(v||'').trim();if(x.length>max||(required&&!x))fail(400,'Campo obrigatório ou excede o limite.');return x||null;};
   const tag=clean('tag',40).toUpperCase(),title=clean('title',200),category=clean('category',100),serial=clean('serial_number',100,false),location=clean('location',200),responsible=clean('responsible',120),source=clean('source_reference',200),value=b.acquisition_value||null;
   if(!UUID.test(b.company_id||'')||!UUID.test(b.establishment_id||'')||(b.owner_party_id&&!UUID.test(b.owner_party_id))||(b.document_id&&!UUID.test(b.document_id))||!date||!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(tag)||!['owned','custody'].includes(b.ownership)||!['good','fair','damaged','unknown'].includes(b.condition)||(value!==null&&(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(value)))||(b.ownership==='owned'?!!b.owner_party_id:!b.owner_party_id||value!==null))fail(400,'Confira identificação, titularidade, estabelecimento, data e valor.');
   const r=await execute(sql,tenant,user,"SELECT asset_id FROM business.create_asset($1::uuid,$2,$3,$4,$5,$6::uuid,$7,$8::date,$9::numeric,$10::uuid,$11::uuid,$12,$13,$14,$15,$16::uuid)",[b.company_id,tag,title,category,b.ownership,b.owner_party_id||null,serial,date,value,b.document_id||null,b.establishment_id,location,responsible,b.condition,source,op],true);if(r.role!=='owner')fail(403,'Patrimônio restrito ao proprietário.');if(!r.rows.length)fail(409,'Identificação duplicada ou vínculo incompatível.');return send({item:r.rows[0]},201);
  }
  const assetMatch=path.match(/^\/v1\/assets\/([^/]+)\/movements$/);
  if(assetMatch&&UUID.test(assetMatch[1])){
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,`SELECT 0 AS revision,a.registered_on::text AS moved_on,e.name AS establishment_name,a.location,a.responsible,a.condition,a.source_reference AS reason,a.created_at FROM business.assets a JOIN core.establishments e ON e.tenant_id=a.tenant_id AND e.id=a.establishment_id WHERE a.tenant_id=$1::uuid AND a.id=$2::uuid UNION ALL SELECT m.revision,m.moved_on::text,e.name,m.location,m.responsible,m.condition,m.reason,m.created_at FROM business.asset_movements m JOIN core.establishments e ON e.tenant_id=m.tenant_id AND e.id=m.establishment_id WHERE m.tenant_id=$1::uuid AND m.asset_id=$2::uuid ORDER BY revision DESC`,[tenant,assetMatch[1]]);if(r.role!=='owner')fail(403,'Patrimônio restrito ao proprietário.');return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request),op=requestId(b),date=crmDate(b.moved_on),location=typeof b.location==='string'?b.location.trim():'',responsible=typeof b.responsible==='string'?b.responsible.trim():'',reason=typeof b.reason==='string'?b.reason.trim():'';
    if(!Number.isInteger(b.revision)||b.revision<0||b.revision>2147483646||!date||!UUID.test(b.establishment_id||'')||!location||location.length>200||!responsible||responsible.length>120||!reason||reason.length>500||!['good','fair','damaged','unknown'].includes(b.condition))fail(400,'Confira data, localização, responsável, condição e justificativa.');
    const r=await execute(sql,tenant,user,"SELECT * FROM business.move_asset($1::uuid,$2::integer,$3::date,$4::uuid,$5,$6,$7,$8,$9::uuid)",[assetMatch[1],b.revision,date,b.establishment_id,location,responsible,b.condition,reason,op],true);if(r.role!=='owner')fail(403,'Patrimônio restrito ao proprietário.');if(!r.rows.length)fail(409,'Revisão desatualizada, data inválida ou estabelecimento incompatível.');return send({item:r.rows[0]},201);
   }
  }
  if(path==='/v1/management-dashboard'&&request.method==='GET'){
   const year=Number(new URL(request.url).searchParams.get('year'));if(!Number.isInteger(year)||year<2000||year>2100)fail(400,'Ano inválido.');
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid),
 dimensions AS (SELECT d.company_id,d.kind,d.status FROM business.management_dimensions d WHERE d.tenant_id=$1::uuid),
 obligations AS (SELECT o.id,o.company_id,o.direction,o.amount,o.issued_on,a.competence_on,a.lines,EXISTS(SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND (n.original_id=o.id OR n.replacement_id=o.id)) AS renegotiated,
 COALESCE((SELECT sum(i.remaining) FROM business.financial_installments i WHERE i.tenant_id=o.tenant_id AND i.obligation_id=o.id),0) AS committed,
 COALESCE((SELECT sum(s.principal) FROM business.financial_installments i JOIN business.financial_settlements s ON s.tenant_id=i.tenant_id AND s.installment_id=i.id WHERE i.tenant_id=o.tenant_id AND i.obligation_id=o.id AND NOT EXISTS(SELECT 1 FROM business.financial_reversals v WHERE v.tenant_id=s.tenant_id AND v.settlement_id=s.id)),0) AS realized
 FROM business.financial_obligations o LEFT JOIN LATERAL(SELECT a.competence_on,a.lines FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id ORDER BY a.revision DESC LIMIT 1) a ON true WHERE o.tenant_id=$1::uuid),
 scoped AS (SELECT *,extract(month FROM COALESCE(competence_on,issued_on))::integer AS month FROM obligations WHERE extract(year FROM COALESCE(competence_on,issued_on))=$2::integer),
 actual AS (SELECT company_id,month,direction,count(*) FILTER(WHERE lines IS NOT NULL AND NOT renegotiated) AS classified,count(*) FILTER(WHERE lines IS NULL AND NOT renegotiated) AS unclassified,count(*) FILTER(WHERE renegotiated) AS renegotiated,
 COALESCE(sum(amount) FILTER(WHERE lines IS NOT NULL AND NOT renegotiated),0) AS allocated,
 COALESCE(sum(realized) FILTER(WHERE lines IS NOT NULL AND NOT renegotiated),0) AS realized,
 COALESCE(sum(committed) FILTER(WHERE lines IS NOT NULL AND NOT renegotiated),0) AS committed,
 COALESCE(sum(amount) FILTER(WHERE lines IS NULL AND NOT renegotiated),0) AS unclassified_value,
 COALESCE(sum(amount) FILTER(WHERE renegotiated),0) AS renegotiated_value FROM scoped GROUP BY company_id,month,direction),
 budgets AS (SELECT DISTINCT ON(company_id) b.company_id,b.revision,b.lines FROM business.management_budgets b WHERE b.tenant_id=$1::uuid AND b.budget_year=$2::integer ORDER BY company_id,revision DESC),
 planned AS (SELECT b.company_id,(l->>'month')::integer AS month,l->>'direction' AS direction,sum((l->>'amount')::numeric) AS amount FROM budgets b CROSS JOIN LATERAL jsonb_array_elements(b.lines) l GROUP BY b.company_id,(l->>'month')::integer,l->>'direction'),
 periods AS (SELECT DISTINCT ON(company_id,period_on) e.company_id,e.period_on,e.status,e.revision,e.snapshot FROM business.management_period_events e WHERE e.tenant_id=$1::uuid AND extract(year FROM e.period_on)=$2::integer ORDER BY company_id,period_on,revision DESC),
 months AS (SELECT c.id AS company_id,m.month,make_date($2::integer,m.month,1) AS period_on,d.direction FROM companies c CROSS JOIN generate_series(1,12) m(month) CROSS JOIN (VALUES('receivable'),('payable')) d(direction)),
 rows AS (SELECT m.company_id,m.month,m.direction,COALESCE(p.amount,0)::text AS planned,COALESCE(a.allocated,0)::text AS allocated,COALESCE(a.realized,0)::text AS realized,COALESCE(a.committed,0)::text AS committed,(COALESCE(p.amount,0)-COALESCE(a.realized,0)-COALESCE(a.committed,0))::text AS deviation,
 COALESCE(a.classified,0) AS classified,COALESCE(a.unclassified,0) AS unclassified,COALESCE(a.renegotiated,0) AS renegotiated,COALESCE(a.unclassified_value,0)::text AS unclassified_value,COALESCE(a.renegotiated_value,0)::text AS renegotiated_value
 FROM months m LEFT JOIN actual a USING(company_id,month,direction) LEFT JOIN planned p USING(company_id,month,direction)),
 period_rows AS (SELECT DISTINCT m.company_id,m.month,CASE WHEN p.status='closed' THEN 'closed' WHEN m.period_on>=date_trunc('month',clock.today)::date THEN 'current_future' ELSE 'open' END AS status,COALESCE(p.revision,0) AS revision,p.snapshot FROM months m CROSS JOIN clock LEFT JOIN periods p ON p.company_id=m.company_id AND p.period_on=m.period_on),
 summaries AS (SELECT c.id,c.name,(SELECT count(*) FROM dimensions d WHERE d.company_id=c.id AND d.kind='financial_category' AND d.status='active') AS categories,(SELECT count(*) FROM dimensions d WHERE d.company_id=c.id AND d.kind='cost_center' AND d.status='active') AS cost_centers,(SELECT count(*) FROM dimensions d WHERE d.company_id=c.id AND d.kind='profit_center' AND d.status='active') AS profit_centers,COALESCE((SELECT b.revision FROM budgets b WHERE b.company_id=c.id),0) AS budget_revision FROM companies c)
 SELECT jsonb_build_object('year',$2::integer,'as_of',(SELECT today::text FROM clock),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM summaries s),'[]'::jsonb),'rows',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.company_id,r.month,r.direction) FROM rows r),'[]'::jsonb),'periods',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.company_id,p.month) FROM period_rows p),'[]'::jsonb)) AS data`,[tenant,year]);
   if(r.role!=='owner')fail(403,'Painel de Controladoria restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/management-periods'&&request.method==='GET'){
   const year=Number(new URL(request.url).searchParams.get('year'));if(!Number.isInteger(year)||year<2000||year>2100)fail(400,'Ano inválido.');
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid),
   history AS (SELECT e.id,e.company_id,e.period_on::text AS period_on,e.revision,e.status,e.checklist,e.snapshot,e.reason,e.created_at FROM business.management_period_events e WHERE e.tenant_id=$1::uuid AND extract(year FROM e.period_on)=$2::integer)
   SELECT jsonb_build_object('year',$2::integer,'as_of',(now() AT TIME ZONE 'America/Fortaleza')::date::text,'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name,c.id) FROM companies c),'[]'::jsonb),'history',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.period_on,h.revision DESC) FROM history h),'[]'::jsonb)) AS data`,[tenant,year]);
   if(r.role!=='owner')fail(403,'Fechamento gerencial restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/management-periods'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),period=crmDate(b.period_on),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!UUID.test(b.company_id||'')||!period||!period.endsWith('-01')||!Number.isInteger(b.revision)||b.revision<0||b.revision>2147483646||!['closed','open'].includes(b.status)||!reason||reason.length>500)fail(400,'Confira empresa, período, revisão e justificativa.');
   if(b.status==='closed'&&(!b.checklist||!['documents','reconciliation','allocations','budget','exceptions'].every(k=>b.checklist[k]===true)||Object.keys(b.checklist).length!==5))fail(400,'Confirme todos os itens do checklist.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.change_management_period($1::uuid,$2::date,$3::integer,$4,$5::jsonb,$6,$7::uuid)",[b.company_id,period,b.revision,b.status,b.status==='closed'?JSON.stringify(b.checklist):null,reason,op],true);
   if(r.role!=='owner')fail(403,'Fechamento gerencial restrito ao proprietário.');if(!r.rows.length)fail(409,'Período inválido, não encerrado, estado inalterado ou revisão desatualizada.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/management-results'&&request.method==='GET'){
   const year=Number(new URL(request.url).searchParams.get('year'));
   if(!Number.isInteger(year)||year<2000||year>2100)fail(400,'Ano inválido.');
   const r=await execute(sql,tenant,user,`WITH bounds AS (SELECT make_date($2::integer,1,1) AS start_on,make_date($2::integer+1,1,1) AS end_on),
 companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid),
 obligations AS (SELECT o.id,o.company_id,o.direction,o.amount,o.issued_on,a.competence_on,a.lines,EXISTS(SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND (n.original_id=o.id OR n.replacement_id=o.id)) AS renegotiated FROM business.financial_obligations o LEFT JOIN LATERAL (SELECT a.competence_on,a.lines FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id ORDER BY a.revision DESC LIMIT 1) a ON true WHERE o.tenant_id=$1::uuid),
 allocations AS (SELECT o.id,o.company_id,o.direction,o.amount,o.competence_on,o.renegotiated,l->>'category_id' AS category_id,l->>'category_code' AS category_code,l->>'category_name' AS category_name,l->>'cost_center_id' AS cost_id,l->>'cost_code' AS cost_code,l->>'cost_name' AS cost_name,l->>'profit_center_id' AS profit_id,l->>'profit_code' AS profit_code,l->>'profit_name' AS profit_name,(l->>'amount')::numeric AS allocated,sum((l->>'amount')::numeric) OVER(PARTITION BY o.id ORDER BY ord) AS cumulative FROM obligations o CROSS JOIN LATERAL jsonb_array_elements(o.lines) WITH ORDINALITY j(l,ord)),
 settlements AS (SELECT o.id AS obligation_id,s.settled_on AS event_on,s.cash_amount AS cash_amount FROM obligations o JOIN business.financial_installments i ON i.tenant_id=$1::uuid AND i.obligation_id=o.id JOIN business.financial_settlements s ON s.tenant_id=i.tenant_id AND s.installment_id=i.id
 UNION ALL SELECT o.id,v.reversed_on,-s.cash_amount FROM obligations o JOIN business.financial_installments i ON i.tenant_id=$1::uuid AND i.obligation_id=o.id JOIN business.financial_settlements s ON s.tenant_id=i.tenant_id AND s.installment_id=i.id JOIN business.financial_reversals v ON v.tenant_id=s.tenant_id AND v.settlement_id=s.id),
 cash_months AS (SELECT s.obligation_id,extract(month FROM s.event_on)::integer AS month,sum(s.cash_amount) AS cash FROM settlements s CROSS JOIN bounds b WHERE s.event_on>=b.start_on AND s.event_on<b.end_on GROUP BY s.obligation_id,extract(month FROM s.event_on)),
 competence_rows AS (SELECT a.company_id,extract(month FROM a.competence_on)::integer AS month,a.direction,a.category_id,a.category_code,a.category_name,a.cost_id,a.cost_code,a.cost_name,a.profit_id,a.profit_code,a.profit_name,a.allocated AS value FROM allocations a CROSS JOIN bounds b WHERE NOT a.renegotiated AND a.competence_on>=b.start_on AND a.competence_on<b.end_on),
 cash_rows AS (SELECT a.company_id,c.month,a.direction,a.category_id,a.category_code,a.category_name,a.cost_id,a.cost_code,a.cost_name,a.profit_id,a.profit_code,a.profit_name,(floor(c.cash*100*a.cumulative/a.amount)-floor(c.cash*100*(a.cumulative-a.allocated)/a.amount))/100 AS value FROM allocations a JOIN cash_months c ON c.obligation_id=a.id WHERE NOT a.renegotiated),
 report_rows AS (SELECT 'competence' AS basis,* FROM competence_rows UNION ALL SELECT 'cash' AS basis,* FROM cash_rows),
 totals AS (SELECT basis,company_id,month,direction,category_id,max(category_code) AS category_code,max(category_name) AS category_name,cost_id,max(cost_code) AS cost_code,max(cost_name) AS cost_name,profit_id,max(profit_code) AS profit_code,max(profit_name) AS profit_name,sum(value)::text AS amount FROM report_rows GROUP BY basis,company_id,month,direction,category_id,cost_id,profit_id),
 coverage_base AS (SELECT 'competence' AS basis,o.company_id,extract(month FROM COALESCE(o.competence_on,o.issued_on))::integer AS month,o.direction,CASE WHEN o.renegotiated THEN 'renegotiated' ELSE 'unclassified' END AS reason,o.amount AS value FROM obligations o CROSS JOIN bounds b WHERE (o.renegotiated OR o.lines IS NULL) AND COALESCE(o.competence_on,o.issued_on)>=b.start_on AND COALESCE(o.competence_on,o.issued_on)<b.end_on
 UNION ALL SELECT 'cash',o.company_id,c.month,o.direction,CASE WHEN o.renegotiated THEN 'renegotiated' ELSE 'unclassified' END,c.cash FROM cash_months c JOIN obligations o ON o.id=c.obligation_id WHERE o.renegotiated OR o.lines IS NULL),
 coverage AS (SELECT basis,company_id,month,direction,reason,count(*) AS count,sum(value)::text AS amount FROM coverage_base GROUP BY basis,company_id,month,direction,reason)
 SELECT jsonb_build_object('year',$2::integer,'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name,c.id) FROM companies c),'[]'::jsonb),'rows',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.basis,t.company_id,t.month,t.direction,t.category_code,t.cost_id,t.profit_id) FROM totals t),'[]'::jsonb),'coverage',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.basis,c.company_id,c.month,c.direction,c.reason) FROM coverage c),'[]'::jsonb)) AS data`,[tenant,year]);if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/management-budgets'&&request.method==='GET'){
   const year=Number(new URL(request.url).searchParams.get('year'));
   if(!Number.isInteger(year)||year<2000||year>2100)fail(400,'Ano inválido.');
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND p.status='active'),
 categories AS (SELECT id,company_id,code,name,direction,status FROM business.management_dimensions WHERE tenant_id=$1::uuid AND kind='financial_category'),
 revisions AS (SELECT b.id,b.company_id,b.budget_year,b.revision,b.lines,b.justification,b.created_at FROM business.management_budgets b WHERE b.tenant_id=$1::uuid AND b.budget_year=$2::integer),
 latest AS (SELECT DISTINCT ON(company_id) * FROM revisions ORDER BY company_id,revision DESC),
 planned AS (SELECT b.company_id,(l->>'category_id')::uuid AS category_id,(l->>'month')::integer AS month,(l->>'amount')::numeric AS planned FROM latest b CROSS JOIN LATERAL jsonb_array_elements(b.lines) l),
 obligations AS (SELECT o.id,o.company_id,o.amount,o.direction,o.issued_on,a.competence_on,a.lines,EXISTS(SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND (n.original_id=o.id OR n.replacement_id=o.id)) AS renegotiated,
 COALESCE((SELECT sum(i.remaining) FROM business.financial_installments i WHERE i.tenant_id=o.tenant_id AND i.obligation_id=o.id),0) AS committed,
 COALESCE((SELECT sum(s.principal) FROM business.financial_installments i JOIN business.financial_settlements s ON s.tenant_id=i.tenant_id AND s.installment_id=i.id WHERE i.tenant_id=o.tenant_id AND i.obligation_id=o.id AND NOT EXISTS(SELECT 1 FROM business.financial_reversals v WHERE v.tenant_id=s.tenant_id AND v.settlement_id=s.id)),0) AS realized
 FROM business.financial_obligations o LEFT JOIN LATERAL (SELECT a.competence_on,a.lines FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id ORDER BY revision DESC LIMIT 1) a ON true WHERE o.tenant_id=$1::uuid),
 scoped AS (SELECT * FROM obligations WHERE extract(year FROM COALESCE(competence_on,issued_on))=$2::integer),
 expanded AS (SELECT o.id,o.company_id,extract(month FROM o.competence_on)::integer AS month,(l->>'category_id')::uuid AS category_id,(l->>'amount')::numeric AS allocated,o.amount,o.realized,o.committed,sum((l->>'amount')::numeric) OVER(PARTITION BY o.id ORDER BY ord) AS cumulative FROM scoped o CROSS JOIN LATERAL jsonb_array_elements(o.lines) WITH ORDINALITY AS j(l,ord) WHERE NOT o.renegotiated),
 actual AS (SELECT company_id,category_id,month,sum(allocated) AS allocated,
 sum((floor(realized*100*cumulative/amount)-floor(realized*100*(cumulative-allocated)/amount))/100) AS realized,
 sum((floor((realized+committed)*100*cumulative/amount)-floor((realized+committed)*100*(cumulative-allocated)/amount)-floor(realized*100*cumulative/amount)+floor(realized*100*(cumulative-allocated)/amount))/100) AS committed FROM expanded GROUP BY company_id,category_id,month),
 comparison AS (SELECT COALESCE(p.company_id,a.company_id) AS company_id,COALESCE(p.category_id,a.category_id) AS category_id,COALESCE(p.month,a.month) AS month,COALESCE(p.planned,0)::text AS planned,COALESCE(a.allocated,0)::text AS allocated,COALESCE(a.realized,0)::text AS realized,COALESCE(a.committed,0)::text AS committed,(COALESCE(p.planned,0)-COALESCE(a.realized,0)-COALESCE(a.committed,0))::text AS remaining FROM planned p FULL JOIN actual a USING(company_id,category_id,month)),
 coverage AS (SELECT c.id AS company_id,(SELECT count(*) FROM scoped o WHERE o.company_id=c.id AND o.lines IS NULL AND NOT o.renegotiated) AS unclassified,(SELECT count(*) FROM scoped o WHERE o.company_id=c.id AND o.renegotiated) AS renegotiated FROM companies c)
 SELECT jsonb_build_object('year',$2::integer,'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM companies c),'[]'::jsonb),'categories',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code,c.id) FROM categories c),'[]'::jsonb),'budgets',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM latest b),'[]'::jsonb),'history',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.revision DESC) FROM revisions b),'[]'::jsonb),'comparison',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.month,c.category_id) FROM comparison c),'[]'::jsonb),'coverage',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM coverage c),'[]'::jsonb)) AS data`,[tenant,year]);if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/management-budgets'&&request.method==='POST'){
   const b=await body(request,48000),op=requestId(b),reason=typeof b.justification==='string'?b.justification.trim():'';
   if(!UUID.test(b.company_id||'')||!Number.isInteger(b.year)||b.year<2000||b.year>2100||!Number.isInteger(b.revision)||b.revision<0||b.revision>2147483646||!reason||reason.length>500||!Array.isArray(b.lines)||b.lines.length<1||b.lines.length>120||b.lines.some(l=>!l||!UUID.test(l.category_id||'')||!Number.isInteger(l.month)||l.month<1||l.month>12||typeof l.amount!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(l.amount)))fail(400,'Confira empresa, ano, revisão e linhas mensais.');
   const r=await execute(sql,tenant,user,"SELECT * FROM business.create_management_budget($1::uuid,$2::integer,$3::integer,$4::jsonb,$5,$6::uuid)",[b.company_id,b.year,b.revision,JSON.stringify(b.lines),reason,op],true);
   if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');if(!r.rows.length)fail(409,'Categoria incompatível, linha duplicada ou revisão desatualizada.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/management-allocations'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH dimensions AS (SELECT id,company_id,kind,code,name,direction,status FROM business.management_dimensions WHERE tenant_id=$1::uuid),
   obligations AS (SELECT o.id,o.code::text AS code,o.company_id,o.company_name,o.counterparty_name,o.title,o.direction,o.amount::text AS amount,o.issued_on::text AS issued_on,COALESCE(a.revision,0) AS revision,a.competence_on::text AS competence_on,a.lines,a.justification,EXISTS(SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND n.original_id=o.id) AS renegotiated FROM business.financial_obligations o LEFT JOIN LATERAL (SELECT * FROM business.management_allocations a WHERE a.tenant_id=o.tenant_id AND a.obligation_id=o.id ORDER BY revision DESC LIMIT 1) a ON true WHERE o.tenant_id=$1::uuid)
   SELECT jsonb_build_object('dimensions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code,d.id) FROM dimensions d),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.code::bigint DESC) FROM obligations o),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');return send(r.rows[0]?.data||{});
  }
  const maMatch=path.match(/^\/v1\/management-allocations\/([^/]+)$/);
  if(maMatch&&UUID.test(maMatch[1])){
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,revision,competence_on::text AS competence_on,amount::text AS amount,lines,justification,created_at FROM business.management_allocations WHERE tenant_id=$1::uuid AND obligation_id=$2::uuid ORDER BY revision DESC",[tenant,maMatch[1]]);
    if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request,24000),op=requestId(b),date=crmDate(b.competence_on),reason=typeof b.justification==='string'?b.justification.trim():'';
    if(!Number.isInteger(b.revision)||b.revision<0||b.revision>2147483646||!date||!reason||reason.length>500||!Array.isArray(b.lines)||b.lines.length<1||b.lines.length>30||b.lines.some(l=>!l||!UUID.test(l.category_id||'')||(l.cost_center_id&&!UUID.test(l.cost_center_id))||(l.profit_center_id&&!UUID.test(l.profit_center_id))||typeof l.amount!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(l.amount)))fail(400,'Confira competência, justificativa, revisão e linhas de rateio.');
    const r=await execute(sql,tenant,user,"SELECT * FROM business.create_management_allocation($1::uuid,$2::integer,$3::date,$4::jsonb,$5,$6::uuid)",[maMatch[1],b.revision,date,JSON.stringify(b.lines),reason,op],true);
    if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');if(!r.rows.length)fail(409,'Rateio incompleto, dimensão incompatível, duplicidade ou revisão desatualizada.');return send({item:r.rows[0]},201);
   }
  }
  if(path==='/v1/management-dimensions'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND p.status='active'),
   items AS (SELECT d.id,d.company_id,p.legal_name AS company_name,d.kind,d.code,d.name,d.direction,d.accounting_reference,d.notes,d.status,d.created_at,d.deactivated_at,d.deactivation_reason FROM business.management_dimensions d JOIN core.parties p ON p.tenant_id=d.tenant_id AND p.id=d.company_id WHERE d.tenant_id=$1::uuid)
   SELECT jsonb_build_object('companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name,c.id) FROM companies c),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.company_name,i.kind,i.code) FROM items i),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/management-dimensions'&&request.method==='POST'){
   const b=await body(request),op=requestId(b);
   const clean=(key,max,required=false)=>{const v=b[key];if(v!=null&&typeof v!=='string')fail(400,'Campo gerencial inválido.');const x=(v||'').trim();if(x.length>max||(required&&!x))fail(400,'Campo obrigatório ou excede o limite.');return x||null;};
   const code=clean('code',40,true).toUpperCase(),name=clean('name',200,true),direction=clean('direction',20),account=clean('accounting_reference',100),notes=clean('notes',500);
   if(!UUID.test(b.company_id||'')||!['financial_category','cost_center','profit_center'].includes(b.kind)||!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code)||(b.kind==='financial_category'?!['receivable','payable'].includes(direction):!!(direction||account)))fail(400,'Confira empresa, tipo, código e classificação.');
   const r=await execute(sql,tenant,user,"SELECT dimension_id FROM business.create_management_dimension($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid)",[b.company_id,b.kind,code,name,direction,account,notes,op],true);
   if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');if(!r.rows.length)fail(409,'Código ou solicitação duplicada, ou empresa inválida.');return send({item:r.rows[0]},201);
  }
  const mdDeactivate=path.match(/^\/v1\/management-dimensions\/([^/]+)\/deactivate$/);
  if(mdDeactivate&&UUID.test(mdDeactivate[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>500)fail(400,'Informe a justificativa.');
   const r=await execute(sql,tenant,user,"SELECT dimension_id FROM business.deactivate_management_dimension($1::uuid,$2,$3::uuid)",[mdDeactivate[1],reason,op],true);
   if(r.role!=='owner')fail(403,'Controladoria restrita ao proprietário.');if(!r.rows.length)fail(409,'Dimensão inexistente ou já inativada.');return send({item:r.rows[0]});
  }
  if(path==='/v1/fiscal-dashboard'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 companies AS (SELECT c.party_id AS id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid),
 establishments AS (SELECT e.id,e.party_id AS company_id FROM core.establishments e JOIN companies c ON c.id=e.party_id WHERE e.tenant_id=$1::uuid AND e.status='active'),
 profiles AS (SELECT f.id,f.establishment_id,f.company_id,f.effective_on FROM business.fiscal_profiles f WHERE f.tenant_id=$1::uuid),
 docs AS (SELECT d.id,d.company_id,d.category,d.expires_on,d.code,d.title FROM business.documents d WHERE d.tenant_id=$1::uuid),
 versions AS (SELECT v.document_id,v.size_bytes FROM business.document_versions v WHERE v.tenant_id=$1::uuid),
 fiscal AS (SELECT f.company_id,f.document_id,f.direction,f.declared_status,f.total FROM business.fiscal_documents f WHERE f.tenant_id=$1::uuid),
 obligations AS (SELECT o.id,o.company_id,o.establishment_id,o.title,o.period,o.due_on,o.status,o.evidence_id FROM business.fiscal_obligations o WHERE o.tenant_id=$1::uuid),
 summaries AS (
 SELECT c.id,c.name,
 (SELECT count(*) FROM docs d WHERE d.company_id=c.id) AS documents,
 (SELECT count(*) FROM docs d WHERE d.company_id=c.id AND NOT EXISTS(SELECT 1 FROM versions v WHERE v.document_id=d.id)) AS no_attachment,
 (SELECT count(*) FROM docs d WHERE d.company_id=c.id AND d.expires_on<(SELECT today FROM clock)) AS expired,
 (SELECT count(*) FROM docs d WHERE d.company_id=c.id AND d.expires_on BETWEEN (SELECT today FROM clock) AND (SELECT today+30 FROM clock)) AS expiring,
 (SELECT count(*) FROM versions v JOIN docs d ON d.id=v.document_id WHERE d.company_id=c.id) AS versions,
 COALESCE((SELECT sum(v.size_bytes) FROM versions v JOIN docs d ON d.id=v.document_id WHERE d.company_id=c.id),0)::text AS bytes,
 (SELECT count(*) FROM establishments e WHERE e.company_id=c.id) AS establishments,
 (SELECT count(*) FROM establishments e WHERE e.company_id=c.id AND NOT EXISTS(SELECT 1 FROM profiles p WHERE p.establishment_id=e.id AND p.effective_on<=(SELECT today FROM clock))) AS missing_profile,
 (SELECT count(*) FROM docs d WHERE d.company_id=c.id AND d.category='fiscal' AND NOT EXISTS(SELECT 1 FROM fiscal f WHERE f.document_id=d.id)) AS unlinked_fiscal,
 (SELECT count(*) FROM fiscal f WHERE f.company_id=c.id AND f.direction='incoming') AS incoming,
 (SELECT count(*) FROM fiscal f WHERE f.company_id=c.id AND f.direction='outgoing') AS outgoing,
 (SELECT count(*) FROM fiscal f WHERE f.company_id=c.id AND f.declared_status='cancelled') AS cancelled_docs,
 COALESCE((SELECT sum(f.total) FROM fiscal f WHERE f.company_id=c.id AND f.direction='incoming' AND f.declared_status='issued'),0)::text AS incoming_value,
 COALESCE((SELECT sum(f.total) FROM fiscal f WHERE f.company_id=c.id AND f.direction='outgoing' AND f.declared_status='issued'),0)::text AS outgoing_value,
 (SELECT count(*) FROM obligations o WHERE o.company_id=c.id AND o.status='pending' AND o.due_on<(SELECT today FROM clock)) AS overdue,
 (SELECT count(*) FROM obligations o WHERE o.company_id=c.id AND o.status='pending' AND o.due_on BETWEEN (SELECT today FROM clock) AND (SELECT today+30 FROM clock)) AS due,
 (SELECT count(*) FROM obligations o WHERE o.company_id=c.id AND o.status='pending' AND o.due_on>(SELECT today+30 FROM clock)) AS future,
 (SELECT count(*) FROM obligations o WHERE o.company_id=c.id AND o.status='fulfilled') AS fulfilled,
 (SELECT count(*) FROM obligations o WHERE o.company_id=c.id AND o.status='fulfilled' AND o.evidence_id IS NULL) AS fulfilled_without_evidence,
 (SELECT count(*) FROM obligations o WHERE o.company_id=c.id AND o.status='cancelled') AS cancelled_obligations
 FROM companies c),
 deadlines AS (SELECT o.company_id,o.title,o.period,o.due_on::text AS due_on,CASE WHEN o.due_on<clock.today THEN 'overdue' ELSE 'due' END AS validity,row_number() OVER(PARTITION BY o.company_id ORDER BY o.due_on,o.id) AS position FROM obligations o CROSS JOIN clock WHERE o.status='pending' AND o.due_on<=clock.today+30),
 expiry AS (SELECT d.company_id,d.code::text AS code,d.title,d.expires_on::text AS expires_on,CASE WHEN d.expires_on<clock.today THEN 'expired' ELSE 'expiring' END AS validity,row_number() OVER(PARTITION BY d.company_id ORDER BY d.expires_on,d.id) AS position FROM docs d CROSS JOIN clock WHERE d.expires_on<=clock.today+30)
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM summaries s),'[]'::jsonb),'storage_bytes',COALESCE((SELECT sum(size_bytes) FROM versions),0)::text,'storage_limit',33554432,'deadlines',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.company_id,d.position) FROM deadlines d WHERE d.position<=20),'[]'::jsonb),'expiry',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.company_id,e.position) FROM expiry e WHERE e.position<=20),'[]'::jsonb)) AS dashboard`,[tenant]);
   if(r.role!=='owner')fail(403,'Painel GED e Fiscal restrito ao proprietário.');return send(r.rows[0]?.dashboard||{});
  }
  if(path==='/v1/fiscal-obligations'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
   establishments AS (SELECT e.id,e.party_id AS company_id,e.name,e.cnpj,p.legal_name AS company_name FROM core.establishments e JOIN business.companies c ON c.tenant_id=e.tenant_id AND c.party_id=e.party_id JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE e.tenant_id=$1::uuid AND e.status='active' AND p.status='active'),
   docs AS (SELECT id,company_id,code::text AS code,title FROM business.documents WHERE tenant_id=$1::uuid AND category='fiscal'),
   items AS (SELECT o.id,o.company_id,o.establishment_id,e.name AS establishment_name,p.legal_name AS company_name,o.title,o.kind,o.period,o.due_on::text AS due_on,o.source_reference,o.document_id,o.status,o.closed_on::text AS closed_on,o.closure_note,o.evidence_id,d.code::text AS document_code,v.code::text AS evidence_code,CASE WHEN o.status<>'pending' THEN o.status WHEN o.due_on<clock.today THEN 'overdue' WHEN o.due_on<=clock.today+30 THEN 'due' ELSE 'future' END AS validity FROM business.fiscal_obligations o JOIN core.establishments e ON e.tenant_id=o.tenant_id AND e.id=o.establishment_id JOIN core.parties p ON p.tenant_id=o.tenant_id AND p.id=o.company_id LEFT JOIN docs d ON d.id=o.document_id LEFT JOIN docs v ON v.id=o.evidence_id CROSS JOIN clock WHERE o.tenant_id=$1::uuid)
   SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'establishments',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.company_name,e.name) FROM establishments e),'[]'::jsonb),'documents',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code::bigint DESC) FROM docs d),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.due_on,i.id) FROM items i),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'Agenda fiscal restrita ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/fiscal-obligations'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),due=crmDate(b.due_on);
   const title=typeof b.title==='string'?b.title.trim():'',period=typeof b.period==='string'?b.period.trim():'',source=typeof b.source_reference==='string'?b.source_reference.trim():'';
   if(!UUID.test(b.establishment_id||'')||(b.document_id&&!UUID.test(b.document_id))||!due||!title||title.length>200||!period||period.length>60||!source||source.length>200||!['tax','declaration','certificate','registration','other'].includes(b.kind))fail(400,'Confira estabelecimento, tipo, período, vencimento e fonte.');
   const r=await execute(sql,tenant,user,"SELECT obligation_id FROM business.create_fiscal_obligation($1::uuid,$2,$3,$4,$5::date,$6,$7::uuid,$8::uuid)",[b.establishment_id,title,b.kind,period,due,source,b.document_id||null,op],true);
   if(r.role!=='owner')fail(403,'Agenda fiscal restrita ao proprietário.');if(!r.rows.length)fail(409,'Duplicidade, estabelecimento ou documento incompatível.');return send({item:r.rows[0]},201);
  }
  const fiscalClose=path.match(/^\/v1\/fiscal-obligations\/([^/]+)\/close$/);
  if(fiscalClose&&UUID.test(fiscalClose[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),date=crmDate(b.closed_on),note=typeof b.note==='string'?b.note.trim():'';
   if(!date||!note||note.length>1000||!['fulfilled','cancelled'].includes(b.status)||(b.evidence_id&&!UUID.test(b.evidence_id)))fail(400,'Informe situação, data e justificativa.');
   const r=await execute(sql,tenant,user,"SELECT obligation_id FROM business.close_fiscal_obligation($1::uuid,$2,$3::date,$4,$5::uuid,$6::uuid)",[fiscalClose[1],b.status,date,note,b.evidence_id||null,op],true);
   if(r.role!=='owner')fail(403,'Agenda fiscal restrita ao proprietário.');if(!r.rows.length)fail(409,'Obrigação encerrada, data futura ou comprovante incompatível.');return send({item:r.rows[0]});
  }
  if(path==='/v1/fiscal-documents'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH establishments AS (SELECT e.id,e.party_id AS company_id,e.name,e.cnpj,p.legal_name AS company_name FROM core.establishments e JOIN business.companies c ON c.tenant_id=e.tenant_id AND c.party_id=e.party_id JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE e.tenant_id=$1::uuid),
   docs AS (SELECT d.id,d.company_id,d.party_id,d.code::text AS code,d.title,d.issued_on::text AS issued_on FROM business.documents d WHERE d.tenant_id=$1::uuid AND d.category='fiscal' AND NOT EXISTS(SELECT 1 FROM business.fiscal_documents f WHERE f.tenant_id=d.tenant_id AND f.document_id=d.id)),
   parties AS (SELECT id,legal_name AS name FROM core.parties WHERE tenant_id=$1::uuid AND status='active'),
   items AS (SELECT f.id,f.company_id,f.establishment_id,f.fiscal_profile_id,f.document_id,f.counterparty_id,f.direction,f.kind,f.number,f.series,f.external_key,f.issued_on::text AS issued_on,f.total::text AS total,f.declared_status,f.source_reference,e.name AS establishment_name,e.cnpj,p.legal_name AS counterparty_name,d.code::text AS document_code,d.company_name,d.title AS document_title,fp.regime AS profile_regime,fp.effective_on::text AS profile_effective FROM business.fiscal_documents f JOIN core.establishments e ON e.tenant_id=f.tenant_id AND e.id=f.establishment_id JOIN core.parties p ON p.tenant_id=f.tenant_id AND p.id=f.counterparty_id JOIN business.documents d ON d.tenant_id=f.tenant_id AND d.id=f.document_id JOIN business.fiscal_profiles fp ON fp.tenant_id=f.tenant_id AND fp.id=f.fiscal_profile_id WHERE f.tenant_id=$1::uuid)
   SELECT jsonb_build_object('establishments',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.company_name,e.name) FROM establishments e),'[]'::jsonb),'documents',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code::bigint DESC) FROM docs d),'[]'::jsonb),'parties',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM parties p),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.issued_on DESC,i.id) FROM items i),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'Documentos fiscais restritos ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/fiscal-documents'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),issued=crmDate(b.issued_on);
   const clean=(key,max,required=true)=>{const v=b[key];if(v!=null&&typeof v!=='string')fail(400,'Campo fiscal inválido.');const x=(v||'').trim();if(x.length>max||(required&&!x))fail(400,'Campo obrigatório ou excede o limite.');return x||null;};
   const number=clean('number',60),series=clean('series',40),key=clean('external_key',120,false),source=clean('source_reference',200);
   if(![b.establishment_id,b.document_id,b.counterparty_id].every(x=>UUID.test(x||''))||!issued||!['incoming','outgoing'].includes(b.direction)||!['nfe','nfse','nfce','cte','other'].includes(b.kind)||!['issued','cancelled','other'].includes(b.declared_status)||typeof b.total!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(b.total))fail(400,'Confira identificação, direção, data, situação e valor.');
   const r=await execute(sql,tenant,user,"SELECT fiscal_document_id FROM business.create_fiscal_document($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::date,$10::numeric,$11,$12,$13::uuid)",[b.establishment_id,b.document_id,b.counterparty_id,b.direction,b.kind,number,series,key,issued,b.total,b.declared_status,source,op],true);
   if(r.role!=='owner')fail(403,'Documentos fiscais restritos ao proprietário.');if(!r.rows.length)fail(409,'Duplicidade, vínculo GED incompatível ou perfil fiscal ausente na emissão.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/ledger'&&request.method==='GET'){
   const company=new URL(request.url).searchParams.get('company'),year=Number(new URL(request.url).searchParams.get('year'));if(!UUID.test(company||'')||!Number.isInteger(year)||year<2000||year>2100)fail(400,'Selecione empresa e ano.');
   const r=await execute(sql,tenant,user,`WITH selected AS (SELECT party_id FROM business.companies WHERE tenant_id=$1::uuid AND party_id=$2::uuid AND business.hr_admin(tenant_id)), movements AS (SELECT (l->>'account_id')::uuid AS account_id,SUM((l->>'amount')::numeric) FILTER(WHERE l->>'side'='debit') AS debit,SUM((l->>'amount')::numeric) FILTER(WHERE l->>'side'='credit') AS credit FROM business.ledger_entries e CROSS JOIN LATERAL jsonb_array_elements(e.lines) l WHERE e.tenant_id=$1::uuid AND e.company_id=$2::uuid AND e.posted_on>=make_date($3,1,1) AND e.posted_on<make_date($3+1,1,1) GROUP BY 1) SELECT jsonb_build_object('allowed',EXISTS(SELECT 1 FROM selected),'accounts',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.code) FROM (SELECT a.id,a.code,a.name,a.kind,COALESCE(m.debit,0)::text AS debit,COALESCE(m.credit,0)::text AS credit,(COALESCE(m.debit,0)-COALESCE(m.credit,0))::text AS net FROM business.ledger_accounts a LEFT JOIN movements m ON m.account_id=a.id WHERE a.tenant_id=$1::uuid AND a.company_id=$2::uuid LIMIT 1000)a),'[]'::jsonb),'entries',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.posted_on DESC,e.created_at DESC) FROM (SELECT e.id,e.posted_on::text,e.description,e.source_reference,e.lines,e.reversal_of,e.created_at,EXISTS(SELECT 1 FROM business.ledger_entries x WHERE x.tenant_id=e.tenant_id AND x.reversal_of=e.id) AS reversed FROM business.ledger_entries e WHERE e.tenant_id=$1::uuid AND e.company_id=$2::uuid AND e.posted_on>=make_date($3,1,1) AND e.posted_on<make_date($3+1,1,1) ORDER BY e.posted_on DESC,e.created_at DESC LIMIT 200)e),'[]'::jsonb)) AS data`,[tenant,company,year]);if(r.role!=='owner'||r.rows[0]?.data?.allowed!==true)fail(403,'Diário restrito ao proprietário e empresa autorizada.');return send({...r.rows[0].data,year,official_accounting:false});
  }
  if(path==='/v1/ledger/accounts'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),code=typeof b.code==='string'?b.code.trim():'',name=typeof b.name==='string'?b.name.trim():'';
   if(!UUID.test(b.company_id||'')||!/^[0-9A-Z][0-9A-Z._-]{0,39}$/.test(code)||!name||name.length>120||!['asset','liability','equity','revenue','expense'].includes(b.kind)||b.confirmed!==true)fail(400,'Confirme empresa, código, nome e natureza da conta.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.ledger_accounts(tenant_id,company_id,code,name,kind,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::uuid WHERE business.hr_admin($1::uuid) AND EXISTS(SELECT 1 FROM business.companies WHERE tenant_id=$1::uuid AND party_id=$2::uuid) ON CONFLICT DO NOTHING RETURNING id`,[tenant,b.company_id,code,name,b.kind,op,user],true);if(r.role!=='owner')fail(403,'Diário restrito ao proprietário.');if(!r.rows.length)fail(409,'Empresa indisponível, código ou operação já registrado.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/ledger/entries'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),date=crmDate(b.posted_on),description=typeof b.description==='string'?b.description.trim():'',source=typeof b.source_reference==='string'?b.source_reference.trim():'';
   if(!UUID.test(b.company_id||'')||!date||!description||description.length>300||!source||source.length>200||!Array.isArray(b.lines)||b.lines.length<2||b.lines.length>100||b.lines.some(l=>!l||!UUID.test(l.account_id||'')||!['debit','credit'].includes(l.side)||typeof l.amount!=='string'||!/^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$/.test(l.amount))||b.confirmed!==true)fail(400,'Confirme empresa, data, documento e partidas.');
   const lines=JSON.stringify(b.lines.map(l=>({account_id:l.account_id,side:l.side,amount:l.amount})));
   const r=await execute(sql,tenant,user,`INSERT INTO business.ledger_entries(tenant_id,company_id,posted_on,description,source_reference,lines,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3::date,$4,$5,$6::jsonb,$7::uuid,$8::uuid WHERE business.ledger_entry_valid($1::uuid,$2::uuid,$3::date,$6::jsonb,NULL) ON CONFLICT DO NOTHING RETURNING id`,[tenant,b.company_id,date,description,source,lines,op,user],true);if(r.role!=='owner')fail(403,'Diário restrito ao proprietário.');if(!r.rows.length)fail(409,'Partidas desequilibradas, período fechado, data inválida ou operação duplicada.');return send({item:r.rows[0]},201);
  }
  const ledgerReverse=path.match(/^\/v1\/ledger\/entries\/([^/]+)\/reverse$/);
  if(ledgerReverse&&UUID.test(ledgerReverse[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),date=crmDate(b.posted_on),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!date||!reason||reason.length>300||b.confirmed!==true)fail(400,'Confirme data e motivo do estorno.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.ledger_entries(tenant_id,company_id,posted_on,description,source_reference,lines,reversal_of,operation_id,created_by) SELECT e.tenant_id,e.company_id,$3::date,$4,e.source_reference,business.ledger_reverse_lines(e.lines),e.id,$5::uuid,$6::uuid FROM business.ledger_entries e WHERE e.tenant_id=$1::uuid AND e.id=$2::uuid AND business.ledger_entry_valid(e.tenant_id,e.company_id,$3::date,business.ledger_reverse_lines(e.lines),e.id) ON CONFLICT DO NOTHING RETURNING id`,[tenant,ledgerReverse[1],date,reason,op,user],true);if(r.role!=='owner')fail(403,'Diário restrito ao proprietário.');if(!r.rows.length)fail(409,'Estorno inválido, já registrado ou período fechado.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/tax/simulations'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT id,rule_id,rule_code,rule_effective_on::text,reference_on::text,base_amount::text,rate_percent::text,result_amount::text,formula_version,assumptions,rule_source,review_evidence,created_at FROM business.tax_simulations WHERE tenant_id=$1::uuid ORDER BY created_at DESC,id LIMIT 500`,[tenant]);if(r.role!=='owner')fail(403,'Tax Engine restrito ao proprietário.');return send({items:r.rows,official_calculation:false,limit:500});
  }
  if(path==='/v1/tax/simulations'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),date=crmDate(b.reference_on),assumptions=typeof b.assumptions==='string'?b.assumptions.trim():'';
   if(!UUID.test(b.rule_id||'')||!date||typeof b.base_amount!=='string'||!/^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$/.test(b.base_amount)||typeof b.rate_percent!=='string'||!/^(0|[1-9][0-9]{0,2})([.][0-9]{1,6})?$/.test(b.rate_percent)||Number(b.rate_percent)>100||!assumptions||assumptions.length>1000||b.confirmed!==true)fail(400,'Informe regra, data, base, percentual e premissas da simulação.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.tax_simulations(tenant_id,rule_id,reference_on,base_amount,rate_percent,assumptions,rule_code,rule_effective_on,rule_source,review_evidence,operation_id,created_by) SELECT v.tenant_id,v.id,$3::date,$4::numeric,$5::numeric,$6,v.rule_code,v.effective_on,v.source_reference,a.evidence,$7::uuid,$8::uuid FROM business.tax_rule_versions v JOIN business.tax_rule_reviews a ON a.tenant_id=v.tenant_id AND a.rule_id=v.id AND a.decision='reviewed' WHERE v.tenant_id=$1::uuid AND v.id=$2::uuid AND business.hr_admin(v.tenant_id) AND v.effective_on<=$3::date AND (v.valid_until IS NULL OR v.valid_until>=$3::date) AND NOT EXISTS(SELECT 1 FROM business.tax_rule_versions x WHERE x.tenant_id=v.tenant_id AND x.rule_code=v.rule_code AND x.id<>v.id AND x.effective_on<=$3::date AND (x.valid_until IS NULL OR x.valid_until>=$3::date)) ON CONFLICT DO NOTHING RETURNING id,result_amount::text,formula_version`,[tenant,b.rule_id,date,b.base_amount,b.rate_percent,assumptions,op,user],true);if(r.role!=='owner')fail(403,'Tax Engine restrito ao proprietário.');if(!r.rows.length)fail(409,'Regra não revisada, fora da vigência, vigência ambígua ou operação já registrada.');return send({item:r.rows[0],official_calculation:false},201);
  }
  if(path==='/v1/tax/rules'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT v.id,v.rule_code,v.effective_on::text,v.valid_until::text,v.tax_name,v.jurisdiction,v.locality,v.applicability,v.source_reference,v.notes,v.created_at,COALESCE(a.decision,'draft') AS review_status,a.evidence,a.created_at AS reviewed_at FROM business.tax_rule_versions v LEFT JOIN business.tax_rule_reviews a ON a.tenant_id=v.tenant_id AND a.rule_id=v.id WHERE v.tenant_id=$1::uuid ORDER BY v.rule_code,v.effective_on DESC LIMIT 500`,[tenant]);if(r.role!=='owner')fail(403,'Tax Engine restrito ao proprietário.');return send({items:r.rows,official_calculation:false,limit:500});
  }
  if(path==='/v1/tax/rules'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),from=crmDate(b.effective_on),until=b.valid_until?crmDate(b.valid_until):null;
   const clean=(key,max)=>{const v=typeof b[key]==='string'?b[key].trim():'';if(!v||v.length>max)fail(400,'Campo de regra inválido.');return v;};
   const code=clean('rule_code',40),name=clean('tax_name',100),locality=clean('locality',100),applicability=clean('applicability',500),source=clean('source_reference',500),notes=clean('notes',1000);
   if(!/^[A-Z0-9_-]{2,40}$/.test(code)||!from||(b.valid_until&&!until)||(until&&until<from)||!['federal','state','municipal'].includes(b.jurisdiction)||b.confirmed!==true)fail(400,'Confirme código, jurisdição, vigência e fonte.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.tax_rule_versions(tenant_id,rule_code,effective_on,valid_until,tax_name,jurisdiction,locality,applicability,source_reference,notes,operation_id,created_by) SELECT $1::uuid,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11::uuid,$12::uuid WHERE business.hr_admin($1::uuid) ON CONFLICT DO NOTHING RETURNING id`,[tenant,code,from,until,name,b.jurisdiction,locality,applicability,source,notes,op,user],true);if(r.role!=='owner')fail(403,'Tax Engine restrito ao proprietário.');if(!r.rows.length)fail(409,'Código e vigência ou operação já registrados.');return send({item:r.rows[0]},201);
  }
  const taxReview=path.match(/^\/v1\/tax\/rules\/([^/]+)\/review$/);
  if(taxReview&&UUID.test(taxReview[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),evidence=typeof b.evidence==='string'?b.evidence.trim():'';
   if(!['reviewed','rejected'].includes(b.decision)||!evidence||evidence.length>500||b.confirmed!==true)fail(400,'Confirme decisão e evidência documental.');
   const r=await execute(sql,tenant,user,`INSERT INTO business.tax_rule_reviews(tenant_id,rule_id,decision,evidence,operation_id,created_by) SELECT $1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid WHERE business.hr_admin($1::uuid) AND EXISTS(SELECT 1 FROM business.tax_rule_versions WHERE tenant_id=$1::uuid AND id=$2::uuid) ON CONFLICT DO NOTHING RETURNING id`,[tenant,taxReview[1],b.decision,evidence,op,user],true);if(r.role!=='owner')fail(403,'Tax Engine restrito ao proprietário.');if(!r.rows.length)fail(409,'Regra indisponível ou revisão já registrada.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/fiscal-profiles'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH establishments AS (SELECT e.id,e.party_id AS company_id,e.name,e.cnpj,p.legal_name AS company_name FROM core.establishments e JOIN business.companies c ON c.tenant_id=e.tenant_id AND c.party_id=e.party_id JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE e.tenant_id=$1::uuid AND e.status='active' AND p.status='active'),
   profiles AS (SELECT f.id,f.company_id,f.establishment_id,f.company_name,f.establishment_name,f.cnpj,f.effective_on::text AS effective_on,f.regime,f.nature_code,f.cnae,f.uf,f.municipality_code,f.state_registration,f.municipal_registration,f.address,f.source_reference,f.created_at,CASE WHEN f.effective_on>(now() AT TIME ZONE 'America/Fortaleza')::date THEN 'future' WHEN EXISTS(SELECT 1 FROM business.fiscal_profiles x WHERE x.tenant_id=f.tenant_id AND x.establishment_id=f.establishment_id AND x.effective_on>f.effective_on AND x.effective_on<=(now() AT TIME ZONE 'America/Fortaleza')::date) THEN 'historical' ELSE 'current' END AS validity FROM business.fiscal_profiles f WHERE f.tenant_id=$1::uuid)
   SELECT jsonb_build_object('establishments',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.company_name,e.name) FROM establishments e),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.effective_on DESC,f.created_at DESC) FROM profiles f),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'Cadastro fiscal restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/fiscal-profiles'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),effective=crmDate(b.effective_on);
   const clean=(key,max,required=false)=>{const v=b[key];if(v!=null&&typeof v!=='string')fail(400,'Campo fiscal inválido.');const x=(v||'').trim();if(x.length>max||(required&&!x))fail(400,'Campo fiscal obrigatório ou excede o limite.');return x||null;};
   const regime=clean('regime',120,true),nature=clean('nature_code',4),cnae=clean('cnae',7),uf=clean('uf',2,true),municipality=clean('municipality_code',7,true),ie=clean('state_registration',40),im=clean('municipal_registration',40),address=clean('address',500),source=clean('source_reference',200,true);
   if(!UUID.test(b.company_id||'')||!UUID.test(b.establishment_id||'')||!effective||(nature&&!/^\d{4}$/.test(nature))||(cnae&&!/^\d{7}$/.test(cnae))||!/^\d{7}$/.test(municipality)||!['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(uf))fail(400,'Confira estabelecimento, vigência, códigos e UF.');
   const r=await execute(sql,tenant,user,"SELECT profile_id FROM business.create_fiscal_profile($1::uuid,$2::uuid,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid)",[b.company_id,b.establishment_id,effective,regime,nature,cnae,uf,municipality,ie,im,address,source,op],true);
   if(r.role!=='owner')fail(403,'Cadastro fiscal restrito ao proprietário.');if(!r.rows.length)fail(409,'Estabelecimento inválido ou vigência já registrada.');return send({item:r.rows[0]},201);
  }
  const docVersions=path.match(/^\/v1\/documents\/([^/]+)\/versions$/);
  if(docVersions&&UUID.test(docVersions[1])){
   const doc=docVersions[1];
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,version_no,filename,size_bytes,sha256_hex,note,created_at FROM business.document_versions WHERE tenant_id=$1::uuid AND document_id=$2::uuid ORDER BY version_no DESC",[tenant,doc]);
    if(r.role!=='owner')fail(403,'GED restrito ao proprietário.');return send({items:r.rows});
   }
   if(request.method==='POST'){
    const auth=await execute(sql,tenant,user,"SELECT id FROM business.documents WHERE tenant_id=$1::uuid AND id=$2::uuid",[tenant,doc]);
    if(auth.role!=='owner')fail(403,'GED restrito ao proprietário.');if(!auth.rows.length)fail(404,'Documento não encontrado.');
    const b=await body(request,1405000),op=requestId(b),filename=typeof b.filename==='string'?b.filename.trim():'',note=typeof b.note==='string'?b.note.trim():'';
    if(filename.length<5||filename.length>180||!filename.toLowerCase().endsWith('.pdf')||/[\\/\x00-\x1f\x7f]/.test(filename)||!note||note.length>500||typeof b.content!=='string'||b.content.length>1398104||! /^[A-Za-z0-9+/]+={0,2}$/.test(b.content)||b.content.length%4!==0||!b.content.startsWith('JVBERi0'))fail(400,'Informe PDF de até 1 MiB, nome e descrição da versão.');
    const r=await execute(sql,tenant,user,"SELECT * FROM business.create_document_version($1::uuid,$2,$3,$4,$5::uuid)",[doc,filename,b.content,note,op],true);
    if(!r.rows.length)fail(409,'Arquivo repetido, limite atingido ou documento inválido.');
    return send({item:r.rows[0]},201);
   }
  }
  const versionDownload=path.match(/^\/v1\/document-versions\/([^/]+)\/download$/);
  if(versionDownload&&UUID.test(versionDownload[1])&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT filename,replace(encode(content,'base64'),chr(10),'') AS content,sha256_hex,size_bytes FROM business.document_versions WHERE tenant_id=$1::uuid AND id=$2::uuid",[tenant,versionDownload[1]]);
   if(r.role!=='owner')fail(403,'GED restrito ao proprietário.');if(!r.rows.length)fail(404,'Versão não encontrada.');
   const x=r.rows[0],bytes=Uint8Array.from(atob(x.content),c=>c.charCodeAt(0)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==x.sha256_hex||bytes.length!==x.size_bytes)fail(500,'Integridade do arquivo não confirmada.');
   return send({item:x});
  }
  if(path==='/v1/documents'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT p.id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND p.status='active'),
   parties AS (SELECT id,legal_name AS name FROM core.parties WHERE tenant_id=$1::uuid AND status='active'),
   docs AS (SELECT id,code::text AS code,company_id,company_name,party_id,party_name,category,title,reference,issued_on::text AS issued_on,expires_on::text AS expires_on,notes,created_at,CASE WHEN expires_on<(now() AT TIME ZONE 'America/Fortaleza')::date THEN 'expired' WHEN expires_on<=(now() AT TIME ZONE 'America/Fortaleza')::date+30 THEN 'due' ELSE 'current' END AS validity FROM business.documents WHERE tenant_id=$1::uuid)
   SELECT jsonb_build_object('companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name,c.id) FROM companies c),'[]'::jsonb),'parties',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name,p.id) FROM parties p),'[]'::jsonb),'items',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code::bigint DESC) FROM docs d),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'GED restrito ao proprietário.');
   return send(r.rows[0]?.data||{});
  }
  if(path==='/v1/documents'&&request.method==='POST'){
   const b=await body(request),op=requestId(b),issued=crmDate(b.issued_on),expires=crmDate(b.expires_on);
   const title=typeof b.title==='string'?b.title.trim():'',ref=typeof b.reference==='string'?b.reference.trim():'',notes=typeof b.notes==='string'?b.notes.trim():'';
   if(!UUID.test(b.company_id||'')||(b.party_id&&!UUID.test(b.party_id))||!['corporate','commercial','contract','financial','fiscal','operational','other'].includes(b.category)||!title||title.length>200||!ref||ref.length>200||notes.length>1000)fail(400,'Informe empresa, categoria, título e referência válidos.');
   const r=await execute(sql,tenant,user,"SELECT document_id,document_code::text AS document_code FROM business.create_document($1::uuid,$2::uuid,$3,$4,$5,$6::date,$7::date,$8,$9::uuid)",[b.company_id,b.party_id||null,b.category,title,ref,issued,expires,notes||null,op],true);
   if(r.role!=='owner')fail(403,'GED restrito ao proprietário.');
   if(!r.rows.length)fail(409,'Cadastro duplicado, empresa ou parceiro inválido, ou datas inconsistentes.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/purchase-dashboard'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 companies AS (SELECT p.id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid),
 requests AS (SELECT r.*,COALESCE((SELECT sum(l.estimated_total) FROM business.purchase_request_lines l WHERE l.tenant_id=r.tenant_id AND l.request_id=r.id),0) AS estimate FROM business.purchase_requests r WHERE r.tenant_id=$1::uuid),
 quotes AS (SELECT q.*,r.company_id FROM business.purchase_quotes q JOIN requests r ON r.id=q.request_id WHERE q.tenant_id=$1::uuid),
 orders AS (SELECT o.* FROM business.purchase_orders o WHERE o.tenant_id=$1::uuid),
 receipts AS (SELECT r.*,o.company_id FROM business.purchase_receipts r JOIN orders o ON o.id=r.order_id WHERE r.tenant_id=$1::uuid),
 balances AS (SELECT o.id,o.company_id,COALESCE(bool_and(COALESCE(x.received,0)>=(l->>'quantity')::numeric),false) AS complete FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.lines) l LEFT JOIN LATERAL (SELECT sum((rl->>'quantity')::numeric) AS received FROM receipts r CROSS JOIN LATERAL jsonb_array_elements(r.lines) rl WHERE r.order_id=o.id AND rl->>'line_id'=l->>'line_id') x ON true WHERE o.status='approved' GROUP BY o.id,o.company_id),
 suppliers AS (SELECT o.company_id,o.supplier_id,max(o.supplier_name) AS name,count(*) AS orders,sum(o.total)::text AS total FROM orders o WHERE o.status='approved' GROUP BY o.company_id,o.supplier_id),
 summaries AS (SELECT c.id,c.name,
 (SELECT count(*) FROM requests r WHERE r.company_id=c.id) AS requests,
 (SELECT count(*) FROM requests r WHERE r.company_id=c.id AND r.status='submitted') AS awaiting_request,
 (SELECT count(*) FROM requests r WHERE r.company_id=c.id AND r.status IN ('draft','submitted') AND r.priority='urgent') AS urgent,
 (SELECT count(*) FROM requests r WHERE r.company_id=c.id AND r.status IN ('draft','submitted','approved') AND r.needed_on<(SELECT today FROM clock) AND NOT EXISTS(SELECT 1 FROM orders o JOIN balances b ON b.id=o.id WHERE o.request_id=r.id AND b.complete)) AS late_requests,
 (SELECT count(*) FROM requests r WHERE r.company_id=c.id AND r.status='approved' AND NOT EXISTS(SELECT 1 FROM quotes q WHERE q.request_id=r.id AND q.valid_until>=(SELECT today FROM clock)) AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.request_id=r.id AND o.status IN ('pending','approved'))) AS awaiting_quote,
 (SELECT count(*) FROM quotes q WHERE q.company_id=c.id) AS quotes,
 (SELECT count(*) FROM quotes q WHERE q.company_id=c.id AND q.valid_until<(SELECT today FROM clock)) AS expired_quotes,
 (SELECT count(*) FROM orders o WHERE o.company_id=c.id AND o.status='pending') AS awaiting_order,
 (SELECT count(*) FROM orders o WHERE o.company_id=c.id AND o.status='approved') AS approved_orders,
 COALESCE((SELECT sum(o.total) FROM orders o WHERE o.company_id=c.id AND o.status='approved'),0)::text AS ordered_value,
 (SELECT count(*) FROM balances b WHERE b.company_id=c.id AND NOT b.complete) AS awaiting_delivery,
 (SELECT count(*) FROM balances b WHERE b.company_id=c.id AND b.complete) AS delivered_orders,
 (SELECT count(*) FROM receipts r WHERE r.company_id=c.id AND r.status='matched') AS matched,
 (SELECT count(*) FROM receipts r WHERE r.company_id=c.id AND r.status='divergent') AS divergent,
 COALESCE((SELECT sum(r.expected_total) FROM receipts r WHERE r.company_id=c.id AND r.status='matched'),0)::text AS matched_value,
 CASE WHEN EXISTS(SELECT 1 FROM business.tenant_memberships m WHERE m.tenant_id=$1::uuid AND m.user_id::text=current_setting('anna.actor_id',true) AND m.active AND m.role='owner') THEN jsonb_build_object(
 'integrated',(SELECT count(*) FROM receipts r JOIN business.financial_obligations f ON f.tenant_id=r.tenant_id AND f.purchase_receipt_id=r.id WHERE r.company_id=c.id),
 'pending',(SELECT count(*) FROM receipts r WHERE r.company_id=c.id AND r.status='matched' AND r.document_total>0 AND NOT EXISTS(SELECT 1 FROM business.financial_obligations f WHERE f.tenant_id=r.tenant_id AND f.purchase_receipt_id=r.id)),
 'value',COALESCE((SELECT sum(f.amount) FROM receipts r JOIN business.financial_obligations f ON f.tenant_id=r.tenant_id AND f.purchase_receipt_id=r.id WHERE r.company_id=c.id),0)::text) ELSE NULL END AS finance
 FROM companies c)
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM summaries s),'[]'::jsonb),'suppliers',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.company_id,s.total::numeric DESC,s.supplier_id) FROM suppliers s),'[]'::jsonb)) AS dashboard`,[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Painel restrito à equipe de compras.');
   return send(r.rows[0]?.dashboard||{});
  }
  const orderMatch=path.match(/^\/v1\/purchase-requests\/([^/]+)\/orders$/);
  if(orderMatch&&UUID.test(orderMatch[1])){
   const rid=orderMatch[1];
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,code::text AS code,quote_id,supplier_name,company_name,quote_reference,valid_until::text,delivery_days,payment_terms,lines,total::text,justification,status,revision,decision_reason,created_at,decided_at FROM business.purchase_orders WHERE tenant_id=$1::uuid AND request_id=$2::uuid ORDER BY code DESC",[tenant,rid]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'Pedidos restritos à equipe de compras.');
    return send({items:r.rows,can_approve:r.role==='owner'});
   }
   if(request.method==='POST'){
    const b=await body(request),op=requestId(b),why=typeof b.justification==='string'?b.justification.trim():'';
    if(!UUID.test(b.quote_id||'')||!why||why.length>1000)fail(400,'Informe cotação e justificativa.');
    const r=await execute(sql,tenant,user,"SELECT order_id FROM business.create_purchase_order($1::uuid,$2::uuid,$3,$4::uuid)",[rid,b.quote_id,why,op],true);
    if(!r.rows.length)fail(409,'Cotação inválida ou vencida, requisição não aprovada ou pedido já existente.');
    return send({item:r.rows[0]},201);
   }
  }
  const purchasePayableMatch=path.match(/^\/v1\/purchase-receipts\/([^/]+)\/payable$/);
  if(purchasePayableMatch&&UUID.test(purchasePayableMatch[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),due=crmDate(b.first_due);
   if(!due||!Number.isInteger(b.installment_count)||b.installment_count<1||b.installment_count>24)fail(400,'Informe vencimento e quantidade de parcelas entre 1 e 24.');
   const r=await execute(sql,tenant,user,"SELECT obligation_id,obligation_code::text AS obligation_code FROM business.create_purchase_payable($1::uuid,$2::date,$3::integer,$4::uuid)",[purchasePayableMatch[1],due,b.installment_count,op],true);
   if(r.role!=='owner')fail(403,'Integração financeira restrita ao proprietário.');
   if(!r.rows.length)fail(409,'Recebimento divergente, já integrado, sem valor positivo ou condições inválidas.');
   return send({item:r.rows[0]},201);
  }
  const receiptMatch=path.match(/^\/v1\/purchase-orders\/([^/]+)\/receipts$/);
  if(receiptMatch&&UUID.test(receiptMatch[1])){
   const oid=receiptMatch[1];
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT r.id,r.code::text AS code,r.reference,r.received_on::text AS received_on,r.notes,r.lines,r.document_total::text AS document_total,r.expected_total::text AS expected_total,r.status,r.created_at,(SELECT o.code::text FROM business.financial_obligations o WHERE o.tenant_id=r.tenant_id AND o.purchase_receipt_id=r.id) AS payable_code FROM business.purchase_receipts r WHERE r.tenant_id=$1::uuid AND r.order_id=$2::uuid ORDER BY r.code",[tenant,oid]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'Recebimentos restritos à equipe de compras.');
    return send({items:r.rows,can_integrate:r.role==='owner'});
   }
   if(request.method==='POST'){
    const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'',notes=typeof b.notes==='string'?b.notes.trim():'',date=crmDate(b.received_on);
    const qty=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,3})?$/.test(v);
    const price=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(v);
    if(!ref||ref.length>200||!notes||notes.length>1000||!date||typeof b.document_total!=='string'||!/^(?:0|[1-9][0-9]{0,21})(?:\.[0-9]{1,2})?$/.test(b.document_total)||!Array.isArray(b.lines)||b.lines.length<1||b.lines.length>20||b.lines.some(l=>!l||!UUID.test(l.line_id||'')||!qty(l.quantity)||!qty(l.document_quantity)||!price(l.document_unit_price)))fail(400,'Informe documento, data, observação, quantidades e preços válidos.');
    const r=await execute(sql,tenant,user,"SELECT receipt_id FROM business.create_purchase_receipt($1::uuid,$2,$3::date,$4,$5::jsonb,$6::numeric,$7::uuid)",[oid,ref,date,notes,JSON.stringify(b.lines),b.document_total,op],true);
    if(!r.rows.length)fail(409,'Pedido inválido, saldo insuficiente, data inválida ou documento duplicado.');
    return send({item:r.rows[0]},201);
   }
  }
  const orderDecision=path.match(/^\/v1\/purchase-orders\/([^/]+)\/decide$/);
  if(orderDecision&&UUID.test(orderDecision[1])&&request.method==='POST'){
   const b=await body(request),op=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!['approved','rejected'].includes(b.status)||b.revision!==1||!reason||reason.length>1000)fail(400,'Informe decisão, revisão e justificativa.');
   const r=await execute(sql,tenant,user,"SELECT order_id FROM business.decide_purchase_order($1::uuid,$2::integer,$3,$4,$5::uuid)",[orderDecision[1],b.revision,b.status,reason,op],true);
   if(r.role!=='owner')fail(403,'Aprovação restrita ao proprietário.');
   if(!r.rows.length)fail(409,'Decisão não autorizada, revisão desatualizada ou cotação vencida.');
   return send({item:r.rows[0]});
  }
  const quoteMatch=path.match(/^\/v1\/purchase-requests\/([^/]+)\/quotes$/);
  if(quoteMatch&&UUID.test(quoteMatch[1])){
   const rid=quoteMatch[1];
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,supplier_id,supplier_name,reference,valid_until::text,delivery_days,payment_terms,lines,total::text,created_at,(valid_until >= (now() AT TIME ZONE 'America/Fortaleza')::date) AS current FROM business.purchase_quotes WHERE tenant_id=$1::uuid AND request_id=$2::uuid ORDER BY total,created_at,id",[tenant,rid]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'Cotações restritas à equipe de compras.');
    return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request),op=requestId(b),ref=typeof b.reference==='string'?b.reference.trim():'',terms=typeof b.payment_terms==='string'?b.payment_terms.trim():'',valid=crmDate(b.valid_until);
    if(!UUID.test(b.supplier_id||'')||!ref||ref.length>200||!terms||terms.length>300||!valid||!Number.isInteger(b.delivery_days)||b.delivery_days<0||b.delivery_days>3650||!Array.isArray(b.lines)||b.lines.length<1||b.lines.length>20||b.lines.some(l=>!l||!UUID.test(l.line_id||'')||typeof l.unit_price!=='string'||! /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(l.unit_price)))fail(400,'Informe fornecedor, referência, validade, prazo, pagamento e todos os preços.');
    const r=await execute(sql,tenant,user,"SELECT quote_id FROM business.create_purchase_quote($1::uuid,$2::uuid,$3,$4::date,$5::integer,$6,$7::jsonb,$8::uuid)",[rid,b.supplier_id,ref,valid,b.delivery_days,terms,JSON.stringify(b.lines),op],true);
    if(!r.rows.length)fail(409,'Cotação duplicada, fornecedor inválido, validade vencida ou requisição não aprovada/completa.');
    return send({item:r.rows[0]},201);
   }
  }
  if(path==='/v1/purchase-requests'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH companies AS (SELECT p.id,p.legal_name AS name FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id WHERE b.tenant_id=$1::uuid AND p.status='active'),
 suppliers AS (SELECT p.id,p.legal_name AS name FROM business.party_roles r JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=r.party_id WHERE r.tenant_id=$1::uuid AND r.role='supplier' AND r.active AND p.status='active'),
 items AS (SELECT id,code::text AS code,name,kind,unit FROM business.catalog_items WHERE tenant_id=$1::uuid AND status='active'),
 requests AS (SELECT r.id,r.code::text AS code,r.company_id,r.supplier_id,r.company_name,r.supplier_name,r.title,r.justification,r.needed_on::text AS needed_on,r.priority,r.status,r.revision,r.created_at,r.created_by,COALESCE(sum(l.estimated_total),0)::text AS total,COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'item_id',l.item_id,'item_code',l.item_code::text,'item_name',l.item_name,'unit',l.unit,'quantity',l.quantity::text,'estimated_unit_price',l.estimated_unit_price::text,'estimated_total',l.estimated_total::text) ORDER BY l.item_code) FILTER(WHERE l.id IS NOT NULL),'[]'::jsonb) AS lines FROM business.purchase_requests r LEFT JOIN business.purchase_request_lines l ON l.tenant_id=r.tenant_id AND l.request_id=r.id WHERE r.tenant_id=$1::uuid GROUP BY r.id)
 SELECT jsonb_build_object('as_of',(now() AT TIME ZONE 'America/Fortaleza')::date::text,'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM companies c),'[]'::jsonb),'suppliers',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) FROM suppliers s),'[]'::jsonb),'catalog',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.name,i.code) FROM items i),'[]'::jsonb),'requests',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.code) FROM requests r),'[]'::jsonb)) AS data`,[tenant]);if(!['owner','registry_editor'].includes(r.role))fail(403,'Compras restritas à equipe autorizada.');
   return send({...r.rows[0]?.data,actor_id:user,can_approve:r.role==='owner'});
  }
  if(path==='/v1/purchase-requests'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),company=b.company_id,supplier=b.supplier_id||null,title=name(b.title),justification=typeof b.justification==='string'?b.justification.trim():'',needed=crmDate(b.needed_on),priority=b.priority,lines=b.lines;
   const uuid=v=>typeof v==='string'&&UUID.test(v),quantity=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,3})?$/.test(v)&&Number(v)>0,price=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(v);
   if(!uuid(company)||(supplier!==null&&!uuid(supplier))||!justification||justification.length>1000||!['normal','urgent'].includes(priority)||!Array.isArray(lines)||lines.length<1||lines.length>20||lines.some(l=>!l||!uuid(l.item_id)||!quantity(l.quantity)||!price(l.estimated_unit_price)))fail(400,'Informe empresa, justificativa, prioridade e até 20 itens com quantidade e estimativa válidas.');
   const r=await execute(sql,tenant,user,"SELECT purchase_id,purchase_code::text AS purchase_code FROM business.create_purchase_request($1::uuid,$2::uuid,$3,$4,$5::date,$6,$7::jsonb,$8::uuid)",[company,supplier,title,justification,needed,priority,JSON.stringify(lines.map(l=>({item_id:l.item_id,quantity:l.quantity,estimated_unit_price:l.estimated_unit_price}))),id],true);
   if(!r.rows.length)fail(409,'Requisição duplicada, fornecedor, empresa, item ou data incompatível.');return send({item:r.rows[0]},201);
  }
  const purchaseMatch=path.match(/^\/v1\/purchase-requests\/([^/]+)\/(history|advance)$/);
  if(purchaseMatch&&UUID.test(purchaseMatch[1])){
   const purchase=purchaseMatch[1];
   if(purchaseMatch[2]==='history'&&request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,from_status,to_status,reason,created_by,created_at FROM business.purchase_request_events WHERE tenant_id=$1::uuid AND request_id=$2::uuid ORDER BY created_at,id",[tenant,purchase]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'Compras restritas à equipe autorizada.');return send({items:r.rows});
   }
   if(purchaseMatch[2]==='advance'&&request.method==='POST'){
    const b=await body(request),id=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
    if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646||!['submitted','approved','rejected','cancelled'].includes(b.status)||reason.length>300||(['rejected','cancelled'].includes(b.status)&&!reason))fail(400,'Informe revisão, decisão e motivo quando obrigatório.');
    const r=await execute(sql,tenant,user,"SELECT * FROM business.advance_purchase_request($1::uuid,$2::integer,$3,$4,$5::uuid)",[purchase,b.revision,b.status,reason||null,id],true);
    if(!r.rows.length)fail(409,'Transição não autorizada ou revisão desatualizada.');return send({item:r.rows[0]});
   }
  }
  if(path==='/v1/finance-dashboard'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 companies AS (SELECT p.id,p.legal_name AS name FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id WHERE b.tenant_id=$1::uuid),
 obligations AS (SELECT o.id,o.company_id,o.direction,o.counterparty_id,o.counterparty_name,o.code::text AS code,o.title,o.amount,o.contract_id,o.contract_revision,c.revision AS current_revision FROM business.financial_obligations o LEFT JOIN business.contracts c ON c.tenant_id=o.tenant_id AND c.id=o.contract_id WHERE o.tenant_id=$1::uuid),
 installments AS (SELECT i.id,o.company_id,o.direction,o.counterparty_id,o.counterparty_name,o.code,o.title,i.due_on,i.remaining,i.status,clock.today-i.due_on AS days_late FROM business.financial_installments i JOIN obligations o ON o.id=i.obligation_id CROSS JOIN clock WHERE i.tenant_id=$1::uuid),
 settlements AS (SELECT s.id,o.company_id,o.direction,s.principal,s.discount,s.interest,s.fine,s.cash_amount,s.settled_on,v.reversed_on,l.account_id FROM business.financial_settlements s JOIN business.financial_installments i ON i.tenant_id=s.tenant_id AND i.id=s.installment_id JOIN obligations o ON o.id=i.obligation_id LEFT JOIN business.financial_reversals v ON v.tenant_id=s.tenant_id AND v.settlement_id=s.id LEFT JOIN business.treasury_settlement_links l ON l.tenant_id=s.tenant_id AND l.settlement_id=s.id WHERE s.tenant_id=$1::uuid),
 movements AS (SELECT m.*,a.company_id FROM business.treasury_movements m JOIN business.treasury_accounts a ON a.tenant_id=m.tenant_id AND a.id=m.account_id WHERE m.tenant_id=$1::uuid),
 balances AS (SELECT a.id,a.company_id,a.opening_balance+COALESCE((SELECT sum(m.amount) FROM movements m WHERE m.account_id=a.id),0) AS balance FROM business.treasury_accounts a WHERE a.tenant_id=$1::uuid),
 reviews AS (SELECT r.account_id,r.source_id,r.kind,r.result FROM business.treasury_reconciliations r WHERE r.tenant_id=$1::uuid AND NOT EXISTS (SELECT 1 FROM business.treasury_reconciliation_voids v WHERE v.tenant_id=r.tenant_id AND v.reconciliation_id=r.id)),
 review_states AS (SELECT m.company_id,COALESCE(r.result,'pending') AS result FROM movements m LEFT JOIN reviews r ON r.account_id=m.account_id AND r.source_id=m.source_id AND r.kind=m.kind),
 recurring AS (SELECT r.company_id,r.status,r.periods-(SELECT count(*) FROM business.financial_recurring_occurrences x WHERE x.tenant_id=r.tenant_id AND x.rule_id=r.id) AS remaining FROM business.financial_recurring_rules r WHERE r.tenant_id=$1::uuid),
 renegotiations AS (SELECT o.company_id,n.principal FROM business.financial_renegotiations n JOIN obligations o ON o.id=n.original_id WHERE n.tenant_id=$1::uuid),
 aging AS (SELECT company_id,CASE WHEN days_late BETWEEN 1 AND 30 THEN '1_30' WHEN days_late BETWEEN 31 AND 60 THEN '31_60' WHEN days_late BETWEEN 61 AND 90 THEN '61_90' ELSE 'over_90' END AS bucket,count(*) AS count,sum(remaining)::text AS amount FROM installments WHERE direction='receivable' AND remaining>0 AND days_late>0 GROUP BY company_id,bucket),
 debtors AS (SELECT company_id,counterparty_id,max(counterparty_name) AS name,count(*) AS count,sum(remaining)::text AS amount,max(days_late) AS oldest_days FROM installments WHERE direction='receivable' AND remaining>0 AND days_late>0 GROUP BY company_id,counterparty_id),
 summaries AS (
 SELECT c.id,c.name,
 COALESCE((SELECT sum(remaining) FROM installments i WHERE i.company_id=c.id AND direction='receivable'),0)::text AS receivable,
 COALESCE((SELECT sum(remaining) FROM installments i WHERE i.company_id=c.id AND direction='payable'),0)::text AS payable,
 COALESCE((SELECT sum(remaining) FROM installments i WHERE i.company_id=c.id AND direction='receivable' AND days_late>0),0)::text AS overdue_in,
 COALESCE((SELECT sum(remaining) FROM installments i WHERE i.company_id=c.id AND direction='payable' AND days_late>0),0)::text AS overdue_out,
 COALESCE((SELECT sum(remaining) FROM installments i WHERE i.company_id=c.id AND direction='receivable' AND days_late BETWEEN -29 AND 0),0)::text AS due_in,
 COALESCE((SELECT sum(remaining) FROM installments i WHERE i.company_id=c.id AND direction='payable' AND days_late BETWEEN -29 AND 0),0)::text AS due_out,
 (SELECT count(*) FROM debtors d WHERE d.company_id=c.id) AS delinquent_parties,
 (SELECT count(*) FROM installments i WHERE i.company_id=c.id AND remaining>0) AS open_installments,
 (SELECT count(*) FROM installments i WHERE i.company_id=c.id AND status='settled') AS settled_installments,
 (SELECT count(*) FROM installments i WHERE i.company_id=c.id AND status='renegotiated') AS replaced_installments,
 COALESCE((SELECT sum(balance) FROM balances b WHERE b.company_id=c.id),0)::text AS balance,
 (SELECT count(*) FROM balances b WHERE b.company_id=c.id AND balance<0) AS negative_accounts,
 (SELECT count(*) FROM balances b WHERE b.company_id=c.id) AS accounts,
 COALESCE((SELECT sum(amount) FROM movements m CROSS JOIN clock WHERE m.company_id=c.id AND kind<>'transfer' AND amount>0 AND occurred_on BETWEEN today-29 AND today),0)::text AS actual_in,
 COALESCE((SELECT -sum(amount) FROM movements m CROSS JOIN clock WHERE m.company_id=c.id AND kind<>'transfer' AND amount<0 AND occurred_on BETWEEN today-29 AND today),0)::text AS actual_out,
 (SELECT count(*) FROM settlements s WHERE s.company_id=c.id AND cash_amount>0 AND account_id IS NULL) AS unlinked,
 (SELECT count(*) FROM review_states r WHERE r.company_id=c.id AND result='matched') AS matched,
 (SELECT count(*) FROM review_states r WHERE r.company_id=c.id AND result='difference') AS differences,
 (SELECT count(*) FROM review_states r WHERE r.company_id=c.id AND result='pending') AS pending,
 (SELECT count(*) FROM recurring r WHERE r.company_id=c.id AND status='active' AND remaining>0) AS active_rules,
 COALESCE((SELECT sum(remaining) FROM recurring r WHERE r.company_id=c.id AND status='active' AND remaining>0),0) AS ungenerated_periods,
 (SELECT count(*) FROM renegotiations n WHERE n.company_id=c.id) AS renegotiations,
 COALESCE((SELECT sum(principal) FROM renegotiations n WHERE n.company_id=c.id),0)::text AS renegotiated_history,
 (SELECT count(*) FROM obligations o WHERE o.company_id=c.id AND contract_id IS NOT NULL AND contract_revision IS DISTINCT FROM current_revision) AS contract_review
 FROM companies c
 )
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM summaries s),'[]'::jsonb),'aging',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.company_id,a.bucket) FROM aging a),'[]'::jsonb),'debtors',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.company_id,d.amount::numeric DESC,d.counterparty_id) FROM (SELECT *,row_number() OVER(PARTITION BY company_id ORDER BY amount::numeric DESC,counterparty_id) AS position FROM debtors) d WHERE d.position<=20),'[]'::jsonb)) AS dashboard`,[tenant]);
   if(r.role!=='owner')fail(403,'Painel financeiro restrito ao proprietário.');
   return send(r.rows[0]?.dashboard||{});
  }
  if(path==='/v1/cashflow'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 accounts AS (SELECT a.id,a.company_id,a.name,p.legal_name AS company_name,a.opening_on,a.opening_balance FROM business.treasury_accounts a JOIN core.parties p ON p.tenant_id=a.tenant_id AND p.id=a.company_id WHERE a.tenant_id=$1::uuid),
 movements AS (SELECT m.*,a.company_id,a.name AS account_name FROM business.treasury_movements m JOIN accounts a ON a.id=m.account_id WHERE m.tenant_id=$1::uuid),
 reviews AS (SELECT r.id,r.account_id,r.source_id,r.kind,r.book_date::text AS book_date,r.book_amount::text AS book_amount,r.statement_date::text AS statement_date,r.statement_amount::text AS statement_amount,r.statement_ref,r.note,r.result,r.created_at,v.id AS void_id,v.reason AS void_reason FROM business.treasury_reconciliations r LEFT JOIN business.treasury_reconciliation_voids v ON v.tenant_id=r.tenant_id AND v.reconciliation_id=r.id WHERE r.tenant_id=$1::uuid),
 balances AS (SELECT a.id,a.company_id,a.name,a.company_name,(a.opening_balance+COALESCE((SELECT sum(m.amount) FROM movements m WHERE m.account_id=a.id),0))::text AS balance FROM accounts a),
 open_items AS (SELECT o.company_id,o.direction,i.due_on,i.remaining FROM business.financial_installments i JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id WHERE i.tenant_id=$1::uuid AND i.remaining>0),
 unlinked AS (SELECT o.company_id,count(*) AS count FROM business.financial_settlements s JOIN business.financial_installments i ON i.tenant_id=s.tenant_id AND i.id=s.installment_id JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id WHERE s.tenant_id=$1::uuid AND s.cash_amount>0 AND NOT EXISTS(SELECT 1 FROM business.treasury_settlement_links l WHERE l.tenant_id=s.tenant_id AND l.settlement_id=s.id) GROUP BY o.company_id),
 companies AS (SELECT p.id,p.legal_name AS name FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id WHERE b.tenant_id=$1::uuid),
 buckets AS (SELECT c.id AS company_id,g.n,(clock.today+g.n*30)::date AS start_on,(clock.today+g.n*30+29)::date AS end_on FROM companies c CROSS JOIN clock CROSS JOIN generate_series(0,2) g(n)),
 forecasts AS (SELECT b.company_id,b.n,b.start_on::text AS start_on,b.end_on::text AS end_on,COALESCE(sum(i.remaining) FILTER(WHERE i.direction='receivable'),0)::text AS incoming,COALESCE(sum(i.remaining) FILTER(WHERE i.direction='payable'),0)::text AS outgoing FROM buckets b LEFT JOIN open_items i ON i.company_id=b.company_id AND i.due_on BETWEEN b.start_on AND b.end_on GROUP BY b.company_id,b.n,b.start_on,b.end_on),
 summaries AS (SELECT c.id,c.name,COALESCE((SELECT sum(a.balance::numeric) FROM balances a WHERE a.company_id=c.id),0)::text AS balance,COALESCE((SELECT sum(i.remaining) FROM open_items i CROSS JOIN clock WHERE i.company_id=c.id AND i.due_on<clock.today AND i.direction='receivable'),0)::text AS overdue_in,COALESCE((SELECT sum(i.remaining) FROM open_items i CROSS JOIN clock WHERE i.company_id=c.id AND i.due_on<clock.today AND i.direction='payable'),0)::text AS overdue_out,COALESCE((SELECT sum(m.amount) FROM movements m CROSS JOIN clock WHERE m.company_id=c.id AND m.kind<>'transfer' AND m.occurred_on BETWEEN clock.today-29 AND clock.today AND m.amount>0),0)::text AS actual_in,COALESCE((SELECT -sum(m.amount) FROM movements m CROSS JOIN clock WHERE m.company_id=c.id AND m.kind<>'transfer' AND m.occurred_on BETWEEN clock.today-29 AND clock.today AND m.amount<0),0)::text AS actual_out,COALESCE((SELECT count FROM unlinked u WHERE u.company_id=c.id),0) AS unlinked_count FROM companies c)
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) FROM summaries s),'[]'::jsonb),'accounts',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.company_name,a.name) FROM balances a),'[]'::jsonb),'forecasts',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.company_id,f.n) FROM forecasts f),'[]'::jsonb),'movements',COALESCE((SELECT jsonb_agg(jsonb_build_object('account_id',m.account_id,'account_name',m.account_name,'company_id',m.company_id,'source_id',m.source_id,'kind',m.kind,'date',m.occurred_on::text,'amount',m.amount::text,'reference',m.reference,'reconciliation_id',r.id,'result',r.result) ORDER BY m.occurred_on DESC,m.source_id,m.kind,m.account_id) FROM movements m LEFT JOIN reviews r ON r.account_id=m.account_id AND r.source_id=m.source_id AND r.kind=m.kind AND r.void_id IS NULL),'[]'::jsonb),'reviews',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id) FROM reviews r),'[]'::jsonb)) AS data`,[tenant]);if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');return send(r.rows[0]?.data||{});
  }
  if(['/v1/cashflow/reconcile','/v1/cashflow/void'].includes(path)&&request.method==='POST'){
   const b=await body(request),id=requestId(b),uuid=v=>typeof v==='string'&&UUID.test(v);let statement,params;
   if(path.endsWith('/reconcile')){
    const date=crmDate(b.statement_date),amount=b.statement_amount,note=typeof b.note==='string'?b.note.trim():'';
    if(!uuid(b.account_id)||!uuid(b.source_id)||!['settlement','reversal','transfer'].includes(b.kind)||!date||typeof amount!=='string'||!/^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,2})?$/.test(amount)||note.length>300)fail(400,'Informe lançamento, data, valor assinado e referência.');
    statement="SELECT reconciliation_id FROM business.reconcile_treasury_movement($1::uuid,$2::uuid,$3,$4::date,$5::numeric,$6,$7,$8::uuid)";params=[b.account_id,b.source_id,b.kind,date,amount,name(b.statement_ref),note||null,id];
   }else{
    const reason=typeof b.reason==='string'?b.reason.trim():'';if(!uuid(b.reconciliation_id)||!reason||reason.length>300)fail(400,'Informe conferência e motivo.');
    statement="SELECT void_id FROM business.void_treasury_reconciliation($1::uuid,$2,$3::uuid)";params=[b.reconciliation_id,reason,id];
   }
   const r=await execute(sql,tenant,user,statement,params,true);if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');if(!r.rows.length)fail(409,'Registro já conferido, referência utilizada, data incompatível ou motivo de divergência ausente.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/treasury'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH accounts AS (SELECT a.*,p.legal_name AS company_name FROM business.treasury_accounts a JOIN core.parties p ON p.tenant_id=a.tenant_id AND p.id=a.company_id WHERE a.tenant_id=$1::uuid),
 settlements AS (SELECT s.id,s.code::text AS code,s.settled_on,s.cash_amount,o.company_id,o.direction,o.title,v.reversed_on,l.account_id FROM business.financial_settlements s JOIN business.financial_installments i ON i.tenant_id=s.tenant_id AND i.id=s.installment_id JOIN business.financial_obligations o ON o.tenant_id=i.tenant_id AND o.id=i.obligation_id LEFT JOIN business.financial_reversals v ON v.tenant_id=s.tenant_id AND v.settlement_id=s.id LEFT JOIN business.treasury_settlement_links l ON l.tenant_id=s.tenant_id AND l.settlement_id=s.id WHERE s.tenant_id=$1::uuid AND s.cash_amount>0),
 movements AS (
 SELECT account_id,settled_on AS occurred_on,CASE WHEN direction='receivable' THEN cash_amount ELSE -cash_amount END AS amount,'settlement' AS kind,'BXA-'||code AS reference,title,id::text AS source_ref FROM settlements WHERE account_id IS NOT NULL
 UNION ALL SELECT account_id,reversed_on,CASE WHEN direction='receivable' THEN -cash_amount ELSE cash_amount END,'reversal','BXA-'||code,title,id::text FROM settlements WHERE account_id IS NOT NULL AND reversed_on IS NOT NULL
 UNION ALL SELECT source_id,occurred_on,-amount,'transfer',reference,'Transferência interna',id::text FROM business.treasury_transfers WHERE tenant_id=$1::uuid
 UNION ALL SELECT destination_id,occurred_on,amount,'transfer',reference,'Transferência interna',id::text FROM business.treasury_transfers WHERE tenant_id=$1::uuid
 ), balances AS (SELECT a.id,a.code::text AS code,a.company_id,a.company_name,a.name,a.kind,a.opening_on::text AS opening_on,a.opening_balance::text AS opening_balance,a.reference,(a.opening_balance+COALESCE(sum(m.amount),0))::text AS balance FROM accounts a LEFT JOIN movements m ON m.account_id=a.id GROUP BY a.id,a.code,a.company_id,a.company_name,a.name,a.kind,a.opening_on,a.opening_balance,a.reference),
 companies AS (SELECT p.id,p.legal_name AS name FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id WHERE b.tenant_id=$1::uuid AND p.status='active')
 SELECT jsonb_build_object('as_of',(now() AT TIME ZONE 'America/Fortaleza')::date::text,'accounts',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.company_name,b.name) FROM balances b),'[]'::jsonb),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM companies c),'[]'::jsonb),'unlinked',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'date',s.settled_on,'amount',s.cash_amount::text,'company_id',s.company_id,'direction',s.direction,'title',s.title,'reversed_on',s.reversed_on) ORDER BY s.settled_on,s.code) FROM settlements s WHERE s.account_id IS NULL),'[]'::jsonb),'movements',COALESCE((SELECT jsonb_agg(jsonb_build_object('account_id',m.account_id,'date',m.occurred_on,'amount',m.amount::text,'kind',m.kind,'reference',m.reference,'title',m.title,'source_ref',m.source_ref) ORDER BY m.occurred_on DESC,m.source_ref,m.kind,m.account_id) FROM movements m),'[]'::jsonb)) AS treasury`,[tenant]);
   if(r.role!=='owner')fail(403,'Tesouraria restrita ao proprietário.');
   return send(r.rows[0]?.treasury||{});
  }
  if(['/v1/treasury/accounts','/v1/treasury/transfers','/v1/treasury/links'].includes(path)&&request.method==='POST'){
   const b=await body(request),id=requestId(b),uuid=v=>typeof v==='string'&&UUID.test(v),decimal=v=>typeof v==='string'&&/^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,2})?$/.test(v);
   let statement,params;
   if(path.endsWith('/accounts')){
    const date=crmDate(b.opening_on);
    if(!uuid(b.company_id)||!['bank','cash'].includes(b.kind)||!date||!decimal(b.opening_balance))fail(400,'Informe empresa, tipo, data e saldo inicial.');
    statement="SELECT account_id,account_code::text AS account_code FROM business.create_treasury_account($1::uuid,$2,$3,$4::date,$5::numeric,$6,$7::uuid)";params=[b.company_id,name(b.name),b.kind,date,b.opening_balance,name(b.reference),id];
   }else if(path.endsWith('/transfers')){
    const date=crmDate(b.occurred_on);
    if(!uuid(b.source_id)||!uuid(b.destination_id)||b.source_id===b.destination_id||!date||!decimal(b.amount)||Number(b.amount)<=0)fail(400,'Informe contas distintas, data e valor positivo.');
    statement="SELECT transfer_id FROM business.record_treasury_transfer($1::uuid,$2::uuid,$3::numeric,$4::date,$5,$6::uuid)";params=[b.source_id,b.destination_id,b.amount,date,name(b.reference),id];
   }else{
    if(!uuid(b.settlement_id)||!uuid(b.account_id))fail(400,'Informe baixa e conta.');
    statement="SELECT link_id FROM business.link_treasury_settlement($1::uuid,$2::uuid,$3::uuid)";params=[b.settlement_id,b.account_id,id];
   }
   const r=await execute(sql,tenant,user,statement,params,true);
   if(r.role!=='owner')fail(403,'Tesouraria restrita ao proprietário.');
   if(!r.rows.length)fail(409,'Registro duplicado ou incompatível com empresa, conta ou data.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/finance-recurring'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 rules AS (SELECT r.id,r.code::text AS code,r.direction,r.company_id,r.counterparty_id,p.legal_name AS company_name,q.legal_name AS counterparty_name,r.title,r.reference,r.amount::text AS amount,r.first_due::text AS first_due,r.periods,r.status,r.close_reason,COALESCE(x.generated,0)::integer AS generated,CASE WHEN r.status='active' AND COALESCE(x.generated,0)<r.periods THEN (r.first_due+make_interval(months=>COALESCE(x.generated,0)::integer))::date::text END AS next_due FROM business.financial_recurring_rules r JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=r.company_id JOIN core.parties q ON q.tenant_id=r.tenant_id AND q.id=r.counterparty_id LEFT JOIN LATERAL (SELECT count(*) AS generated FROM business.financial_recurring_occurrences x WHERE x.tenant_id=r.tenant_id AND x.rule_id=r.id) x ON true WHERE r.tenant_id=$1::uuid),
 renegotiations AS (SELECT n.id,n.original_id,n.replacement_id,o.code::text AS original_code,b.code::text AS replacement_code,n.principal::text AS principal,n.reason,n.reference,n.sources,n.created_at FROM business.financial_renegotiations n JOIN business.financial_obligations o ON o.tenant_id=n.tenant_id AND o.id=n.original_id JOIN business.financial_obligations b ON b.tenant_id=n.tenant_id AND b.id=n.replacement_id WHERE n.tenant_id=$1::uuid),
 occurrences AS (SELECT x.rule_id,x.period_no,o.code::text AS obligation_code,o.first_due::text AS due_on,o.amount::text AS amount FROM business.financial_recurring_occurrences x JOIN business.financial_obligations o ON o.tenant_id=x.tenant_id AND o.id=x.obligation_id WHERE x.tenant_id=$1::uuid)
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'rules',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.code) FROM rules r),'[]'::jsonb),'renegotiations',COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) FROM renegotiations n),'[]'::jsonb),'occurrences',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rule_id,x.period_no) FROM occurrences x),'[]'::jsonb)) AS data`,[tenant]);
   if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');
   return send(r.rows[0]?.data||{});
  }
  if(['/v1/finance-recurring/renegotiate','/v1/finance-recurring/rules','/v1/finance-recurring/generate','/v1/finance-recurring/close'].includes(path)&&request.method==='POST'){
   const b=await body(request),id=requestId(b),uuid=v=>typeof v==='string'&&UUID.test(v),money=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(v)&&Number(v)>0,integer=(v,max)=>Number.isInteger(v)&&v>=1&&v<=max;
   const reason=()=>{const v=typeof b.reason==='string'?b.reason.trim():'';if(!v||v.length>300)fail(400,'Informe motivo válido.');return v;};
   let statement,params;
   if(path.endsWith('/renegotiate')){
    const due=crmDate(b.first_due);if(!uuid(b.obligation_id)||!money(b.expected)||!due||!integer(b.installment_count,24))fail(400,'Informe obrigação, saldo, vencimento e parcelas.');
    statement="SELECT obligation_id,obligation_code::text AS obligation_code FROM business.renegotiate_financial_obligation($1::uuid,$2::numeric,$3::date,$4::integer,$5,$6,$7::uuid)";params=[b.obligation_id,b.expected,due,b.installment_count,reason(),name(b.reference),id];
   }else if(path.endsWith('/rules')){
    const due=crmDate(b.first_due);if(!uuid(b.company_id)||!uuid(b.counterparty_id)||!['receivable','payable'].includes(b.direction)||!money(b.amount)||!due||!integer(b.periods,120))fail(400,'Informe partes, valor, vencimento e períodos.');
    statement="SELECT rule_id,rule_code::text AS rule_code FROM business.create_financial_recurring_rule($1,$2::uuid,$3::uuid,$4,$5,$6::numeric,$7::date,$8::integer,$9::uuid)";params=[b.direction,b.company_id,b.counterparty_id,name(b.title),name(b.reference),b.amount,due,b.periods,id];
   }else if(path.endsWith('/generate')){
    const issued=crmDate(b.issued_on);if(!uuid(b.rule_id)||!integer(b.period_no,120)||!issued)fail(400,'Informe regra, período e emissão.');
    statement="SELECT obligation_id,obligation_code::text AS obligation_code FROM business.generate_financial_occurrence($1::uuid,$2::integer,$3::date,$4::uuid)";params=[b.rule_id,b.period_no,issued,id];
   }else{
    if(!uuid(b.rule_id))fail(400,'Informe regra.');
    statement="SELECT rule_id FROM business.close_financial_recurring_rule($1::uuid,$2,$3::uuid)";params=[b.rule_id,reason(),id];
   }
   const r=await execute(sql,tenant,user,statement,params,true);if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');if(!r.rows.length)fail(409,'Saldo, regra, período ou data incompatível, ou registro já efetuado. Atualize a consulta.');return send({item:r.rows[0]},201);
  }
  if(path==='/v1/financial-obligations'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 obligations AS (SELECT o.id,o.code::text AS code,o.direction,o.company_id,o.company_name,o.counterparty_id,o.counterparty_name,o.contract_id,o.purchase_receipt_id,c.code::text AS contract_code,o.contract_revision,c.revision AS current_contract_revision,o.title,o.reference,o.amount::text AS amount,o.issued_on::text AS issued_on,o.first_due::text AS first_due,o.installment_count,EXISTS(SELECT 1 FROM business.financial_renegotiations n WHERE n.tenant_id=o.tenant_id AND n.original_id=o.id) AS renegotiated, (SELECT x.original_id FROM business.financial_renegotiations x WHERE x.tenant_id=o.tenant_id AND x.replacement_id=o.id) AS renegotiated_from,(SELECT x.rule_id FROM business.financial_recurring_occurrences x WHERE x.tenant_id=o.tenant_id AND x.obligation_id=o.id) AS recurring_rule_id FROM business.financial_obligations o LEFT JOIN business.contracts c ON c.tenant_id=o.tenant_id AND c.id=o.contract_id WHERE o.tenant_id=$1::uuid),
 installments AS (SELECT i.id,i.obligation_id,i.installment_no,i.due_on::text AS due_on,i.amount::text AS amount,i.remaining::text AS remaining,i.revision,i.status,CASE WHEN i.status='renegotiated' THEN 'renegotiated' WHEN i.status='settled' THEN 'settled' WHEN i.due_on<clock.today THEN 'overdue' WHEN i.due_on=clock.today THEN 'today' ELSE 'scheduled' END AS validity FROM business.financial_installments i CROSS JOIN clock WHERE i.tenant_id=$1::uuid),
 companies AS (SELECT p.id,p.legal_name AS name FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id WHERE b.tenant_id=$1::uuid AND p.status='active'),
 parties AS (SELECT id,legal_name AS name,kind FROM core.parties WHERE tenant_id=$1::uuid AND status='active'),
 contracts AS (SELECT c.id,c.code::text AS code,c.title,c.seller_name,c.payer_name,c.total::text AS total,c.revision FROM business.contracts c WHERE c.tenant_id=$1::uuid AND c.status IN ('signed','active','suspended') AND c.signed_on IS NOT NULL AND c.total BETWEEN 0.01 AND 9999999999999999.99 AND NOT EXISTS (SELECT 1 FROM business.financial_obligations o WHERE o.tenant_id=c.tenant_id AND o.contract_id=c.id))
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'obligations',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.issued_on DESC,o.code) FROM obligations o),'[]'::jsonb),'installments',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.due_on,i.obligation_id,i.installment_no) FROM installments i),'[]'::jsonb),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM companies c),'[]'::jsonb),'parties',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM parties p),'[]'::jsonb),'contracts',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code) FROM contracts c),'[]'::jsonb)) AS finance`,[tenant]);
   if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');
   return send(r.rows[0]?.finance||{});
  }
  const installmentMatch=path.match(/^\/v1\/financial-installments\/([^/]+)\/settlements$/);
  if(installmentMatch&&UUID.test(installmentMatch[1])){
   const installment=installmentMatch[1];
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT s.id,s.code::text AS code,s.principal::text AS principal,s.discount::text AS discount,s.interest::text AS interest,s.fine::text AS fine,s.cash_amount::text AS cash_amount,s.settled_on::text AS settled_on,s.method,s.reference,s.created_at,v.id AS reversal_id,v.reversed_on::text AS reversed_on,v.reason AS reversal_reason FROM business.financial_settlements s LEFT JOIN business.financial_reversals v ON v.tenant_id=s.tenant_id AND v.settlement_id=s.id WHERE s.tenant_id=$1::uuid AND s.installment_id=$2::uuid ORDER BY s.code DESC",[tenant,installment]);
    if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');
    return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request),id=requestId(b),date=crmDate(b.settled_on),reference=name(b.reference),method=b.method,amounts=[b.principal,b.discount,b.interest,b.fine];
    if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646||!date||!['pix','transfer','cash','card','boleto','other','non_cash'].includes(method)||amounts.some(v=>typeof v!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(v)))fail(400,'Informe revisão, valores monetários, data, meio e referência.');
    const r=await execute(sql,tenant,user,"SELECT settlement_id,settlement_code::text AS settlement_code FROM business.settle_financial_installment($1::uuid,$2::integer,$3::numeric,$4::numeric,$5::numeric,$6::numeric,$7::date,$8,$9,$10::uuid)",[installment,b.revision,...amounts,date,method,reference,id],true);
    if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');
    if(!r.rows.length)fail(409,'Saldo insuficiente, revisão desatualizada, data incompatível ou baixa já registrada.');
    return send({item:r.rows[0]},201);
   }
  }
  const reversalMatch=path.match(/^\/v1\/financial-settlements\/([^/]+)\/reverse$/);
  if(reversalMatch&&UUID.test(reversalMatch[1])&&request.method==='POST'){
   const b=await body(request),id=requestId(b),date=crmDate(b.reversed_on),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646||!date||!reason||reason.length>300)fail(400,'Informe revisão, data e motivo do estorno.');
   const r=await execute(sql,tenant,user,"SELECT reversal_id FROM business.reverse_financial_settlement($1::uuid,$2::integer,$3::date,$4,$5::uuid)",[reversalMatch[1],b.revision,date,reason,id],true);
   if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');
   if(!r.rows.length)fail(409,'Baixa já estornada, revisão desatualizada ou data incompatível.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/financial-obligations'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),direction=b.direction,contract=b.contract_id||null,company=b.company_id||null,party=b.counterparty_id||null,revision=b.contract_revision??null,title=name(b.title),reference=name(b.reference),amount=b.amount??null,issued=crmDate(b.issued_on),due=crmDate(b.first_due),count=b.installment_count;
   const uuid=v=>typeof v==='string'&&UUID.test(v);
   if(!['receivable','payable'].includes(direction)||!issued||!due||due<issued||!Number.isInteger(count)||count<1||count>24||(contract?(!uuid(contract)||direction!=='receivable'||company!==null||party!==null||amount!==null||!Number.isInteger(revision)||revision<1||revision>2147483647):(!uuid(company)||!uuid(party)||company===party||revision!==null||typeof amount!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(amount))))fail(400,'Informe origem, partes, valor, referência, datas e até 24 parcelas.');
   const r=await execute(sql,tenant,user,"SELECT obligation_id,obligation_code::text AS obligation_code FROM business.create_financial_obligation($1,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6,$7,$8::numeric,$9::date,$10::date,$11::integer,$12::uuid)",[direction,company,party,contract,revision,title,reference,amount,issued,due,count,id],true);
   if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');
   if(!r.rows.length)fail(409,'Obrigação já registrada, contrato alterado ou dados incompatíveis. Confira valores e datas.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/contract-dashboard'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 contracts AS (
 SELECT c.id,c.code::text AS code,c.title,c.customer_name,c.seller_name,c.status,c.revision,c.total,c.valid_from,c.valid_until,c.ended_on,
 CASE WHEN c.status IN ('signed','active','suspended') AND c.valid_until<clock.today THEN 'expired' ELSE c.status END AS effective_status
 FROM business.contracts c CROSS JOIN clock WHERE c.tenant_id=$1::uuid
 ), amendments AS (
 SELECT a.status,a.kind,a.base_revision,c.revision,c.effective_status FROM business.contract_amendments a JOIN contracts c ON c.id=a.contract_id WHERE a.tenant_id=$1::uuid
 ), rights AS (
 SELECT r.id,r.commercial_unit,r.capacity,LEAST(r.valid_until,c.valid_until,c.ended_on) AS effective_until,
 CASE WHEN r.status='revoked' THEN 'revoked' WHEN c.status IN ('terminated','expired') OR LEAST(r.valid_until,c.valid_until)<clock.today THEN 'expired' WHEN c.status='suspended' THEN 'suspended' WHEN c.status<>'active' OR r.valid_from>LEAST(r.valid_until,c.valid_until) THEN 'blocked' WHEN r.valid_from>clock.today OR c.valid_from>clock.today THEN 'scheduled' ELSE 'effective' END AS validity
 FROM business.license_rights r JOIN contracts c ON c.id=r.contract_id CROSS JOIN clock WHERE r.tenant_id=$1::uuid
 ), reservations AS (
 SELECT a.right_id,sum(a.quantity) FILTER(WHERE a.status='allocated') AS reserved,count(*) FILTER(WHERE a.status='allocated') AS allocated_count,count(*) FILTER(WHERE a.status='released') AS released_count
 FROM business.license_allocations a WHERE a.tenant_id=$1::uuid GROUP BY a.right_id
 ), orders AS (
 SELECT o.id,o.status FROM business.commercial_orders o WHERE o.tenant_id=$1::uuid
 ), contract_stages AS (
 SELECT effective_status AS status,count(*) AS count,COALESCE(sum(total),0)::text AS value FROM contracts GROUP BY effective_status
 ), right_stages AS (
 SELECT validity,count(*) AS count FROM rights GROUP BY validity
 ), capacities AS (
 SELECT r.commercial_unit AS unit,count(*) AS rights, sum(r.capacity)::text AS capacity,sum(COALESCE(a.reserved,0))::text AS reserved,sum(r.capacity-COALESCE(a.reserved,0))::text AS available
 FROM rights r LEFT JOIN reservations a ON a.right_id=r.id WHERE r.validity='effective' AND r.capacity IS NOT NULL GROUP BY r.commercial_unit
 ), deadlines AS (
 SELECT c.code,c.title,c.customer_name,c.effective_status AS status,c.valid_until::text AS valid_until,c.valid_until-clock.today AS days_left,c.total::text AS total FROM contracts c CROSS JOIN clock
 WHERE c.status IN ('signed','active','suspended') AND c.valid_until BETWEEN clock.today AND clock.today+90 ORDER BY c.valid_until,c.id LIMIT 30
 )
 SELECT jsonb_build_object(
 'as_of',(SELECT today::text FROM clock),
 'contracts',jsonb_build_object('total',(SELECT count(*) FROM contracts),'active',(SELECT count(*) FROM contracts WHERE effective_status='active' AND valid_from<=(SELECT today FROM clock)),'active_value',(SELECT COALESCE(sum(total),0)::text FROM contracts WHERE effective_status='active' AND valid_from<=(SELECT today FROM clock)),'awaiting_approval',(SELECT count(*) FROM contracts WHERE status='submitted'),'awaiting_signature',(SELECT count(*) FROM contracts WHERE status='approved'),'signed_pending_activation',(SELECT count(*) FROM contracts WHERE effective_status='signed'),'expired_pending',(SELECT count(*) FROM contracts WHERE effective_status='expired' AND status<>'expired'),'due_30',(SELECT count(*) FROM contracts CROSS JOIN clock WHERE status IN ('signed','active','suspended') AND valid_until BETWEEN today AND today+30),'due_31_60',(SELECT count(*) FROM contracts CROSS JOIN clock WHERE status IN ('signed','active','suspended') AND valid_until BETWEEN today+31 AND today+60),'due_61_90',(SELECT count(*) FROM contracts CROSS JOIN clock WHERE status IN ('signed','active','suspended') AND valid_until BETWEEN today+61 AND today+90)),
 'amendments',jsonb_build_object('draft',(SELECT count(*) FROM amendments WHERE status='draft'),'stale',(SELECT count(*) FROM amendments WHERE status='draft' AND (base_revision<>revision OR effective_status NOT IN ('signed','active','suspended'))),'applied',(SELECT count(*) FROM amendments WHERE status='applied'),'renewals',(SELECT count(*) FROM amendments WHERE status='applied' AND kind='renewal')),
 'orders',jsonb_build_object('pending',(SELECT count(*) FROM orders WHERE status='pending_contract'),'formalized',(SELECT count(*) FROM orders WHERE status='contract_formalized')),
 'licenses',jsonb_build_object('total',(SELECT count(*) FROM rights),'effective',(SELECT count(*) FROM rights WHERE validity='effective'),'temporal_effective',(SELECT count(*) FROM rights WHERE validity='effective' AND capacity IS NULL),'due_30',(SELECT count(*) FROM rights CROSS JOIN clock WHERE validity='effective' AND effective_until BETWEEN today AND today+30),'reserved_count',(SELECT COALESCE(sum(allocated_count),0) FROM reservations),'released_count',(SELECT COALESCE(sum(released_count),0) FROM reservations)),
 'contract_stages',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM contract_stages s),'[]'::jsonb),
 'right_stages',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM right_stages s),'[]'::jsonb),
 'capacities',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.unit) FROM capacities s),'[]'::jsonb),
 'deadlines',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.valid_until,d.code) FROM deadlines d),'[]'::jsonb)
 ) AS dashboard`,[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Indicadores restritos à equipe contratual.');
   return send(r.rows[0]?.dashboard||{});
  }
  if(path==='/v1/license-allocations'&&request.method==='GET'){
   const scope=[...await masterInstitutions(request,env)];
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 rights AS (
 SELECT r.id,r.code::text AS code,r.item_name,r.commercial_unit,r.capacity,c.customer_name,c.customer_id,c.code::text AS contract_code,
 COALESCE((SELECT sum(a.quantity) FROM business.license_allocations a WHERE a.tenant_id=r.tenant_id AND a.right_id=r.id AND a.status='allocated'),0)::integer AS reserved,
 CASE WHEN r.status='revoked' THEN 'revoked' WHEN c.status IN ('terminated','expired') OR LEAST(r.valid_until,c.valid_until)<clock.today THEN 'expired' WHEN c.status='suspended' THEN 'suspended' WHEN c.status<>'active' OR r.valid_from>LEAST(r.valid_until,c.valid_until) THEN 'blocked' WHEN r.valid_from>clock.today OR c.valid_from>clock.today THEN 'scheduled' ELSE 'effective' END AS validity
 FROM business.license_rights r JOIN business.contracts c ON c.tenant_id=r.tenant_id AND c.id=r.contract_id CROSS JOIN clock WHERE r.tenant_id=$1::uuid
 ), allocations AS (
 SELECT a.id,a.code::text AS code,a.right_id,a.beneficiary_kind,a.institution_id,a.establishment_id,a.person_id,a.beneficiary_ref,COALESCE(p.legal_name,s.name,a.beneficiary_ref) AS beneficiary_name,a.quantity,a.status,a.authorization_ref,a.created_at,a.released_at,a.release_reason,
 CASE WHEN a.status='released' THEN 'released' WHEN r.validity<>'effective' THEN r.validity WHEN a.beneficiary_kind='institution' AND NOT EXISTS (SELECT 1 FROM core.institution_links l CROSS JOIN clock WHERE l.tenant_id=a.tenant_id AND l.institution_id=a.institution_id AND l.party_id=r.customer_id AND l.valid_from<=clock.today AND (l.valid_until IS NULL OR l.valid_until>clock.today)) THEN 'blocked' WHEN a.beneficiary_kind='person' AND p.status IS DISTINCT FROM 'active' THEN 'blocked' WHEN a.beneficiary_kind='establishment' AND s.status IS DISTINCT FROM 'active' THEN 'blocked' ELSE 'effective' END AS validity
 FROM business.license_allocations a JOIN rights r ON r.id=a.right_id LEFT JOIN core.parties p ON p.tenant_id=a.tenant_id AND p.id=a.person_id LEFT JOIN core.establishments s ON s.tenant_id=a.tenant_id AND s.id=a.establishment_id WHERE a.tenant_id=$1::uuid AND (a.institution_id IS NULL OR a.institution_id=ANY($2::uuid[]))
 ), institutions AS (
 SELECT DISTINCT l.institution_id,l.party_id FROM core.institution_links l CROSS JOIN clock WHERE l.tenant_id=$1::uuid AND l.institution_id=ANY($2::uuid[]) AND l.valid_from<=clock.today AND (l.valid_until IS NULL OR l.valid_until>clock.today)
 ), establishments AS (
 SELECT id,party_id,name FROM core.establishments WHERE tenant_id=$1::uuid AND status='active'
 ), persons AS (
 SELECT id,legal_name AS name FROM core.parties WHERE tenant_id=$1::uuid AND kind='PF' AND status='active'
 )
 SELECT COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.code) FROM rights r),'[]'::jsonb) AS rights,COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC,a.id) FROM allocations a),'[]'::jsonb) AS allocations,COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM institutions i),'[]'::jsonb) AS institutions,COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) FROM establishments s),'[]'::jsonb) AS establishments,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM persons p),'[]'::jsonb) AS persons`,[tenant,scope]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Distribuição restrita à equipe autorizada.');
   return send({...r.rows[0],can_write:r.role==='owner'});
  }
  if(path==='/v1/license-allocations'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),right=b.right_id,kind=b.beneficiary_kind,target=b.target_id||null,ref=name(b.beneficiary_ref,false),authorization=name(b.authorization_ref),quantity=b.quantity;
   const identified=['institution','establishment','person'].includes(kind);
   if(typeof right!=='string'||!UUID.test(right)||!['institution','establishment','person','device','external_unit'].includes(kind)||(identified?(typeof target!=='string'||!UUID.test(target)||!!ref):(!!target||!ref))||!Number.isInteger(quantity)||quantity<1||quantity>999999)fail(400,'Informe direito, beneficiário, quantidade e referência de autorização.');
   const scope=kind==='institution'?[...await masterInstitutions(request,env)]:[];
   const r=await execute(sql,tenant,user,"SELECT allocation_id,allocation_code::text AS allocation_code FROM business.allocate_license($1::uuid,$2,$3::uuid,$4,$5::integer,$6,$7::uuid[],$8::uuid)",[right,kind,target,ref,quantity,authorization,scope,id],true);
   if(!r.rows.length)fail(409,'Capacidade insuficiente, direito indisponível, beneficiário incompatível ou já alocado.');
   return send({item:r.rows[0]},201);
  }
  const allocationMatch=path.match(/^\/v1\/license-allocations\/([^/]+)\/release$/);
  if(allocationMatch&&UUID.test(allocationMatch[1])&&request.method==='POST'){
   const b=await body(request),id=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>300)fail(400,'Informe o motivo da liberação.');
   const scope=[...await masterInstitutions(request,env)];
   const r=await execute(sql,tenant,user,"SELECT allocation_id FROM business.release_license_allocation($1::uuid,$2,$3::uuid[],$4::uuid)",[allocationMatch[1],reason,scope,id],true);
   if(!r.rows.length)fail(409,'Alocação indisponível, fora do escopo ou já liberada.');
   return send({item:r.rows[0]});
  }
  if(path==='/v1/license-rights'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 rights AS (
 SELECT r.id,r.code::text AS code,r.contract_id,c.code::text AS contract_code,c.title AS contract_title,c.customer_name,r.proposal_line_id,r.item_name,r.commercial_unit,r.commercial_quantity::text AS commercial_quantity,r.capacity,r.module_id,r.module_code,r.scope_label,r.valid_from::text AS valid_from,r.valid_until::text AS valid_until,LEAST(r.valid_until,c.valid_until,c.ended_on)::text AS effective_until,r.instrument_ref,r.status,r.revocation_reason,r.revoked_at,r.created_at,c.status AS contract_status,
 CASE WHEN r.status='revoked' THEN 'revoked' WHEN c.status IN ('terminated','expired') OR (LEAST(r.valid_until,c.valid_until)<clock.today) THEN 'expired' WHEN c.status='suspended' THEN 'suspended' WHEN c.status<>'active' OR r.valid_from>LEAST(r.valid_until,c.valid_until) THEN 'blocked' WHEN r.valid_from>clock.today OR c.valid_from>clock.today THEN 'scheduled' ELSE 'effective' END AS validity
 FROM business.license_rights r JOIN business.contracts c ON c.tenant_id=r.tenant_id AND c.id=r.contract_id CROSS JOIN clock WHERE r.tenant_id=$1::uuid
 ), eligible AS (
 SELECT c.id AS contract_id,c.code::text AS contract_code,c.title AS contract_title,c.customer_name,c.valid_until::text AS contract_until,l.id AS line_id,l.item_name,l.item_code::text AS item_code,l.unit,l.quantity::text AS quantity,CASE WHEN l.unit IN ('seat','device','institution','unit') THEN l.quantity::integer END AS capacity
 FROM business.contracts c JOIN business.commercial_orders o ON o.tenant_id=c.tenant_id AND o.id=c.order_id JOIN business.proposal_lines l ON l.tenant_id=o.tenant_id AND l.proposal_id=o.proposal_id JOIN business.catalog_items i ON i.tenant_id=l.tenant_id AND i.id=l.item_id CROSS JOIN clock
 WHERE c.tenant_id=$1::uuid AND c.status='active' AND c.signed_on IS NOT NULL AND c.valid_from<=clock.today AND (c.valid_until IS NULL OR c.valid_until>=clock.today) AND c.contract_kind IN ('license','mixed') AND i.kind='license' AND (l.unit IN ('month','year') OR (l.unit IN ('seat','device','institution','unit') AND l.quantity=trunc(l.quantity))) AND NOT EXISTS (SELECT 1 FROM business.license_rights r WHERE r.tenant_id=c.tenant_id AND r.contract_id=c.id AND r.proposal_line_id=l.id)
 )
 SELECT COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id) FROM rights r),'[]'::jsonb) AS rights,COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.contract_code,e.item_name,e.line_id) FROM eligible e),'[]'::jsonb) AS eligible`,[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Licenciamento restrito à equipe autorizada.');
   return send({items:r.rows[0]?.rights||[],eligible:r.rows[0]?.eligible||[],can_write:r.role==='owner'});
  }
  if(path==='/v1/license-modules'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT 1",[ ]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Licenciamento restrito à equipe autorizada.');
   return send({items:await masterLicenseModules(request,env)});
  }
  if(path==='/v1/license-rights'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),contract=b.contract_id,line=b.proposal_line_id,module=b.module_id||null,scope=name(b.scope_label,false),reference=name(b.instrument_ref),from=crmDate(b.valid_from),until=crmDate(b.valid_until);
   if(typeof contract!=='string'||!UUID.test(contract)||typeof line!=='string'||!UUID.test(line)||(module!==null&&(typeof module!=='string'||!UUID.test(module)))||(!module&&!scope)||!from||(until&&until<from))fail(400,'Informe contrato, item, módulo ou escopo, referência e vigência.');
   let code=null;if(module){const m=(await masterLicenseModules(request,env)).find(m=>m.id.toLowerCase()===module.toLowerCase());if(!m)fail(409,'Módulo não disponível no Master.');code=m.code;}
   const r=await execute(sql,tenant,user,"SELECT right_id,right_code::text AS right_code FROM business.create_license_right($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::date,$7::date,$8,$9::uuid)",[contract,line,module,code,scope,from,until,reference,id],true);
   if(!r.rows.length)fail(409,'Item não elegível, direito já registrado ou vigência incompatível.');
   return send({item:r.rows[0]},201);
  }
  const rightMatch=path.match(/^\/v1\/license-rights\/([^/]+)\/revoke$/);
  if(rightMatch&&UUID.test(rightMatch[1])&&request.method==='POST'){
   const b=await body(request),id=requestId(b),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!reason||reason.length>300)fail(400,'Informe o motivo da revogação.');
   const r=await execute(sql,tenant,user,"SELECT right_id FROM business.revoke_license_right($1::uuid,$2,$3::uuid)",[rightMatch[1],reason,id],true);
   if(!r.rows.length)fail(409,'Direito não encontrado, já revogado ou acesso restrito.');
   return send({item:r.rows[0]});
  }
  if(path==='/v1/contracts'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT c.id,c.code::text AS code,c.order_id,o.code::text AS order_code,p.code::text AS proposal_code,c.customer_id,c.seller_id,c.payer_id,c.title,c.contract_kind,c.customer_name,c.seller_name,c.payer_name,c.total::text AS total,c.currency,c.valid_from::text AS valid_from,c.valid_until::text AS valid_until,c.payment_terms,c.instrument_ref,c.notes,c.status,c.revision,c.signed_on::text AS signed_on,c.signature_ref,c.activated_at,c.ended_on::text AS ended_on,CASE WHEN c.status IN ('signed','active','suspended') AND c.valid_until<(now() AT TIME ZONE 'America/Fortaleza')::date THEN 'expired' WHEN c.valid_from>(now() AT TIME ZONE 'America/Fortaleza')::date THEN 'scheduled' ELSE 'current' END AS validity,c.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('item_code',l.item_code::text,'item_name',l.item_name,'unit',l.unit,'quantity',l.quantity::text,'unit_price',l.unit_price::text,'discount_pct',l.discount_pct::text,'net',l.net::text) ORDER BY l.item_code) FROM business.proposal_lines l WHERE l.tenant_id=c.tenant_id AND l.proposal_id=o.proposal_id),'[]'::jsonb) AS lines FROM business.contracts c JOIN business.commercial_orders o ON o.tenant_id=c.tenant_id AND o.id=c.order_id JOIN business.proposals p ON p.tenant_id=o.tenant_id AND p.id=o.proposal_id WHERE c.tenant_id=$1::uuid ORDER BY c.code DESC",[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Contratos restritos à equipe autorizada.');
   return send({items:r.rows});
  }
  const lifecycleMatch=path.match(/^\/v1\/contracts\/([^/]+)\/(advance|history)$/);
  if(lifecycleMatch&&UUID.test(lifecycleMatch[1])){
   const contract=lifecycleMatch[1],operation=lifecycleMatch[2];
   if(operation==='history'&&request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,from_status,to_status,reference,effective_on::text AS effective_on,created_by,created_at FROM business.contract_events WHERE tenant_id=$1::uuid AND contract_id=$2::uuid ORDER BY created_at,id",[tenant,contract]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'Histórico contratual restrito.');
    return send({items:r.rows});
   }
   if(operation==='advance'&&request.method==='POST'){
    const b=await body(request),id=requestId(b),next=b.status,reference=typeof b.reference==='string'?b.reference.trim():'',signed=crmDate(b.signed_on);
    if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646||!['submitted','approved','rejected','signed','active','suspended','terminated','expired'].includes(next)||reference.length>(next==='signed'?200:300)||(['rejected','signed','suspended','terminated'].includes(next)&&!reference)||(next==='signed'?!signed:!!signed))fail(400,'Informe etapa, revisão, motivo ou referência e data de assinatura quando exigidos.');
    const r=await execute(sql,tenant,user,"SELECT contract_id,new_status,new_revision FROM business.advance_contract($1::uuid,$2::integer,$3,$4,$5::date,$6::uuid)",[contract,b.revision,next,reference||null,signed,id],true);
    if(!r.rows.length)fail(409,'Transição não autorizada, revisão desatualizada ou data incompatível com a vigência.');
    return send({item:r.rows[0]});
   }
  }
  const amendmentMatch=path.match(/^\/v1\/contracts\/([^/]+)\/amendments$/);
  if(amendmentMatch&&UUID.test(amendmentMatch[1])){
   const contract=amendmentMatch[1];
   if(request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,code::text AS code,contract_id,base_revision,kind,old_total::text AS old_total,new_total::text AS new_total,old_terms,new_terms,old_until::text AS old_until,new_until::text AS new_until,reason,status,signed_on::text AS signed_on,signature_ref,effective_on::text AS effective_on,decision_reason,decided_by,decided_at,created_by,created_at FROM business.contract_amendments WHERE tenant_id=$1::uuid AND contract_id=$2::uuid ORDER BY code DESC",[tenant,contract]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'Aditivos restritos à equipe contratual.');
    return send({items:r.rows});
   }
   if(request.method==='POST'){
    const b=await body(request),id=requestId(b),kind=b.kind,total=b.new_total,until=crmDate(b.new_until),terms=typeof b.new_terms==='string'?b.new_terms.trim():'',reason=typeof b.reason==='string'?b.reason.trim():'';
    if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646||!['amendment','renewal'].includes(kind)||typeof total!=='string'||!/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,2})?$/.test(total)||terms.length>300||!reason||reason.length>300)fail(400,'Informe tipo, revisão, valor total revisado e motivo válidos.');
    const r=await execute(sql,tenant,user,"SELECT amendment_id,amendment_code::text AS amendment_code FROM business.create_contract_amendment($1::uuid,$2::integer,$3,$4::numeric,$5,$6::date,$7,$8::uuid)",[contract,b.revision,kind,total,terms||null,until,reason,id],true);
    if(!r.rows.length)fail(409,'Contrato indisponível, revisão desatualizada, alteração inválida ou aditivo em aberto.');
    return send({item:r.rows[0]},201);
   }
  }
  const decisionMatch=path.match(/^\/v1\/contract-amendments\/([^/]+)\/decide$/);
  if(decisionMatch&&UUID.test(decisionMatch[1])&&request.method==='POST'){
   const b=await body(request),id=requestId(b),decision=b.decision,reference=typeof b.reference==='string'?b.reference.trim():'',signed=crmDate(b.signed_on);
   if(!['applied','rejected'].includes(decision)||!reference||reference.length>(decision==='applied'?200:300)||(decision==='applied'?!signed:!!signed))fail(400,'Informe decisão, referência ou motivo e data de assinatura quando aplicável.');
   const r=await execute(sql,tenant,user,"SELECT amendment_id,new_status,contract_id FROM business.decide_contract_amendment($1::uuid,$2,$3,$4::date,$5::uuid)",[decisionMatch[1],decision,reference,signed,id],true);
   if(!r.rows.length)fail(409,'Decisão não autorizada, aditivo encerrado ou contrato alterado. Confira os registros.');
   return send({item:r.rows[0]});
  }
  if(path==='/v1/contracts'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),order=b.order_id,payer=b.payer_id||null,title=name(b.title),kind=b.contract_kind,from=crmDate(b.valid_from),until=crmDate(b.valid_until);
   const terms=typeof b.payment_terms==='string'?b.payment_terms.trim():'',ref=name(b.instrument_ref,false),notes=typeof b.notes==='string'?b.notes.trim():'';
   if(typeof order!=='string'||!UUID.test(order)||(payer!==null&&(typeof payer!=='string'||!UUID.test(payer)))||!['sale','service','license','mixed'].includes(kind)||!from||(until&&until<from)||terms.length>300||notes.length>1000)fail(400,'Informe pedido, tipo de contrato, pagador e vigência válidos.');
   const r=await execute(sql,tenant,user,"SELECT contract_id,contract_code::text AS contract_code FROM business.create_contract($1::uuid,$2::uuid,$3,$4,$5::date,$6::date,$7,$8,$9,$10::uuid)",[order,payer,title,kind,from,until,terms||null,ref,notes||null,id],true);
   if(!r.rows.length)fail(409,'Pedido indisponível, já vinculado ou partes incompatíveis.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/commercial-orders'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT o.id,o.code::text AS code,o.proposal_id,p.code::text AS proposal_code,p.title,p.customer_name,p.seller_name,o.total::text AS total,o.currency,o.status,o.created_at FROM business.commercial_orders o JOIN business.proposals p ON p.tenant_id=o.tenant_id AND p.id=o.proposal_id WHERE o.tenant_id=$1::uuid ORDER BY o.code DESC",[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Pedidos restritos à equipe comercial.');
   return send({items:r.rows});
  }
  if(path==='/v1/proposals'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),customer=b.customer_id,list=b.list_id,opportunity=b.opportunity_id||null,title=name(b.title),until=crmDate(b.valid_until);
   const terms=typeof b.payment_terms==='string'?b.payment_terms.trim():'',notes=typeof b.notes==='string'?b.notes.trim():'';
   const uuid=v=>typeof v==='string'&&UUID.test(v);
   if(!uuid(customer)||!uuid(list)||(opportunity!==null&&!uuid(opportunity))||!until||terms.length>300||notes.length>1000||!Array.isArray(b.lines)||b.lines.length<1||b.lines.length>20)fail(400,'Informe cliente, tabela, validade e até 20 itens.');
   const lines=b.lines.map(l=>{if(!l||!uuid(l.price_entry_id)||typeof l.quantity!=='string'||!/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,3})?$/.test(l.quantity)||Number(l.quantity)<=0||typeof l.discount_pct!=='string'||!/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,2})?$/.test(l.discount_pct)||Number(l.discount_pct)>100)fail(400,'Quantidade ou desconto inválido.');return {price_entry_id:l.price_entry_id,quantity:l.quantity,discount_pct:l.discount_pct};});
   if(new Set(lines.map(l=>l.price_entry_id)).size!==lines.length)fail(400,'Não repita o mesmo item.');
   const r=await execute(sql,tenant,user,"SELECT proposal_id,proposal_code::text AS proposal_code FROM business.create_proposal($1::uuid,$2::uuid,$3::uuid,$4,$5::date,$6,$7,$8::jsonb,$9::uuid)",[customer,list,opportunity,title,until,terms||null,notes||null,JSON.stringify(lines),id],true); 
   if(!r.rows.length)fail(409,'Cliente, tabela, oportunidade ou preços incompatíveis com a proposta. Atualize os dados.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/price-lists'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`SELECT
   COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name,s.id) FROM (SELECT p.id,p.legal_name AS name FROM business.companies c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.party_id WHERE c.tenant_id=$1::uuid AND p.status='active' AND p.kind='PJ') s),'[]'::jsonb) AS sellers,
   COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.name,l.id) FROM (SELECT l.id,l.seller_id,p.legal_name AS seller_name,l.name,l.segment,l.payment_terms,l.currency FROM business.price_lists l JOIN core.parties p ON p.tenant_id=l.tenant_id AND p.id=l.seller_id WHERE l.tenant_id=$1::uuid) l),'[]'::jsonb) AS lists,
   COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.valid_from DESC,e.id) FROM (SELECT e.id,e.list_id,e.item_id,i.name AS item_name,i.code::text AS item_code,e.unit,e.unit_price::text AS unit_price,e.valid_from::text AS valid_from,e.valid_until::text AS valid_until,CASE WHEN e.valid_from>CURRENT_DATE THEN 'scheduled' WHEN e.valid_until<CURRENT_DATE THEN 'expired' ELSE 'active' END AS validity FROM business.price_entries e JOIN business.catalog_items i ON i.tenant_id=e.tenant_id AND i.id=e.item_id WHERE e.tenant_id=$1::uuid) e),'[]'::jsonb) AS entries`,[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Preços restritos à equipe comercial.');
   return send({sellers:r.rows[0]?.sellers||[],lists:r.rows[0]?.lists||[],entries:r.rows[0]?.entries||[]});
  }
  if(path==='/v1/price-lists'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),seller=b.seller_id,label=name(b.name),segment=name(b.segment,false),terms=typeof b.payment_terms==='string'?b.payment_terms.trim():'';
   if(typeof seller!=='string'||!UUID.test(seller)||label.length>120||(segment&&segment.length>120)||terms.length>300)fail(400,'Informe empresa própria, nome e condições válidas.');
   const r=await execute(sql,tenant,user,"SELECT list_id FROM business.create_price_list($1::uuid,$2,$3,$4,$5::uuid)",[seller,label,segment,terms||null,id]);
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/price-entries'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),list=b.list_id,item=b.item_id,price=crmValue(b.unit_price),from=crmDate(b.valid_from),until=crmDate(b.valid_until);
   if(typeof list!=='string'||!UUID.test(list)||typeof item!=='string'||!UUID.test(item)||price===null||!from||(until&&until<from))fail(400,'Informe tabela, item, preço e vigência válidos.');
   const r=await execute(sql,tenant,user,"SELECT entry_id FROM business.add_price_entry($1::uuid,$2::uuid,$3::numeric,$4::date,$5::date,$6::uuid)",[list,item,price,from,until,id],true);
   if(!r.rows.length)fail(409,'Item indisponível ou vigência sobreposta. Encerre o preço anterior antes de cadastrar outro.');
   return send({item:r.rows[0]},201);
  }
  const priceMatch=path.match(/^\/v1\/price-entries\/([^/]+)\/close$/);
  if(priceMatch&&UUID.test(priceMatch[1])&&request.method==='POST'){
   const b=await body(request),id=requestId(b),until=crmDate(b.valid_until),reason=typeof b.reason==='string'?b.reason.trim():'';
   if(!until||!reason||reason.length>300)fail(400,'Informe último dia de vigência e motivo.');
   const r=await execute(sql,tenant,user,"SELECT entry_id FROM business.close_price_entry($1::uuid,$2::date,$3,$4::uuid)",[priceMatch[1],until,reason,id],true);
   if(!r.rows.length)fail(409,'Preço não encontrado ou encerramento inválido.');
   return send({item:r.rows[0]});
  }
  if(path==='/v1/catalog'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name,c.id) FROM (SELECT id,name FROM business.catalog_categories WHERE tenant_id=$1::uuid) c),'[]'::jsonb) AS categories,COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.name,i.id) FROM (SELECT i.id,i.code::text AS code,i.category_id,c.name AS category_name,i.kind,i.name,i.description,i.unit,i.status,i.revision FROM business.catalog_items i JOIN business.catalog_categories c ON c.tenant_id=i.tenant_id AND c.id=i.category_id WHERE i.tenant_id=$1::uuid) i),'[]'::jsonb) AS items",[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Catálogo restrito à equipe de cadastro.');
   return send({categories:r.rows[0]?.categories||[],items:r.rows[0]?.items||[]});
  }
  if(path==='/v1/catalog/categories'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),label=name(b.name);
   if(label.length>120)fail(400,'Categoria deve ter até 120 caracteres.');
   const r=await execute(sql,tenant,user,"SELECT category_id FROM business.create_catalog_category($1,$2::uuid)",[label,id]);
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/catalog/items'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),label=name(b.name),category=b.category_id,kind=b.kind,unit=b.unit,description=b.description==null?'':b.description;
   const units={product:['unit','kit','kg','meter','liter'],service:['unit','hour','day','project','month','year'],license:['unit','seat','device','institution','month','year']};
   if(typeof category!=='string'||!UUID.test(category)||!Object.hasOwn(units,kind)||!units[kind].includes(unit)||typeof description!=='string'||description.trim().length>1000)fail(400,'Selecione categoria, tipo, unidade compatível e descrição válida.');
   const r=await execute(sql,tenant,user,"SELECT item_id,item_code::text AS item_code FROM business.create_catalog_item($1::uuid,$2,$3,$4,$5,$6::uuid)",[category,kind,label,description,unit,id]);
   return send({item:r.rows[0]},201);
  }
  const catalogMatch=path.match(/^\/v1\/catalog\/items\/([^/]+)\/update$/);
  if(catalogMatch&&UUID.test(catalogMatch[1])&&request.method==='POST'){
   const b=await body(request),id=requestId(b),label=name(b.name),category=b.category_id,unit=b.unit,status=b.status,description=b.description==null?'':b.description;
   if(typeof category!=='string'||!UUID.test(category)||!['unit','kit','kg','meter','liter','hour','day','project','month','year','seat','device','institution'].includes(unit)||!['active','inactive'].includes(status)||typeof description!=='string'||description.trim().length>1000||!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646)fail(400,'Dados de atualização inválidos.');
   const r=await execute(sql,tenant,user,"SELECT item_id,new_revision FROM business.update_catalog_item($1::uuid,$2::integer,$3::uuid,$4,$5,$6,$7,$8::uuid)",[catalogMatch[1],b.revision,category,label,description,unit,status,id],true);
   if(!r.rows.length)fail(409,'Item não encontrado, sem alterações ou atualizado por outro usuário.');
   return send({item:r.rows[0]});
  }
  if(path==='/v1/crm/opportunities'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT o.id,o.party_id,p.legal_name AS party_name,o.title,o.stage,o.estimated_value::text AS estimated_value,o.expected_close::text AS expected_close,o.next_followup::text AS next_followup,o.loss_reason,o.revision,o.created_at,o.updated_at,CASE WHEN o.stage NOT IN ('won','lost') AND o.next_followup<CURRENT_DATE THEN true ELSE false END AS overdue FROM business.opportunities o JOIN core.parties p ON p.tenant_id=o.tenant_id AND p.id=o.party_id WHERE o.tenant_id=$1::uuid ORDER BY o.updated_at DESC,o.id",[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'CRM restrito à equipe de cadastro.');
   return send({items:r.rows});
  }
  if(path==='/v1/crm/opportunities'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),party=b.party_id,title=name(b.title),value=crmValue(b.estimated_value),close=crmDate(b.expected_close),followup=crmDate(b.next_followup);
   if(typeof party!=='string'||!UUID.test(party))fail(400,'Selecione a pessoa ou empresa.');
   const r=await execute(sql,tenant,user,"SELECT opportunity_id FROM business.create_opportunity($1::uuid,$2,$3::numeric,$4::date,$5::date,$6::uuid)",[party,title,value,close,followup,id]);
   return send({item:r.rows[0]},201);
  }
  const crmMatch=path.match(/^\/v1\/crm\/opportunities\/([^/]+)\/(update|interactions)$/);
  if(crmMatch&&UUID.test(crmMatch[1])){
   const opportunity=crmMatch[1],operation=crmMatch[2];
   if(operation==='update'&&request.method==='POST'){
    const b=await body(request),id=requestId(b),title=name(b.title),stage=b.stage,value=crmValue(b.estimated_value),close=crmDate(b.expected_close),followup=crmDate(b.next_followup),reason=typeof b.loss_reason==='string'?b.loss_reason.trim():'';
    if(!Number.isInteger(b.revision)||b.revision<1||b.revision>2147483646||!['prospecting','qualified','proposal','negotiation','won','lost'].includes(stage)||reason.length>300||(stage==='lost'?!reason:!!reason))fail(400,'Informe etapa, revisão e motivo de perda quando aplicável.');
    const r=await execute(sql,tenant,user,"SELECT opportunity_id,new_revision FROM business.update_opportunity($1::uuid,$2::integer,$3,$4,$5::numeric,$6::date,$7::date,$8,$9::uuid)",[opportunity,b.revision,title,stage,value,close,followup,reason||null,id],true);
    if(!r.rows.length)fail(409,'Oportunidade encerrada, alterada por outro usuário ou não encontrada.');
    return send({item:r.rows[0]});
   }
   if(operation==='interactions'&&request.method==='GET'){
    const r=await execute(sql,tenant,user,"SELECT id,channel,interaction_date::text AS interaction_date,summary,created_at,created_by FROM business.crm_interactions WHERE tenant_id=$1::uuid AND opportunity_id=$2::uuid ORDER BY interaction_date DESC,created_at DESC,id",[tenant,opportunity]);
    if(!['owner','registry_editor'].includes(r.role))fail(403,'CRM restrito à equipe de cadastro.');
    return send({items:r.rows});
   }
   if(operation==='interactions'&&request.method==='POST'){
    const b=await body(request),id=requestId(b),channel=b.channel,date=crmDate(b.interaction_date),summary=typeof b.summary==='string'?b.summary.trim():'';
    if(!['phone','email','meeting','message','visit','other'].includes(channel)||!date||!summary||summary.length>1000)fail(400,'Informe canal, data e resumo da interação.');
    const r=await execute(sql,tenant,user,"SELECT interaction_id FROM business.add_crm_interaction($1::uuid,$2,$3::date,$4,$5::uuid)",[opportunity,channel,date,summary,id]);
    if(!r.rows.length)fail(404,'Oportunidade não encontrada ou acesso restrito.');
    return send({item:r.rows[0]},201);
   }
  }
  if(path==='/v1/maintenance'&&request.method==='GET'){
   const scope=await masterInstitutions(request,env);
   const r=await execute(sql,tenant,user,`WITH entities AS (
 SELECT 'party' AS kind,p.id,p.legal_name AS name,p.display_name,p.code::text AS code,p.kind AS subtype,NULL::text AS parent_name,p.status FROM core.parties p WHERE p.tenant_id=$1::uuid
 UNION ALL SELECT 'establishment',e.id,e.name,NULL::text,NULL::text,e.kind,p.legal_name,e.status FROM core.establishments e JOIN core.parties p ON p.tenant_id=e.tenant_id AND p.id=e.party_id WHERE e.tenant_id=$1::uuid
), links AS (
 SELECT 'institution_link' AS kind,l.id,l.institution_id,p.legal_name||COALESCE(' · '||e.name,'') AS label,l.valid_from,(l.valid_until-1) AS last_day FROM core.institution_links l JOIN core.parties p ON p.tenant_id=l.tenant_id AND p.id=l.party_id LEFT JOIN core.establishments e ON e.tenant_id=l.tenant_id AND e.id=l.establishment_id WHERE l.tenant_id=$1::uuid AND l.institution_id=ANY($2::uuid[])
 UNION ALL SELECT 'company_contact',c.id,NULL::uuid,p.legal_name||' · '||f.legal_name||' · '||c.role,c.valid_from,c.valid_until FROM core.company_contacts c JOIN core.parties p ON p.tenant_id=c.tenant_id AND p.id=c.company_id JOIN core.parties f ON f.tenant_id=c.tenant_id AND f.id=c.person_id WHERE c.tenant_id=$1::uuid
 UNION ALL SELECT 'franchise_relationship',r.id,NULL::uuid,b.name||' · '||f.legal_name||' → '||p.legal_name,r.valid_from,r.valid_until FROM core.franchise_relationships r JOIN core.franchise_networks n ON n.tenant_id=r.tenant_id AND n.id=r.network_id JOIN core.brands b ON b.tenant_id=n.tenant_id AND b.id=n.brand_id JOIN core.parties f ON f.tenant_id=n.tenant_id AND f.id=n.franchisor_id JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=r.franchisee_id WHERE r.tenant_id=$1::uuid
)
SELECT COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.name,e.id) FROM entities e),'[]'::jsonb) AS entities,
 COALESCE((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('validity',CASE WHEN l.valid_from>CURRENT_DATE THEN 'scheduled' WHEN l.last_day<CURRENT_DATE THEN 'expired' ELSE 'active' END) ORDER BY l.valid_from DESC,l.id) FROM links l),'[]'::jsonb) AS links`,[tenant,[...scope]]);
   return send({entities:r.rows[0]?.entities||[],links:r.rows[0]?.links||[],can_edit:['owner','registry_editor'].includes(r.role),can_close:r.role==='owner'});
  }
  if(path==='/v1/audit'&&request.method==='GET'){
   const scope=await masterInstitutions(request,env);
   const r=await execute(sql,tenant,user,`SELECT a.id,a.actor_id,a.entity_type,a.entity_id,a.action,a.request_id,a.details,a.created_at FROM business.audit_events a WHERE a.tenant_id=$1::uuid AND (
 a.entity_type IN ('party','establishment','corporate_group','corporate_group_member','ownership_interest','company_contact','brand','franchise_network','franchise_relationship','opportunity','crm_interaction','catalog_category','catalog_item','price_list','price_entry','proposal','commercial_order','contract','contract_amendment','license_right','financial_obligation','financial_settlement','financial_reversal','treasury_account','treasury_transfer','treasury_link','financial_renegotiation','financial_recurring_rule','financial_recurring_occurrence','treasury_reconciliation','treasury_reconciliation_void','purchase_request')
 OR (a.entity_type='license_allocation' AND EXISTS (SELECT 1 FROM business.license_allocations la WHERE la.tenant_id=a.tenant_id AND la.id=a.entity_id AND (la.institution_id IS NULL OR la.institution_id=ANY($2::uuid[]))))
 OR (a.entity_type='institution_link' AND EXISTS (SELECT 1 FROM core.institution_links l WHERE l.tenant_id=a.tenant_id AND l.id=a.entity_id AND l.institution_id=ANY($2::uuid[])))
 OR (a.entity_type='institution_admin_relation' AND EXISTS (SELECT 1 FROM core.institution_admin_relations r WHERE r.tenant_id=a.tenant_id AND r.id=a.entity_id AND r.supervisor_id=ANY($2::uuid[]) AND r.subordinate_id=ANY($2::uuid[])))
) ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,[tenant,[...scope]]);
   if(r.role!=='owner')fail(403,'Auditoria restrita ao proprietário.');
   return send({items:r.rows,limit:100});
  }
  if(path==='/v1/maintenance/edit'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),entity=b.entity_id,kind=b.kind,label=name(b.name),oldName=name(b.old_name);
   if(typeof entity!=='string'||!UUID.test(entity)||!['party','establishment'].includes(kind))fail(400,'Selecione um cadastro válido.');
   const r=kind==='party'?await execute(sql,tenant,user,"SELECT party_id FROM business.update_party_name($1::uuid,$2,$3,$4,$5,$6::uuid)",[entity,oldName,name(b.old_display,false),label,name(b.display_name,false),id],true):await execute(sql,tenant,user,"SELECT establishment_id FROM business.update_establishment_name($1::uuid,$2,$3,$4::uuid)",[entity,oldName,label,id],true);
   if(!r.rows.length)fail(409,'Cadastro não encontrado, alterado por outro usuário ou sem mudanças. Atualize os dados.');
   return send({item:r.rows[0]});
  }
  if(path==='/v1/maintenance/close'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),entity=b.entity_id,kind=b.kind,last=b.last_day;
   const reason=typeof b.reason==='string'?b.reason.trim():'';
   const date=v=>typeof v==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)&&v.slice(0,4)!=='0000'&&v<='9999-12-30'&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
   if(typeof entity!=='string'||!UUID.test(entity)||!['institution_link','company_contact','franchise_relationship'].includes(kind)||!date(last)||!reason||reason.length>300)fail(400,'Informe vínculo, último dia de vigência e motivo válido.');
   let r;
   if(kind==='institution_link'){const scope=await masterInstitutions(request,env);r=await execute(sql,tenant,user,"SELECT closed_id,valid_until FROM business.close_institution_link($1::uuid,$2::date,$3,$4::uuid,$5::uuid[])",[entity,last,reason,id,[...scope]],true);}
   else if(kind==='company_contact')r=await execute(sql,tenant,user,"SELECT closed_id,valid_until FROM business.close_company_contact($1::uuid,$2::date,$3,$4::uuid)",[entity,last,reason,id],true);
   else r=await execute(sql,tenant,user,"SELECT closed_id,valid_until FROM business.close_franchise_relationship($1::uuid,$2::date,$3,$4::uuid)",[entity,last,reason,id],true);
   if(!r.rows.length)fail(409,'Vínculo fora do escopo, não encontrado, ou data não encurta a vigência.');
   return send({item:r.rows[0]});
  }
  if(path==='/v1/organogram'&&request.method==='GET'){
   const scope=await masterInstitutions(request,env);
   const institutionIds=[...scope];
   const r=await execute(sql,tenant,user,`WITH nodes AS (
 SELECT 'party:'||p.id AS id, p.kind AS kind, p.legal_name AS label, jsonb_build_object('code',p.code::text,'status',p.status,'own_company',EXISTS(SELECT 1 FROM business.companies c WHERE c.tenant_id=p.tenant_id AND c.party_id=p.id),'roles',ARRAY(SELECT r.role FROM business.party_roles r WHERE r.tenant_id=p.tenant_id AND r.party_id=p.id AND r.active ORDER BY r.role)) AS meta FROM core.parties p WHERE p.tenant_id=$1::uuid
 UNION ALL SELECT 'establishment:'||e.id,'establishment',e.name,jsonb_build_object('kind',e.kind,'status',e.status) FROM core.establishments e WHERE e.tenant_id=$1::uuid
 UNION ALL SELECT 'group:'||g.id,'group',g.name,'{}'::jsonb FROM core.corporate_groups g WHERE g.tenant_id=$1::uuid
 UNION ALL SELECT 'brand:'||b.id,'brand',b.name,'{}'::jsonb FROM core.brands b WHERE b.tenant_id=$1::uuid
 UNION ALL SELECT 'network:'||n.id,'network',b.name||' · '||p.legal_name,'{}'::jsonb FROM core.franchise_networks n JOIN core.brands b ON b.tenant_id=n.tenant_id AND b.id=n.brand_id JOIN core.parties p ON p.tenant_id=n.tenant_id AND p.id=n.franchisor_id WHERE n.tenant_id=$1::uuid
), edges AS (
 SELECT 'establishment:'||e.id AS id,'legal' AS category,'party:'||e.party_id AS source,'establishment:'||e.id AS target,CASE WHEN e.kind='matrix' THEN 'Matriz' ELSE 'Filial' END AS label FROM core.establishments e WHERE e.tenant_id=$1::uuid
 UNION ALL SELECT 'institution_link:'||l.id,'operational',COALESCE('establishment:'||l.establishment_id,'party:'||l.party_id),'institution:'||l.institution_id,'Vínculo jurídico operacional' FROM core.institution_links l WHERE l.tenant_id=$1::uuid AND l.institution_id=ANY($2::uuid[]) AND l.valid_from<=CURRENT_DATE AND (l.valid_until IS NULL OR l.valid_until>CURRENT_DATE)
 UNION ALL SELECT 'group_member:'||m.id,'group','group:'||m.group_id,'party:'||m.party_id,CASE WHEN m.membership_kind='coordinator' THEN 'Coordenadora' ELSE 'Integrante' END FROM core.corporate_group_members m WHERE m.tenant_id=$1::uuid
 UNION ALL SELECT 'admin:'||a.id,'administrative','institution:'||a.supervisor_id,'institution:'||a.subordinate_id,CASE WHEN a.autonomy='delegated' THEN 'Gestão delegada' ELSE 'Gestão centralizada' END FROM core.institution_admin_relations a WHERE a.tenant_id=$1::uuid AND a.supervisor_id=ANY($2::uuid[]) AND a.subordinate_id=ANY($2::uuid[])
 UNION ALL SELECT 'ownership:'||o.id,'ownership','party:'||o.shareholder_id,'party:'||o.company_id,'Capital: '||trim_scale(o.capital_pct)::text||'%'||CASE WHEN o.vote_pct IS NULL THEN ' · votos não informados' ELSE ' · votos: '||trim_scale(o.vote_pct)::text||'%' END FROM core.ownership_interests o WHERE o.tenant_id=$1::uuid
 UNION ALL SELECT 'brand:'||b.id,'commercial','party:'||b.holder_id,'brand:'||b.id,'Titular declarado' FROM core.brands b WHERE b.tenant_id=$1::uuid
 UNION ALL SELECT 'brand_network:'||n.id,'commercial','brand:'||n.brand_id,'network:'||n.id,'Marca da rede' FROM core.franchise_networks n WHERE n.tenant_id=$1::uuid
 UNION ALL SELECT 'franchisor:'||n.id,'commercial','party:'||n.franchisor_id,'network:'||n.id,'Franqueadora' FROM core.franchise_networks n WHERE n.tenant_id=$1::uuid
 UNION ALL SELECT 'franchise:'||r.id,'commercial','network:'||r.network_id,'party:'||r.franchisee_id,'Franqueada' FROM core.franchise_relationships r WHERE r.tenant_id=$1::uuid AND r.valid_from<=CURRENT_DATE AND (r.valid_until IS NULL OR r.valid_until>=CURRENT_DATE)
 UNION ALL SELECT 'contact:'||c.id,'contact','party:'||c.person_id,'party:'||c.company_id,CASE c.role WHEN 'commercial' THEN 'Contato comercial' WHEN 'administrative' THEN 'Contato administrativo' WHEN 'financial' THEN 'Contato financeiro' WHEN 'technical' THEN 'Contato técnico' WHEN 'legal_contact' THEN 'Contato jurídico' WHEN 'legal_representative' THEN 'Representante legal declarado' WHEN 'attorney' THEN 'Procurador declarado' ELSE 'Contato' END FROM core.company_contacts c WHERE c.tenant_id=$1::uuid AND c.valid_from<=CURRENT_DATE AND (c.valid_until IS NULL OR c.valid_until>=CURRENT_DATE)
)
SELECT COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.kind,n.label,n.id) FROM nodes n),'[]'::jsonb) AS nodes,
 COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.category,e.id) FROM edges e),'[]'::jsonb) AS edges`,[tenant,institutionIds]);
   return send({nodes:r.rows[0]?.nodes||[],edges:r.rows[0]?.edges||[],institution_ids:institutionIds,contacts_visible:['owner','registry_editor'].includes(r.role)});
  }
  if(path==='/v1/brands'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT b.id,b.name,b.holder_id,p.legal_name AS holder_name,b.registration_ref FROM core.brands b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.holder_id WHERE b.tenant_id=$1::uuid ORDER BY b.name,p.legal_name",[tenant]);
   return send({items:r.rows});
  }
  if(path==='/v1/brands'&&request.method==='POST'){
   const b=await body(request),holder=b.holder_id,label=name(b.name),registration=name(b.registration_ref,false),id=requestId(b);
   if(typeof holder!=='string'||!UUID.test(holder))fail(400,'Selecione o titular.');
   const r=await execute(sql,tenant,user,"SELECT brand_id FROM business.create_brand($1::uuid,$2,$3,$4::uuid)",[holder,label,registration,id]);
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/franchise-networks'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT n.id,n.brand_id,b.name AS brand_name,n.franchisor_id,p.legal_name AS franchisor_name,n.authority_ref FROM core.franchise_networks n JOIN core.brands b ON b.tenant_id=n.tenant_id AND b.id=n.brand_id JOIN core.parties p ON p.tenant_id=n.tenant_id AND p.id=n.franchisor_id WHERE n.tenant_id=$1::uuid ORDER BY b.name,p.legal_name",[tenant]);
   return send({items:r.rows});
  }
  if(path==='/v1/franchise-networks'&&request.method==='POST'){
   const b=await body(request),brand=b.brand_id,franchisor=b.franchisor_id,ref=name(b.authority_ref),id=requestId(b);
   if(typeof brand!=='string'||!UUID.test(brand)||typeof franchisor!=='string'||!UUID.test(franchisor))fail(400,'Selecione marca e franqueadora.');
   const r=await execute(sql,tenant,user,"SELECT network_id FROM business.create_franchise_network($1::uuid,$2::uuid,$3,$4::uuid)",[brand,franchisor,ref,id]);
   if(!r.rows.length)fail(409,'Rede já cadastrada para esta marca e franqueadora.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/franchise-relationships'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT r.id,r.network_id,r.franchisee_id,b.name AS brand_name,f.legal_name AS franchisor_name,p.legal_name AS franchisee_name,r.agreement_ref,r.territory,r.valid_from,r.valid_until,CASE WHEN r.valid_from>CURRENT_DATE THEN 'scheduled' WHEN r.valid_until<CURRENT_DATE THEN 'expired' ELSE 'active' END AS validity FROM core.franchise_relationships r JOIN core.franchise_networks n ON n.tenant_id=r.tenant_id AND n.id=r.network_id JOIN core.brands b ON b.tenant_id=n.tenant_id AND b.id=n.brand_id JOIN core.parties f ON f.tenant_id=n.tenant_id AND f.id=n.franchisor_id JOIN core.parties p ON p.tenant_id=r.tenant_id AND p.id=r.franchisee_id WHERE r.tenant_id=$1::uuid ORDER BY b.name,p.legal_name,r.valid_from DESC",[tenant]);
   return send({items:r.rows});
  }
  if(path==='/v1/franchise-relationships'&&request.method==='POST'){
   const b=await body(request),network=b.network_id,franchisee=b.franchisee_id,ref=name(b.agreement_ref),territory=name(b.territory,false),id=requestId(b);
   const date=v=>typeof v==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)&&v.slice(0,4)!=='0000'&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
   const from=b.valid_from,until=b.valid_until||null;
   if(typeof network!=='string'||!UUID.test(network)||typeof franchisee!=='string'||!UUID.test(franchisee)||!date(from)||(until!==null&&(!date(until)||until<from)))fail(400,'Selecione rede, franqueado e vigência válida.');
   const r=await execute(sql,tenant,user,"SELECT relationship_id FROM business.add_franchise_relationship($1::uuid,$2::uuid,$3,$4,$5::date,$6::date,$7::uuid)",[network,franchisee,ref,territory,from,until,id],true);
   if(!r.rows.length)fail(409,'Já existe vínculo de franquia com vigência sobreposta.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/company-contacts'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT x.id,x.company_id,x.person_id,c.legal_name AS company_name,p.legal_name AS person_name,x.role,x.job_title,x.email,x.phone,x.document_ref,x.authority_scope,x.valid_from,x.valid_until,CASE WHEN x.valid_from>CURRENT_DATE THEN 'scheduled' WHEN x.valid_until<CURRENT_DATE THEN 'expired' ELSE 'active' END AS validity FROM core.company_contacts x JOIN core.parties c ON c.tenant_id=x.tenant_id AND c.id=x.company_id JOIN core.parties p ON p.tenant_id=x.tenant_id AND p.id=x.person_id WHERE x.tenant_id=$1::uuid ORDER BY c.legal_name,p.legal_name,x.role,x.valid_from DESC",[tenant]);
   if(!['owner','registry_editor'].includes(r.role))fail(403,'Contatos restritos aos responsáveis pelo cadastro.');
   return send({items:r.rows});
  }
  if(path==='/v1/company-contacts'&&request.method==='POST'){
   const b=await body(request),company=b.company_id,person=b.person_id,role=b.role,id=requestId(b);
   const roles=['commercial','administrative','financial','technical','legal_contact','legal_representative','attorney'];
   const optional=(v,max)=>{if(v===undefined||v===null||v==='')return null;if(typeof v!=='string'||v.trim().length>max)fail(400,'Campo de contato inválido.');return v.trim()||null;};
   const title=optional(b.job_title,120),email=optional(b.email,254),phone=optional(b.phone,40),ref=optional(b.document_ref,200),scope=optional(b.authority_scope,500);
   const date=v=>typeof v==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)&&v.slice(0,4)!=='0000'&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
   const from=b.valid_from,until=b.valid_until||null,legal=['legal_representative','attorney'].includes(role);
   if(typeof company!=='string'||!UUID.test(company)||typeof person!=='string'||!UUID.test(person)||!roles.includes(role)||!date(from)||(until!==null&&(!date(until)||until<from)))fail(400,'Selecione empresa, pessoa física, função e vigência válidas.');
   if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'E-mail inválido.');
   if(phone&&(!/^[+0-9() .-]+$/.test(phone)||phone.replace(/[^0-9]/g,'').length<7||phone.replace(/[^0-9]/g,'').length>15))fail(400,'Telefone inválido.');
   if(legal&&(!ref||!scope))fail(400,'Representação legal exige referência documental e escopo declarado.');
   if(!legal&&(ref||scope))fail(400,'Referência e poderes são reservados à representação legal.');
   const r=await execute(sql,tenant,user,"SELECT contact_id FROM business.add_company_contact($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11::uuid)",[company,person,role,title,email,phone,ref,scope,from,until,id],true);
   if(!r.rows.length)fail(409,'Já existe contato com a mesma função e vigência sobreposta.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/ownership'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT o.id,o.company_id,o.shareholder_id,c.legal_name AS company_name,p.legal_name AS shareholder_name,p.kind AS shareholder_kind,o.capital_pct::text AS capital_pct,o.vote_pct::text AS vote_pct,o.declared_control,o.valid_from FROM core.ownership_interests o JOIN core.parties c ON c.tenant_id=o.tenant_id AND c.id=o.company_id JOIN core.parties p ON p.tenant_id=o.tenant_id AND p.id=o.shareholder_id WHERE o.tenant_id=$1::uuid ORDER BY c.legal_name,p.legal_name",[tenant]);
   return send({items:r.rows});
  }
  if(path==='/v1/ownership'&&request.method==='POST'){
   const b=await body(request),company=b.company_id,shareholder=b.shareholder_id,capital=b.capital_pct,vote=b.vote_pct===null||b.vote_pct===''||b.vote_pct===undefined?null:b.vote_pct,control=b.declared_control,id=requestId(b);
   const decimal=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?$/.test(v)&&Number(v)<=100;
   if(typeof company!=='string'||!UUID.test(company)||typeof shareholder!=='string'||!UUID.test(shareholder)||company.toLowerCase()===shareholder.toLowerCase()||!decimal(capital)||Number(capital)<=0||(vote!==null&&!decimal(vote))||!['unspecified','individual','joint','none'].includes(control))fail(400,'Informe sócio, empresa e percentuais válidos de capital e voto (até 6 casas decimais).');
   const r=await execute(sql,tenant,user,"SELECT interest_id FROM business.add_ownership_interest($1::uuid,$2::uuid,$3::numeric,$4::numeric,$5,$6::uuid)",[company,shareholder,capital,vote,control,id],true);
   if(!r.rows.length)fail(409,'Participação já registrada ou soma de capital/votos superior a 100%.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/corporate-groups'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT g.id,g.name,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'party_id',p.id,'party_name',p.legal_name,'membership_kind',m.membership_kind,'valid_from',m.valid_from) ORDER BY p.legal_name) FROM core.corporate_group_members m JOIN core.parties p ON p.tenant_id=m.tenant_id AND p.id=m.party_id WHERE m.tenant_id=g.tenant_id AND m.group_id=g.id),'[]'::jsonb) AS members FROM core.corporate_groups g WHERE g.tenant_id=$1::uuid ORDER BY g.name",[tenant]);
   return send({items:r.rows});
  }
  if(path==='/v1/corporate-groups'&&request.method==='POST'){
   const b=await body(request),label=name(b.name),id=requestId(b);
   const r=await execute(sql,tenant,user,"SELECT group_id FROM business.create_corporate_group($1,$2::uuid)",[label,id]);
   return send({item:r.rows[0]},201);
  }
  const memberMatch=path.match(/^\/v1\/corporate-groups\/([^/]+)\/members$/);
  if(memberMatch&&UUID.test(memberMatch[1])&&request.method==='POST'){
   const b=await body(request),party=b.party_id,kind=b.membership_kind,id=requestId(b);
   if(typeof party!=='string'||!UUID.test(party)||!['member','coordinator'].includes(kind))fail(400,'Selecione uma pessoa jurídica e sua participação no grupo.');
   const r=await execute(sql,tenant,user,"SELECT member_id FROM business.add_corporate_member($1::uuid,$2::uuid,$3,$4::uuid)",[memberMatch[1],party,kind,id]);
   if(!r.rows.length)fail(409,'Pessoa jurídica já vinculada ao grupo.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/admin-relations'&&request.method==='GET'){
   const scope=await masterInstitutions(request,env);
   const r=await execute(sql,tenant,user,"SELECT id,supervisor_id,subordinate_id,autonomy,valid_from FROM core.institution_admin_relations WHERE tenant_id=$1::uuid ORDER BY valid_from,id",[tenant]);
   return send({items:r.rows.filter(x=>scope.has(x.supervisor_id.toLowerCase())&&scope.has(x.subordinate_id.toLowerCase()))});
  }
  if(path==='/v1/admin-relations'&&request.method==='POST'){
   const b=await body(request),supervisor=b.supervisor_id,subordinate=b.subordinate_id,autonomy=b.autonomy,id=requestId(b);
   if(typeof supervisor!=='string'||!UUID.test(supervisor)||typeof subordinate!=='string'||!UUID.test(subordinate)||supervisor.toLowerCase()===subordinate.toLowerCase()||!['delegated','centralized'].includes(autonomy))fail(400,'Selecione duas instituições distintas e o nível de autonomia.');
   const scope=await masterInstitutions(request,env);
   if(!scope.has(supervisor.toLowerCase())||!scope.has(subordinate.toLowerCase()))fail(403,'Instituição fora do escopo autorizado.');
   const r=await execute(sql,tenant,user,"SELECT relation_id FROM business.add_admin_relation($1::uuid,$2::uuid,$3,$4::uuid)",[supervisor,subordinate,autonomy,id],true);
   if(!r.rows.length)fail(409,'A instituição já possui supervisão direta ou a relação criaria um ciclo.');
   return send({item:r.rows[0]},201);
  }
  if(path==='/v1/institution-links'&&request.method==='GET'){
   const scope=await masterInstitutions(request,env);
   const r=await execute(sql,tenant,user,"SELECT l.id,l.institution_id,l.party_id,l.establishment_id,l.valid_from,p.legal_name AS party_name,e.name AS establishment_name,e.cnpj FROM core.institution_links l JOIN core.parties p ON p.tenant_id=l.tenant_id AND p.id=l.party_id LEFT JOIN core.establishments e ON e.tenant_id=l.tenant_id AND e.id=l.establishment_id WHERE l.tenant_id=$1::uuid AND l.valid_from<=CURRENT_DATE AND (l.valid_until IS NULL OR l.valid_until>CURRENT_DATE) ORDER BY l.valid_from DESC",[tenant]);
   return send({items:r.rows.filter(l=>scope.has(l.institution_id.toLowerCase()))});
  }
  if(path==='/v1/institution-links'&&request.method==='POST'){
   const b=await body(request),id=requestId(b),institution=b.institution_id,party=b.party_id,establishment=b.establishment_id||null;
   if(typeof institution!=='string'||!UUID.test(institution)||typeof party!=='string'||!UUID.test(party)||(establishment!==null&&(typeof establishment!=='string'||!UUID.test(establishment))))fail(400,'Selecione instituição, pessoa jurídica e estabelecimento válido, quando aplicável.');
   const scope=await masterInstitutions(request,env);
   if(!scope.has(institution.toLowerCase()))fail(403,'Instituição fora do escopo autorizado do Master.');
   const r=await execute(sql,tenant,user,"SELECT link_id FROM business.link_institution($1::uuid,$2::uuid,$3::uuid,$4::uuid)",[institution,party,establishment,id]);
   if(!r.rows.length)fail(409,'Já existe vínculo vigente ou futuro. Consulte o cadastro.');
   return send({item:r.rows[0]},201);
  }
  const classificationMatch=path.match(/^\/v1\/parties\/([^/]+)\/classifications$/);
  if(classificationMatch&&UUID.test(classificationMatch[1])&&request.method==='POST'){
   const b=await body(request),classification=b.classification,id=requestId(b);
   if(!['customer','supplier','partner','service_provider','representative','own_company'].includes(classification))fail(400,'Classificação inválida.');
   const r=await execute(sql,tenant,user,"SELECT classification,inserted FROM business.add_classification($1::uuid,$2,$3::uuid)",[classificationMatch[1],classification,id]);
   if(!r.rows.length)fail(404,'Cadastro ativo não encontrado.');
   return send({item:r.rows[0]},r.rows[0].inserted?201:200);
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
  if(e?.code==='42501'&&(/management_(allocation|budget)_period_guard/.test(e.message||'')))return send({error:'Período gerencial encerrado. Consulte o fechamento e reabra com justificativa, se necessário.'},409);
  if(e?.code==='42501'&&/asset_movements_lifecycle_guard/.test(e.message||''))return send({error:'Bem encerrado ou data anterior ao último evento patrimonial.'},409);
  if(e?.code==='42501')return send({error:'Operação não autorizada.'},403);
  if(['40001','40P01'].includes(e?.code))return send({error:'Alteração concorrente. Atualize a estrutura antes de tentar novamente.'},409);
  if(e?.code==='23P01')return send({error:'Recurso indisponível no período ou em utilização. Atualize a agenda antes de repetir.'},409);
  if(e?.code==='23505')return send({error:'Cadastro existente ou conflito de unicidade. Consulte antes de repetir.'},409);
  if(['23514','23503','23502','22P02'].includes(e?.code))return send({error:'Dados incompatíveis com as regras cadastrais.'},422);
  return send({error:'Serviço cadastral indisponível. Não reenvie sem consultar o cadastro.'},503);
 }
}};
