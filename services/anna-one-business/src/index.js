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
 if(path==='/health'&&request.method==='GET')return send({service:'anna-one-business',version:'0.1.0-dev',status:'online'});
 try{
  if(!env.DATABASE_URL||!UUID.test(env.INTERNAL_TENANT_ID||''))fail(503,'Serviço cadastral ainda não configurado.');
  const user=await actor(request,env),tenant=env.INTERNAL_TENANT_ID;
  const sql=neon(env.DATABASE_URL);
  if(path==='/v1/context'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,"SELECT id,name FROM business.tenants WHERE id=$1::uuid AND kind='internal' AND status='active'",[tenant]);
   return send({tenant:r.rows[0],role:r.role,can_write:['owner','registry_editor'].includes(r.role),classifications:true,institution_links:true,corporate_structure:true,ownership:true,brands_franchises:true,organogram:true,maintenance:true,proposal_workflow:true,contract_lifecycle:true,contract_amendments:true,finance:r.role==='owner',contract_dashboard:['owner','registry_editor'].includes(r.role),license_allocations:['owner','registry_editor'].includes(r.role),license_rights:['owner','registry_editor'].includes(r.role),contracts:['owner','registry_editor'].includes(r.role),commercial_dashboard:['owner','registry_editor'].includes(r.role),proposals:['owner','registry_editor'].includes(r.role),price_lists:['owner','registry_editor'].includes(r.role),catalog:['owner','registry_editor'].includes(r.role),crm:['owner','registry_editor'].includes(r.role),audit:r.role==='owner',company_contacts:['owner','registry_editor'].includes(r.role)});
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
  if(path==='/v1/financial-obligations'&&request.method==='GET'){
   const r=await execute(sql,tenant,user,`WITH clock AS (SELECT (now() AT TIME ZONE 'America/Fortaleza')::date AS today),
 obligations AS (SELECT o.id,o.code::text AS code,o.direction,o.company_id,o.company_name,o.counterparty_id,o.counterparty_name,o.contract_id,c.code::text AS contract_code,o.contract_revision,c.revision AS current_contract_revision,o.title,o.reference,o.amount::text AS amount,o.issued_on::text AS issued_on,o.first_due::text AS first_due,o.installment_count FROM business.financial_obligations o LEFT JOIN business.contracts c ON c.tenant_id=o.tenant_id AND c.id=o.contract_id WHERE o.tenant_id=$1::uuid),
 installments AS (SELECT i.id,i.obligation_id,i.installment_no,i.due_on::text AS due_on,i.amount::text AS amount,CASE WHEN i.due_on<clock.today THEN 'overdue' WHEN i.due_on=clock.today THEN 'today' ELSE 'scheduled' END AS validity FROM business.financial_installments i CROSS JOIN clock WHERE i.tenant_id=$1::uuid),
 companies AS (SELECT p.id,p.legal_name AS name FROM business.companies b JOIN core.parties p ON p.tenant_id=b.tenant_id AND p.id=b.party_id WHERE b.tenant_id=$1::uuid AND p.status='active'),
 parties AS (SELECT id,legal_name AS name,kind FROM core.parties WHERE tenant_id=$1::uuid AND status='active'),
 contracts AS (SELECT c.id,c.code::text AS code,c.title,c.seller_name,c.payer_name,c.total::text AS total,c.revision FROM business.contracts c WHERE c.tenant_id=$1::uuid AND c.status IN ('signed','active','suspended') AND c.signed_on IS NOT NULL AND c.total BETWEEN 0.01 AND 9999999999999999.99 AND NOT EXISTS (SELECT 1 FROM business.financial_obligations o WHERE o.tenant_id=c.tenant_id AND o.contract_id=c.id))
 SELECT jsonb_build_object('as_of',(SELECT today::text FROM clock),'obligations',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.issued_on DESC,o.code) FROM obligations o),'[]'::jsonb),'installments',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.due_on,i.obligation_id,i.installment_no) FROM installments i),'[]'::jsonb),'companies',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM companies c),'[]'::jsonb),'parties',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name) FROM parties p),'[]'::jsonb),'contracts',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code) FROM contracts c),'[]'::jsonb)) AS finance`,[tenant]);
   if(r.role!=='owner')fail(403,'Financeiro restrito ao proprietário.');
   return send(r.rows[0]?.finance||{});
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
 a.entity_type IN ('party','establishment','corporate_group','corporate_group_member','ownership_interest','company_contact','brand','franchise_network','franchise_relationship','opportunity','crm_interaction','catalog_category','catalog_item','price_list','price_entry','proposal','commercial_order','contract','contract_amendment','license_right','financial_obligation')
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
  if(e?.code==='42501')return send({error:'Operação não autorizada.'},403);
  if(e?.code==='40001')return send({error:'Alteração concorrente. Atualize a estrutura antes de tentar novamente.'},409);
  if(e?.code==='23505')return send({error:'Cadastro existente ou conflito de unicidade. Consulte antes de repetir.'},409);
  if(['23514','23503','23502','22P02'].includes(e?.code))return send({error:'Dados incompatíveis com as regras cadastrais.'},422);
  return send({error:'Serviço cadastral indisponível. Não reenvie sem consultar o cadastro.'},503);
 }
}};
