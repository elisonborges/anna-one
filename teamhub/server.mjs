import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {neon} from '@neondatabase/serverless';
import {createRemoteJWKSet,jwtVerify} from 'jose';

const vars=['DATABASE_URL','AUTH_JWKS_URL','AUTH_ISSUER'];
for(const key of vars) if(!process.env[key]) throw Error('Configuração ausente: '+key);
const sql=neon(process.env.DATABASE_URL);
const jwks=createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL));
const dir=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000);
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(res,status,obj)=>{res.writeHead(status,headers);res.end(JSON.stringify(obj));};
const validId=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'');
async function json(req){
 let raw=''; for await(const c of req){raw+=c;if(raw.length>25000)throw Object.assign(Error('Payload grande'),{status:413});}
 try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(Error('JSON inválido'),{status:400});}
}
function bad(message,status=400){throw Object.assign(Error(message),{status});}
function todayInFortaleza(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=k=>parts.find(p=>p.type===k).value;
 return part('year')+'-'+part('month')+'-'+part('day');
}
function validDueDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function checkDueDate(value){
 if(value===null||value===undefined)return;
 if(!validDueDate(value))bad('Data de prazo inválida.');
 if(value<todayInFortaleza())bad('O prazo não pode ser anterior à data de hoje.');
}

function validateTreatment(x){
 if(!['pending','analysis','executing','waiting','blocked','resolved'].includes(x))bad('Situação do tratamento inválida.');
}
function safeNote(x,max=2000){
 if(typeof x!=='string'||x.length>max)bad('Texto inválido ou muito longo.');
 return x.trim();
}
async function user(req){
 const token=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1]; if(!token)bad('Faça login no Portal AnnA One.',401);
 try{
  const {payload}=await jwtVerify(token,jwks,{issuer:process.env.AUTH_ISSUER,algorithms:['EdDSA']});
  if(typeof payload.sub!=='string'||!payload.sub)bad('Identidade inválida',401);
  req.identityEmail=typeof payload.email==='string'?payload.email.trim().toLowerCase():null;
  return payload.sub;
 }catch(e){if(e.status)throw e;console.warn('Nexus auth verification failed:',String(e?.code||e?.name||'unknown'));bad('Sessão inválida ou expirada.',401);}
}
async function membership(subject,org){
 const r=await sql`SELECT role FROM teamhub.memberships WHERE auth_subject=${subject} AND organization_id=${org} AND active=true`;
 if(!r.length)bad('Acesso à organização negado.',403);return r[0].role;
}
function requireEditor(role){if(!['admin','manager','member'].includes(role))bad('Operação não autorizada.',403);}
function requireManager(role){if(!['admin','manager'].includes(role))bad('Operação reservada ao gestor.',403);}

async function checkAssignees(org,values){
 if(!Array.isArray(values)||values.length>20||values.some(v=>typeof v!=='string'||v.length>200))bad('Selecione até 20 integrantes válidos.');
 const arr=[...new Set(values)];
 if(arr.length!==values.length)bad('Há responsáveis duplicados.');
 if(arr.length){
  const rows=await sql`SELECT auth_subject FROM teamhub.memberships WHERE organization_id=${org} AND active=true AND auth_subject IN (SELECT jsonb_array_elements_text(${JSON.stringify(arr)}::jsonb))`;
  if(rows.length!==arr.length)bad('Um ou mais responsáveis não estão ativos na organização.',403);
 }
 return arr;
}
async function syncAssignees(org,task,subjects){
 await sql`DELETE FROM teamhub.task_assignees WHERE organization_id=${org} AND task_id=${task}`;
 if(subjects.length)await sql`INSERT INTO teamhub.task_assignees(organization_id,task_id,auth_subject)
 SELECT ${org}::uuid,${task}::uuid,x.auth_subject FROM jsonb_array_elements_text(${JSON.stringify(subjects)}::jsonb) AS x(auth_subject)
 ON CONFLICT DO NOTHING`;
}
async function project(org,id){
 const rows=await sql`SELECT id,name,description,created_at FROM teamhub.projects WHERE organization_id=${org} AND id=${id} AND archived_at IS NULL`;
 if(!rows.length)bad('Projeto indisponível.',404);return rows[0];
}
const route=async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(405);return res.end();}
 const url=new URL(req.url,'http://localhost'); const p=url.pathname;
 if(p==='/health')return reply(res,200,{ok:true,service:'anna-nexus'});
 if(!p.startsWith('/api/')){
  if(req.method!=='GET')return reply(res,405,{error:'Método não permitido'});
  const file=p==='/'?'/index.html':p;
  if(!['/index.html','/app.js','/styles.css','/manifest.webmanifest','/anna-symbol.svg'].includes(file))return reply(res,404,{error:'Não encontrado'});
  const data=await readFile(path.join(dir,'public',file));
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.webmanifest')?'application/manifest+json':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' https://esm.sh; connect-src 'self' https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech; style-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});return res.end(data);
 }
 const subject=await user(req);
 if(p==='/api/invitations/accept'&&req.method==='POST'){
  const b=await json(req);
  const token=typeof b.token==='string'?b.token:'';
  if(!/^[a-f0-9]{64}$/.test(token))bad('Convite inválido.',400);
  if(!req.identityEmail)bad('O token de identidade não contém e-mail. Faça login novamente no portal.',403);
  const hash=createHash('sha256').update(token).digest('hex');
  const invitations=await sql`SELECT id,organization_id,email,role FROM teamhub.invitations WHERE token_hash=${hash} AND status='pending' AND expires_at>now()`;
  if(!invitations.length)bad('Convite expirado, cancelado ou já utilizado.',410);
  const invitation=invitations[0];
  if(invitation.email!==req.identityEmail)bad('Este convite foi emitido para outro e-mail. Entre com a conta convidada do Portal AnnA One.',403);
  const linked=await sql`WITH claimed AS (
   UPDATE teamhub.invitations SET status='accepted',accepted_by_subject=${subject},accepted_at=now()
   WHERE id=${invitation.id} AND status='pending' AND expires_at>now() RETURNING organization_id,role
  ), membership AS (
   INSERT INTO teamhub.memberships(organization_id,auth_subject,role,active)
   SELECT organization_id,${subject},role,true FROM claimed
   ON CONFLICT (organization_id,auth_subject) DO UPDATE SET role=EXCLUDED.role,active=true
   RETURNING organization_id
  ) SELECT organization_id FROM membership`;
  if(!linked.length)bad('O convite não está mais disponível.',409);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action) VALUES(${invitation.organization_id},${subject},'invitation.accepted')`;
  return reply(res,200,{accepted:true,organization_id:invitation.organization_id});
 }
 if(p==='/api/me'&&req.method==='GET'){
  const orgs=await sql`SELECT o.id,o.name,o.display_name,o.logo_url,m.role FROM teamhub.memberships m JOIN teamhub.organizations o ON o.id=m.organization_id WHERE m.auth_subject=${subject} AND m.active=true ORDER BY o.name`;
  return reply(res,200,{organizations:orgs});
 }
 const org=url.searchParams.get('org')||req.headers['x-organization-id'];
 if(!validId(org))bad('Selecione uma organização válida.');
 const role=await membership(subject,org);
 if(p==='/api/organization'&&req.method==='PATCH'){
  if(role!=='admin')bad('Apenas administradores podem personalizar a organização.',403);
  const b=await json(req);
  const displayName=typeof b.display_name==='string'?b.display_name.trim():'';
  const logoUrl=typeof b.logo_url==='string'?b.logo_url.trim():'';
  if(displayName.length>100)bad('Nome da empresa muito longo.');
  if(logoUrl.length>500||logoUrl&&!/^https:\/\/[^\s/?#]+[^\s]*$/i.test(logoUrl))bad('Informe um endereço HTTPS válido para a imagem.');
  const rows=await sql`UPDATE teamhub.organizations SET display_name=${displayName},logo_url=${logoUrl} WHERE id=${org} RETURNING id,name,display_name,logo_url`;
  return reply(res,200,{organization:rows[0]});
 }
 const mm=/^\/api\/members\/([^/]+)$/.exec(p);
 if(mm&&req.method==='PATCH'){
  if(role!=='admin')bad('Apenas administradores podem editar membros.',403);
  const target=decodeURIComponent(mm[1]);
  if(!target||target.length>200)bad('Membro inválido.');
  const b=await json(req);
  if(b.role!==undefined&&!['admin','manager','member','guest'].includes(b.role))bad('Perfil inválido.');
  if(b.active!==undefined&&typeof b.active!=='boolean')bad('Estado inválido.');
  if(b.role===undefined&&b.active===undefined)bad('Nenhuma alteração recebida.');
  const current=await sql`SELECT role,active FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${target}`;
  if(!current.length)bad('Membro não encontrado.',404);
  if(target===subject&&(b.active===false||(b.role!==undefined&&b.role!=='admin')))bad('Não é permitido retirar seu próprio acesso administrativo.',403);
  if(current[0].role==='admin'&&(b.role!==undefined&&b.role!=='admin'||b.active===false)){
   const count=await sql`SELECT count(*)::int AS total FROM teamhub.memberships WHERE organization_id=${org} AND role='admin' AND active=true`;
   if(count[0].total<=1)bad('A organização precisa manter pelo menos um administrador.',409);
  }
  const nextRole=b.role===undefined?current[0].role:b.role;
  const nextActive=b.active===undefined?current[0].active:b.active;
  const rows=await sql`UPDATE teamhub.memberships SET role=${nextRole},active=${nextActive} WHERE organization_id=${org} AND auth_subject=${target} RETURNING auth_subject,role,active`;
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action) VALUES(${org},${subject},'membership.updated')`;
  return reply(res,200,{member:rows[0]});
 }
 if(p==='/api/invitations'&&req.method==='GET'){
  if(role!=='admin')bad('Apenas administradores podem consultar convites.',403);
  const rows=await sql`SELECT id,email,role,status,created_at,expires_at,accepted_at FROM teamhub.invitations WHERE organization_id=${org} ORDER BY created_at DESC LIMIT 100`;
  return reply(res,200,{invitations:rows});
 }
 if(p==='/api/invitations'&&req.method==='POST'){
  if(role!=='admin')bad('Apenas administradores podem convidar membros.',403);
  const b=await json(req);
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  const invitedRole=b.role;
  if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))bad('Informe um e-mail válido.');
  if(!['admin','manager','member','guest'].includes(invitedRole))bad('Papel inválido.');
  if(req.identityEmail===email)bad('Sua conta já está na organização.');
  const token=randomBytes(32).toString('hex');
  const tokenHash=createHash('sha256').update(token).digest('hex');
  try{
   const rows=await sql`INSERT INTO teamhub.invitations(organization_id,email,role,token_hash,invited_by_subject,expires_at)
     VALUES(${org},${email},${invitedRole},${tokenHash},${subject},now()+interval '7 days') RETURNING id,email,role,status,expires_at`;
   await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action) VALUES(${org},${subject},'invitation.created')`;
   return reply(res,201,{invitation:rows[0],invite_url:'https://anna-nexus-dev.onrender.com/#invite='+token,delivery:'manual'});
  }catch(e){
   if(e?.code==='23505'||String(e?.message||'').includes('invitations_one_pending'))bad('Este e-mail já possui um convite pendente. Cancele-o antes de enviar outro.',409);
   throw e;
  }
 }
 const cancel=/^\/api\/invitations\/([0-9a-f-]+)\/cancel$/.exec(p);
 if(cancel&&validId(cancel[1])&&req.method==='POST'){
  if(role!=='admin')bad('Apenas administradores podem cancelar convites.',403);
  const rows=await sql`UPDATE teamhub.invitations SET status='cancelled',cancelled_at=now() WHERE id=${cancel[1]} AND organization_id=${org} AND status='pending' RETURNING id`;
  if(!rows.length)bad('Convite não está mais pendente.',404);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action) VALUES(${org},${subject},'invitation.cancelled')`;
  return reply(res,200,{cancelled:true});
 }
 if(p==='/api/members'&&req.method==='GET'){
  const members=await sql`SELECT auth_subject,role,active FROM teamhub.memberships WHERE organization_id=${org} ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,auth_subject`;
  return reply(res,200,{members,viewer:subject,role});
 }
 if(p==='/api/my-tasks'&&req.method==='GET'){
  const tasks=await sql`SELECT t.id,t.title,t.status,t.priority,t.due_at,t.project_id,p.name AS project_name FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id WHERE t.organization_id=${org} AND (t.assignee_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.task_assignees a WHERE a.task_id=t.id AND a.organization_id=t.organization_id AND a.auth_subject=${subject})) AND p.archived_at IS NULL ORDER BY (t.status='done'),t.due_at NULLS LAST,t.created_at DESC LIMIT 200`;
  return reply(res,200,{tasks});
 }
 if(p==='/api/projects'&&req.method==='GET'){
  const projects=await sql`SELECT p.id,p.name,p.description,p.created_at, COUNT(t.id)::int AS total, COUNT(t.id) FILTER(WHERE t.status='done')::int AS done, COUNT(t.id) FILTER(WHERE t.status='doing')::int AS doing FROM teamhub.projects p LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id WHERE p.organization_id=${org} AND p.archived_at IS NULL GROUP BY p.id ORDER BY p.created_at DESC`;
  return reply(res,200,{projects,role});
 }
 if(p==='/api/dashboard'&&req.method==='GET'){
  const rows=await sql`SELECT COUNT(DISTINCT p.id)::int AS projects, COUNT(t.id) FILTER(WHERE t.status!='done')::int AS open, COUNT(t.id) FILTER(WHERE t.status='doing')::int AS doing, COUNT(t.id) FILTER(WHERE t.status='done')::int AS done, COUNT(t.id) FILTER(WHERE t.status!='done' AND t.treatment_status IN ('blocked','waiting'))::int AS attention FROM teamhub.projects p LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id WHERE p.organization_id=${org} AND p.archived_at IS NULL`;
  return reply(res,200,{summary:rows[0]});
 }
 if(p==='/api/attention'&&req.method==='GET'){
  const items=await sql`SELECT t.id,t.project_id,p.name AS project_name,t.title,t.treatment_status,t.pending_reason,t.next_action,t.due_at FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id WHERE t.organization_id=${org} AND p.archived_at IS NULL AND t.status!='done' AND t.treatment_status IN ('blocked','waiting') ORDER BY CASE WHEN t.treatment_status='blocked' THEN 0 ELSE 1 END,t.due_at NULLS LAST,t.updated_at DESC LIMIT 50`;
  return reply(res,200,{items});
 }
 if(p==='/api/projects'&&req.method==='POST'){
  requireManager(role);const body=await json(req);const name=String(body.name||'').trim();if(name.length<2||name.length>160)bad('Nome entre 2 e 160 caracteres.');
  const rows=await sql`INSERT INTO teamhub.projects(organization_id,name,description) VALUES(${org},${name},${String(body.description||'').slice(0,1000)}) RETURNING id,name,description`;
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id) VALUES(${org},${subject},'project.created',${rows[0].id})`;
  return reply(res,201,{project:rows[0]});
 }
 const pm=/^\/api\/projects\/([0-9a-f-]+)\/tasks$/.exec(p);
 if(pm&&validId(pm[1])){
  const proj=await project(org,pm[1]);
  if(req.method==='GET'){
   const tasks=await sql`SELECT t.id,t.title,t.description,t.status,t.priority,t.assignee_subject,t.due_at,t.position,t.created_at,t.treatment_status,t.treatment_notes,t.pending_reason,t.next_action,COALESCE((SELECT jsonb_agg(a.auth_subject ORDER BY a.auth_subject) FROM teamhub.task_assignees a WHERE a.task_id=t.id AND a.organization_id=t.organization_id),'[]'::jsonb) AS assignees FROM teamhub.tasks t WHERE t.organization_id=${org} AND t.project_id=${proj.id} ORDER BY t.position,t.created_at`;
   return reply(res,200,{project:proj,tasks,role});
  }
  if(req.method==='POST'){
   requireEditor(role);const b=await json(req),title=String(b.title||'').trim();
   if(title.length<2||title.length>240)bad('Título entre 2 e 240 caracteres.');
   const priority=b.priority||'medium';
   if(!['low','medium','high'].includes(priority))bad('Prioridade inválida.');
   const due=b.due_at===null||b.due_at===undefined?null:b.due_at;
   checkDueDate(due);
   const due_at=due===null?null:due+'T12:00:00Z';
   const treatment=b.treatment_status||'pending';validateTreatment(treatment);
   const treatmentNotes=b.treatment_notes===undefined?'':safeNote(b.treatment_notes);
   const pendingReason=b.pending_reason===undefined?'':safeNote(b.pending_reason);
   const nextAction=b.next_action===undefined?'':safeNote(b.next_action);
   const assignee=b.assignee_subject===undefined||b.assignee_subject===null||b.assignee_subject===''?null:b.assignee_subject;
   if(assignee!==null){
    if(typeof assignee!=='string'||assignee.length>128)bad('Responsável inválido.');
    const member=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${assignee} AND active=true`;
    if(!member.length)bad('Responsável não pertence à organização.',403);
   }
   const assignees=await checkAssignees(org,b.assignees===undefined?(assignee?[assignee]:[]):b.assignees);
   const rows=await sql`INSERT INTO teamhub.tasks(organization_id,project_id,title,description,priority,due_at,assignee_subject,treatment_status,treatment_notes,pending_reason,next_action,created_by_subject,position) VALUES(${org},${proj.id},${title},${String(b.description||'').slice(0,2000)},${priority},${due_at},${assignee},${treatment},${treatmentNotes},${pendingReason},${nextAction},${subject},(SELECT COALESCE(MAX(position),0)+1 FROM teamhub.tasks WHERE project_id=${proj.id})) RETURNING *`;
   await syncAssignees(org,rows[0].id,assignees);
   await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id) VALUES(${org},${subject},'task.created',${proj.id},${rows[0].id})`;
   await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary) VALUES(${org},${rows[0].id},${subject},'created','Tarefa criada')`;
   return reply(res,201,{task:rows[0]});
  }
 }
 const hm=/^\/api\/tasks\/([0-9a-f-]+)\/history$/.exec(p);
 if(hm&&validId(hm[1])&&req.method==='GET'){
  const target=await sql`SELECT id FROM teamhub.tasks WHERE id=${hm[1]} AND organization_id=${org}`;
  if(!target.length)bad('Tarefa não encontrada.',404);
  const history=await sql`SELECT event_type,summary,actor_subject,created_at FROM teamhub.task_updates WHERE organization_id=${org} AND task_id=${hm[1]} ORDER BY created_at DESC,id DESC LIMIT 100`;
  return reply(res,200,{history});
 }
 if(hm&&validId(hm[1])&&req.method==='POST'){
  requireEditor(role);
  const target=await sql`SELECT id FROM teamhub.tasks WHERE id=${hm[1]} AND organization_id=${org}`;
  if(!target.length)bad('Tarefa não encontrada.',404);
  const body=await json(req),summary=safeNote(body.summary,2000);
  if(!summary)bad('Informe o andamento ou a observação.');
  const [item]=await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary) VALUES(${org},${hm[1]},${subject},'comment',${summary}) RETURNING id,created_at`;
  return reply(res,201,{update:item});
 }
 const tm=/^\/api\/tasks\/([0-9a-f-]+)$/.exec(p);
 if(tm&&validId(tm[1])&&req.method==='PATCH'){
  requireEditor(role);const b=await json(req);
  const keys=Object.keys(b);
  if(!keys.length||keys.some(k=>!['status','priority','title','description','due_at','assignee_subject','assignees','treatment_status','treatment_notes','pending_reason','next_action','update_note'].includes(k)))bad('Campos não permitidos.');
  const existing=await sql`SELECT id,project_id,title,description,status,priority,due_at,assignee_subject,treatment_status,treatment_notes,pending_reason,next_action FROM teamhub.tasks WHERE id=${tm[1]} AND organization_id=${org}`;
  if(!existing.length)bad('Tarefa não encontrada.',404);
  const t=existing[0];
  const status=b.status===undefined?t.status:b.status;
  const priority=b.priority===undefined?t.priority:b.priority;
  const title=b.title===undefined?t.title:String(b.title).trim();
  const description=b.description===undefined?t.description:String(b.description);
  let dueAt=t.due_at;
  if(b.due_at!==undefined){
    checkDueDate(b.due_at);
    dueAt=b.due_at===null?null:b.due_at+'T12:00:00Z';
  }
  const assignee=b.assignee_subject===undefined?t.assignee_subject:(b.assignee_subject===null||b.assignee_subject===''?null:b.assignee_subject);
  if(assignee!==null){
   if(typeof assignee!=='string'||assignee.length>128)bad('Responsável inválido.');
   const member=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${assignee} AND active=true`;
   if(!member.length)bad('Responsável não pertence à organização.',403);
  }
  const assignees=b.assignees===undefined?null:await checkAssignees(org,b.assignees);
  const treatment=b.treatment_status===undefined?t.treatment_status:b.treatment_status;validateTreatment(treatment);
  const treatmentNotes=b.treatment_notes===undefined?t.treatment_notes:safeNote(b.treatment_notes);
  const pendingReason=b.pending_reason===undefined?t.pending_reason:safeNote(b.pending_reason);
  const nextAction=b.next_action===undefined?t.next_action:safeNote(b.next_action);
  const updateNote=b.update_note===undefined?'':safeNote(b.update_note);
  if(!['todo','doing','done'].includes(status)||!['low','medium','high'].includes(priority)||title.length<2||title.length>240||description.length>2000)bad('Valores inválidos.');
  const result=await sql`UPDATE teamhub.tasks SET status=${status},priority=${priority},title=${title},description=${description},due_at=${dueAt},assignee_subject=${assignee},treatment_status=${treatment},treatment_notes=${treatmentNotes},pending_reason=${pendingReason},next_action=${nextAction},updated_at=now() WHERE id=${t.id} AND organization_id=${org} RETURNING id,title,description,status,priority,due_at,assignee_subject,treatment_status,treatment_notes,pending_reason,next_action`;
  if(assignees!==null)await syncAssignees(org,t.id,assignees);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id) VALUES(${org},${subject},'task.updated',${t.project_id},${t.id})`;
  const changed=treatment!==t.treatment_status||status!==t.status||treatmentNotes!==t.treatment_notes||pendingReason!==t.pending_reason||nextAction!==t.next_action;
  if(updateNote||changed){
   const summary=updateNote||'Situação ou informações de tratamento atualizadas';
   await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary) VALUES(${org},${t.id},${subject},'progress',${summary})`;
  }
  return reply(res,200,{task:result[0]});
 }
 return reply(res,404,{error:'Rota não encontrada'});
};
http.createServer((req,res)=>Promise.resolve(route(req,res)).catch(e=>reply(res,e.status||500,{error:e.status?e.message:'Erro interno'}))).listen(port,'0.0.0.0',()=>console.log('AnnA Nexus na porta',port));
