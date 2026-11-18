import {randomBytes,createHash} from 'node:crypto';
const fail=(s,n=400)=>{throw Object.assign(Error(s),{status:n})};
const amount=(x,z=false)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<0||(!z&&x===0)||x>1e9||Math.abs(x*1000-Math.round(x*1000))>0.0001)fail('Quantidade inválida.');return x};
const day=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x)))fail('Data inválida.');return x};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function handleProduction(c){
 const {req,res,p,org,subject,role,sql,reply,json,canManageProject,notifyMembers,dispatchInvitationEmail,sendEmail,NEXUS_INVITE_URL}=c;
 const m=/^\/api\/production\/([0-9a-f-]+)(?:\/(.*))?$/.exec(p);
 if(p!=='/api/production'&&!m)return false;
 if(p==='/api/production'){
  if(req.method!=='POST'||!['admin','manager'].includes(role))fail('Operação reservada ao gestor.',403);
  const b=await json(req),name=String(b.name||'').trim(),unit=String(b.unit||'').trim();
  if(name.length<2||name.length>160||!unit||unit.length>32)fail('Nome ou unidade inválidos.');
  const target=amount(b.target),due=day(b.due_date);
  const mode=b.goal_mode||'collective',actor=b.quality_actor||'operator';
  if(!['collective','individual'].includes(mode)||!['operator','inspector'].includes(actor))fail('Configurações inválidas.');
  const shifts=Array.isArray(b.shifts)?b.shifts:[];
  if(shifts.length>8||shifts.some(s=>!s.name||s.name.length>40||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.start)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.end)||s.start===s.end))fail('Turnos inválidos.');
  const created=await sql`WITH p AS(
   INSERT INTO teamhub.projects(organization_id,name,description,card_color,card_theme,manager_subject,access_mode,card_type)
   VALUES(${org},${name},${String(b.description||'').slice(0,1000)},'teal','teal',${role==='manager'?subject:null},'restricted','production') RETURNING id,name
  ), s AS(
   INSERT INTO teamhub.production_settings(organization_id,project_id,target,unit,due_date,goal_mode,approval_required,quality_enabled,quality_actor,shifts)
   SELECT ${org}::uuid,p.id,${target},${unit},${due},${mode},${b.approval_required===true},${b.quality_enabled===true},${actor},${JSON.stringify(shifts)}::jsonb FROM p RETURNING project_id
  ) SELECT p.id,p.name FROM p JOIN s ON p.id=s.project_id`;
  reply(res,201,{card:created[0]});return true;
 }
 const id=m[1],action=m[2]||'';
 if(!UUID.test(id))fail('Card inválido.');
 const rows=await sql`SELECT p.id,p.name,p.completion_status,s.* FROM teamhub.projects p
  JOIN teamhub.production_settings s ON s.project_id=p.id AND s.organization_id=p.organization_id
  WHERE p.id=${id} AND p.organization_id=${org} AND p.archived_at IS NULL`;
 if(!rows.length)fail('Card de produção inexistente.',404);
 const card=rows[0],manager=await canManageProject(id);
 const mine=await sql`SELECT production_role FROM teamhub.production_assignments
  WHERE organization_id=${org} AND project_id=${id} AND auth_subject=${subject}`;
 const permission=mine[0]?.production_role;
 if(!manager&&!permission)fail('Card não atribuído à sua conta.',403);
 if(req.method==='GET'&&!action){
  const entries=await sql`SELECT e.*,COALESCE((SELECT SUM(r.approved) FROM teamhub.production_rework r WHERE r.entry_id=e.id),0) AS rework_approved,
   COALESCE((SELECT SUM(r.rejected) FROM teamhub.production_rework r WHERE r.entry_id=e.id),0) AS rework_rejected
   FROM teamhub.production_entries e WHERE e.organization_id=${org} AND e.project_id=${id} ORDER BY e.created_at DESC LIMIT 300`;
  const assignments=await sql`SELECT a.*,pr.display_name,pr.email FROM teamhub.production_assignments a
   LEFT JOIN teamhub.member_profiles pr ON pr.auth_subject=a.auth_subject
   WHERE a.organization_id=${org} AND a.project_id=${id}`;
  const totals=await sql`SELECT
   COALESCE(SUM(CASE WHEN e.status='approved' THEN COALESCE(e.quality_approved,e.quantity) ELSE 0 END),0) AS original,
   COALESCE(SUM(CASE WHEN e.status IN ('pending','awaiting_quality') THEN e.quantity ELSE 0 END),0) AS pending
   FROM teamhub.production_entries e WHERE e.organization_id=${org} AND e.project_id=${id}`;
  const reworks=await sql`SELECT COALESCE(SUM(approved),0) AS approved FROM teamhub.production_rework
   WHERE organization_id=${org} AND project_id=${id}`;
  const summary={approved:Number(totals[0].original)+Number(reworks[0].approved),pending:Number(totals[0].pending)};
  reply(res,200,{summary,card,manager,permission,entries:manager||permission==='inspector'?entries:entries.filter(e=>e.author_subject===subject),
   assignments:manager?assignments:assignments.filter(a=>a.auth_subject===subject)});return true;
 }
 if(req.method==='POST'&&action==='entries'){
  if(!manager&&permission!=='operator')fail('Apenas operadores autorizados.',403);
  if(card.completion_status!=='active')fail('Card encerrado.',409);
  const b=await json(req),q=amount(b.quantity),dt=day(b.operational_date),shift=b.shift_name||null;
  if((shift&&!card.shifts.some(s=>s.name===shift))||(!shift&&card.shifts.length))fail('Turno inválido.');
  if(!UUID.test(b.request_id||''))fail('Identificador de lançamento inválido.');
  let a=null,r=null,w=null,checker=null,status=card.quality_enabled?'awaiting_quality':card.approval_required?'pending':'approved';
  if(card.quality_enabled&&card.quality_actor==='operator'){
   a=amount(b.approved,true);r=amount(b.rejected,true);w=amount(b.rework,true);
   if(Math.abs(a+r+w-q)>0.0001)fail('A soma da qualidade deve ser igual à produção.');
   checker=subject;status=card.approval_required?'pending':'approved';
  }
  const done=await sql`INSERT INTO teamhub.production_entries(organization_id,project_id,author_subject,quantity,operational_date,shift_name,
   quality_approved,quality_rejected,quality_rework,quality_by_subject,quality_at,status,client_request_id)
   VALUES(${org},${id},${subject},${q},${dt},${shift},${a},${r},${w},${checker},${checker?new Date().toISOString():null},${status},${b.request_id}::uuid)
   ON CONFLICT(organization_id,project_id,client_request_id) DO NOTHING RETURNING id,status`;
  if(!done.length)fail('Lançamento já recebido.',409);
  await sql`INSERT INTO teamhub.production_audit(organization_id,project_id,entry_id,actor_subject,action)
   VALUES(${org},${id},${done[0].id},${subject},'registered')`;
  reply(res,201,{entry:done[0]});return true;
 }
 const em=/^entries\/([0-9a-f-]+)\/(quality|decide|rework)$/.exec(action);
 if(req.method==='POST'&&em){
  const eid=em[1],op=em[2],b=await json(req);
  if(!UUID.test(eid))fail('Registro inválido.');
  const rows=await sql`SELECT * FROM teamhub.production_entries WHERE id=${eid} AND organization_id=${org} AND project_id=${id}`;
  if(!rows.length)fail('Registro não encontrado.',404);
  const e=rows[0];
  if(op==='quality'){
   if(!card.quality_enabled||card.quality_actor!=='inspector'||e.status!=='awaiting_quality'||(!manager&&permission!=='inspector'))fail('Conferência não permitida.',403);
   const a=amount(b.approved,true),r=amount(b.rejected,true),w=amount(b.rework,true);
   if(Math.abs(a+r+w-Number(e.quantity))>0.0001)fail('Classificação divergente.');
   const out=await sql`UPDATE teamhub.production_entries SET quality_approved=${a},quality_rejected=${r},quality_rework=${w},
    quality_by_subject=${subject},quality_at=now(),status=${card.approval_required?'pending':'approved'}
    WHERE id=${eid} AND status='awaiting_quality' RETURNING id`;
   if(!out.length)fail('Registro já conferido.',409);
  }else if(op==='decide'){
   if(!manager||!card.approval_required||e.status!=='pending'||!['approved','rejected'].includes(b.decision))fail('Aprovação não permitida.',403);
   const note=String(b.note||'').trim().slice(0,500);
   if(b.decision==='rejected'&&note.length<3)fail('Informe a justificativa.');
   const out=await sql`UPDATE teamhub.production_entries SET status=${b.decision},decided_by_subject=${subject},
    decided_at=now(),decision_note=${note} WHERE id=${eid} AND status='pending' RETURNING id`;
   if(!out.length)fail('Registro já decidido.',409);
  }else{
   if(!manager||!card.quality_enabled||e.status!=='approved')fail('Retrabalho não permitido.',403);
   const a=amount(b.approved,true),r=amount(b.rejected,true);
   if(a+r<=0)fail('Informe a quantidade retrabalhada.');
   const used=await sql`SELECT COALESCE(SUM(approved+rejected),0) AS used FROM teamhub.production_rework WHERE entry_id=${eid}`;
   if(Number(used[0].used)+a+r>Number(e.quality_rework)+0.0001)fail('Retrabalho excede o saldo.',409);
   await sql`INSERT INTO teamhub.production_rework(organization_id,project_id,entry_id,approved,rejected,operator_subject)
    VALUES(${org},${id},${eid},${a},${r},${subject})`;
  }
  await sql`INSERT INTO teamhub.production_audit(organization_id,project_id,entry_id,actor_subject,action)
   VALUES(${org},${id},${eid},${subject},${op})`;
  reply(res,200,{ok:true});return true;
 }
 if(req.method==='POST'&&action==='assign'){
  if(!manager)fail('Somente gestor atribui funcionários.',403);
  const b=await json(req),email=String(b.email||'').trim().toLowerCase(),productionRole=b.production_role||'operator';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!['operator','inspector','viewer'].includes(productionRole))fail('Destinatário ou função inválida.');
  const individual=b.individual_target==null?null:amount(b.individual_target,true);
  if(individual!==null&&card.goal_mode!=='individual')fail('Card com meta coletiva.');
  if(card.goal_mode==='individual'){
   if(individual===null)fail('Informe a meta individual para este funcionário.');
   const assigned=await sql`SELECT COALESCE(SUM(individual_target),0) AS allocated
    FROM teamhub.production_assignments WHERE organization_id=${org} AND project_id=${id}`;
   const reserved=await sql`SELECT COALESCE(SUM(individual_target),0) AS allocated
    FROM teamhub.invitations WHERE organization_id=${org} AND project_id=${id}
      AND status='pending' AND expires_at>now()`;
   if(Number(assigned[0].allocated)+Number(reserved[0].allocated)+individual>Number(card.target)+0.0001)
    fail('A soma das metas individuais ultrapassaria a meta geral.',409);
  }
  const persons=await sql`SELECT m.auth_subject,m.active FROM teamhub.memberships m JOIN teamhub.member_profiles pr
   ON pr.auth_subject=m.auth_subject WHERE m.organization_id=${org} AND lower(pr.email)=${email} LIMIT 1`;
  if(persons.length){
   if(!persons[0].active)fail('Funcionário inativo: solicite reativação.',409);
   const worker=persons[0].auth_subject;
   const inserted=await sql`INSERT INTO teamhub.production_assignments(organization_id,project_id,auth_subject,production_role,individual_target)
    VALUES(${org},${id},${worker},${productionRole},${individual}) ON CONFLICT DO NOTHING RETURNING auth_subject`;
   if(!inserted.length)fail('Funcionário já atribuído.',409);
   await sql`INSERT INTO teamhub.project_members(organization_id,project_id,auth_subject,added_by_subject)
    VALUES(${org},${id},${worker},${subject}) ON CONFLICT DO NOTHING`;
   await notifyMembers(org,subject,[worker],'project.assigned','Novo card atribuído',card.name,id);
   const notice=await sql`INSERT INTO teamhub.card_email_notices(organization_id,project_id,recipient_subject,recipient_email)
    VALUES(${org},${id},${worker},${email}) ON CONFLICT DO NOTHING RETURNING id`;
   let emailStatus='previously_notified';
   if(notice.length){
    const orgName=await sql`SELECT name FROM teamhub.organizations WHERE id=${org}`;
    const result=await sendEmail(email,card.name,orgName[0]?.name||'AnnA One',id,notice[0].id);
    emailStatus=result.status;
    await sql`UPDATE teamhub.card_email_notices SET status=${result.status},provider_id=${result.id||null},
     error_message=${result.error||null} WHERE id=${notice[0].id}`;
   }
   reply(res,201,{assignment:'existing',email_status:emailStatus});return true;
  }
  const pending=await sql`SELECT id FROM teamhub.invitations WHERE organization_id=${org} AND email=${email} AND status='pending' AND expires_at>now()`;
  if(pending.length)fail('Já existe convite pendente para este e-mail.',409);
  const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
  const invited=await sql`INSERT INTO teamhub.invitations(organization_id,email,role,token_hash,invited_by_subject,expires_at,project_id,production_role,individual_target)
   VALUES(${org},${email},'member',${hash},${subject},now()+interval '7 days',${id},${productionRole},${individual}) RETURNING id`;
  const orgData=await sql`SELECT name,logo_url FROM teamhub.organizations WHERE id=${org}`;
  const link=NEXUS_INVITE_URL+'#invite='+token;
  const result=await dispatchInvitationEmail({invitationId:invited[0].id,email,role:'member',inviteUrl:link,
   organizationName:(orgData[0]?.name||'AnnA One')+' · '+card.name,logoUrl:orgData[0]?.logo_url||''});
  reply(res,201,{assignment:'invited',email_status:result.email_status,invite_url:link});return true;
 }
 if(req.method==='POST'&&action==='remove'){
  if(!manager)fail('Somente gestor remove atribuições.',403);
  const b=await json(req),worker=String(b.subject||'');
  if(worker===subject)fail('Não é permitido remover o próprio acesso por esta tela.',409);
  const removed=await sql`DELETE FROM teamhub.production_assignments
   WHERE organization_id=${org} AND project_id=${id} AND auth_subject=${worker} RETURNING auth_subject`;
  if(!removed.length)fail('Atribuição não encontrada.',404);
  await sql`DELETE FROM teamhub.project_members WHERE organization_id=${org} AND project_id=${id} AND auth_subject=${worker}`;
  await sql`INSERT INTO teamhub.production_audit(organization_id,project_id,actor_subject,action,details)
    VALUES(${org},${id},${subject},'member.removed',${JSON.stringify({worker})}::jsonb)`;
  reply(res,200,{removed:true});return true;
 }
 fail('Operação inválida.',404);
}
