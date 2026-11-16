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
async function json(req,maxSize=25000){
 let raw=''; for await(const c of req){raw+=c;if(raw.length>maxSize)throw Object.assign(Error('Payload grande'),{status:413});}
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

function parseTaskLabels(value){
 if(!Array.isArray(value)||value.length>6||value.some(x=>typeof x!=='string'||x.length>32||!['Urgente','Cliente','Revisão','Bug','Melhoria','Aprovação'].includes(x))||new Set(value).size!==value.length)bad('Etiquetas inválidas.');
 return value;
}
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
async function syncSubtaskAssignees(org,subtask,subjects){
 await sql`DELETE FROM teamhub.subtask_assignees WHERE organization_id=${org} AND subtask_id=${subtask}`;
 if(subjects.length)await sql`INSERT INTO teamhub.subtask_assignees(organization_id,subtask_id,auth_subject)
 SELECT ${org}::uuid,${subtask}::uuid,x.auth_subject FROM jsonb_array_elements_text(${JSON.stringify(subjects)}::jsonb) AS x(auth_subject)
 ON CONFLICT DO NOTHING`;
}
function preferenceCategory(event){
 if(event.startsWith('task.mention'))return 'mentions';
 if(event.startsWith('task.due')||event.startsWith('task.overdue')||event.startsWith('subtask.due')||event.startsWith('subtask.overdue'))return 'deadlines';
 if(event.startsWith('project.review')||event.startsWith('project.completion'))return 'approvals';
 return 'assignments';
}
async function notifyMembers(org,actor,subjects,event,title,details,projectId,taskId=null){
 const targets=[...new Set(subjects)].filter(x=>x!==actor);
 if(!targets.length)return;
 await sql`INSERT INTO teamhub.notifications(organization_id,recipient_subject,actor_subject,event_type,title,details,project_id,task_id)
 SELECT ${org}::uuid,x.auth_subject,${actor},${event},${title},${details},${projectId}::uuid,${taskId}::uuid
 FROM jsonb_array_elements_text(${JSON.stringify(targets)}::jsonb) AS x(auth_subject)
 JOIN teamhub.memberships m ON m.organization_id=${org} AND m.auth_subject=x.auth_subject AND m.active=true
 LEFT JOIN teamhub.notification_preferences pref ON pref.organization_id=${org} AND pref.auth_subject=x.auth_subject
 WHERE CASE ${preferenceCategory(event)}
  WHEN 'mentions' THEN COALESCE(pref.mentions,true)
  WHEN 'deadlines' THEN COALESCE(pref.deadlines,true)
  WHEN 'approvals' THEN COALESCE(pref.approvals,true)
  ELSE COALESCE(pref.assignments,true) END`;
}
async function verifyProjectRecipients(org,projectId,subjects){
 if(!subjects.length)return;
 const rows=await sql`SELECT access_mode,owner_subject FROM teamhub.projects WHERE id=${projectId} AND organization_id=${org}`;
 if(!rows.length)bad('Projeto não encontrado.',404);
 if(rows[0].access_mode!=='restricted')return;
 const allowed=await sql`SELECT m.auth_subject FROM teamhub.memberships m
  WHERE m.organization_id=${org} AND m.active=true AND m.auth_subject IN
   (SELECT jsonb_array_elements_text(${JSON.stringify(subjects)}::jsonb))
   AND (m.role IN ('admin','manager') OR m.auth_subject=${rows[0].owner_subject}
   OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=${projectId} AND pm.auth_subject=m.auth_subject))`;
 if(allowed.length!==subjects.length)bad('Para atribuir uma tarefa em projeto restrito, primeiro autorize os responsáveis no projeto.',403);
}
async function project(org,id){
 const rows=await sql`SELECT id,name,description,created_at,paused_at,card_color,owner_subject,access_mode,completion_status,completed_at FROM teamhub.projects WHERE organization_id=${org} AND id=${id} AND archived_at IS NULL`;
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
 const unrestricted=['admin','manager'].includes(role);
 const authorized=unrestricted?null:await sql`SELECT p.id FROM teamhub.projects p WHERE p.organization_id=${org} AND
  (p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS
   (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
 const allowedSet=new Set(authorized?.map(x=>x.id)||[]);
 const canSee=id=>unrestricted||allowedSet.has(id);
 const projectRoute=/^\/api\/projects\/([0-9a-f-]+)(?:\/.*)?$/.exec(p);
 const taskRoute=/^\/api\/tasks\/([0-9a-f-]+)(?:\/.*)?$/.exec(p);
 const subtaskRoute=/^\/api\/subtasks\/([0-9a-f-]+)$/.exec(p);
 if(!unrestricted){
  let targetProject=projectRoute?.[1]||null;
  if(taskRoute){const rows=await sql`SELECT project_id FROM teamhub.tasks WHERE id=${taskRoute[1]} AND organization_id=${org}`;targetProject=rows[0]?.project_id||null;}
  if(subtaskRoute){const rows=await sql`SELECT project_id FROM teamhub.subtasks WHERE id=${subtaskRoute[1]} AND organization_id=${org}`;targetProject=rows[0]?.project_id||null;}
  if((projectRoute||taskRoute||subtaskRoute)&&(!targetProject||!canSee(targetProject)))bad('Acesso ao projeto não autorizado.',403);
 }
 if(req.method!=='GET'&&(
   /^\/api\/tasks\/[0-9a-f-]+(?:\/.*)?$/.test(p)||
   /^\/api\/subtasks\/[0-9a-f-]+$/.test(p)||
   /^\/api\/projects\/[0-9a-f-]+\/(?:tasks|pause|resume)$/.test(p)
  )){
   let targetId=projectRoute?.[1]||null;
   if(taskRoute){const x=await sql`SELECT project_id FROM teamhub.tasks WHERE organization_id=${org} AND id=${taskRoute[1]}`;targetId=x[0]?.project_id||null;}
   if(subtaskRoute){const x=await sql`SELECT project_id FROM teamhub.subtasks WHERE organization_id=${org} AND id=${subtaskRoute[1]}`;targetId=x[0]?.project_id||null;}
   if(targetId){
    const statusRows=await sql`SELECT completion_status FROM teamhub.projects WHERE organization_id=${org} AND id=${targetId}`;
    if(statusRows[0]?.completion_status!=='active')bad('Projeto aguardando validação ou concluído. Solicite devolução ou reabertura para editar.',409);
   }
 }
 if(p==='/api/organization'&&req.method==='PATCH'){
  if(role!=='admin')bad('Apenas administradores podem personalizar a organização.',403);
  const b=await json(req,120000);
  const displayName=typeof b.display_name==='string'?b.display_name.trim():'';
  const logoUrl=typeof b.logo_url==='string'?b.logo_url.trim():'';
  if(displayName.length>100)bad('Nome da empresa muito longo.');
  if(logoUrl){
   const image=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(logoUrl);
   if(image){
    const binary=Buffer.from(image[2],'base64');
    if(binary.length===0||binary.length>75*1024)bad('Imagem deve ter no máximo 75 KB.');
    const valid=image[1]==='png'&&binary.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
     ||image[1]==='jpeg'&&binary[0]===255&&binary[1]===216&&binary[2]===255
     ||image[1]==='webp'&&binary.subarray(0,4).toString()==='RIFF'&&binary.subarray(8,12).toString()==='WEBP';
    if(!valid)bad('Arquivo de imagem inválido. Use PNG, JPG ou WebP.');
   }else if(logoUrl.length>500||!/^https:\/\/[^\s/?#]+[^\s]*$/i.test(logoUrl)){
    bad('Informe uma imagem PNG, JPG ou WebP válida ou um endereço HTTPS.');
   }
  }
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
 if(p==='/api/notification-preferences'&&req.method==='GET'){
  const rows=await sql`SELECT assignments,mentions,deadlines,approvals,email_enabled
   FROM teamhub.notification_preferences WHERE organization_id=${org} AND auth_subject=${subject}`;
  return reply(res,200,{preferences:rows[0]||{assignments:true,mentions:true,deadlines:true,approvals:true,email_enabled:false},
   email_available:false,delivery:'internal'});
 }
 if(p==='/api/notification-preferences'&&req.method==='PATCH'){
  const b=await json(req);
  if(Object.keys(b).some(k=>!['assignments','mentions','deadlines','approvals'].includes(k)))bad('Preferência inválida.');
  if(!Object.keys(b).length||Object.values(b).some(x=>typeof x!=='boolean'))bad('Informe opções válidas.');
  const prev=await sql`SELECT assignments,mentions,deadlines,approvals FROM teamhub.notification_preferences
   WHERE organization_id=${org} AND auth_subject=${subject}`;
  const old=prev[0]||{assignments:true,mentions:true,deadlines:true,approvals:true};
  const values={...old,...b};
  const rows=await sql`INSERT INTO teamhub.notification_preferences
    (organization_id,auth_subject,assignments,mentions,deadlines,approvals,email_enabled)
    VALUES(${org},${subject},${values.assignments},${values.mentions},${values.deadlines},${values.approvals},false)
    ON CONFLICT(organization_id,auth_subject) DO UPDATE SET
    assignments=excluded.assignments,mentions=excluded.mentions,deadlines=excluded.deadlines,
    approvals=excluded.approvals,updated_at=now()
    RETURNING assignments,mentions,deadlines,approvals,email_enabled`;
  return reply(res,200,{preferences:rows[0],email_available:false});
 }
 if(p==='/api/notifications'&&req.method==='GET'){
  const rows=await sql`SELECT id,event_type,title,details,project_id,task_id,read_at,created_at
   FROM teamhub.notifications WHERE organization_id=${org} AND recipient_subject=${subject}
   ORDER BY created_at DESC LIMIT 100`;
  const unread=await sql`SELECT count(*)::int AS total FROM teamhub.notifications WHERE organization_id=${org} AND recipient_subject=${subject} AND read_at IS NULL`;
  return reply(res,200,{notifications:rows.filter(n=>!n.project_id||canSee(n.project_id)),unread:rows.filter(n=>!n.read_at&&(!n.project_id||canSee(n.project_id))).length});
 }
 const mark=/^\/api\/notifications\/([0-9a-f-]+)\/read$/.exec(p);
 if(mark&&validId(mark[1])&&req.method==='POST'){
  const rows=await sql`UPDATE teamhub.notifications SET read_at=COALESCE(read_at,now()) WHERE id=${mark[1]} AND organization_id=${org} AND recipient_subject=${subject} RETURNING id`;
  if(!rows.length)bad('Notificação não encontrada.',404);
  return reply(res,200,{read:true});
 }
 if(p==='/api/notifications/read-all'&&req.method==='POST'){
  await sql`UPDATE teamhub.notifications SET read_at=now() WHERE organization_id=${org} AND recipient_subject=${subject} AND read_at IS NULL`;
  return reply(res,200,{ok:true});
 }
 if(p==='/api/members'&&req.method==='GET'){
  const members=await sql`SELECT auth_subject,role,active FROM teamhub.memberships WHERE organization_id=${org} ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,auth_subject`;
  return reply(res,200,{members,viewer:subject,role});
 }
 if(p==='/api/my-tasks'&&req.method==='GET'){
  const showArchived=url.searchParams.get('archived')==='1';
  const tasks=await sql`SELECT t.id,t.title,t.status,t.priority,t.due_at,t.project_id,p.name AS project_name,t.paused_at,t.archived_at,t.created_at,t.treatment_status FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id WHERE t.organization_id=${org} AND t.deleted_at IS NULL AND (t.archived_at IS NULL OR ${showArchived}) AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject})) AND (t.assignee_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.task_assignees a WHERE a.task_id=t.id AND a.organization_id=t.organization_id AND a.auth_subject=${subject})) AND p.archived_at IS NULL ORDER BY (t.status='done'),t.due_at NULLS LAST,t.created_at DESC LIMIT 200`;
  return reply(res,200,{tasks});
 }
 if(p==='/api/my-subtasks'&&req.method==='GET'){
  const rows=await sql`SELECT s.id,s.task_id,s.project_id,s.title,s.status,s.priority,s.due_at,s.created_at,
    t.title AS task_title,p.name AS project_name
   FROM teamhub.subtasks s
   JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id
   JOIN teamhub.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id
   WHERE s.organization_id=${org} AND t.archived_at IS NULL AND t.deleted_at IS NULL AND p.archived_at IS NULL AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))
   AND (s.owner_subject=${subject} OR EXISTS(SELECT 1 FROM teamhub.subtask_assignees a WHERE a.organization_id=s.organization_id AND a.subtask_id=s.id AND a.auth_subject=${subject}))
   ORDER BY (s.status='done'),s.due_at NULLS LAST,s.created_at DESC LIMIT 200`;
  return reply(res,200,{subtasks:rows});
 }
 if(p==='/api/calendar'&&req.method==='GET'){
  const tasks=await sql`SELECT t.id,t.project_id,t.title,t.due_at,t.created_at,t.status,p.name AS project_name,'task' AS kind
   FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
   WHERE t.organization_id=${org} AND t.deleted_at IS NULL AND t.archived_at IS NULL
   AND p.archived_at IS NULL AND t.due_at IS NOT NULL
   AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject}
     OR EXISTS(SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))
   ORDER BY t.due_at,t.created_at LIMIT 2000`;
  const subtasks=await sql`SELECT s.id,s.project_id,s.title,s.due_at,s.created_at,s.status,p.name AS project_name,'subtask' AS kind
   FROM teamhub.subtasks s JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id
   JOIN teamhub.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id
   WHERE s.organization_id=${org} AND t.deleted_at IS NULL AND t.archived_at IS NULL AND p.archived_at IS NULL
   AND s.due_at IS NOT NULL
   AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject}
     OR EXISTS(SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))
   ORDER BY s.due_at,s.created_at LIMIT 2000`;
  return reply(res,200,{items:[...tasks,...subtasks]});
 }
 if(p==='/api/projects'&&req.method==='GET'){
  const projects=await sql`SELECT p.id,p.name,p.description,p.created_at,p.paused_at,p.card_color,p.owner_subject,p.access_mode,p.completion_status,p.completed_at, COUNT(t.id)::int AS total, COUNT(t.id) FILTER(WHERE t.status='done')::int AS done, COUNT(t.id) FILTER(WHERE t.status='doing')::int AS doing FROM teamhub.projects p LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id AND t.deleted_at IS NULL AND t.archived_at IS NULL WHERE p.organization_id=${org} AND p.archived_at IS NULL AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject})) GROUP BY p.id ORDER BY p.created_at DESC`;
  return reply(res,200,{projects,role});
 }
 if(p==='/api/dashboard'&&req.method==='GET'){
  const rows=await sql`SELECT COUNT(DISTINCT p.id)::int AS projects, COUNT(t.id) FILTER(WHERE t.status!='done')::int AS open, COUNT(t.id) FILTER(WHERE t.status='doing')::int AS doing, COUNT(t.id) FILTER(WHERE t.status='done')::int AS done, COUNT(t.id) FILTER(WHERE t.status!='done' AND t.treatment_status IN ('blocked','waiting'))::int AS attention FROM teamhub.projects p LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id AND t.archived_at IS NULL AND t.deleted_at IS NULL WHERE p.organization_id=${org} AND p.archived_at IS NULL AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
  return reply(res,200,{summary:rows[0]});
 }
 if(p==='/api/automation/check-deadlines'&&req.method==='POST'){
  requireManager(role);
  const rows=await sql`WITH candidates AS(
    SELECT t.id AS task_id,t.project_id,t.title,t.due_at,assignee.auth_subject,
      ((t.due_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'America/Fortaleza')::date) AS overdue
    FROM teamhub.tasks t
    JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
    JOIN LATERAL (
      SELECT DISTINCT x.auth_subject FROM (
       SELECT a.auth_subject FROM teamhub.task_assignees a WHERE a.organization_id=t.organization_id AND a.task_id=t.id
       UNION SELECT t.assignee_subject WHERE t.assignee_subject IS NOT NULL
      ) x
    ) assignee ON true
    JOIN teamhub.memberships m ON m.organization_id=t.organization_id AND m.auth_subject=assignee.auth_subject AND m.active=true
    WHERE t.organization_id=${org} AND t.status!='done'
      AND t.archived_at IS NULL AND t.deleted_at IS NULL AND t.due_at IS NOT NULL AND p.archived_at IS NULL
      AND (t.due_at AT TIME ZONE 'UTC')::date <= (now() AT TIME ZONE 'America/Fortaleza')::date+2
      AND (p.access_mode='organization' OR m.role IN ('admin','manager') OR p.owner_subject=m.auth_subject
       OR EXISTS(SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=m.auth_subject))
  ), inserted AS(
    INSERT INTO teamhub.notifications(organization_id,recipient_subject,actor_subject,event_type,title,details,project_id,task_id)
    SELECT ${org}::uuid,c.auth_subject,${subject},
      CASE WHEN c.overdue THEN 'task.overdue' ELSE 'task.due_soon' END,
      CASE WHEN c.overdue THEN 'Tarefa atrasada' ELSE 'Prazo próximo' END,
      c.title,c.project_id,c.task_id
    FROM candidates c
    LEFT JOIN teamhub.notification_preferences pref ON pref.organization_id=${org} AND pref.auth_subject=c.auth_subject
    WHERE COALESCE(pref.deadlines,true) AND NOT EXISTS(
      SELECT 1 FROM teamhub.notifications n WHERE n.organization_id=${org}
        AND n.recipient_subject=c.auth_subject AND n.task_id=c.task_id
        AND n.event_type=CASE WHEN c.overdue THEN 'task.overdue' ELSE 'task.due_soon' END
        AND n.created_at>=now()-interval '24 hours'
    )
    RETURNING id
  ) SELECT count(*)::int AS sent FROM inserted`;
  return reply(res,200,{created:rows[0]?.sent||0,delivery:'internal',checked_at:new Date().toISOString()});
 }
 if(p==='/api/dashboard/insights'&&req.method==='GET'){
  const period=Number(url.searchParams.get('days')||30);
  if(![7,30,90].includes(period))bad('Selecione um período de 7, 30 ou 90 dias.');
  const projectId=url.searchParams.get('project')||null;
  if(projectId&&(!validId(projectId)||!canSee(projectId)))bad('Projeto não autorizado.',403);
  const projects=await sql`SELECT p.id,p.name,p.card_color,p.paused_at,
     COUNT(t.id)::int AS tasks,
     COUNT(t.id) FILTER (WHERE t.status='done')::int AS completed,
     COUNT(t.id) FILTER (WHERE t.status='doing')::int AS doing,
     COUNT(t.id) FILTER (WHERE t.status='todo')::int AS todo,
     COUNT(t.id) FILTER (WHERE t.status!='done' AND t.due_at IS NOT NULL
       AND (t.due_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'America/Fortaleza')::date)::int AS overdue,
     COUNT(t.id) FILTER (WHERE t.status!='done' AND t.treatment_status IN ('waiting','blocked'))::int AS attention
    FROM teamhub.projects p
    LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id AND t.archived_at IS NULL AND t.deleted_at IS NULL
    WHERE p.organization_id=${org} AND p.archived_at IS NULL
     AND (${projectId}::uuid IS NULL OR p.id=${projectId}::uuid)
     AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS
       (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))
    GROUP BY p.id ORDER BY p.name`;
  const subtasks=await sql`SELECT count(s.id)::int AS total,
     count(s.id) FILTER (WHERE s.status='done')::int AS completed,
     count(s.id) FILTER (WHERE s.status!='done' AND s.due_at IS NOT NULL AND
       (s.due_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'America/Fortaleza')::date)::int AS overdue
    FROM teamhub.subtasks s
    JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id AND t.archived_at IS NULL AND t.deleted_at IS NULL
    JOIN teamhub.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id AND p.archived_at IS NULL
    WHERE s.organization_id=${org} AND (${projectId}::uuid IS NULL OR s.project_id=${projectId}::uuid)
     AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS
       (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
  const activity=await sql`SELECT (a.created_at AT TIME ZONE 'America/Fortaleza')::date::text AS day, count(*)::int AS total
    FROM teamhub.activities a LEFT JOIN teamhub.projects p ON p.id=a.project_id AND p.organization_id=a.organization_id
    WHERE a.organization_id=${org}
      AND a.created_at>=now()-${period}*interval '1 day'
      AND (${projectId}::uuid IS NULL OR a.project_id=${projectId}::uuid)
      AND (a.project_id IS NOT NULL OR ${unrestricted})
      AND (a.project_id IS NULL OR ${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS
       (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=a.project_id AND pm.auth_subject=${subject}))
    GROUP BY 1 ORDER BY 1`;
  const pending=await sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(pp.ended_at,now())-pp.started_at))),0)::bigint AS seconds
    FROM teamhub.pause_periods pp JOIN teamhub.projects p ON p.id=pp.project_id AND p.organization_id=pp.organization_id
    WHERE pp.organization_id=${org} AND p.archived_at IS NULL AND (${projectId}::uuid IS NULL OR p.id=${projectId}::uuid)
     AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS
       (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
  const total=(field)=>projects.reduce((sum,p)=>sum+Number(p[field]||0),0);
  return reply(res,200,{summary:{projects:projects.length,tasks:total('tasks'),todo:total('todo'),doing:total('doing'),
      done:total('completed'),overdue:total('overdue'),attention:total('attention'),paused_projects:projects.filter(p=>p.paused_at).length,
      subtasks:subtasks[0]?.total||0,subtasks_done:subtasks[0]?.completed||0,subtasks_overdue:subtasks[0]?.overdue||0,
      pending_seconds:Number(pending[0]?.seconds||0)},
    projects,activity,period,generated_at:new Date().toISOString()});
 }
 if(p==='/api/attention'&&req.method==='GET'){
  const items=await sql`SELECT t.id,t.project_id,p.name AS project_name,t.title,t.treatment_status,t.pending_reason,t.next_action,t.due_at FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id WHERE t.organization_id=${org} AND t.archived_at IS NULL AND t.deleted_at IS NULL AND p.archived_at IS NULL AND (${unrestricted} OR p.access_mode='organization' OR p.owner_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject})) AND t.status!='done' AND t.treatment_status IN ('blocked','waiting') ORDER BY CASE WHEN t.treatment_status='blocked' THEN 0 ELSE 1 END,t.due_at NULLS LAST,t.updated_at DESC LIMIT 50`;
  return reply(res,200,{items});
 }
 const approvalQueue='/api/approvals/queue';
 if(p===approvalQueue&&req.method==='GET'){
  requireManager(role);
  const pending=await sql`SELECT id,name,completion_requested_at,completion_note,owner_subject
    FROM teamhub.projects WHERE organization_id=${org} AND archived_at IS NULL AND completion_status='review'
    ORDER BY completion_requested_at,id`;
  return reply(res,200,{projects:pending});
 }
 const completion=/^\/api\/projects\/([0-9a-f-]+)\/completion(?:\/(request|approve|reject|reopen))?$/.exec(p);
 if(completion&&validId(completion[1])){
  const projectId=completion[1],proj=await project(org,projectId);
  const taskCounts=await sql`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE status!='done')::int AS open,
    count(*) FILTER (WHERE treatment_status IN ('blocked','waiting'))::int AS blocked,
    count(*) FILTER (WHERE paused_at IS NOT NULL)::int AS paused
    FROM teamhub.tasks WHERE organization_id=${org} AND project_id=${projectId}
     AND archived_at IS NULL AND deleted_at IS NULL`;
  const subCounts=await sql`SELECT count(s.id)::int AS total,count(s.id) FILTER (WHERE s.status!='done')::int AS open
    FROM teamhub.subtasks s JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id
    WHERE s.organization_id=${org} AND s.project_id=${projectId}
     AND t.archived_at IS NULL AND t.deleted_at IS NULL`;
  const checks=await sql`SELECT action,note,checklist,actor_subject,created_at FROM teamhub.project_approvals
    WHERE organization_id=${org} AND project_id=${projectId} ORDER BY created_at DESC,id DESC LIMIT 30`;
  if(req.method==='GET'&&!completion[2])return reply(res,200,{
   status:proj.completion_status,completed_at:proj.completed_at,
   tasks:taskCounts[0],subtasks:subCounts[0],history:checks});
  if(req.method==='POST'&&completion[2]){
   const action=completion[2];
   if(action==='request')requireEditor(role);else if(role!=='admin')bad('Apenas administradores podem aprovar, recusar ou reabrir projetos.',403);
   const b=await json(req),note=safeNote(b.note||'',1000);
   if(['reject','reopen'].includes(action)&&note.length<5)bad('Informe uma justificativa com pelo menos 5 caracteres.');
   const checklist={deliverables:!!b.deliverables,tests:!!b.tests,documentation:!!b.documentation,stakeholders:!!b.stakeholders,pendencies:!!b.pendencies};
   if(['request','approve'].includes(action)&&!Object.values(checklist).every(Boolean))bad('Confirme todos os checks de conferência antes de prosseguir.',409);
   if(action==='request'&&(taskCounts[0].open>0||subCounts[0].open>0||taskCounts[0].blocked>0||taskCounts[0].paused>0||proj.paused_at)){
    bad('Conclua as tarefas e subtarefas, retome o projeto e marque todos os checks antes de solicitar validação.',409);
   }
   if(action==='approve'&&(taskCounts[0].open>0||subCounts[0].open>0||taskCounts[0].blocked>0||taskCounts[0].paused>0||proj.paused_at))bad('Há tarefas, subtarefas ou pausas em aberto. Rejeite e solicite os ajustes.',409);
   const transitions={
    request:{from:['active'],to:'review'},approve:{from:['review'],to:'completed'},
    reject:{from:['review'],to:'active'},reopen:{from:['completed'],to:'active'}
   };
   const step=transitions[action];
   const updated=await sql`UPDATE teamhub.projects SET
     completion_status=${step.to},
     completion_requested_at=CASE WHEN ${action}='request' THEN now() WHEN ${action} IN ('reject','reopen') THEN NULL ELSE completion_requested_at END,
     completed_at=CASE WHEN ${action}='approve' THEN now() WHEN ${action} IN ('reject','reopen') THEN NULL ELSE completed_at END,
     completion_note=${note}
     WHERE id=${projectId} AND organization_id=${org}
      AND completion_status IN (SELECT jsonb_array_elements_text(${JSON.stringify(step.from)}::jsonb))
     RETURNING id,completion_status,completed_at`;
   if(!updated.length)bad('Situação do projeto mudou. Atualize a página e tente novamente.',409);
   await sql`INSERT INTO teamhub.project_approvals(organization_id,project_id,action,actor_subject,note,checklist)
    VALUES(${org},${projectId},${action==='request'?'requested':action==='approve'?'approved':action==='reject'?'rejected':'reopened'},${subject},${note},${JSON.stringify(checklist)}::jsonb)`;
   await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id)
    VALUES(${org},${subject},${'project.completion.'+action},${projectId})`;
   if(action==='request'){
    const admins=await sql`SELECT auth_subject FROM teamhub.memberships WHERE organization_id=${org} AND role='admin' AND active=true`;
    await notifyMembers(org,subject,admins.map(x=>x.auth_subject),'project.review','Projeto aguardando aprovação',proj.name,projectId);
   }else{
    const requesters=await sql`SELECT actor_subject FROM teamhub.project_approvals
      WHERE organization_id=${org} AND project_id=${projectId} AND action='requested'
      ORDER BY created_at DESC LIMIT 1`;
    const recipients=[...new Set([proj.owner_subject,requesters[0]?.actor_subject].filter(Boolean))];
    const titles={approve:'Projeto aprovado e concluído',reject:'Projeto devolvido para ajustes',reopen:'Projeto reaberto'};
    await notifyMembers(org,subject,recipients,'project.completion.'+action,titles[action],note||proj.name,projectId);
   }
   return reply(res,200,{project:updated[0],status:step.to});
  }
 }
 const accessRoute=/^\/api\/projects\/([0-9a-f-]+)\/access$/.exec(p);
 if(accessRoute&&validId(accessRoute[1])&&req.method==='GET'){
  requireManager(role);
  const proj=await project(org,accessRoute[1]);
  const members=await sql`SELECT pm.auth_subject FROM teamhub.project_members pm
   JOIN teamhub.memberships m ON m.organization_id=pm.organization_id AND m.auth_subject=pm.auth_subject
   WHERE pm.project_id=${proj.id} AND pm.organization_id=${org} AND m.active=true ORDER BY pm.created_at`;
  return reply(res,200,{access_mode:proj.access_mode,members:members.map(x=>x.auth_subject)});
 }
 if(accessRoute&&validId(accessRoute[1])&&req.method==='PATCH'){
  requireManager(role);
  const proj=await project(org,accessRoute[1]),b=await json(req);
  const mode=b.access_mode;
  if(!['organization','restricted'].includes(mode))bad('Modo de acesso inválido.');
  const members=await checkAssignees(org,b.members||[]);
  await sql`DELETE FROM teamhub.project_members WHERE project_id=${proj.id} AND organization_id=${org}`;
  if(members.length)await sql`INSERT INTO teamhub.project_members(organization_id,project_id,auth_subject,added_by_subject)
   SELECT ${org}::uuid,${proj.id}::uuid,x.auth_subject,${subject}
   FROM jsonb_array_elements_text(${JSON.stringify(members)}::jsonb) x(auth_subject)`;
  await sql`UPDATE teamhub.projects SET access_mode=${mode} WHERE id=${proj.id} AND organization_id=${org}`;
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id)
   VALUES(${org},${subject},'project.access.updated',${proj.id})`;
  return reply(res,200,{access_mode:mode,members});
 }
 const colorAllowed=['blue','violet','green','orange','pink','teal','slate'];
 const projectEdit=/^\/api\/projects\/([0-9a-f-]+)$/.exec(p);
 if(projectEdit&&validId(projectEdit[1])&&req.method==='PATCH'){
  requireManager(role);
  const proj=await project(org,projectEdit[1]);
  const b=await json(req);
  if(Object.keys(b).some(k=>!['card_color','owner_subject','name','description'].includes(k)))bad('Campo inválido.');
  const cardColor=b.card_color===undefined?proj.card_color:b.card_color;
  if(!colorAllowed.includes(cardColor))bad('Cor do card inválida.');
  const owner=b.owner_subject===undefined?proj.owner_subject:(b.owner_subject||null);
  if(owner!==null){
   const valid=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${owner} AND active=true`;
   if(!valid.length)bad('Responsável não pertence à organização.',403);
  }
  const name=b.name===undefined?proj.name:String(b.name||'').trim();
  const description=b.description===undefined?proj.description:String(b.description||'').trim();
  if(name.length<2||name.length>160||description.length>1000)bad('Informe um nome e descrição válidos.');
  const rows=await sql`UPDATE teamhub.projects SET name=${name},description=${description},card_color=${cardColor},owner_subject=${owner} WHERE id=${proj.id} AND organization_id=${org} RETURNING id,name,card_color,owner_subject`;
  if(owner&&owner!==proj.owner_subject)await notifyMembers(org,subject,[owner],'project.assigned','Você recebeu um projeto',name,proj.id);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id) VALUES(${org},${subject},'project.updated',${proj.id})`;
  return reply(res,200,{project:rows[0]});
 }
 if(p==='/api/projects'&&req.method==='POST'){
  requireManager(role);const body=await json(req);const name=String(body.name||'').trim();if(name.length<2||name.length>160)bad('Nome entre 2 e 160 caracteres.');
  const cardColor=body.card_color||'blue';
  if(!colorAllowed.includes(cardColor))bad('Cor do card inválida.');
  const owner=body.owner_subject||null;
  if(owner!==null){
   const check=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${owner} AND active=true`;
   if(!check.length)bad('Responsável não pertence à organização.',403);
  }
  const templates={
   blank:[],
   planning:['Definir objetivos e escopo','Listar entregas e responsáveis','Definir cronograma','Validar planejamento'],
   development:['Levantar requisitos','Desenhar solução','Implementar funcionalidades','Realizar testes','Revisar e entregar'],
   support:['Registrar solicitação','Investigar causa','Aplicar correção','Validar com solicitante','Documentar solução'],
   education:['Planejar atividade','Preparar materiais','Executar atividade','Avaliar resultados','Registrar evidências']
  };
  const template=body.template||'blank';
  if(!Object.hasOwn(templates,template))bad('Modelo de projeto inválido.');
  const titles=templates[template];
  const rows=await sql`WITH created_project AS(
   INSERT INTO teamhub.projects(organization_id,name,description,card_color,owner_subject)
   VALUES(${org},${name},${String(body.description||'').slice(0,1000)},${cardColor},${owner})
   RETURNING id,name,description,card_color,owner_subject
  ), created_tasks AS(
   INSERT INTO teamhub.tasks(organization_id,project_id,title,created_by_subject,position)
   SELECT ${org}::uuid,p.id,x.title,${subject},x.ord::integer
   FROM created_project p CROSS JOIN jsonb_array_elements_text(${JSON.stringify(titles)}::jsonb) WITH ORDINALITY AS x(title,ord)
   RETURNING id
  )
  SELECT p.*, (SELECT count(*)::int FROM created_tasks) AS starter_tasks FROM created_project p`;
  if(owner)await notifyMembers(org,subject,[owner],'project.assigned','Você recebeu um projeto',name,rows[0].id);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id) VALUES(${org},${subject},'project.created',${rows[0].id})`;
  return reply(res,201,{project:rows[0]});
 }
 const pp=/^\/api\/projects\/([0-9a-f-]+)\/(pause|resume)$/.exec(p);
 if(pp&&validId(pp[1])&&req.method==='POST'){
  requireManager(role);const proj=await project(org,pp[1]);
  if(pp[2]==='pause'){
   if(proj.paused_at)bad('Projeto já está pausado.');
   const b=await json(req),reason=safeNote(b.reason);
   if(reason.length<3)bad('Informe o motivo da pendência (mínimo 3 caracteres).');
   const result=await sql`UPDATE teamhub.projects SET paused_at=now() WHERE id=${proj.id} AND organization_id=${org} AND paused_at IS NULL RETURNING paused_at`;
   if(!result.length)bad('Projeto já está pausado.',409);
   await sql`INSERT INTO teamhub.pause_periods(organization_id,project_id,reason,started_by_subject) VALUES(${org},${proj.id},${reason},${subject})`;
  }else{
   if(!proj.paused_at)bad('Projeto não está pausado.');
   await sql`UPDATE teamhub.projects SET paused_at=NULL WHERE id=${proj.id} AND organization_id=${org}`;
   await sql`UPDATE teamhub.pause_periods SET ended_at=now(),ended_by_subject=${subject} WHERE project_id=${proj.id} AND organization_id=${org} AND task_id IS NULL AND ended_at IS NULL`;
  }
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id) VALUES(${org},${subject},${pp[2]==='pause'?'project.paused':'project.resumed'},${proj.id})`;
  return reply(res,200,{ok:true});
 }
 const subList=/^\/api\/tasks\/([0-9a-f-]+)\/subtasks$/.exec(p);
 if(subList&&validId(subList[1])){
  const parent=await sql`SELECT id,project_id FROM teamhub.tasks WHERE id=${subList[1]} AND organization_id=${org} AND deleted_at IS NULL`;
  if(!parent.length)bad('Tarefa não encontrada.',404);
  if(req.method==='GET'){
   const rows=await sql`SELECT s.id,s.title,s.status,s.priority,s.owner_subject,s.due_at,s.created_at,COALESCE((SELECT jsonb_agg(a.auth_subject ORDER BY a.auth_subject) FROM teamhub.subtask_assignees a WHERE a.organization_id=s.organization_id AND a.subtask_id=s.id),'[]'::jsonb) AS assignees FROM teamhub.subtasks s WHERE s.organization_id=${org} AND s.task_id=${subList[1]} ORDER BY s.created_at`;
   return reply(res,200,{subtasks:rows});
  }
  if(req.method==='POST'){
   requireEditor(role);
   const b=await json(req),title=String(b.title||'').trim();
   if(title.length<2||title.length>240)bad('Título entre 2 e 240 caracteres.');
   const owner=b.owner_subject||null;
   if(owner){
    const members=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${owner} AND active=true`;
    if(!members.length)bad('Responsável não está ativo.',403);
   }
   const assignees=await checkAssignees(org,b.assignees===undefined?(owner?[owner]:[]):b.assignees);
   await verifyProjectRecipients(org,parent[0].project_id,[...new Set([...assignees,...(owner?[owner]:[])])]);
   const due=b.due_at||null;checkDueDate(due);
   const priority=b.priority||'medium';
   const labels=parseTaskLabels(b.labels===undefined?[]:b.labels);
   if(!['low','medium','high'].includes(priority))bad('Prioridade inválida.');
   const rows=await sql`INSERT INTO teamhub.subtasks(organization_id,project_id,task_id,title,owner_subject,due_at,priority,created_by_subject)
    VALUES(${org},${parent[0].project_id},${subList[1]},${title},${owner},${due?due+'T12:00:00Z':null},${priority},${subject})
    RETURNING id,title,status,priority,owner_subject,due_at`;
   await syncSubtaskAssignees(org,rows[0].id,assignees);
   await notifyMembers(org,subject,assignees,'subtask.assigned','Nova subtarefa atribuída',title,parent[0].project_id,subList[1]);
   await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary) VALUES(${org},${subList[1]},${subject},'progress',${'Subtarefa criada: '+title})`;
   return reply(res,201,{subtask:rows[0]});
  }
 }
 const subEdit=/^\/api\/subtasks\/([0-9a-f-]+)$/.exec(p);
 if(subEdit&&validId(subEdit[1])&&req.method==='PATCH'){
  requireEditor(role);
  const rows=await sql`SELECT id,task_id,title,status,priority,owner_subject,due_at FROM teamhub.subtasks WHERE id=${subEdit[1]} AND organization_id=${org}`;
  if(!rows.length)bad('Subtarefa não encontrada.',404);
  const prev=rows[0],b=await json(req);
  if(Object.keys(b).some(k=>!['title','status','priority','owner_subject','assignees','due_at'].includes(k)))bad('Campo inválido.');
  const assignees=b.assignees===undefined?null:await checkAssignees(org,b.assignees);
  if(assignees!==null){const ps=await sql`SELECT project_id FROM teamhub.subtasks WHERE id=${prev.id} AND organization_id=${org}`;if(ps.length)await verifyProjectRecipients(org,ps[0].project_id,[...new Set([...assignees,...(owner?[owner]:[])])]);}
  if(assignees!==null||b.assignee_subject!==undefined)await verifyProjectRecipients(org,t.project_id,[...new Set([...(assignees||[]),...(assignee?[assignee]:[])])]);
  const title=b.title===undefined?prev.title:String(b.title||'').trim();
  const status=b.status===undefined?prev.status:b.status;
  const priority=b.priority===undefined?prev.priority:b.priority;
  const owner=b.owner_subject===undefined?prev.owner_subject:(b.owner_subject||null);
  let due=prev.due_at;
  if(b.due_at!==undefined){checkDueDate(b.due_at);due=b.due_at?b.due_at+'T12:00:00Z':null;}
  if(title.length<2||title.length>240||!['todo','doing','done'].includes(status)||!['low','medium','high'].includes(priority))bad('Valores inválidos.');
  if(owner){const members=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${owner} AND active=true`;if(!members.length)bad('Responsável não está ativo.',403);}
  const result=await sql`UPDATE teamhub.subtasks SET title=${title},status=${status},priority=${priority},owner_subject=${owner},due_at=${due},updated_at=now() WHERE id=${prev.id} AND organization_id=${org} RETURNING id,title,status,priority,owner_subject,due_at`;
  if(assignees!==null){
   const former=await sql`SELECT auth_subject FROM teamhub.subtask_assignees WHERE organization_id=${org} AND subtask_id=${prev.id}`;
   const newlyAssigned=assignees.filter(x=>!former.some(m=>m.auth_subject===x));
   await syncSubtaskAssignees(org,prev.id,assignees);
   if(newlyAssigned.length){
    const parent=await sql`SELECT project_id FROM teamhub.tasks WHERE id=${prev.task_id} AND organization_id=${org}`;
    if(parent.length)await notifyMembers(org,subject,newlyAssigned,'subtask.assigned','Responsabilidade de subtarefa',title,parent[0].project_id,prev.task_id);
   }
  }
  await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary) VALUES(${org},${prev.task_id},${subject},'progress',${'Subtarefa atualizada: '+title})`;
  return reply(res,200,{subtask:result[0]});
 }
 const lifecycle=/^\/api\/tasks\/([0-9a-f-]+)\/(pause|resume|archive|restore|delete)$/.exec(p);
 if(lifecycle&&validId(lifecycle[1])&&req.method==='POST'){
  requireEditor(role);
  const [task]=await sql`SELECT id,project_id,title,paused_at,archived_at,deleted_at FROM teamhub.tasks WHERE id=${lifecycle[1]} AND organization_id=${org}`;
  if(!task||task.deleted_at)bad('Tarefa não encontrada.',404);
  const act=lifecycle[2];
  if(act==='pause'){
   if(task.paused_at||task.archived_at)bad('A tarefa não pode ser pausada nesse estado.');
   const b=await json(req),reason=safeNote(b.reason);
   if(reason.length<3)bad('Informe o motivo da pendência (mínimo 3 caracteres).');
   const result=await sql`UPDATE teamhub.tasks SET paused_at=now(),treatment_status='blocked',pending_reason=${reason},updated_at=now() WHERE id=${task.id} AND organization_id=${org} AND paused_at IS NULL AND archived_at IS NULL RETURNING id`;
   if(!result.length)bad('Tarefa já pausada.',409);
   await sql`INSERT INTO teamhub.pause_periods(organization_id,project_id,task_id,reason,started_by_subject) VALUES(${org},${task.project_id},${task.id},${reason},${subject})`;
  }else if(act==='resume'){
   if(!task.paused_at)bad('Tarefa não está pausada.');
   await sql`UPDATE teamhub.tasks SET paused_at=NULL,treatment_status='executing',updated_at=now() WHERE id=${task.id} AND organization_id=${org}`;
   await sql`UPDATE teamhub.pause_periods SET ended_at=now(),ended_by_subject=${subject} WHERE organization_id=${org} AND task_id=${task.id} AND ended_at IS NULL`;
  }else{
   if(act==='delete'&&role!=='admin')bad('Apenas administradores podem excluir tarefas.',403);
   const nowArchived=act==='archive'||act==='delete';
   if(task.paused_at&&nowArchived){
    await sql`UPDATE teamhub.pause_periods SET ended_at=now(),ended_by_subject=${subject} WHERE organization_id=${org} AND task_id=${task.id} AND ended_at IS NULL`;
   }
   if(act==='archive')await sql`UPDATE teamhub.tasks SET archived_at=now(),paused_at=NULL,updated_at=now() WHERE id=${task.id} AND organization_id=${org}`;
   if(act==='restore')await sql`UPDATE teamhub.tasks SET archived_at=NULL,updated_at=now() WHERE id=${task.id} AND organization_id=${org}`;
   if(act==='delete')await sql`UPDATE teamhub.tasks SET deleted_at=now(),paused_at=NULL,updated_at=now() WHERE id=${task.id} AND organization_id=${org}`;
  }
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id) VALUES(${org},${subject},${'task.'+act},${task.project_id},${task.id})`;
  await sql`INSERT INTO teamhub.task_updates(organization_id,actor_subject,task_id,event_type,summary) VALUES(${org},${subject},${task.id},'progress',${'Ação: '+act})`;
  return reply(res,200,{ok:true});
 }
 if(p==='/api/reports'&&req.method==='GET'){
  const rows=await sql`SELECT pr.id AS project_id,pr.name AS project_name,pr.created_at AS project_created_at,pr.paused_at AS project_paused_at,pr.completion_status,pr.completed_at,
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(x.ended_at,now())-x.started_at))),0)::bigint FROM teamhub.pause_periods x WHERE x.organization_id=${org} AND x.project_id=pr.id AND x.task_id IS NULL) AS project_pending_seconds,
    (SELECT count(*)::int FROM teamhub.pause_periods x WHERE x.organization_id=${org} AND x.project_id=pr.id AND x.task_id IS NULL) AS project_pauses,
    (SELECT count(*)::int FROM teamhub.tasks t WHERE t.organization_id=${org} AND t.project_id=pr.id AND t.deleted_at IS NULL) AS total_tasks,
    (SELECT count(*)::int FROM teamhub.tasks t WHERE t.organization_id=${org} AND t.project_id=pr.id AND t.status='done' AND t.deleted_at IS NULL) AS done_tasks
   FROM teamhub.projects pr WHERE pr.organization_id=${org} ORDER BY pr.created_at DESC`;
  const pauses=await sql`SELECT x.project_id,x.task_id,x.reason,x.started_at,x.ended_at,x.started_by_subject,
    ROUND(EXTRACT(EPOCH FROM(COALESCE(x.ended_at,now())-x.started_at)))::bigint AS elapsed_seconds
   FROM teamhub.pause_periods x WHERE x.organization_id=${org} ORDER BY x.started_at DESC LIMIT 1000`;
  const taskRows=await sql`SELECT t.id,t.project_id,t.title,t.status,t.treatment_status,t.paused_at,t.archived_at,t.deleted_at,t.created_at,t.assignee_subject,
    COALESCE((SELECT jsonb_agg(a.auth_subject ORDER BY a.auth_subject) FROM teamhub.task_assignees a WHERE a.organization_id=t.organization_id AND a.task_id=t.id),'[]'::jsonb) AS assignees,
    (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM(COALESCE(x.ended_at,now())-x.started_at))),0)::bigint
     FROM teamhub.pause_periods x WHERE x.organization_id=${org} AND x.task_id=t.id) AS pending_seconds,
    (SELECT count(*)::int FROM teamhub.pause_periods x WHERE x.organization_id=${org} AND x.task_id=t.id) AS pauses
   FROM teamhub.tasks t WHERE t.organization_id=${org} ORDER BY t.created_at DESC LIMIT 1000`;
  const subtaskRows=await sql`SELECT s.id,s.task_id,s.project_id,s.title,s.status,s.priority,s.owner_subject,s.created_at,s.due_at,
   t.title AS parent_title,p.name AS project_name,
   COALESCE((SELECT jsonb_agg(a.auth_subject ORDER BY a.auth_subject) FROM teamhub.subtask_assignees a WHERE a.organization_id=s.organization_id AND a.subtask_id=s.id),'[]'::jsonb) AS assignees
   FROM teamhub.subtasks s JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id
   JOIN teamhub.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id
   WHERE s.organization_id=${org} ORDER BY s.created_at DESC LIMIT 1000`;
  const approvals=await sql`SELECT a.project_id,p.name AS project_name,a.action,a.actor_subject,a.note,a.checklist,a.created_at
    FROM teamhub.project_approvals a
    JOIN teamhub.projects p ON p.id=a.project_id AND p.organization_id=a.organization_id
    WHERE a.organization_id=${org} ORDER BY a.created_at DESC LIMIT 1000`;
  return reply(res,200,{projects:rows.filter(x=>canSee(x.project_id)),
   tasks:taskRows.filter(x=>canSee(x.project_id)),
   subtasks:subtaskRows.filter(x=>canSee(x.project_id)),
   pauses:pauses.filter(x=>canSee(x.project_id)),
   approvals:approvals.filter(x=>canSee(x.project_id)),
   generated_at:new Date().toISOString()});
 }
 const pm=/^\/api\/projects\/([0-9a-f-]+)\/tasks$/.exec(p);
 if(pm&&validId(pm[1])){
  const proj=await project(org,pm[1]);
  if(req.method==='GET'){
   const tasks=await sql`SELECT t.id,t.title,t.description,t.status,t.priority,t.assignee_subject,t.due_at,t.position,t.created_at,t.treatment_status,t.treatment_notes,t.pending_reason,t.next_action,t.paused_at,t.archived_at,t.deleted_at,t.labels,(SELECT count(*)::int FROM teamhub.subtasks st WHERE st.organization_id=t.organization_id AND st.task_id=t.id) AS subtask_total,(SELECT count(*)::int FROM teamhub.subtasks st WHERE st.organization_id=t.organization_id AND st.task_id=t.id AND st.status='done') AS subtask_done,COALESCE((SELECT jsonb_agg(a.auth_subject ORDER BY a.auth_subject) FROM teamhub.task_assignees a WHERE a.task_id=t.id AND a.organization_id=t.organization_id),'[]'::jsonb) AS assignees FROM teamhub.tasks t WHERE t.organization_id=${org} AND t.project_id=${proj.id} AND t.deleted_at IS NULL AND t.archived_at IS NULL ORDER BY t.position,t.created_at`;
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
   await verifyProjectRecipients(org,proj.id,[...new Set([...assignees,...(assignee?[assignee]:[])])]);
   const rows=await sql`INSERT INTO teamhub.tasks(organization_id,project_id,title,description,priority,due_at,assignee_subject,treatment_status,treatment_notes,pending_reason,next_action,labels,created_by_subject,position) VALUES(${org},${proj.id},${title},${String(b.description||'').slice(0,2000)},${priority},${due_at},${assignee},${treatment},${treatmentNotes},${pendingReason},${nextAction},${JSON.stringify(labels)}::jsonb,${subject},(SELECT COALESCE(MAX(position),0)+1 FROM teamhub.tasks WHERE project_id=${proj.id})) RETURNING *`;
   await syncAssignees(org,rows[0].id,assignees);
   await notifyMembers(org,subject,assignees,'task.assigned','Nova tarefa atribuída',title,proj.id,rows[0].id);
   await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id) VALUES(${org},${subject},'task.created',${proj.id},${rows[0].id})`;
   await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary) VALUES(${org},${rows[0].id},${subject},'created','Tarefa criada')`;
   return reply(res,201,{task:rows[0]});
  }
 }
 const attachList=/^\/api\/tasks\/([0-9a-f-]+)\/attachments$/.exec(p);
 const attachFile=/^\/api\/tasks\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/.exec(p);
 if((attachList||attachFile)&&validId((attachList||attachFile)[1])){
  const taskId=(attachList||attachFile)[1];
  const task=await sql`SELECT id,project_id FROM teamhub.tasks WHERE id=${taskId} AND organization_id=${org} AND deleted_at IS NULL AND archived_at IS NULL`;
  if(!task.length)bad('Tarefa indisponível.',404);
  if(attachList&&req.method==='GET'){
   const rows=await sql`SELECT id,file_name,media_type,file_size,uploaded_by_subject,created_at FROM teamhub.task_attachments
    WHERE organization_id=${org} AND task_id=${taskId} ORDER BY created_at DESC LIMIT 12`;
   return reply(res,200,{attachments:rows,max_bytes:262144});
  }
  if(attachList&&req.method==='POST'){
   requireEditor(role);
   const b=await json(req,370000);
   const name=typeof b.file_name==='string'?b.file_name.trim():'',mime=b.media_type;
   if(!name||name.length>180||/[\\/\u0000-\u001f\u007f]/.test(name))bad('Nome de arquivo inválido.');
   if(!['application/pdf','image/png','image/jpeg','image/webp','text/plain'].includes(mime))bad('Tipo não permitido.');
   if(typeof b.base64!=='string'||b.base64.length>350000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.base64))bad('Arquivo inválido.');
   const bytes=Buffer.from(b.base64,'base64');
   if(bytes.length<1||bytes.length>262144)bad('Cada anexo deve ter no máximo 256 KB.');
   if(bytes.toString('base64')!==b.base64)bad('Conteúdo inválido.');
   const valid=mime==='text/plain'||
    (mime==='application/pdf'&&bytes.subarray(0,5).toString()==='%PDF-')||
    (mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||
    (mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||
    (mime==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP');
   if(!valid)bad('O conteúdo não corresponde ao formato declarado.');
   const count=await sql`SELECT count(*)::int AS total FROM teamhub.task_attachments WHERE organization_id=${org} AND task_id=${taskId}`;
   if(count[0].total>=12)bad('Limite de 12 anexos por tarefa atingido.',409);
   const rows=await sql`INSERT INTO teamhub.task_attachments(organization_id,task_id,file_name,media_type,file_size,content,uploaded_by_subject)
    VALUES(${org},${taskId},${name},${mime},${bytes.length},decode(${b.base64},'base64'),${subject})
    RETURNING id,file_name,media_type,file_size,created_at`;
   await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id)
    VALUES(${org},${subject},'task.attachment.added',${task[0].project_id},${taskId})`;
   return reply(res,201,{attachment:rows[0]});
  }
  if(attachFile&&validId(attachFile[2])){
   if(req.method==='GET'){
    const rows=await sql`SELECT file_name,media_type,file_size,encode(content,'base64') AS base64 FROM teamhub.task_attachments
     WHERE id=${attachFile[2]} AND task_id=${taskId} AND organization_id=${org}`;
    if(!rows.length)bad('Anexo não encontrado.',404);
    return reply(res,200,{file:rows[0]});
   }
   if(req.method==='DELETE'){
    requireEditor(role);
    const rows=await sql`DELETE FROM teamhub.task_attachments WHERE id=${attachFile[2]} AND task_id=${taskId}
      AND organization_id=${org} AND (${['admin','manager'].includes(role)} OR uploaded_by_subject=${subject}) RETURNING id,file_name`;
    if(!rows.length)bad('Anexo não encontrado ou sem permissão para excluir.',403);
    await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id)
      VALUES(${org},${subject},'task.attachment.removed',${task[0].project_id},${taskId})`;
    return reply(res,200,{deleted:true});
   }
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
  const mentions=await checkAssignees(org,body.mentions===undefined?[]:body.mentions);
  const parent=await sql`SELECT project_id,title FROM teamhub.tasks WHERE organization_id=${org} AND id=${hm[1]} AND deleted_at IS NULL`;
  if(!parent.length)bad('Tarefa não encontrada.',404);
  await verifyProjectRecipients(org,parent[0].project_id,mentions);
  const [item]=await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary) VALUES(${org},${hm[1]},${subject},'comment',${summary}) RETURNING id,created_at`;
  if(mentions.length)await notifyMembers(org,subject,mentions,'task.mention','Você foi mencionado em uma tarefa',parent[0].title,parent[0].project_id,hm[1]);
  return reply(res,201,{update:item});
 }
 const tm=/^\/api\/tasks\/([0-9a-f-]+)$/.exec(p);
 if(tm&&validId(tm[1])&&req.method==='PATCH'){
  requireEditor(role);const b=await json(req);
  const keys=Object.keys(b);
  if(!keys.length||keys.some(k=>!['status','priority','title','description','due_at','assignee_subject','assignees','labels','treatment_status','treatment_notes','pending_reason','next_action','update_note'].includes(k)))bad('Campos não permitidos.');
  const existing=await sql`SELECT id,project_id,title,description,status,priority,due_at,assignee_subject,treatment_status,treatment_notes,pending_reason,next_action,labels FROM teamhub.tasks WHERE id=${tm[1]} AND organization_id=${org}`;
  if(!existing.length)bad('Tarefa não encontrada.',404);
  const t=existing[0];
  const status=b.status===undefined?t.status:b.status;
  const labels=b.labels===undefined?t.labels:parseTaskLabels(b.labels);
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
  const result=await sql`UPDATE teamhub.tasks SET status=${status},priority=${priority},title=${title},description=${description},due_at=${dueAt},assignee_subject=${assignee},treatment_status=${treatment},treatment_notes=${treatmentNotes},pending_reason=${pendingReason},next_action=${nextAction},labels=${JSON.stringify(labels)}::jsonb,updated_at=now() WHERE id=${t.id} AND organization_id=${org} RETURNING id,title,description,status,priority,due_at,assignee_subject,treatment_status,treatment_notes,pending_reason,next_action`;
  if(assignees!==null){
   const former=await sql`SELECT auth_subject FROM teamhub.task_assignees WHERE organization_id=${org} AND task_id=${t.id}`;
   const newlyAssigned=assignees.filter(x=>!former.some(m=>m.auth_subject===x));
   await syncAssignees(org,t.id,assignees);
   await notifyMembers(org,subject,newlyAssigned,'task.assigned','Tarefa atribuída',title,t.project_id,t.id);
  }
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
