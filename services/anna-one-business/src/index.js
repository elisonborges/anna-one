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
   return send({tenant:r.rows[0],role:r.role,can_write:['owner','registry_editor'].includes(r.role),classifications:true,institution_links:true,corporate_structure:true,ownership:true,brands_franchises:true,organogram:true,company_contacts:['owner','registry_editor'].includes(r.role)});
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
