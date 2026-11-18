import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {neon} from '@neondatabase/serverless';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {handleProduction} from './production.mjs';

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
  req.identityEmailVerified=payload.email_verified===true;
  return payload.sub;
 }catch(e){if(e.status)throw e;console.warn('Nexus auth verification failed:',String(e?.code||e?.name||'unknown'));bad('Sessão inválida ou expirada.',401);}
}
async function membership(subject,org){
 const r=await sql`SELECT m.role FROM teamhub.memberships m
 JOIN teamhub.organizations o ON o.id=m.organization_id
 WHERE m.auth_subject=${subject} AND m.organization_id=${org}
 AND m.active=true AND o.module_enabled=true`;
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
 if(event.startsWith('project.review')||event.startsWith('project.completion')||event.startsWith('task.reopen'))return 'approvals';
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
async function notifyDirectCardAssignment(org,actor,recipient,projectId,projectName){
 if(recipient===actor)return;
 await sql`INSERT INTO teamhub.notifications
   (organization_id,recipient_subject,actor_subject,event_type,title,details,project_id)
   VALUES(${org},${recipient},${actor},'card.direct_assigned','Você foi adicionado a um card',
    ${projectName},${projectId})`;
}
async function verifyProjectRecipients(org,projectId,subjects){
 if(!subjects.length)return;
 const rows=await sql`SELECT access_mode,owner_subject,manager_subject FROM teamhub.projects WHERE id=${projectId} AND organization_id=${org}`;
 if(!rows.length)bad('Projeto não encontrado.',404);
 if(rows[0].access_mode!=='restricted')return;
 const allowed=await sql`SELECT m.auth_subject FROM teamhub.memberships m
  WHERE m.organization_id=${org} AND m.active=true AND m.auth_subject IN
   (SELECT jsonb_array_elements_text(${JSON.stringify(subjects)}::jsonb))
   AND (m.role='admin' OR m.auth_subject=${rows[0].manager_subject} OR m.auth_subject=${rows[0].owner_subject}
   OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=${projectId} AND pm.auth_subject=m.auth_subject))`;
 if(allowed.length!==subjects.length)bad('Para atribuir uma tarefa em projeto restrito, primeiro autorize os responsáveis no projeto.',403);
}
async function project(org,id){
 const rows=await sql`SELECT id,name,description,created_at,paused_at,COALESCE(card_theme,card_color) AS card_color,owner_subject,manager_subject,access_mode,completion_status,completed_at FROM teamhub.projects WHERE organization_id=${org} AND id=${id} AND archived_at IS NULL`;
 if(!rows.length)bad('Projeto indisponível.',404);return rows[0];
}
function emailTransportConfigured(){
 return process.env.NEXUS_EMAIL_ENABLED==='true'&&
  typeof process.env.RESEND_API_KEY==='string'&&process.env.RESEND_API_KEY.startsWith('re_')&&
  typeof process.env.NEXUS_EMAIL_FROM==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.NEXUS_EMAIL_FROM);
}

const MASTER_WORKER_URL='https://anna-one-auditoria.elisonborg.workers.dev';
async function masterWorker(req,endpoint){
 const bearer=req.headers.authorization||'';
 if(!/^Bearer\s+\S+$/i.test(bearer))bad('Sessão Master ausente.',401);
 let response;
 try{
  response=await fetch(MASTER_WORKER_URL+endpoint,{
   headers:{Authorization:bearer,Accept:'application/json'},
   signal:AbortSignal.timeout(8000),cache:'no-store'
  });
 }catch{bad('Não foi possível validar o Master do Portal AnnA One.',503);}
 if(!response.ok)bad('Acesso Master não autorizado no Portal AnnA One.',403);
 return response.json().catch(()=>bad('Resposta inválida do Portal AnnA One.',502));
}
async function requireMaster(req){
 const permission=await masterWorker(req,'/v1/admin/authorize');
 if(permission?.authenticated!==true||permission?.admin_authorized!==true)
  bad('Esta operação exige permissão Master do Portal AnnA One.',403);
}
async function masterInstitution(req,id){
 if(!validId(id))bad('Cliente inválido.');
 const data=await masterWorker(req,'/v1/admin/institutions/'+encodeURIComponent(id)+'/modules');
 if(!data?.institution||!Array.isArray(data.modules)||(data.institution.id&&data.institution.id!==id))
  bad('Cadastro do cliente não confirmado pelo Master.',502);
 const entry=data.modules.find(x=>x.code==='nexus');
 if(!entry)bad('O módulo Nexus ainda não foi cadastrado no catálogo do Master.',409);
 return {institution:data.institution,entry,
  enabled:data.institution.status==='active'&&entry.status==='available'&&entry.parent_allowed!==false&&entry.enabled===true};
}
const NEXUS_INVITE_URL='https://anna-nexus-dev.onrender.com/';
const escapeEmailHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);
function inviteEmailContent({organizationName,logoUrl,role,inviteUrl}){
 const org=escapeEmailHtml(organizationName||'Sua organização');
 const roleLabel=({admin:'Administrador',manager:'Gestor',member:'Membro',guest:'Convidado'})[role]||'Convidado';
 const logo=typeof logoUrl==='string'&&/^https:\/\//i.test(logoUrl)&&logoUrl.length<1000
  ?logoUrl:NEXUS_INVITE_URL+'anna-symbol.svg';
 const safeLogo=escapeEmailHtml(logo);
 const safeUrl=escapeEmailHtml(inviteUrl);
 const subject='Convite para participar de '+(organizationName||'uma equipe')+' no AnnA Nexus';
 const textBody='Você recebeu um convite para participar de '+(organizationName||'uma organização')+
  ' no AnnA Nexus. Perfil: '+roleLabel+
  '. Para aceitar, acesse: '+inviteUrl+
  '\n\nEste convite é individual, válido por 7 dias e deve ser usado com o mesmo endereço de e-mail. Se não esperava este convite, ignore esta mensagem.\nAnnA One · Tecnologia e Educação Juntas.';
 const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
 <meta name="viewport" content="width=device-width,initial-scale=1"></head>
 <body style="margin:0;background:#eff5fb;font-family:Arial,Helvetica,sans-serif;color:#173451">
 <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#eff5fb">
 <tr><td align="center" style="padding:26px 12px">
 <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #dce7f3;border-radius:16px;overflow:hidden">
 <tr><td style="background:#0c2646;padding:26px;text-align:center">
 <img alt="" src="${safeLogo}" width="52" height="52" style="display:block;margin:0 auto 8px;object-fit:contain">
 <div style="font-size:28px;font-weight:bold;color:#ffffff">AnnA <span style="color:#69baff">One</span></div>
 <div style="color:#ccdef0;letter-spacing:2px;font-size:11px;padding-top:5px">NEXUS · GESTÃO COLABORATIVA</div>
 </td></tr>
 <tr><td style="padding:29px 29px 12px">
 <h1 style="font-size:23px;line-height:1.35;margin:0 0 16px;color:#123965">Você foi convidado!</h1>
 <p style="font-size:15px;line-height:1.7;margin:0 0 17px">Você recebeu um convite para participar de uma equipe no <strong>AnnA Nexus</strong>, ambiente colaborativo da AnnA One.</p>
 <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="background:#f1f6fc;border-radius:10px">
 <tr><td style="padding:16px;font-size:14px;line-height:1.8">
 <span style="color:#54708a">Organização</span><br><strong>${org}</strong><br>
 <span style="color:#54708a">Perfil de acesso</span><br><strong>${escapeEmailHtml(roleLabel)}</strong>
 </td></tr></table>
 <div style="text-align:center;margin:28px 0 24px">
 <a href="${safeUrl}" style="background:#0870ca;color:#fff;text-decoration:none;border-radius:9px;padding:15px 28px;display:inline-block;font-size:15px;font-weight:bold">Aceitar convite</a>
 </div>
 <p style="color:#5d7288;font-size:13px;line-height:1.6">Este convite é individual e válido por <strong>7 dias</strong>. Entre ou crie sua conta AnnA One com o mesmo e-mail destinatário.</p>
 <p style="color:#5d7288;font-size:12px;line-height:1.6;overflow-wrap:anywhere">Se o botão não funcionar, copie o endereço abaixo:<br>
 <a href="${safeUrl}" style="color:#0870ca;word-break:break-all">${safeUrl}</a></p>
 </td></tr>
 <tr><td style="padding:18px 28px 22px;border-top:1px solid #e6edf5;text-align:center;color:#6b7c8f;font-size:12px;line-height:1.6">
 AnnA One · Tecnologia e Educação Juntas<br>
 Mensagem automática de convite. Se não esperava este e-mail, pode ignorá-lo.<br>
 Não compartilhe o link individual de acesso.
 </td></tr></table>
 </td></tr></table></body></html>`;
 return {subject,html,text:textBody};
}
async function dispatchInvitationEmail({invitationId,email,role,inviteUrl,organizationName,logoUrl,attempt=0}){
 if(!emailTransportConfigured()){
  await sql`UPDATE teamhub.invitations SET email_status='not_configured',
   email_error='Envio automático não configurado no ambiente.',
   email_attempted_at=now(),email_attempts=email_attempts+1
   WHERE id=${invitationId}`;
  return {delivery:'manual',email_status:'not_configured'};
 }
 const content=inviteEmailContent({organizationName,logoUrl,role,inviteUrl});
 // Resend idempotency prevents accidental duplicate submissions of the same invitation.
 try{
  const response=await fetch('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,
    'Content-Type':'application/json',
    'Idempotency-Key':'nexus-invitation-'+invitationId+'-'+attempt},
   body:JSON.stringify({from:'AnnA One | Nexus <'+process.env.NEXUS_EMAIL_FROM+'>',
    to:[email],subject:content.subject,html:content.html,text:content.text}),
   signal:AbortSignal.timeout(10000)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error('Resend HTTP '+response.status);
  const providerId=typeof result.id==='string'?result.id.slice(0,128):'';
  if(!providerId)throw Error('Resend não confirmou um identificador de envio.');
  await sql`UPDATE teamhub.invitations SET email_status='sent',
   email_attempted_at=now(),email_provider_id=${providerId},email_error=NULL,
   email_attempts=email_attempts+1 WHERE id=${invitationId}`;
  return {delivery:'email',email_status:'sent'};
 }catch(error){
  const note=String(error?.message||'Falha do provedor').slice(0,160);
  await sql`UPDATE teamhub.invitations SET email_status='failed',
   email_attempted_at=now(),email_error=${note},
   email_attempts=email_attempts+1 WHERE id=${invitationId}`;
  console.warn('Nexus invitation email was not accepted by the provider.',note);
  return {delivery:'manual',email_status:'failed'};
 }
}
async function sendCardNotificationEmail(email,card,company,cardId,noticeId,organizationId,assignmentCount=1){
 if(!emailTransportConfigured())return {status:'not_configured'};
 try{
  const link=NEXUS_INVITE_URL+'?org='+encodeURIComponent(organizationId)+'#card='+cardId;
  const response=await fetch('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,
    'Content-Type':'application/json','Idempotency-Key':'nexus-card-'+noticeId+'-'+assignmentCount},
   body:JSON.stringify({from:'AnnA One | Nexus <'+process.env.NEXUS_EMAIL_FROM+'>',to:[email],
    subject:'Você foi adicionado ao card '+card,
    text:'Você foi adicionado ao card '+card+' de '+company+'. Acesse com sua conta AnnA One: '+link,
    html:'<p>Você foi adicionado ao card <strong>'+escapeEmailHtml(card)+'</strong> de '+
      escapeEmailHtml(company)+'.</p><p><a href="'+escapeEmailHtml(link)+
      '">Acessar meu card</a></p><p>Utilize sua conta AnnA One; não é necessário novo cadastro.</p>'}),
   signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error('Resend HTTP '+response.status);
  const result=await response.json().catch(()=>({}));
  if(!result.id)throw Error('Envio sem confirmação.');
  return {status:'sent',id:String(result.id)};
 }catch(e){return {status:'failed',error:String(e.message||'Falha').slice(0,150)};}
}
// A atribuição ao card é independente do envio. Tentativas posteriores preservam
// a chave de idempotência do Resend e nunca reativam acesso removido.
let cardEmailRetryBusy=false;
async function retryCardAssignmentEmails(){
 if(cardEmailRetryBusy||!emailTransportConfigured())return;
 cardEmailRetryBusy=true;
 try{
  const pending=await sql`SELECT n.id,n.organization_id,n.project_id,n.recipient_subject,
    n.recipient_email,n.assignment_count,p.name AS card_name,o.name AS org_name
   FROM teamhub.card_email_notices n
   JOIN teamhub.projects p ON p.id=n.project_id AND p.organization_id=n.organization_id
   JOIN teamhub.organizations o ON o.id=n.organization_id AND o.module_enabled=true
   JOIN teamhub.memberships m ON m.organization_id=n.organization_id AND m.auth_subject=n.recipient_subject AND m.active=true
   WHERE n.status IN ('queued','failed','not_configured','sending')
    AND n.retry_attempts<5 AND n.created_at>now()-interval '7 days'
    AND (n.last_attempt_at IS NULL OR n.last_attempt_at<now()-interval '10 minutes')
    AND p.archived_at IS NULL
    AND (EXISTS(SELECT 1 FROM teamhub.project_members pm
       WHERE pm.organization_id=n.organization_id AND pm.project_id=n.project_id
        AND pm.auth_subject=n.recipient_subject)
     OR EXISTS(SELECT 1 FROM teamhub.production_assignments pa
       WHERE pa.organization_id=n.organization_id AND pa.project_id=n.project_id
        AND pa.auth_subject=n.recipient_subject))
   ORDER BY n.created_at LIMIT 10`;
  for(const n of pending){
   const claimed=await sql`UPDATE teamhub.card_email_notices SET
     status='sending',retry_attempts=retry_attempts+1,last_attempt_at=now()
     WHERE id=${n.id} AND assignment_count=${n.assignment_count}
      AND status IN ('queued','failed','not_configured','sending')
      AND retry_attempts<5 AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '10 minutes')
     RETURNING id`;
   if(!claimed.length)continue;
   const result=await sendCardNotificationEmail(n.recipient_email,n.card_name,n.org_name,
    n.project_id,n.id,n.organization_id,n.assignment_count);
   await sql`UPDATE teamhub.card_email_notices SET
     status=${result.status},provider_id=${result.id||null},
     error_message=${result.error||null}
     WHERE id=${n.id} AND assignment_count=${n.assignment_count}`;
  }
 }catch(e){console.warn('Nexus card email retries unavailable:',String(e.message||'Unknown').slice(0,130))}
 finally{cardEmailRetryBusy=false;}
}
let emailWorkerBusy=false;
async function processEmailOutbox(){
 if(emailWorkerBusy||!emailTransportConfigured())return;
 emailWorkerBusy=true;
 try{
  const pending=await sql`SELECT n.id,n.organization_id,n.recipient_subject,c.email
   FROM teamhub.notifications n
   JOIN teamhub.notification_preferences pref ON pref.organization_id=n.organization_id AND pref.auth_subject=n.recipient_subject AND pref.email_enabled=true
   JOIN teamhub.notification_email_contacts c ON c.organization_id=n.organization_id AND c.auth_subject=n.recipient_subject
   JOIN teamhub.memberships m ON m.organization_id=n.organization_id AND m.auth_subject=n.recipient_subject AND m.active=true
   LEFT JOIN teamhub.projects p ON p.id=n.project_id AND p.organization_id=n.organization_id
   WHERE n.event_type<>'card.direct_assigned' AND n.read_at IS NULL AND n.created_at>=pref.updated_at AND n.created_at>now()-interval '7 days'
    AND (n.project_id IS NULL OR p.access_mode='organization' OR m.role='admin' OR p.manager_subject=n.recipient_subject OR p.owner_subject=n.recipient_subject
      OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=n.organization_id AND pm.project_id=n.project_id AND pm.auth_subject=n.recipient_subject))
    AND NOT EXISTS(SELECT 1 FROM teamhub.email_delivery_log e WHERE e.notification_id=n.id)
   ORDER BY n.created_at ASC LIMIT 15`;
  for(const n of pending){
   const claim=await sql`INSERT INTO teamhub.email_delivery_log(notification_id,organization_id,recipient_subject,recipient_email,status,error_message)
    VALUES(${n.id},${n.organization_id},${n.recipient_subject},${n.email},'failed','processing')
    ON CONFLICT(notification_id) DO NOTHING RETURNING id`;
   if(!claim.length)continue;
   try{
    const response=await fetch('https://api.resend.com/emails',{
     method:'POST',
     headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'nexus-'+n.id},
     body:JSON.stringify({from:process.env.NEXUS_EMAIL_FROM,to:[n.email],
      subject:'Você tem um novo aviso no AnnA Nexus',
      text:'Uma nova notificação está disponível na sua conta AnnA Nexus. Acesse https://anna-nexus-dev.onrender.com para consultar. Nenhum detalhe confidencial é enviado por e-mail.'}),
     signal:AbortSignal.timeout(10000)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error('Resend HTTP '+response.status);
    await sql`UPDATE teamhub.email_delivery_log SET status='sent',provider_message_id=${String(result.id||'').slice(0,128)},error_message=''
     WHERE id=${claim[0].id}`;
   }catch(error){
    await sql`UPDATE teamhub.email_delivery_log SET status='failed',error_message=${String(error?.message||'Provider error').slice(0,160)}
     WHERE id=${claim[0].id}`;
    console.warn('Nexus email attempt failed; see delivery log for audit.');
   }
  }
 }catch(error){console.warn('Nexus email outbox unavailable:',String(error?.message||'Unknown').slice(0,140))}
 finally{emailWorkerBusy=false;}
}
async function createDeadlineNotifications(org,subject){
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
      AND (p.access_mode='organization' OR m.role='admin' OR p.manager_subject=m.auth_subject OR p.owner_subject=m.auth_subject
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
  const subtasks=await sql`WITH candidates AS(
    SELECT s.id AS subtask_id,s.task_id,s.project_id,s.title,s.due_at,m.auth_subject,
     (s.due_at AT TIME ZONE 'UTC')::date < (now() AT TIME ZONE 'America/Fortaleza')::date AS overdue
    FROM teamhub.subtasks s
    JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id AND t.deleted_at IS NULL AND t.archived_at IS NULL
    JOIN teamhub.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id AND p.archived_at IS NULL
    JOIN LATERAL(
      SELECT DISTINCT a.auth_subject FROM (
       SELECT sa.auth_subject FROM teamhub.subtask_assignees sa WHERE sa.organization_id=s.organization_id AND sa.subtask_id=s.id
       UNION SELECT s.owner_subject WHERE s.owner_subject IS NOT NULL
      ) a
    ) assigned ON true
    JOIN teamhub.memberships m ON m.organization_id=s.organization_id AND m.auth_subject=assigned.auth_subject AND m.active=true
    LEFT JOIN teamhub.notification_preferences pref ON pref.organization_id=s.organization_id AND pref.auth_subject=m.auth_subject
    WHERE s.organization_id=${org} AND s.status!='done' AND s.due_at IS NOT NULL
      AND (s.due_at AT TIME ZONE 'UTC')::date <=(now() AT TIME ZONE 'America/Fortaleza')::date+2
      AND COALESCE(pref.deadlines,true)
      AND (p.access_mode='organization' OR m.role='admin' OR p.manager_subject=m.auth_subject OR p.owner_subject=m.auth_subject
       OR EXISTS(SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=m.auth_subject))
   ), inserted AS(
    INSERT INTO teamhub.notifications(organization_id,recipient_subject,actor_subject,event_type,title,details,project_id,task_id)
    SELECT ${org}::uuid,c.auth_subject,${subject},
      CASE WHEN c.overdue THEN 'subtask.overdue' ELSE 'subtask.due_soon' END,
      CASE WHEN c.overdue THEN 'Subtarefa atrasada' ELSE 'Prazo da subtarefa próximo' END,
      c.title,c.project_id,c.task_id
    FROM candidates c WHERE NOT EXISTS(
      SELECT 1 FROM teamhub.notifications n WHERE n.organization_id=${org}
       AND n.recipient_subject=c.auth_subject AND n.task_id=c.task_id
       AND n.details=c.title
       AND n.event_type=CASE WHEN c.overdue THEN 'subtask.overdue' ELSE 'subtask.due_soon' END
       AND n.created_at>=now()-interval '24 hours'
    )
    RETURNING id
   ) SELECT count(*)::int AS sent FROM inserted`;

 return {created:(rows[0]?.sent||0)+(subtasks[0]?.sent||0),tasks_created:rows[0]?.sent||0,subtasks_created:subtasks[0]?.sent||0};
}
async function logManualDeadlineRun(org,result){
 await sql`INSERT INTO teamhub.automation_runs(organization_id,local_day,status,trigger_type,finished_at,tasks_created,subtasks_created)
 VALUES(${org},${todayInFortaleza()},'completed','manual',now(),${result.tasks_created},${result.subtasks_created})
 ON CONFLICT(organization_id,job_name,local_day,trigger_type) DO UPDATE SET
 started_at=now(),finished_at=now(),status='completed',
 tasks_created=teamhub.automation_runs.tasks_created+excluded.tasks_created,
 subtasks_created=teamhub.automation_runs.subtasks_created+excluded.subtasks_created,error_message=''`;
}
let scheduledRunInProgress=false;
async function runScheduledDeadlines(){
 if(scheduledRunInProgress||process.env.NEXUS_AUTO_DEADLINES==='false')return;
 const h=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Fortaleza',hour:'2-digit',hourCycle:'h23'}).format(new Date());
 if(Number(h)<9)return;
 scheduledRunInProgress=true;
 try{
  const orgs=await sql`SELECT DISTINCT o.id FROM teamhub.organizations o
   JOIN teamhub.memberships m ON m.organization_id=o.id AND m.active=true
   JOIN teamhub.projects p ON p.organization_id=o.id AND p.archived_at IS NULL
   WHERE EXISTS(SELECT 1 FROM teamhub.tasks t WHERE t.organization_id=o.id AND t.project_id=p.id AND t.deleted_at IS NULL AND t.archived_at IS NULL)
   ORDER BY o.id LIMIT 200`;
  for(const row of orgs){
   const claimed=await sql`INSERT INTO teamhub.automation_runs(organization_id,local_day,status,trigger_type)
     VALUES(${row.id},${todayInFortaleza()},'running','scheduled')
     ON CONFLICT(organization_id,job_name,local_day,trigger_type) DO UPDATE SET
       status='running',started_at=now(),error_message=''
     WHERE teamhub.automation_runs.status='failed'
        OR (teamhub.automation_runs.status='running' AND teamhub.automation_runs.started_at<now()-interval '20 minutes')
     RETURNING id`;
   if(!claimed.length)continue;
   try{
    const result=await createDeadlineNotifications(row.id,'system:deadline-check');
    await sql`UPDATE teamhub.automation_runs SET status='completed',finished_at=now(),
     tasks_created=${result.tasks_created},subtasks_created=${result.subtasks_created}
     WHERE id=${claimed[0].id}`;
    console.info('Nexus daily reminders processed for organization:',row.id,'total:',result.created);
   }catch(error){
    await sql`UPDATE teamhub.automation_runs SET status='failed',finished_at=now(),error_message=${String(error?.message||'Unknown error').slice(0,200)} WHERE id=${claimed[0].id}`;
    console.warn('Nexus reminder job failed for organization:',row.id);
   }
  }
 }catch(error){console.warn('Nexus reminder scheduler unavailable:',String(error?.message||'Unknown').slice(0,150))}
 finally{scheduledRunInProgress=false;}
}

const route=async(req,res)=>{
 const url=new URL(req.url,'http://localhost'); const p=url.pathname;
 const masterRoute=p.startsWith('/api/master/');
 const origin=req.headers.origin||'';
 if(masterRoute&&origin==='https://annaone.com.br'){
  res.setHeader('Access-Control-Allow-Origin','https://annaone.com.br');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 }
 if(req.method==='OPTIONS'){
  if(masterRoute&&origin==='https://annaone.com.br'){
   res.writeHead(204);return res.end();
  }
  res.writeHead(405);return res.end();
 }
 if(masterRoute&&origin&&origin!=='https://annaone.com.br'&&origin!=='https://anna-nexus-dev.onrender.com')
  bad('Origem administrativa não autorizada.',403);
 if(p==='/health')return reply(res,200,{ok:true,service:'anna-nexus'});
 if(!p.startsWith('/api/')){
  if(req.method!=='GET')return reply(res,405,{error:'Método não permitido'});
  const file=p==='/'?'/index.html':p;
  if(!['/index.html','/app.js','/theme.js','/styles.css','/manifest.webmanifest','/anna-symbol.svg'].includes(file))return reply(res,404,{error:'Não encontrado'});
  const data=await readFile(path.join(dir,'public',file));
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.webmanifest')?'application/manifest+json':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' https://esm.sh; connect-src 'self' https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech; style-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});return res.end(data);
 }
 // Public invitation preview: the random 256-bit token is itself the secret.
 // It is received in a POST body (never query params or server request logs).
 // No identity or membership information is returned beyond this invitation.
 if(p==='/api/invitations/preview'&&req.method==='POST'){
  const b=await json(req);
  const token=typeof b.token==='string'?b.token.toLowerCase():'';
  if(!/^[a-f0-9]{64}$/.test(token))bad('Link de convite inválido.',400);
  const hash=createHash('sha256').update(token).digest('hex');
  const rows=await sql`SELECT i.email,i.role,i.project_id,p.name AS project_name,o.display_name,o.name
   FROM teamhub.invitations i JOIN teamhub.organizations o ON o.id=i.organization_id
   LEFT JOIN teamhub.projects p ON p.id=i.project_id AND p.organization_id=i.organization_id
   WHERE i.token_hash=${hash} AND i.status='pending' AND i.expires_at>now()
   LIMIT 1`;
  if(!rows.length)bad('Este convite expirou, foi cancelado ou já foi utilizado. Solicite um novo convite.',410);
  return reply(res,200,{email:rows[0].email,role:rows[0].role,project_name:rows[0].project_name||null,
   organization:rows[0].display_name||rows[0].name});
 }
 const subject=await user(req);
 if(p==='/api/master/organizations'&&req.method==='GET'){
  await requireMaster(req);
  const rows=await sql`SELECT o.id,o.name,o.slug,o.master_institution_id,
    o.module_enabled,COUNT(m.auth_subject)::int AS members
    FROM teamhub.organizations o LEFT JOIN teamhub.memberships m
    ON m.organization_id=o.id AND m.active=true
    GROUP BY o.id ORDER BY o.name LIMIT 200`;
  return reply(res,200,{organizations:rows});
 }
 const masterSync=/^\/api\/master\/institutions\/([0-9a-f-]+)\/sync$/.exec(p);
 if(masterSync&&req.method==='POST'){
  await requireMaster(req);
  const {institution,enabled}=await masterInstitution(req,masterSync[1]);
  const b=await json(req);
  const linkOrg=b.link_org_id||null;
  if(linkOrg!==null&&!validId(linkOrg))bad('Organização selecionada inválida.');
  const matching=await sql`SELECT id,master_institution_id FROM teamhub.organizations
   WHERE master_institution_id=${masterSync[1]}::uuid`;
  let org;
  if(matching.length){
   if(linkOrg&&linkOrg!==matching[0].id)bad('Este cliente já possui organização vinculada.',409);
   const rows=await sql`UPDATE teamhub.organizations SET module_enabled=${enabled}
    WHERE id=${matching[0].id} RETURNING id,name,module_enabled,master_institution_id`;
   org=rows[0];
  }else if(linkOrg){
   const rows=await sql`UPDATE teamhub.organizations SET
    master_institution_id=${masterSync[1]}::uuid,module_enabled=${enabled}
    WHERE id=${linkOrg} AND master_institution_id IS NULL
    RETURNING id,name,module_enabled,master_institution_id`;
   if(!rows.length)bad('Organização já vinculada ou inexistente. Nenhuma alteração realizada.',409);
   org=rows[0];
  }else if(enabled){
   const name=String(institution.name||'').trim();
   if(name.length<2||name.length>160)bad('Nome de cliente inválido no Master.',409);
   const slug='master-'+masterSync[1];
   const rows=await sql`INSERT INTO teamhub.organizations(name,slug,master_institution_id,module_enabled)
    VALUES(${name},${slug},${masterSync[1]}::uuid,true)
    RETURNING id,name,module_enabled,master_institution_id`;
   org=rows[0];
  }else bad('Habilite o módulo AnnA Nexus no catálogo do Master antes de criar uma organização.',409);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action)
   VALUES(${org.id},${subject},'master.organization.synced')`;
  return reply(res,200,{organization:org,module_enabled:enabled,created:!matching.length&&!linkOrg});
 }
 const masterInvite=/^\/api\/master\/institutions\/([0-9a-f-]+)\/invite-admin$/.exec(p);
 if(masterInvite&&req.method==='POST'){
  await requireMaster(req);
  const {enabled}=await masterInstitution(req,masterInvite[1]);
  if(!enabled)bad('Habilite o Nexus para esta instituição no catálogo do Master.',409);
  const rows=await sql`SELECT id,name,display_name,logo_url FROM teamhub.organizations
   WHERE master_institution_id=${masterInvite[1]}::uuid AND module_enabled=true`;
  if(!rows.length)bad('Sincronize a organização do cliente antes de convidar o administrador.',409);
  const org=rows[0],b=await json(req),email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))bad('E-mail inválido.');
  const duplicate=await sql`SELECT 1 FROM teamhub.member_profiles p
   JOIN teamhub.memberships m ON m.auth_subject=p.auth_subject
   WHERE m.organization_id=${org.id} AND m.active=true
    AND lower(p.email)=${email}`;
  if(duplicate.length)bad('Esta pessoa já pertence à organização. Gerencie seu perfil no Nexus.',409);
  const token=randomBytes(32).toString('hex');
  const hash=createHash('sha256').update(token).digest('hex');
  let invitation;
  try{
   const inserted=await sql`INSERT INTO teamhub.invitations
    (organization_id,email,role,token_hash,invited_by_subject,expires_at)
    VALUES(${org.id},${email},'admin',${hash},${subject},now()+interval '7 days')
    RETURNING id,email,role,expires_at`;
   invitation=inserted[0];
  }catch(e){
   if(e?.code==='23505'||String(e.message||'').includes('invitations_one_pending'))
    bad('Este destinatário já possui um convite pendente. Não foi enviado outro.',409);
   throw e;
  }
  const inviteUrl=NEXUS_INVITE_URL+'#invite='+token;
  const sending=await dispatchInvitationEmail({
   invitationId:invitation.id,email,role:'admin',inviteUrl,
   organizationName:org.display_name||org.name,logoUrl:org.logo_url||''
  });
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action)
    VALUES(${org.id},${subject},'master.admin.invited')`;
  return reply(res,201,{invitation:{id:invitation.id,email,expires_at:invitation.expires_at},
   email_status:sending.email_status,invite_url:inviteUrl});
 }
 if(p==='/api/profile/self'&&req.method==='PUT'){
  const b=await json(req);
  const name=typeof b.display_name==='string'?b.display_name.trim().replace(/\s+/g,' '):'';
  if(name.length>160)bad('Nome muito longo.');
  const email=req.identityEmail||'';
  await sql`INSERT INTO teamhub.member_profiles(auth_subject,display_name,email,updated_at)
   VALUES(${subject},${name},${email},now())
   ON CONFLICT(auth_subject) DO UPDATE SET
     display_name=CASE WHEN EXCLUDED.display_name<>'' THEN EXCLUDED.display_name
       ELSE teamhub.member_profiles.display_name END,
     email=EXCLUDED.email,updated_at=now()`;
  return reply(res,200,{ok:true});
 }
 if(p==='/api/invitations/accept'&&req.method==='POST'){
  const b=await json(req);
  const token=typeof b.token==='string'?b.token:'';
  if(!/^[a-f0-9]{64}$/.test(token))bad('Convite inválido.',400);
  // The possession of a 256-bit, single-use invitation token delivered to the
  // invitee's mailbox is the email-possession proof for this specific invitation.
  // Neon Auth's shared email/password configuration currently allows sign-up
  // without a separate verification email. We still require an authenticated
  // session and an exact match between the identity email and invitation email.
  // No other Nexus endpoint relaxes verification based on this rule.
  if(!req.identityEmail)bad('Entre com sua conta AnnA One para aceitar o convite.',403);
  const hash=createHash('sha256').update(token).digest('hex');
  const invitations=await sql`SELECT id,organization_id,email,role,project_id,production_role,individual_target,invited_by_subject FROM teamhub.invitations WHERE token_hash=${hash} AND status='pending' AND expires_at>now()`;
  if(!invitations.length)bad('Convite expirado, cancelado ou já utilizado.',410);
  const invitation=invitations[0];
  if(invitation.email!==req.identityEmail)bad('Este convite foi emitido para outro e-mail. Entre com a conta convidada do Portal AnnA One.',403);
  const [orgEnabled]=await sql`SELECT module_enabled FROM teamhub.organizations WHERE id=${invitation.organization_id}`;
  if(!orgEnabled?.module_enabled)bad('Módulo Nexus desabilitado para esta organização.',403);
  const alreadyMember=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${invitation.organization_id} AND auth_subject=${subject}`;
  if(alreadyMember.length)bad('Esta conta já pertence à organização. Peça ao administrador para ajustar o perfil ou reativar o acesso.',409);
  // Validate card before consuming invitation; the join and membership then commit atomically.
  if(invitation.project_id){
   const target=await sql`SELECT id FROM teamhub.projects
    WHERE id=${invitation.project_id} AND organization_id=${invitation.organization_id}
      AND archived_at IS NULL AND access_mode='restricted'`;
   if(!target.length)bad('O card deste convite está indisponível. Solicite um novo convite.',410);
  }
  const linked=await sql`WITH claimed AS (
   UPDATE teamhub.invitations SET status='accepted',accepted_by_subject=${subject},accepted_at=now()
   WHERE id=${invitation.id} AND status='pending' AND expires_at>now()
    AND NOT EXISTS (SELECT 1 FROM teamhub.memberships m
      WHERE m.organization_id=${invitation.organization_id} AND m.auth_subject=${subject})
   RETURNING organization_id,role,project_id,production_role,individual_target,invited_by_subject
  ), membership AS (
   INSERT INTO teamhub.memberships(organization_id,auth_subject,role,active)
   SELECT organization_id,${subject},role,true FROM claimed
   ON CONFLICT (organization_id,auth_subject) DO NOTHING
   RETURNING organization_id
  ), project_link AS (
   INSERT INTO teamhub.project_members(organization_id,project_id,auth_subject,added_by_subject)
   SELECT c.organization_id,c.project_id,${subject},c.invited_by_subject
   FROM claimed c JOIN membership m ON m.organization_id=c.organization_id
   WHERE c.project_id IS NOT NULL
   ON CONFLICT DO NOTHING RETURNING project_id
  ), production_link AS (
   INSERT INTO teamhub.production_assignments(organization_id,project_id,auth_subject,production_role,individual_target)
   SELECT c.organization_id,c.project_id,${subject},COALESCE(c.production_role,'operator'),c.individual_target
   FROM claimed c JOIN membership m ON m.organization_id=c.organization_id
   JOIN teamhub.production_settings s ON s.project_id=c.project_id AND s.organization_id=c.organization_id
   ON CONFLICT DO NOTHING RETURNING project_id
  )
  SELECT m.organization_id FROM membership m`;
  if(!linked.length)bad('O convite não está mais disponível.',409);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action) VALUES(${invitation.organization_id},${subject},'invitation.accepted')`;
  return reply(res,200,{accepted:true,organization_id:invitation.organization_id,project_id:invitation.project_id||null});
 }
 if(p==='/api/me'&&req.method==='GET'){
  const orgs=await sql`SELECT o.id,o.name,o.display_name,o.logo_url,m.role FROM teamhub.memberships m JOIN teamhub.organizations o ON o.id=m.organization_id WHERE m.auth_subject=${subject} AND m.active=true AND o.module_enabled=true ORDER BY o.name`;
  return reply(res,200,{organizations:orgs});
 }
 const org=url.searchParams.get('org')||req.headers['x-organization-id'];
 if(!validId(org))bad('Selecione uma organização válida.');
 const role=await membership(subject,org);
 const unrestricted=role==='admin';
 const canManageProject=async id=>{
  if(role==='admin')return true;
  if(role!=='manager')return false;
  const rows=await sql`SELECT 1 FROM teamhub.projects WHERE id=${id} AND organization_id=${org} AND manager_subject=${subject} AND archived_at IS NULL`;
  return rows.length>0;
 };
 const requireProjectManagement=async id=>{
  if(!(await canManageProject(id)))bad('Ação reservada ao gestor responsável ou administrador.',403);
 };
 const taskInfo=async id=>{
  const rows=await sql`SELECT t.project_id,t.status,t.paused_at,t.archived_at,t.deleted_at,
    (t.assignee_subject=${subject} OR EXISTS(SELECT 1 FROM teamhub.task_assignees a
    WHERE a.organization_id=${org} AND a.task_id=t.id AND a.auth_subject=${subject})) AS assigned
    FROM teamhub.tasks t WHERE t.id=${id} AND t.organization_id=${org}`;
  return rows[0]||null;
 };
 const requireTaskExecution=async id=>{
  const t=await taskInfo(id);
  if(t){const [pr]=await sql`SELECT paused_at,completion_status FROM teamhub.projects WHERE organization_id=${org} AND id=${t.project_id}`;
   if(!pr||pr.paused_at||pr.completion_status!=='active')bad('Projeto pausado ou encerrado: execução bloqueada.',409);}
  if(!t||t.deleted_at||t.archived_at||!((await canManageProject(t.project_id))||((role==='member'||role==='manager')&&t.assigned)))
   bad('Ação reservada ao responsável atribuído ou gestor responsável.',403);
  return t;
 };
 const requireSubtaskExecution=async id=>{
  const rows=await sql`SELECT s.project_id,(s.owner_subject=${subject} OR EXISTS(
    SELECT 1 FROM teamhub.subtask_assignees a WHERE a.organization_id=${org}
      AND a.subtask_id=s.id AND a.auth_subject=${subject})) AS assigned
   FROM teamhub.subtasks s WHERE s.id=${id} AND s.organization_id=${org}`;
  if(!rows.length||!((await canManageProject(rows[0].project_id))||((role==='member'||role==='manager')&&rows[0].assigned)))
   bad('Subtarefa não atribuída ou sem permissão.',403);
  return rows[0];
 };
 if(p==='/api/production/dashboard'&&req.method==='GET'){
  if(!['admin','manager'].includes(role))bad('Painel reservado a gestores.',403);
  const rows=await sql`WITH totals AS(
   SELECT organization_id,project_id,
    SUM(CASE WHEN status='approved' THEN COALESCE(quality_approved,quantity) ELSE 0 END) AS approved,
    SUM(CASE WHEN status IN ('pending','awaiting_quality') THEN quantity ELSE 0 END) AS pending,
    SUM(CASE WHEN status='approved' THEN COALESCE(quality_rejected,0) ELSE 0 END) AS rejected
   FROM teamhub.production_entries WHERE organization_id=${org}
   GROUP BY organization_id,project_id
  ), rework AS(
   SELECT organization_id,project_id,SUM(approved) AS approved,SUM(rejected) AS rejected
   FROM teamhub.production_rework WHERE organization_id=${org}
   GROUP BY organization_id,project_id
  )
  SELECT p.id,p.name,s.target,s.unit,s.due_date,s.goal_mode,
   COALESCE(t.approved,0)+COALESCE(r.approved,0) AS completed,
   COALESCE(t.pending,0) AS pending,
   COALESCE(t.rejected,0)+COALESCE(r.rejected,0) AS rejected
  FROM teamhub.projects p JOIN teamhub.production_settings s
   ON s.organization_id=p.organization_id AND s.project_id=p.id
  LEFT JOIN totals t ON t.organization_id=p.organization_id AND t.project_id=p.id
  LEFT JOIN rework r ON r.organization_id=p.organization_id AND r.project_id=p.id
  WHERE p.organization_id=${org} AND p.archived_at IS NULL
   AND (${role==='admin'} OR p.manager_subject=${subject})
  ORDER BY s.due_date,p.created_at DESC LIMIT 200`;
  return reply(res,200,{cards:rows});
 }
 const standardCard=/^\/api\/cards\/([0-9a-f-]+)\/(assign|remove|members)$/.exec(p);
 if(standardCard){
  const cardId=standardCard[1],operation=standardCard[2];
  if(!validId(cardId))bad('Card inválido.');
  const projectRows=await sql`SELECT id,name,access_mode,card_type FROM teamhub.projects
   WHERE id=${cardId} AND organization_id=${org} AND archived_at IS NULL`;
  if(!projectRows.length)bad('Card não encontrado.',404);
  const card=projectRows[0],manager=await canManageProject(cardId);
  if(!manager)bad('Esta operação é reservada ao gestor do card.',403);
  if(card.card_type!=='project')bad('Use a equipe do card de produção.',409);
  if(req.method==='GET'&&operation==='members'){
   const data=await sql`SELECT m.auth_subject,pr.display_name,pr.email
    FROM teamhub.project_members m
    LEFT JOIN teamhub.member_profiles pr ON pr.auth_subject=m.auth_subject
    WHERE m.organization_id=${org} AND m.project_id=${cardId}`;
   return reply(res,200,{members:data,restricted:card.access_mode==='restricted'});
  }
  if(card.access_mode!=='restricted')bad('Para convidar por card, primeiro selecione acesso restrito nas configurações do projeto.',409);
  if(req.method==='POST'&&operation==='remove'){
   const b=await json(req),worker=String(b.subject||'');
   if(worker===subject)bad('Não remova sua própria conta por esta opção.',409);
   const deleted=await sql`DELETE FROM teamhub.project_members
    WHERE organization_id=${org} AND project_id=${cardId} AND auth_subject=${worker}
    RETURNING auth_subject`;
   if(!deleted.length)bad('Participante não encontrado.',404);
   return reply(res,200,{removed:true});
  }
  if(req.method==='POST'&&operation==='assign'){
   const b=await json(req),email=String(b.email||'').trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)bad('Informe um e-mail válido.');
   const found=await sql`SELECT m.auth_subject,m.active FROM teamhub.memberships m JOIN teamhub.member_profiles pr
    ON m.auth_subject=pr.auth_subject WHERE m.organization_id=${org} AND lower(pr.email)=${email} LIMIT 1`;
   if(found.length){
    if(!found[0].active)bad('Funcionário com acesso desativado. Solicite reativação.',409);
    const worker=found[0].auth_subject;
    const inserted=await sql`INSERT INTO teamhub.project_members(organization_id,project_id,auth_subject,added_by_subject)
     VALUES(${org},${cardId},${worker},${subject}) ON CONFLICT DO NOTHING RETURNING auth_subject`;
    if(!inserted.length)bad('Funcionário já atribuído ao card.',409);
    await notifyDirectCardAssignment(org,subject,worker,cardId,card.name);
    const notice=await sql`INSERT INTO teamhub.card_email_notices(organization_id,project_id,recipient_subject,recipient_email)
      VALUES(${org},${cardId},${worker},${email})
      ON CONFLICT(organization_id,project_id,recipient_subject)
      DO UPDATE SET assignment_count=teamhub.card_email_notices.assignment_count+1,
        status='queued',provider_id=NULL,error_message=NULL,created_at=now()
      RETURNING id,assignment_count`;
    let delivery='previously_notified';
    if(notice.length){
     const company=await sql`SELECT name FROM teamhub.organizations WHERE id=${org}`;
     const sent=await sendCardNotificationEmail(email,card.name,company[0]?.name||'AnnA One',cardId,notice[0].id,org,notice[0].assignment_count);
     delivery=sent.status;
     await sql`UPDATE teamhub.card_email_notices SET status=${sent.status},provider_id=${sent.id||null},
      error_message=${sent.error||null},retry_attempts=1,last_attempt_at=now()
      WHERE id=${notice[0].id}`;
    }
    return reply(res,201,{assignment:'existing',email_status:delivery});
   }
   const pending=await sql`SELECT id FROM teamhub.invitations WHERE organization_id=${org} AND email=${email}
     AND status='pending' AND expires_at>now()`;
   if(pending.length)bad('Já existe um convite pendente para este e-mail.',409);
   const token=randomBytes(32).toString('hex'),tokenHash=createHash('sha256').update(token).digest('hex');
   const invitations=await sql`INSERT INTO teamhub.invitations
    (organization_id,email,role,token_hash,invited_by_subject,expires_at,project_id)
    VALUES(${org},${email},'member',${tokenHash},${subject},now()+interval '7 days',${cardId})
    RETURNING id`;
   const company=await sql`SELECT name,logo_url FROM teamhub.organizations WHERE id=${org}`;
   const inviteUrl=NEXUS_INVITE_URL+'#invite='+token;
   const result=await dispatchInvitationEmail({invitationId:invitations[0].id,email,
    role:'member',inviteUrl,organizationName:(company[0]?.name||'AnnA One')+' · '+card.name,
    logoUrl:company[0]?.logo_url||''});
   return reply(res,201,{assignment:'invited',email_status:result.email_status,invite_url:inviteUrl});
  }
  return reply(res,405,{error:'Operação não permitida.'});
 }
 if(await handleProduction({req,res,p,org,subject,role,sql,reply,json,canManageProject,
   notifyDirectCardAssignment,dispatchInvitationEmail,sendEmail:sendCardNotificationEmail,NEXUS_INVITE_URL}))return;
 if(role==='guest'&&req.method!=='GET'&&!/^\/api\/notifications\/(?:read-all|[0-9a-f-]+\/read)$/.test(p))
  bad('Convidado possui acesso somente de leitura.',403);
 if(role==='guest'&&/^\/api\/(?:members|my-tasks|my-subtasks|reports|approvals|automation)/.test(p))
  bad('Área indisponível ao convidado.',403);
 const authorized=unrestricted?null:await sql`SELECT p.id FROM teamhub.projects p WHERE p.organization_id=${org} AND p.archived_at IS NULL AND
  (p.manager_subject=${subject} OR (${role!=='guest'} AND p.access_mode='organization')
   OR (${role!=='guest'} AND p.owner_subject=${subject}) OR EXISTS
   (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
 const allowedSet=new Set(authorized?.map(x=>x.id)||[]);
 const canSee=id=>unrestricted||allowedSet.has(id);
 const projectRoute=/^\/api\/projects\/([0-9a-f-]+)(?:\/.*)?$/.exec(p);
 if(projectRoute&&validId(projectRoute[1])){
  const active=await sql`SELECT 1 FROM teamhub.projects
   WHERE id=${projectRoute[1]} AND organization_id=${org} AND archived_at IS NULL`;
  if(!active.length)bad('Card excluído ou indisponível.',404);
 }

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
 if(p==='/api/invitations/config'&&req.method==='GET'){
  if(role!=='admin')bad('Consulta restrita ao administrador.',403);
  return reply(res,200,{email_enabled:emailTransportConfigured(),delivery_provider:'Resend',
   fallback:'manual',validity_days:7});
 }
 if(p==='/api/invitations'&&req.method==='GET'){
  if(role!=='admin')bad('Apenas administradores podem consultar convites.',403);
  const rows=await sql`SELECT id,email,role,status,created_at,expires_at,accepted_at,email_status,email_attempted_at,email_attempts,email_error FROM teamhub.invitations WHERE organization_id=${org} ORDER BY created_at DESC LIMIT 100`;
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
   const inviteUrl=NEXUS_INVITE_URL+'#invite='+token;
   const [organization]=await sql`SELECT name,display_name,logo_url FROM teamhub.organizations WHERE id=${org}`;
   const sending=await dispatchInvitationEmail({
    invitationId:rows[0].id,email,role:invitedRole,inviteUrl,
    organizationName:organization?.display_name||organization?.name||'Sua organização',
    logoUrl:organization?.logo_url||''
   });
   return reply(res,201,{invitation:{...rows[0],email_status:sending.email_status},
    invite_url:inviteUrl,delivery:sending.delivery,email_status:sending.email_status});
  }catch(e){
   if(e?.code==='23505'||String(e?.message||'').includes('invitations_one_pending'))bad('Este e-mail já possui um convite pendente. Cancele-o antes de enviar outro.',409);
   throw e;
  }
 }
 const resend=/^\/api\/invitations\/([0-9a-f-]+)\/resend$/.exec(p);
 if(resend&&validId(resend[1])&&req.method==='POST'){
  if(role!=='admin')bad('Apenas administradores podem reenviar convites.',403);
  const token=randomBytes(32).toString('hex');
  const hash=createHash('sha256').update(token).digest('hex');
  // Resend generates a fresh URL; the old invitation link becomes invalid.
  // Cooldown prevents accidental duplicate clicks and spam.
  const rows=await sql`UPDATE teamhub.invitations
   SET token_hash=${hash},expires_at=now()+interval '7 days',
     email_status='manual',email_error=NULL,email_provider_id=NULL
   WHERE id=${resend[1]} AND organization_id=${org}
    AND status='pending'
    AND (email_attempted_at IS NULL OR email_attempted_at<now()-interval '60 seconds')
    AND email_attempts<5
   RETURNING id,email,role,email_attempts`;
  if(!rows.length)bad('Convite indisponível, limite de tentativas atingido ou aguarde 60 segundos antes de reenviar.',409);
  const invite=rows[0];
  const inviteUrl=NEXUS_INVITE_URL+'#invite='+token;
  const [organization]=await sql`SELECT name,display_name,logo_url FROM teamhub.organizations WHERE id=${org}`;
  const sending=await dispatchInvitationEmail({invitationId:invite.id,email:invite.email,
   role:invite.role,inviteUrl,attempt:Number(invite.email_attempts||0),
   organizationName:organization?.display_name||organization?.name||'Sua organização',
   logoUrl:organization?.logo_url||''});
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action)
   VALUES(${org},${subject},'invitation.resent')`;
  return reply(res,200,{invite_url:inviteUrl,invitation:{id:invite.id,email:invite.email,role:invite.role},
   delivery:sending.delivery,email_status:sending.email_status,old_link_invalidated:true});
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
   email_available:emailTransportConfigured(),can_enable_email:emailTransportConfigured()&&req.identityEmailVerified&&!!req.identityEmail,
   delivery:emailTransportConfigured()?'internal_and_opt_in_email':'internal'});
 }
 if(p==='/api/notification-preferences'&&req.method==='PATCH'){
  const b=await json(req);
  if(Object.keys(b).some(k=>!['assignments','mentions','deadlines','approvals','email_enabled'].includes(k)))bad('Preferência inválida.');
  if(b.email_enabled===true&&(!emailTransportConfigured()||!req.identityEmailVerified||!req.identityEmail))bad('E-mail indisponível: requer provedor configurado e endereço verificado pela autenticação.',409);
  if(!Object.keys(b).length||Object.values(b).some(x=>typeof x!=='boolean'))bad('Informe opções válidas.');
  const prev=await sql`SELECT assignments,mentions,deadlines,approvals,email_enabled FROM teamhub.notification_preferences
   WHERE organization_id=${org} AND auth_subject=${subject}`;
  const old=prev[0]||{assignments:true,mentions:true,deadlines:true,approvals:true,email_enabled:false};
  const values={...old,...b};
  const rows=await sql`INSERT INTO teamhub.notification_preferences
    (organization_id,auth_subject,assignments,mentions,deadlines,approvals,email_enabled)
    VALUES(${org},${subject},${values.assignments},${values.mentions},${values.deadlines},${values.approvals},${values.email_enabled})
    ON CONFLICT(organization_id,auth_subject) DO UPDATE SET
    assignments=excluded.assignments,mentions=excluded.mentions,deadlines=excluded.deadlines,
    approvals=excluded.approvals,email_enabled=excluded.email_enabled,updated_at=now()
    RETURNING assignments,mentions,deadlines,approvals,email_enabled`;
  if(b.email_enabled===true){
   await sql`INSERT INTO teamhub.notification_email_contacts(organization_id,auth_subject,email,verified_at)
    VALUES(${org},${subject},${req.identityEmail},now())
    ON CONFLICT(organization_id,auth_subject) DO UPDATE
     SET email=excluded.email,verified_at=now(),updated_at=now()`;
  }else if(b.email_enabled===false){
   await sql`DELETE FROM teamhub.notification_email_contacts WHERE organization_id=${org} AND auth_subject=${subject}`;
  }
  return reply(res,200,{preferences:rows[0],email_available:emailTransportConfigured()});
 }
 if(p==='/api/notifications'&&req.method==='GET'){
  const rows=await sql`SELECT id,event_type,title,details,project_id,task_id,read_at,created_at
   FROM teamhub.notifications WHERE organization_id=${org} AND recipient_subject=${subject}
   ORDER BY created_at DESC LIMIT 100`;
  const visible=rows.filter(n=>(!n.project_id||canSee(n.project_id))&&
   (role!=='guest'||/^(project.assigned|task.due|task.overdue|subtask.due|subtask.overdue)/.test(n.event_type)));
  return reply(res,200,{notifications:visible,unread:visible.filter(n=>!n.read_at).length});
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
  const members=await sql`SELECT m.auth_subject,m.role,m.active,
  COALESCE(NULLIF(p.display_name,''),'') AS display_name,
  COALESCE(p.email,'') AS email
  FROM teamhub.memberships m LEFT JOIN teamhub.member_profiles p
  ON p.auth_subject=m.auth_subject
  WHERE m.organization_id=${org}
  ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,m.auth_subject`;
  return reply(res,200,{members,viewer:subject,role});
 }
 if(p==='/api/my-tasks'&&req.method==='GET'){
  const showArchived=url.searchParams.get('archived')==='1';
  const tasks=await sql`SELECT t.id,t.title,t.status,t.priority,t.due_at,t.project_id,p.name AS project_name,t.paused_at,t.archived_at,t.created_at,t.treatment_status FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id WHERE t.organization_id=${org} AND t.deleted_at IS NULL AND (t.archived_at IS NULL OR ${showArchived}) AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject})) AND (t.assignee_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.task_assignees a WHERE a.task_id=t.id AND a.organization_id=t.organization_id AND a.auth_subject=${subject})) AND p.archived_at IS NULL ORDER BY (t.status='done'),t.due_at NULLS LAST,t.created_at DESC LIMIT 200`;
  return reply(res,200,{tasks});
 }
 if(p==='/api/my-subtasks'&&req.method==='GET'){
  const rows=await sql`SELECT s.id,s.task_id,s.project_id,s.title,s.status,s.priority,s.due_at,s.created_at,
    t.title AS task_title,p.name AS project_name
   FROM teamhub.subtasks s
   JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id
   JOIN teamhub.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id
   WHERE s.organization_id=${org} AND t.archived_at IS NULL AND t.deleted_at IS NULL AND p.archived_at IS NULL AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))
   AND (s.owner_subject=${subject} OR EXISTS(SELECT 1 FROM teamhub.subtask_assignees a WHERE a.organization_id=s.organization_id AND a.subtask_id=s.id AND a.auth_subject=${subject}))
   ORDER BY (s.status='done'),s.due_at NULLS LAST,s.created_at DESC LIMIT 200`;
  return reply(res,200,{subtasks:rows});
 }
 if(p==='/api/calendar'&&req.method==='GET'){
  const tasks=await sql`SELECT t.id,t.project_id,t.title,t.due_at,t.created_at,t.status,p.name AS project_name,'task' AS kind
   FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
   WHERE t.organization_id=${org} AND t.deleted_at IS NULL AND t.archived_at IS NULL
   AND p.archived_at IS NULL AND t.due_at IS NOT NULL
   AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject}
     OR EXISTS(SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))
   ORDER BY t.due_at,t.created_at LIMIT 2000`;
  const subtasks=await sql`SELECT s.id,s.project_id,s.title,s.due_at,s.created_at,s.status,p.name AS project_name,'subtask' AS kind
   FROM teamhub.subtasks s JOIN teamhub.tasks t ON t.id=s.task_id AND t.organization_id=s.organization_id
   JOIN teamhub.projects p ON p.id=s.project_id AND p.organization_id=s.organization_id
   WHERE s.organization_id=${org} AND t.deleted_at IS NULL AND t.archived_at IS NULL AND p.archived_at IS NULL
   AND s.due_at IS NOT NULL
   AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject}
     OR EXISTS(SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))
   ORDER BY s.due_at,s.created_at LIMIT 2000`;
  return reply(res,200,{items:[...tasks,...subtasks]});
 }
 if(p==='/api/projects/order'&&req.method==='PATCH'){
  const b=await json(req);
  const ids=b.project_ids;
  if(!Array.isArray(ids)||ids.length>200||ids.some(id=>typeof id!=='string'||!validId(id))||new Set(ids).size!==ids.length)bad('Ordem de projetos inválida.');
  const available=await sql`SELECT id FROM teamhub.projects WHERE organization_id=${org} AND archived_at IS NULL`;
  const availableIds=new Set(available.map(x=>x.id));
  if(ids.some(id=>!availableIds.has(id)||!canSee(id)))bad('A ordem contém projeto não autorizado.',403);
  await sql`INSERT INTO teamhub.project_card_layouts(organization_id,auth_subject,project_ids)
    VALUES(${org},${subject},${JSON.stringify(ids)}::jsonb)
    ON CONFLICT(organization_id,auth_subject) DO UPDATE
    SET project_ids=excluded.project_ids,updated_at=now()`;
  return reply(res,200,{saved:true,count:ids.length});
 }
 if(p==='/api/projects'&&req.method==='GET'){
  const projects=await sql`SELECT p.id,p.name,p.card_type,p.description,
  (SELECT s.target FROM teamhub.production_settings s
   WHERE s.organization_id=p.organization_id AND s.project_id=p.id) AS production_target,
  (SELECT COALESCE(SUM(CASE WHEN e.status='approved' THEN COALESCE(e.quality_approved,e.quantity) ELSE 0 END),0)
   FROM teamhub.production_entries e WHERE e.organization_id=p.organization_id AND e.project_id=p.id)
  +(SELECT COALESCE(SUM(r.approved),0) FROM teamhub.production_rework r
    WHERE r.organization_id=p.organization_id AND r.project_id=p.id) AS production_done,
  p.created_at,p.paused_at,COALESCE(p.card_theme,p.card_color) AS card_color,p.owner_subject,p.manager_subject,p.access_mode,p.completion_status,p.completed_at, COUNT(t.id)::int AS total, COUNT(t.id) FILTER(WHERE t.status='done')::int AS done, COUNT(t.id) FILTER(WHERE t.status='doing')::int AS doing FROM teamhub.projects p LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id AND t.deleted_at IS NULL AND t.archived_at IS NULL WHERE p.organization_id=${org} AND p.archived_at IS NULL AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject})) GROUP BY p.id ORDER BY p.created_at DESC`;
  const layout=await sql`SELECT project_ids FROM teamhub.project_card_layouts WHERE organization_id=${org} AND auth_subject=${subject}`;
  const preferred=Array.isArray(layout[0]?.project_ids)?layout[0].project_ids:[];
  const position=new Map(preferred.map((id,index)=>[id,index]));
  projects.sort((a,b)=>(position.get(a.id)??Number.MAX_SAFE_INTEGER)-(position.get(b.id)??Number.MAX_SAFE_INTEGER));
  return reply(res,200,{projects,role});
 }
 if(p==='/api/dashboard'&&req.method==='GET'){
  if(role==='guest')bad('Painel interno indisponível ao convidado.',403);
  const rows=await sql`SELECT COUNT(DISTINCT p.id)::int AS projects, COUNT(t.id) FILTER(WHERE t.status!='done')::int AS open, COUNT(t.id) FILTER(WHERE t.status='doing')::int AS doing, COUNT(t.id) FILTER(WHERE t.status='done')::int AS done, COUNT(t.id) FILTER(WHERE t.status!='done' AND t.treatment_status IN ('blocked','waiting'))::int AS attention FROM teamhub.projects p LEFT JOIN teamhub.tasks t ON t.project_id=p.id AND t.organization_id=p.organization_id AND t.archived_at IS NULL AND t.deleted_at IS NULL WHERE p.organization_id=${org} AND p.archived_at IS NULL AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
  return reply(res,200,{summary:rows[0]});
 }
 if(p==='/api/automation/check-deadlines'&&req.method==='POST'){
  if(role!=='admin')bad('Verificação organizacional reservada ao administrador.',403);
  const result=await createDeadlineNotifications(org,subject);
  await logManualDeadlineRun(org,result);
  return reply(res,200,{...result,delivery:'internal',checked_at:new Date().toISOString()});
 }
 if(p==='/api/automation/email-deliveries'&&req.method==='GET'){
  if(role!=='admin')bad('Monitor da organização exclusivo do administrador.',403);
  const rows=await sql`SELECT attempted_at,status,error_message,provider_message_id
   FROM teamhub.email_delivery_log WHERE organization_id=${org} ORDER BY attempted_at DESC LIMIT 100`;
  const totals=await sql`SELECT status,count(*)::int AS total FROM teamhub.email_delivery_log
   WHERE organization_id=${org} GROUP BY status`;
  return reply(res,200,{configured:emailTransportConfigured(),deliveries:rows,totals});
 }
 if(p==='/api/automation/runs'&&req.method==='GET'){
  if(role!=='admin')bad('Monitor da organização exclusivo do administrador.',403);
  const rows=await sql`SELECT id,local_day,trigger_type,status,started_at,finished_at,
   tasks_created,subtasks_created,error_message FROM teamhub.automation_runs
   WHERE organization_id=${org} ORDER BY started_at DESC LIMIT 100`;
  return reply(res,200,{runs:rows,scheduled_mode:'best-effort'});
 }
 if(p==='/api/dashboard/insights'&&req.method==='GET'){
  if(role==='guest')bad('Painel interno indisponível ao convidado.',403);
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
     AND (${role!=='manager'} OR p.manager_subject=${subject})
     AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS
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
     AND (${role!=='manager'} OR p.manager_subject=${subject})
     AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS
       (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
  const activity=await sql`SELECT (a.created_at AT TIME ZONE 'America/Fortaleza')::date::text AS day, count(*)::int AS total
    FROM teamhub.activities a LEFT JOIN teamhub.projects p ON p.id=a.project_id AND p.organization_id=a.organization_id
    WHERE a.organization_id=${org}
      AND a.created_at>=now()-${period}*interval '1 day'
      AND (${projectId}::uuid IS NULL OR a.project_id=${projectId}::uuid)
      AND (a.project_id IS NOT NULL OR ${unrestricted})
      AND (${role!=='manager'} OR p.manager_subject=${subject})
      AND (a.project_id IS NULL OR ${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS
       (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=a.project_id AND pm.auth_subject=${subject}))
    GROUP BY 1 ORDER BY 1`;
  const pending=await sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(pp.ended_at,now())-pp.started_at))),0)::bigint AS seconds
    FROM teamhub.pause_periods pp JOIN teamhub.projects p ON p.id=pp.project_id AND p.organization_id=pp.organization_id
    WHERE pp.organization_id=${org} AND p.archived_at IS NULL AND (${projectId}::uuid IS NULL OR p.id=${projectId}::uuid)
     AND (${role!=='manager'} OR p.manager_subject=${subject})
     AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS
       (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject}))`;
  const total=(field)=>projects.reduce((sum,p)=>sum+Number(p[field]||0),0);
  return reply(res,200,{summary:{projects:projects.length,tasks:total('tasks'),todo:total('todo'),doing:total('doing'),
      done:total('completed'),overdue:total('overdue'),attention:total('attention'),paused_projects:projects.filter(p=>p.paused_at).length,
      subtasks:subtasks[0]?.total||0,subtasks_done:subtasks[0]?.completed||0,subtasks_overdue:subtasks[0]?.overdue||0,
      pending_seconds:Number(pending[0]?.seconds||0)},
    projects,activity,period,generated_at:new Date().toISOString()});
 }
 if(p==='/api/attention'&&req.method==='GET'){
  const items=await sql`SELECT t.id,t.project_id,p.name AS project_name,t.title,t.treatment_status,t.pending_reason,t.next_action,t.due_at FROM teamhub.tasks t JOIN teamhub.projects p ON p.id=t.project_id AND p.organization_id=t.organization_id WHERE t.organization_id=${org} AND t.archived_at IS NULL AND t.deleted_at IS NULL AND p.archived_at IS NULL AND (${unrestricted} OR (p.access_mode='organization' AND ${role!=='guest'}) OR (p.owner_subject=${subject} AND ${role!=='guest'}) OR p.manager_subject=${subject} OR EXISTS (SELECT 1 FROM teamhub.project_members pm WHERE pm.organization_id=${org} AND pm.project_id=p.id AND pm.auth_subject=${subject})) AND t.status!='done' AND t.treatment_status IN ('blocked','waiting') ORDER BY CASE WHEN t.treatment_status='blocked' THEN 0 ELSE 1 END,t.due_at NULLS LAST,t.updated_at DESC LIMIT 50`;
  return reply(res,200,{items});
 }

 // v0.1.40 — Central de Solicitações e Aprovações.
 if(p==='/api/approvals/central'&&req.method==='GET'){
  if(role==='guest')bad('Convidados não acessam solicitações internas.',403);
  const requests=await sql`SELECT r.id,r.task_id,r.project_id,r.reason,r.status,r.created_at,
     r.requester_subject,r.decided_by_subject,r.decision_note,r.decided_at,
     t.title AS task_title,p.name AS project_name
   FROM teamhub.task_reopen_requests r
   JOIN teamhub.projects p ON p.id=r.project_id AND p.organization_id=r.organization_id
   JOIN teamhub.tasks t ON t.id=r.task_id AND t.organization_id=r.organization_id
   WHERE r.organization_id=${org} AND
    (${role==='admin'} OR (${role==='manager'} AND p.manager_subject=${subject})
      OR r.requester_subject=${subject})
   ORDER BY r.created_at DESC LIMIT 200`;
  const projects=role==='admin'||role==='manager'
   ?await sql`SELECT id,name,completion_requested_at,completion_note,completion_status
     FROM teamhub.projects WHERE organization_id=${org} AND archived_at IS NULL
      AND (${role==='admin'} OR manager_subject=${subject})
      AND completion_status='review'
     ORDER BY completion_requested_at DESC LIMIT 100`: [];
  const projectHistory=role==='admin'||role==='manager'
   ?await sql`SELECT a.project_id,p.name AS project_name,a.action,a.note,a.actor_subject,a.created_at
     FROM teamhub.project_approvals a JOIN teamhub.projects p ON p.id=a.project_id
      AND p.organization_id=a.organization_id
     WHERE a.organization_id=${org} AND a.action IN ('approved','rejected','reopened')
      AND (${role==='admin'} OR p.manager_subject=${subject})
     ORDER BY a.created_at DESC LIMIT 150`:[];
  return reply(res,200,{requests,projects,project_history:projectHistory});
 }
 const requestReopen=/^\/api\/tasks\/([0-9a-f-]+)\/reopen-requests$/.exec(p);
 if(requestReopen&&validId(requestReopen[1])&&req.method==='POST'){
  const task=await requireTaskExecution(requestReopen[1]);
  if(task.status!=='done')bad('Somente tarefas concluídas podem solicitar reabertura.',409);
  const [proj]=await sql`SELECT id,name,manager_subject,completion_status,paused_at FROM teamhub.projects
   WHERE organization_id=${org} AND id=${task.project_id} AND archived_at IS NULL`;
  if(!proj||proj.completion_status!=='active'||proj.paused_at)
   bad('Reabra ou retome o projeto antes de solicitar a reabertura de tarefa.',409);
  const b=await json(req),reason=safeNote(b.reason,2000);
  if(reason.length<3)bad('Justificativa obrigatória (mínimo de 3 caracteres).');
  let rows;
  try{
   rows=await sql`INSERT INTO teamhub.task_reopen_requests
     (organization_id,project_id,task_id,requester_subject,reason)
     VALUES(${org},${task.project_id},${requestReopen[1]},${subject},${reason})
     RETURNING id,status,created_at`;
  }catch(e){
   if(e?.code==='23505'||String(e?.message||'').includes('nexus_one_reopen_pending'))
    bad('Já existe uma solicitação pendente para esta tarefa.',409);
   throw e;
  }
  const admins=await sql`SELECT auth_subject FROM teamhub.memberships
   WHERE organization_id=${org} AND role='admin' AND active=true`;
  await notifyMembers(org,subject,[...admins.map(x=>x.auth_subject),proj.manager_subject].filter(Boolean),
   'task.reopen.requested','Solicitação de reabertura de tarefa',
   'Acesse a Central de Solicitações e Aprovações.',task.project_id,requestReopen[1]);
  return reply(res,201,{request:rows[0]});
 }
 const decideReopen=/^\/api\/reopen-requests\/([0-9a-f-]+)\/decide$/.exec(p);
 if(decideReopen&&validId(decideReopen[1])&&req.method==='POST'){
  const b=await json(req),decision=b.decision,note=safeNote(b.note||'',1000);
  if(!['approved','rejected'].includes(decision))bad('Decisão inválida.');
  if(decision==='rejected'&&note.length<3)bad('A recusa exige justificativa.');
  const [pending]=await sql`SELECT r.id,r.project_id,r.task_id,r.requester_subject
   FROM teamhub.task_reopen_requests r WHERE r.id=${decideReopen[1]}
    AND r.organization_id=${org} AND r.status='pending'`;
  if(!pending)bad('Solicitação não está pendente.',409);
  await requireProjectManagement(pending.project_id);
  // One SQL statement handles the decision and task transition together.
  const result=await sql`WITH decided AS (
    UPDATE teamhub.task_reopen_requests r SET status=${decision},
      decision_note=${note},decided_by_subject=${subject},decided_at=now()
    FROM teamhub.projects p,teamhub.tasks t
    WHERE r.id=${pending.id} AND r.organization_id=${org}
      AND r.status='pending' AND p.id=r.project_id AND p.organization_id=r.organization_id
      AND t.id=r.task_id AND t.organization_id=r.organization_id
      AND ( ${decision}='rejected' OR
        (p.completion_status='active' AND p.paused_at IS NULL
         AND t.status='done' AND t.deleted_at IS NULL AND t.archived_at IS NULL))
    RETURNING r.id,r.project_id,r.task_id
   ), changed AS(
    UPDATE teamhub.tasks t SET status='doing',updated_at=now()
     FROM decided d WHERE ${decision}='approved' AND t.id=d.task_id AND t.organization_id=${org}
     RETURNING t.id
   ) SELECT id,project_id,task_id FROM decided`;
  if(!result.length)bad('A solicitação não pode ser decidida neste estado.',409);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id,task_id)
    VALUES(${org},${subject},${'task.reopen.'+decision},${pending.project_id},${pending.task_id})`;
  await sql`INSERT INTO teamhub.task_updates(organization_id,task_id,actor_subject,event_type,summary)
    VALUES(${org},${pending.task_id},${subject},'progress',${'Reabertura '+(decision==='approved'?'aprovada':'recusada')+(note?': '+note:'')})`;
  await notifyMembers(org,subject,[pending.requester_subject],
   'task.reopen.decided',decision==='approved'?'Reabertura aprovada':'Reabertura recusada',
   'Consulte o resultado na Central de Solicitações e Aprovações.',pending.project_id,pending.task_id);
  return reply(res,200,{decided:true,status:decision});
 }
 const approvalQueue='/api/approvals/queue';
 if(p===approvalQueue&&req.method==='GET'){
  requireManager(role);
  const pending=await sql`SELECT id,name,completion_requested_at,completion_note,owner_subject
    FROM teamhub.projects WHERE organization_id=${org} AND archived_at IS NULL AND completion_status='review' AND (${role==='admin'} OR manager_subject=${subject})
    ORDER BY completion_requested_at,id`;
  return reply(res,200,{projects:pending});
 }
 const completion=/^\/api\/projects\/([0-9a-f-]+)\/completion(?:\/(request|approve|reject|reopen))?$/.exec(p);
 if(completion&&validId(completion[1])){
  if(role==='guest')bad('Histórico de aprovações indisponível ao convidado.',403);
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
   if(action==='request')await requireProjectManagement(projectId);else if(role!=='admin')bad('Apenas administradores podem aprovar, recusar ou reabrir projetos.',403);
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
  await requireProjectManagement(proj.id);
  const members=await sql`SELECT pm.auth_subject FROM teamhub.project_members pm
   JOIN teamhub.memberships m ON m.organization_id=pm.organization_id AND m.auth_subject=pm.auth_subject
   WHERE pm.project_id=${proj.id} AND pm.organization_id=${org} AND m.active=true ORDER BY pm.created_at`;
  return reply(res,200,{access_mode:proj.access_mode,members:members.map(x=>x.auth_subject)});
 }
 if(accessRoute&&validId(accessRoute[1])&&req.method==='PATCH'){
  requireManager(role);
  const proj=await project(org,accessRoute[1]),b=await json(req);
  await requireProjectManagement(proj.id);
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
 const colorAllowed=['blue','violet','green','orange','pink','teal','slate','indigo','coral','gold','mint','charcoal'];
 const legacyColors=['blue','violet','green','orange','pink','teal','slate'];
 const projectEdit=/^\/api\/projects\/([0-9a-f-]+)$/.exec(p);
 if(projectEdit&&validId(projectEdit[1])&&req.method==='DELETE'){
  requireManager(role);
  const id=projectEdit[1];
  await requireProjectManagement(id);
  const closed=await sql`WITH removed AS (
   UPDATE teamhub.projects SET archived_at=now()
   WHERE id=${id} AND organization_id=${org} AND archived_at IS NULL
   RETURNING id
  ), audit AS (
   INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id)
   SELECT ${org}::uuid,${subject},'project.deleted',id FROM removed
   RETURNING id
  ) SELECT removed.id FROM removed JOIN audit ON true`;
  if(!closed.length)bad('Card não encontrado ou já excluído.',404);
  return reply(res,200,{deleted:true,card_id:id});
 }

 if(projectEdit&&validId(projectEdit[1])&&req.method==='PATCH'){
  requireManager(role);
  const proj=await project(org,projectEdit[1]);
  await requireProjectManagement(proj.id);
  const b=await json(req);
  if(Object.keys(b).some(k=>!['card_color','owner_subject','manager_subject','name','description'].includes(k)))bad('Campo inválido.');
  const cardColor=b.card_color===undefined?proj.card_color:b.card_color;
  if(!colorAllowed.includes(cardColor))bad('Cor do card inválida.');
  const owner=b.owner_subject===undefined?proj.owner_subject:(b.owner_subject||null);
  const manager=role==='manager'?subject:(b.manager_subject===undefined?proj.manager_subject:(b.manager_subject||null));
  if(manager&&role==='admin'){const mr=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${manager} AND active=true AND role='manager'`;if(!mr.length)bad('Gestor inválido.',403);}
  if(owner!==null){
   const valid=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${owner} AND active=true`;
   if(!valid.length)bad('Responsável não pertence à organização.',403);
  }
  const name=b.name===undefined?proj.name:String(b.name||'').trim();
  const description=b.description===undefined?proj.description:String(b.description||'').trim();
  if(name.length<2||name.length>160||description.length>1000)bad('Informe um nome e descrição válidos.');
  const rows=await sql`UPDATE teamhub.projects SET name=${name},description=${description},
  card_color=CASE WHEN ${legacyColors.includes(cardColor)} THEN ${legacyColors.includes(cardColor)?cardColor:'blue'} ELSE card_color END,
  card_theme=${cardColor},owner_subject=${owner},manager_subject=${manager}
  WHERE id=${proj.id} AND organization_id=${org}
  RETURNING id,name,COALESCE(card_theme,card_color) AS card_color,owner_subject,manager_subject`;
  if(owner&&owner!==proj.owner_subject)await notifyMembers(org,subject,[owner],'project.assigned','Você recebeu um projeto',name,proj.id);
  await sql`INSERT INTO teamhub.activities(organization_id,actor_subject,action,project_id) VALUES(${org},${subject},'project.updated',${proj.id})`;
  return reply(res,200,{project:rows[0]});
 }
 if(p==='/api/projects'&&req.method==='POST'){
  requireManager(role);const body=await json(req);const name=String(body.name||'').trim();if(name.length<2||name.length>160)bad('Nome entre 2 e 160 caracteres.');
  const cardColor=body.card_color||'blue';
  if(!colorAllowed.includes(cardColor))bad('Cor do card inválida.');
  const owner=body.owner_subject||null;
  const manager=role==='manager'?subject:(body.manager_subject||null);
  if(manager&&role==='admin'){const mr=await sql`SELECT 1 FROM teamhub.memberships WHERE organization_id=${org} AND auth_subject=${manager} AND active=true AND role='manager'`;if(!mr.length)bad('Gestor inválido.',403);}
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
   INSERT INTO teamhub.projects(organization_id,name,description,card_color,card_theme,owner_subject,manager_subject)
   VALUES(${org},${name},${String(body.description||'').slice(0,1000)},${legacyColors.includes(cardColor)?cardColor:'blue'},${cardColor},${owner},${manager})
   RETURNING id,name,description,COALESCE(card_theme,card_color) AS card_color,owner_subject,manager_subject
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
  await requireProjectManagement(proj.id);
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
   await requireProjectManagement(parent[0].project_id);
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
  await requireSubtaskExecution(subEdit[1]);
  const rows=await sql`SELECT id,task_id,title,status,priority,owner_subject,due_at FROM teamhub.subtasks WHERE id=${subEdit[1]} AND organization_id=${org}`;
  if(!rows.length)bad('Subtarefa não encontrada.',404);
  const prev=rows[0],b=await json(req);
  if(prev.status==='done')bad('Subtarefa concluída: alterações bloqueadas.',409);
  const [subContext]=await sql`SELECT project_id FROM teamhub.subtasks WHERE id=${prev.id} AND organization_id=${org}`;
  if(!(await canManageProject(subContext.project_id))&&Object.keys(b).some(k=>k!=='status'))bad('Responsável só pode alterar a etapa da subtarefa.',403);
  if(prev.status==='done'&&b.status!==undefined&&b.status!=='done')bad('Subtarefa concluída: solicite análise do gestor.',409);
  if(Object.keys(b).some(k=>!['title','status','priority','owner_subject','assignees','due_at'].includes(k)))bad('Campo inválido.');
  const assignees=b.assignees===undefined?null:await checkAssignees(org,b.assignees);
  if(assignees!==null)await verifyProjectRecipients(org,subContext.project_id,assignees);
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
  const [task]=await sql`SELECT id,project_id,title,status,paused_at,archived_at,deleted_at FROM teamhub.tasks WHERE id=${lifecycle[1]} AND organization_id=${org}`;
  if(!task||task.deleted_at)bad('Tarefa não encontrada.',404);
  const act=lifecycle[2];
  if(['pause','resume'].includes(act))await requireTaskExecution(task.id);
  else if(act==='delete'){if(role!=='admin')bad('Exclusão exclusiva do administrador.',403);}
  else await requireProjectManagement(task.project_id);
  if(task.status==='done'&&['pause','resume'].includes(act))bad('Tarefa concluída: solicite reabertura.',409);
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
  if(!['admin','manager'].includes(role))bad('Relatórios gerenciais indisponíveis.',403);
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
  const reportIds=new Set(role==='admin'?rows.map(x=>x.project_id):(await sql`SELECT id FROM teamhub.projects WHERE organization_id=${org} AND manager_subject=${subject}`).map(x=>x.id));
  return reply(res,200,{projects:rows.filter(x=>reportIds.has(x.project_id)),
   tasks:taskRows.filter(x=>reportIds.has(x.project_id)),
   subtasks:subtaskRows.filter(x=>reportIds.has(x.project_id)),
   pauses:pauses.filter(x=>reportIds.has(x.project_id)),
   approvals:approvals.filter(x=>reportIds.has(x.project_id)),
   generated_at:new Date().toISOString()});
 }
 // Reordenação dentro de um projeto: operação atômica, escopada à organização.
 const taskOrder=/^\/api\/projects\/([0-9a-f-]+)\/tasks\/order$/.exec(p);
 if(taskOrder&&validId(taskOrder[1])&&req.method==='PATCH'){
  requireEditor(role);
  const proj=await project(org,taskOrder[1]);
  await requireProjectManagement(proj.id);
  if(proj.completion_status!=='active'||proj.paused_at)bad('Projeto em pausa, validação ou concluído: não é possível reordenar.',409);
  const b=await json(req),ids=b.task_ids;
  if(!Array.isArray(ids)||ids.length>200||ids.some(id=>typeof id!=='string'||!validId(id))||new Set(ids).size!==ids.length){
   bad('Informe a ordem válida das tarefas.',400);
  }
  const existing=await sql`SELECT id FROM teamhub.tasks
   WHERE organization_id=${org} AND project_id=${proj.id} AND deleted_at IS NULL AND archived_at IS NULL`;
  const allowed=new Set(existing.map(x=>x.id));
  if(ids.length!==allowed.size||ids.some(id=>!allowed.has(id)))bad('A lista de tarefas mudou. Atualize o projeto antes de reordenar.',409);
  if(ids.length){
   const rows=await sql`WITH ord AS(
     SELECT value::uuid AS id,ordinality::integer AS pos
     FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) WITH ORDINALITY
    )
    UPDATE teamhub.tasks t SET position=ord.pos,updated_at=now()
    FROM ord WHERE t.id=ord.id AND t.organization_id=${org} AND t.project_id=${proj.id}
     AND t.deleted_at IS NULL AND t.archived_at IS NULL
    RETURNING t.id`;
   if(rows.length!==ids.length)bad('Não foi possível aplicar toda a ordenação.',409);
  }
  return reply(res,200,{saved:true,count:ids.length});
 }
 const archivedList=/^\/api\/projects\/([0-9a-f-]+)\/tasks\/archived$/.exec(p);
 if(archivedList&&validId(archivedList[1])&&req.method==='GET'){
  await requireProjectManagement(archivedList[1]);
  const rows=await sql`SELECT id,title,status,archived_at FROM teamhub.tasks
   WHERE organization_id=${org} AND project_id=${archivedList[1]}
    AND archived_at IS NOT NULL AND deleted_at IS NULL ORDER BY archived_at DESC LIMIT 200`;
  return reply(res,200,{tasks:rows});
 }
 const pm=/^\/api\/projects\/([0-9a-f-]+)\/tasks$/.exec(p);
 if(pm&&validId(pm[1])){
  const proj=await project(org,pm[1]);
  if(req.method==='GET'){
   const tasks=await sql`SELECT t.id,t.title,t.description,t.status,t.priority,t.assignee_subject,t.due_at,t.position,t.created_at,t.treatment_status,t.treatment_notes,t.pending_reason,t.next_action,t.paused_at,t.archived_at,t.deleted_at,t.labels,(SELECT count(*)::int FROM teamhub.subtasks st WHERE st.organization_id=t.organization_id AND st.task_id=t.id) AS subtask_total,(SELECT count(*)::int FROM teamhub.subtasks st WHERE st.organization_id=t.organization_id AND st.task_id=t.id AND st.status='done') AS subtask_done,COALESCE((SELECT jsonb_agg(a.auth_subject ORDER BY a.auth_subject) FROM teamhub.task_assignees a WHERE a.task_id=t.id AND a.organization_id=t.organization_id),'[]'::jsonb) AS assignees FROM teamhub.tasks t WHERE t.organization_id=${org} AND t.project_id=${proj.id} AND t.deleted_at IS NULL AND t.archived_at IS NULL ORDER BY t.position,t.created_at`;
   return reply(res,200,{project:proj,tasks,role});
  }
  if(req.method==='POST'){
   await requireProjectManagement(proj.id);const b=await json(req),title=String(b.title||'').trim();
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
   const info=await requireTaskExecution(taskId);
   if(info.status==='done')bad('Tarefa concluída: anexos bloqueados.',409);
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
    const info=await requireTaskExecution(taskId);
    if(info.status==='done')bad('Tarefa concluída: anexos bloqueados.',409);
    const rows=await sql`DELETE FROM teamhub.task_attachments WHERE id=${attachFile[2]} AND task_id=${taskId}
      AND organization_id=${org} AND (${role==='admin'||(await canManageProject(task[0].project_id))} OR uploaded_by_subject=${subject}) RETURNING id,file_name`;
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
  const info=await requireTaskExecution(hm[1]);
  if(info.status==='done')bad('Tarefa concluída: comentários bloqueados.',409);
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
  const context=await requireTaskExecution(tm[1]);const b=await json(req);
  if(context.status==='done')bad('Tarefa concluída: solicite reabertura para continuar a execução.',409);
  if(!(await canManageProject(context.project_id))&&Object.keys(b).some(k=>!['status','update_note'].includes(k)))bad('Responsável só pode alterar etapa e andamento.',403);
  if(context.status==='done'&&b.status!==undefined&&b.status!=='done')bad('Reabertura exige decisão na Central.',409);
  if(context.paused_at&&b.status!==undefined)bad('Retome a tarefa antes de alterar a etapa.',409);
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
http.createServer((req,res)=>Promise.resolve(route(req,res)).catch(e=>reply(res,e.status||500,{error:e.status?e.message:'Erro interno'}))).listen(port,'0.0.0.0',()=>{
 console.log('AnnA Nexus na porta',port);
 // No plano Free, o Render pode suspender o processo: esta rotina é best-effort.
 setTimeout(()=>runScheduledDeadlines().catch(()=>{}),25000).unref();
 setInterval(()=>runScheduledDeadlines().catch(()=>{}),15*60*1000).unref();
 setTimeout(()=>processEmailOutbox().catch(()=>{}),40000).unref();
 setTimeout(()=>retryCardAssignmentEmails().catch(()=>{}),55000).unref();
 setInterval(()=>processEmailOutbox().catch(()=>{}),10*60*1000).unref();
 setInterval(()=>retryCardAssignmentEmails().catch(()=>{}),10*60*1000).unref();
});
