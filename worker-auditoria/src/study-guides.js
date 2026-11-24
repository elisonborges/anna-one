import { neon } from "@neondatabase/serverless";
import { verifyBearer } from "./auth.js";

const reply=(body,status=200,cors={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...cors}});
const uuid=x=>typeof x==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
const date=x=>x===null||x===""||typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x);
export async function handleStudyGuides(request,env,cors,url){
  let identity;
  try{identity=await verifyBearer(request,env)}catch{return reply({error:"Autenticação central necessária"},401,cors)}
  if(!env.DATABASE_URL)return reply({error:"Banco central indisponível"},503,cors);
  const sql=neon(env.DATABASE_URL),user=identity.userId;
  try{
    const master=await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${user}::uuid) AS ok`;
    const isMaster=master[0]?.ok===true;
    const grants=isMaster?await sql`SELECT id AS institution_id,name,'master' AS role FROM public.institutions WHERE status='active' ORDER BY name`:await sql`SELECT m.institution_id,m.role,i.name FROM public.memberships m
      JOIN public.institutions i ON i.id=m.institution_id
      JOIN public.institution_modules im ON im.institution_id=i.id AND im.enabled=true
      JOIN public.modules mo ON mo.id=im.module_id AND mo.code='agenda' AND mo.status='available'
      LEFT JOIN public.institutions parent ON parent.id=i.parent_institution_id
      LEFT JOIN public.institution_modules pim ON pim.institution_id=parent.id AND pim.module_id=mo.id
      LEFT JOIN public.user_module_permissions up ON up.institution_id=i.id AND up.module_id=mo.id AND up.user_id=m.user_id
      WHERE m.user_id=${user}::uuid AND m.active=true AND i.status='active'
        AND (parent.id IS NULL OR (parent.status='active' AND pim.enabled=true))
        AND ((m.role='institution_admin' AND NOT EXISTS(
          SELECT 1 FROM public.user_module_permissions p WHERE p.institution_id=i.id AND p.user_id=m.user_id
        )) OR up.enabled=true)`;
    if(!grants.length)return isMaster&&request.method==="GET"&&url.pathname==="/v1/agenda/study-guides"?reply({is_master:true,manager:true,institution:null,institutions:[],guides:[],subjects:[]},200,cors):reply({error:isMaster?"Cadastre uma instituição antes de criar roteiros":"Sem acesso institucional à Agenda"},403,cors);
    const institution=url.searchParams.get("institution_id")||grants[0].institution_id;
    const grant=grants.find(g=>g.institution_id===institution);
    if(!grant)return reply({error:"Instituição não autorizada"},403,cors);
    const manager=isMaster||["institution_admin","manager","coordinator","coordenacao","coordenador"].includes(grant.role);
    const base="/v1/agenda/study-guides";
    if(url.pathname===base+"/daily-entries"){
      if(request.method==="GET"){
        const assignments=await sql`SELECT id,grade,classroom,subject,academic_year FROM public.agenda_teaching_assignments WHERE institution_id=${institution}::uuid AND active=true AND teacher_user_id=${user}::uuid ORDER BY grade,classroom,subject`;
        const entries=await sql`SELECT e.*,a.grade,a.classroom,a.subject FROM public.agenda_daily_entries e JOIN public.agenda_teaching_assignments a ON a.id=e.assignment_id WHERE a.institution_id=${institution}::uuid AND (e.author_id=${user}::uuid OR (${manager} AND e.status<>'draft')) ORDER BY e.agenda_date DESC LIMIT 200`;
        return reply({assignments,entries,manager},200,cors);
      }
      const b=await request.json().catch(()=>null);
      const fields=v=>({classContent:clean(v?.classContent,12000),classActivity:clean(v?.classActivity,12000),homeActivity:clean(v?.homeActivity,12000)});
      if(request.method==="POST"){
        if(!uuid(b?.assignment_id)||typeof b.agenda_date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(b.agenda_date))return reply({error:"Registro inválido"},400,cors);
        const content=fields(b.content);
        if(!Object.values(content).some(Boolean))return reply({error:"Preencha o conteúdo"},400,cors);
        const rows=await sql`INSERT INTO public.agenda_daily_entries(assignment_id,author_id,agenda_date,content) SELECT id,${user}::uuid,${b.agenda_date}::date,${JSON.stringify(content)}::jsonb FROM public.agenda_teaching_assignments WHERE id=${b.assignment_id}::uuid AND institution_id=${institution}::uuid AND teacher_user_id=${user}::uuid AND active=true AND academic_year=EXTRACT(YEAR FROM ${b.agenda_date}::date) ON CONFLICT(assignment_id,agenda_date) DO NOTHING RETURNING id`;
        return reply(rows.length?rows[0]:{error:"Vínculo inválido ou agenda já existente"},rows.length?201:409,cors);
      }
      if(request.method==="PATCH"){
        if(!uuid(b?.id))return reply({error:"Registro inválido"},400,cors);
        let rows;
        if(b.action==="save"||b.action==="submit"){
          const content=fields(b.content);
          if(!Object.values(content).some(Boolean))return reply({error:"Preencha o conteúdo"},400,cors);
          rows=await sql`UPDATE public.agenda_daily_entries e SET content=${JSON.stringify(content)}::jsonb,status=${b.action==="submit"?"submitted":"draft"},review_content=NULL,reviewer_id=NULL,review_note=NULL,updated_at=now() FROM public.agenda_teaching_assignments a WHERE a.id=e.assignment_id AND a.institution_id=${institution}::uuid AND a.active=true AND a.teacher_user_id=${user}::uuid AND e.author_id=${user}::uuid AND e.id=${b.id}::uuid AND e.status IN ('draft','needs_clarification') RETURNING e.id`;
        }else if(manager&&(b.action==="approve"||b.action==="return")){
          const content=fields(b.content),note=clean(b.note,2000);
          if(b.action==="return"&&!note||b.action==="approve"&&!Object.values(content).some(Boolean))return reply({error:"Informe revisão ou justificativa"},400,cors);
          rows=await sql`UPDATE public.agenda_daily_entries e SET status=${b.action==="approve"?"approved":"needs_clarification"},review_content=${JSON.stringify(content)}::jsonb,reviewer_id=${user}::uuid,review_note=${note},updated_at=now() FROM public.agenda_teaching_assignments a WHERE a.id=e.assignment_id AND a.institution_id=${institution}::uuid AND e.id=${b.id}::uuid AND e.status='submitted' RETURNING e.id`;
        }else return reply({error:"Ação não autorizada"},403,cors);
        return reply(rows.length?rows[0]:{error:"Registro indisponível para esta ação"},rows.length?200:409,cors);
      }
      return reply({error:"Método não permitido"},405,cors);
    }
    if(url.pathname===base+"/distribution"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      if(request.method==="GET"){
        const documents=await sql`SELECT id,content->'fields'->>'titulo' AS title FROM public.agenda_communications_central WHERE institution_id=${institution}::uuid AND status='approved' ORDER BY updated_at DESC LIMIT 100`;
        const recipients=await sql`SELECT DISTINCT m.user_id,u.display_name,m.role FROM public.memberships m JOIN public.app_users u ON u.id=m.user_id WHERE m.institution_id=${institution}::uuid AND m.active=true AND u.email IS NOT NULL AND u.email<>'' ORDER BY u.display_name`;
        const history=await sql`SELECT q.id,q.status,q.scheduled_at,q.sent_at,q.error,q.attempts,u.display_name,d.content->'fields'->>'titulo' AS title FROM public.agenda_distribution q JOIN public.app_users u ON u.id=q.recipient_id JOIN public.agenda_communications_central d ON d.id=q.document_id WHERE q.institution_id=${institution}::uuid ORDER BY q.created_at DESC LIMIT 200`;
        return reply({documents,recipients,history,delivery_enabled:env.AGENDA_DISTRIBUTION_ENABLED==="true"},200,cors);
      }
      const b=await request.json().catch(()=>null);
      if(request.method==="POST"){
        if(!uuid(b?.document_id)||!Array.isArray(b.recipient_ids)||!b.recipient_ids.length||b.recipient_ids.length>50||!b.recipient_ids.every(uuid)||!Number.isFinite(Date.parse(b.scheduled_at)))return reply({error:"Envio inválido"},400,cors);
        const rows=await sql`INSERT INTO public.agenda_distribution(institution_id,document_id,created_by,recipient_id,scheduled_at)
        SELECT d.institution_id,d.id,${user}::uuid,m.user_id,GREATEST(now(),${b.scheduled_at}::timestamptz) FROM public.agenda_communications_central d JOIN public.memberships m ON m.institution_id=d.institution_id AND m.active=true JOIN public.app_users u ON u.id=m.user_id WHERE d.id=${b.document_id}::uuid AND d.institution_id=${institution}::uuid AND d.status='approved' AND m.user_id=ANY(${b.recipient_ids}::uuid[]) AND u.email IS NOT NULL AND u.email<>'' ON CONFLICT DO NOTHING RETURNING id`;
        return reply({queued:rows.length},200,cors);
      }
      if(request.method==="PATCH"){
        if(!uuid(b?.id)||!["cancel","retry"].includes(b.action))return reply({error:"Ação inválida"},400,cors);
        const rows=await sql`UPDATE public.agenda_distribution SET status=CASE WHEN ${b.action}='cancel' THEN 'cancelled' ELSE 'pending' END,scheduled_at=now(),error=NULL WHERE id=${b.id}::uuid AND institution_id=${institution}::uuid AND ((${b.action}='cancel' AND status='pending') OR (${b.action}='retry' AND status='failed' AND attempts<3)) RETURNING id`;
        return rows.length?reply({saved:true},200,cors):reply({error:"Ação indisponível"},409,cors);
      }
    }
    if(url.pathname===base+"/communications"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      if(request.method==="GET"){
        const documents=await sql`SELECT id,content,status,updated_at FROM public.agenda_communications_central WHERE institution_id=${institution}::uuid ORDER BY updated_at DESC LIMIT 100`;
        const events=await sql`SELECT DISTINCT g.grade,g.classroom,g.academic_year,s.exam_date AS date,s.subject,g.title FROM public.agenda_study_guides g JOIN public.agenda_study_guide_subjects s ON s.guide_id=g.id WHERE g.institution_id=${institution}::uuid AND g.status='published' AND s.exam_date IS NOT NULL ORDER BY s.exam_date LIMIT 500`;
        return reply({documents,events},200,cors);
      }
      if(request.method==="POST"||request.method==="PATCH"){
        const b=await request.json().catch(()=>null);
        if(!b||!b.fields||!clean(b.fields.titulo,200)||!["Aviso","Comunicado","Circular"].includes(b.fields.tipo))return reply({error:"Documento inválido"},400,cors);
        const fields={};for(const k of ["tipo","numero","modelo","escola","data","destino","titulo","texto","eventos","assinatura","cargo","rodape","grade","classroom"])fields[k]=clean(b.fields[k],k==="texto"||k==="eventos"?20000:300);
        fields.escola=grant.name;
        const state=b.status||"draft";if(!["draft","review","approved"].includes(state))return reply({error:"Situação inválida"},400,cors);
        const content=JSON.stringify({fields});
        if(request.method==="POST"){
          if(state!=="draft")return reply({error:"Salve o rascunho primeiro"},400,cors);
          const rows=await sql`INSERT INTO public.agenda_communications_central(institution_id,author_id,content) VALUES (${institution}::uuid,${user}::uuid,${content}::jsonb) RETURNING id,status`;
          return reply(rows[0],201,cors);
        }
        if(!uuid(b.id))return reply({error:"Documento inválido"},400,cors);
        const rows=await sql`UPDATE public.agenda_communications_central SET content=CASE WHEN status='review' AND ${state}='approved' THEN content ELSE ${content}::jsonb END,status=${state},updated_at=now() WHERE id=${b.id}::uuid AND institution_id=${institution}::uuid AND ((status='draft' AND ${state} IN ('draft','review')) OR (status='review' AND ${state} IN ('draft','approved'))) RETURNING id,status`;
        return rows.length?reply(rows[0],200,cors):reply({error:"Documento indisponível ou aprovado"},409,cors);
      }
    }
    if(url.pathname===base+"/notifications/reminders"&&request.method==="POST"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      const rows=await sql`INSERT INTO public.agenda_notifications(institution_id,recipient_id,guide_id,event_key,title,message)
      SELECT g.institution_id,s.teacher_user_id,g.id,s.id::text||':'||g.deadline::text||':'||CASE WHEN g.deadline < (now() AT TIME ZONE 'America/Fortaleza')::date THEN 'late' ELSE 'due' END,
      CASE WHEN g.deadline < (now() AT TIME ZONE 'America/Fortaleza')::date THEN 'Prazo vencido' ELSE 'Prazo próximo' END,g.title||' · '||s.subject
      FROM public.agenda_study_guides g JOIN public.agenda_study_guide_subjects s ON s.guide_id=g.id JOIN public.memberships m ON m.institution_id=g.institution_id AND m.user_id=s.teacher_user_id AND m.active=true
      WHERE g.institution_id=${institution}::uuid AND g.status IN ('open','review') AND s.status IN ('pending','revision') AND g.deadline <= (now() AT TIME ZONE 'America/Fortaleza')::date+2 ON CONFLICT DO NOTHING RETURNING id`;
      return reply({created:rows.length},200,cors);
    }
    if(url.pathname===base+"/notifications"){
      if(request.method==="GET"){
        const notifications=await sql`SELECT id,guide_id,title,message,created_at,read_at FROM public.agenda_notifications WHERE institution_id=${institution}::uuid AND recipient_id=${user}::uuid ORDER BY created_at DESC LIMIT 100`;
        return reply({notifications},200,cors);
      }
      if(request.method==="PATCH"){
        const b=await request.json().catch(()=>null);
        if(!uuid(b?.id))return reply({error:"Notificação inválida"},400,cors);
        await sql`UPDATE public.agenda_notifications SET read_at=COALESCE(read_at,now()) WHERE id=${b.id}::uuid AND institution_id=${institution}::uuid AND recipient_id=${user}::uuid`;
        return reply({saved:true},200,cors);
      }
    }
    if(url.pathname===base+"/assignments"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      if(request.method==="GET"){
        const assignments=await sql`SELECT a.*,u.display_name,u.email FROM public.agenda_teaching_assignments a JOIN public.app_users u ON u.id=a.teacher_user_id WHERE a.institution_id=${institution}::uuid ORDER BY a.academic_year DESC,a.grade,a.classroom,a.subject`;
        return reply({assignments},200,cors);
      }
      if(request.method==="POST"){
        const b=await request.json().catch(()=>null);
        if(!b||!uuid(b.teacher_user_id)||!clean(b.grade,80)||!clean(b.subject,120)||!Number.isInteger(b.academic_year)||b.academic_year<2020||b.academic_year>2100)return reply({error:"Atribuição inválida"},400,cors);
        const rows=await sql`INSERT INTO public.agenda_teaching_assignments(institution_id,teacher_user_id,academic_year,grade,classroom,subject)
          SELECT m.institution_id,m.user_id,${b.academic_year},${clean(b.grade,80)},${clean(b.classroom,80)},${clean(b.subject,120)} FROM public.memberships m
          WHERE m.institution_id=${institution}::uuid AND m.user_id=${b.teacher_user_id}::uuid AND m.active=true AND m.role='teacher'
          ON CONFLICT(institution_id,teacher_user_id,academic_year,grade,classroom,subject) DO UPDATE SET active=true RETURNING id`;
        return rows.length?reply({saved:true},200,cors):reply({error:"Professor não vinculado"},403,cors);
      }
      if(request.method==="PATCH"){
        const b=await request.json().catch(()=>null);
        if(!uuid(b?.id)||typeof b.active!=="boolean")return reply({error:"Atribuição inválida"},400,cors);
        const rows=await sql`UPDATE public.agenda_teaching_assignments SET active=${b.active} WHERE id=${b.id}::uuid AND institution_id=${institution}::uuid RETURNING id`;
        return rows.length?reply({saved:true},200,cors):reply({error:"Atribuição não encontrada"},404,cors);
      }
    }
    if(url.pathname===base+"/import-assignments"&&request.method==="POST"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      const b=await request.json().catch(()=>null);
      if(!uuid(b?.guide_id))return reply({error:"Roteiro inválido"},400,cors);
      const rows=await sql`INSERT INTO public.agenda_study_guide_subjects(guide_id,subject,teacher_user_id)
        SELECT DISTINCT g.id,a.subject,a.teacher_user_id FROM public.agenda_study_guides g JOIN public.agenda_teaching_assignments a ON a.institution_id=g.institution_id AND a.academic_year=g.academic_year AND lower(a.grade)=lower(g.grade) AND lower(a.classroom)=lower(g.classroom) AND a.active=true
        JOIN public.memberships m ON m.institution_id=a.institution_id AND m.user_id=a.teacher_user_id AND m.active=true AND m.role='teacher'
        WHERE g.id=${b.guide_id}::uuid AND g.institution_id=${institution}::uuid AND g.status='draft' AND NOT EXISTS(SELECT 1 FROM public.agenda_study_guide_subjects s WHERE s.guide_id=g.id AND lower(s.subject)=lower(a.subject) AND s.teacher_user_id=a.teacher_user_id) RETURNING id`;
      return reply({imported:rows.length},200,cors);
    }
    if(url.pathname===base&&request.method==="GET"){
      const guides=await sql`SELECT id,institution_id,grade,classroom,title,period,academic_year,deadline,status,created_at
        FROM public.agenda_study_guides g WHERE institution_id=${institution}::uuid
        AND (${manager} OR EXISTS(SELECT 1 FROM public.agenda_study_guide_subjects s WHERE s.guide_id=g.id AND g.status<>'draft' AND s.teacher_user_id=${user}::uuid))
        ORDER BY created_at DESC LIMIT 100`;
      const subjects=manager
        ? await sql`SELECT s.id,s.guide_id,s.subject,s.exam_date,s.teacher_user_id,s.topics,s.materials,s.status
            FROM public.agenda_study_guide_subjects s JOIN public.agenda_study_guides g ON g.id=s.guide_id
            WHERE g.institution_id=${institution}::uuid ORDER BY s.exam_date,s.subject`
        : await sql`SELECT s.id,s.guide_id,s.subject,s.exam_date,s.teacher_user_id,s.topics,s.materials,s.status
            FROM public.agenda_study_guide_subjects s JOIN public.agenda_study_guides g ON g.id=s.guide_id
            WHERE g.institution_id=${institution}::uuid AND s.teacher_user_id=${user}::uuid
              AND g.status IN ('open','review','published') ORDER BY s.exam_date,s.subject`;
      return reply({institution:{id:institution,name:grant.name},role:grant.role,is_master:isMaster,institutions:grants,manager,guides,subjects},200,cors);
    }
    if(url.pathname===base+"/teachers"&&request.method==="GET"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      const teachers=await sql`SELECT m.user_id,u.display_name,u.email,m.role FROM public.memberships m
        JOIN public.app_users u ON u.id=m.user_id WHERE m.institution_id=${institution}::uuid AND m.active=true
        ORDER BY u.display_name,u.email LIMIT 250`;
      return reply({teachers},200,cors);
    }
    if(url.pathname===base&&request.method==="POST"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      const body=await request.json().catch(()=>null);
      if(!body||!clean(body.grade,80)||!clean(body.title,160)||!Number.isInteger(Number(body.academic_year))||Number(body.academic_year)<2020||Number(body.academic_year)>2100||!date(body.deadline))
        return reply({error:"Dados do roteiro inválidos"},400,cors);
      const rows=await sql`INSERT INTO public.agenda_study_guides
        (institution_id,grade,classroom,title,period,academic_year,deadline,created_by,status)
        VALUES (${institution}::uuid,${clean(body.grade,80)},${clean(body.classroom,80)},${clean(body.title,160)},
        ${clean(body.period,120)},${Number(body.academic_year)},${body.deadline||null},${user}::uuid,'draft')
        RETURNING id`;
      return reply({id:rows[0].id},201,cors);
    }
    if(url.pathname===base+"/duplicate"&&request.method==="POST"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      const b=await request.json().catch(()=>null);
      if(!uuid(b?.guide_id)||!Number.isInteger(b.academic_year)||b.academic_year<2020||b.academic_year>2100)return reply({error:"Dados inválidos"},400,cors);
      const rows=await sql`WITH source AS (SELECT * FROM public.agenda_study_guides WHERE id=${b.guide_id}::uuid AND institution_id=${institution}::uuid AND status='published'),
      new_guide AS (INSERT INTO public.agenda_study_guides(institution_id,grade,classroom,title,period,academic_year,created_by,status)
      SELECT institution_id,grade,classroom,title,period,${b.academic_year},${user}::uuid,'draft' FROM source
      WHERE NOT EXISTS(SELECT 1 FROM public.agenda_study_guide_subjects s WHERE s.guide_id=source.id AND NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.institution_id=source.institution_id AND m.user_id=s.teacher_user_id AND m.active=true AND m.role='teacher')) RETURNING id),
      copied AS (INSERT INTO public.agenda_study_guide_subjects(guide_id,subject,teacher_user_id,topics,materials,status)
      SELECT n.id,s.subject,s.teacher_user_id,s.topics,s.materials,'pending' FROM new_guide n CROSS JOIN public.agenda_study_guide_subjects s WHERE s.guide_id=${b.guide_id}::uuid RETURNING id)
      SELECT n.id,(SELECT count(*) FROM copied)::integer AS copied FROM new_guide n`;
      return rows.length?reply(rows[0],201,cors):reply({error:"Roteiro indisponível ou professor original sem vínculo ativo"},409,cors);
    }
    const subjectRoute=url.pathname.match(/^\/v1\/agenda\/study-guides\/([0-9a-f-]{36})\/subjects$/);
    if(subjectRoute&&request.method==="POST"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      const body=await request.json().catch(()=>null),guideId=subjectRoute[1];
      if(!uuid(guideId)||!body||!clean(body.subject,120)||!uuid(body.teacher_user_id)||!date(body.exam_date))return reply({error:"Disciplina inválida"},400,cors);
      const rows=await sql`INSERT INTO public.agenda_study_guide_subjects (guide_id,subject,exam_date,teacher_user_id)
        SELECT g.id,${clean(body.subject,120)},${body.exam_date||null},m.user_id
        FROM public.agenda_study_guides g JOIN public.memberships m ON m.institution_id=g.institution_id
        WHERE g.id=${guideId}::uuid AND g.institution_id=${institution}::uuid AND g.status='draft' AND m.user_id=${body.teacher_user_id}::uuid AND m.active=true
        RETURNING id`;
      return rows.length?reply({id:rows[0].id},201,cors):reply({error:"Professor ou roteiro não autorizado"},403,cors);
    }
    const subjectPatch=url.pathname.match(/^\/v1\/agenda\/study-guides\/subjects\/([0-9a-f-]{36})$/);
    if(subjectPatch&&request.method==="PATCH"){
      const id=subjectPatch[1],body=await request.json().catch(()=>null);
      if(!uuid(id)||!body||!["draft","submitted","revision","approved"].includes(body.action))return reply({error:"Atualização inválida"},400,cors);
      if(body.action==="approved"||body.action==="revision"){if(!manager)return reply({error:"Aprovação restrita à coordenação"},403,cors)}
      const status={draft:"pending",submitted:"submitted",revision:"revision",approved:"approved"}[body.action];
      const rows=await sql`WITH changed AS (UPDATE public.agenda_study_guide_subjects s
        SET topics=${clean(body.topics,20000)},materials=${clean(body.materials,20000)},status=${status},updated_at=now()
        FROM public.agenda_study_guides g
        WHERE s.id=${id}::uuid AND s.guide_id=g.id AND g.institution_id=${institution}::uuid
          AND g.status<>'published' AND ( ${manager} OR (s.teacher_user_id=${user}::uuid AND g.status='open' AND ${body.action} IN ('draft','submitted')))
          AND ( ${manager} OR s.status IN ('pending','revision','submitted'))
        RETURNING s.id,s.guide_id,s.teacher_user_id,s.updated_at,s.subject), notices AS (INSERT INTO public.agenda_notifications(institution_id,recipient_id,guide_id,event_key,title,message) SELECT ${institution}::uuid,c.teacher_user_id,c.guide_id,c.id::text||':'||${status}||':'||c.updated_at::text,CASE WHEN ${status}='approved' THEN 'Disciplina aprovada' ELSE 'Correção solicitada' END,c.subject FROM changed c WHERE ${status} IN ('approved','revision') ON CONFLICT DO NOTHING RETURNING id)  , coordinator_notices AS (INSERT INTO public.agenda_notifications(institution_id,recipient_id,guide_id,event_key,title,message)
      SELECT DISTINCT ${institution}::uuid,m.user_id,c.guide_id,c.id::text||':submitted:'||c.updated_at::text,'Disciplina enviada',c.subject FROM changed c JOIN public.memberships m ON m.institution_id=${institution}::uuid AND m.active=true AND m.role IN ('institution_admin','manager') WHERE ${status}='submitted' ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM changed`;
      return rows.length?reply({saved:true},200,cors):reply({error:"Edição não permitida"},403,cors);
    }
    const guidePatch=url.pathname.match(/^\/v1\/agenda\/study-guides\/([0-9a-f-]{36})$/);
    if(guidePatch&&request.method==="PATCH"){
      if(!manager)return reply({error:"Acesso restrito à coordenação"},403,cors);
      const body=await request.json().catch(()=>null);
      if(!uuid(guidePatch[1])||!["draft","open","review","published"].includes(body?.status))return reply({error:"Status inválido"},400,cors);
      if(body.status==='published'){
        const pending=await sql`SELECT COUNT(*)::integer AS count FROM public.agenda_study_guide_subjects s
          JOIN public.agenda_study_guides g ON g.id=s.guide_id
          WHERE g.id=${guidePatch[1]}::uuid AND g.institution_id=${institution}::uuid AND s.status<>'approved'`;
        const total=await sql`SELECT COUNT(*)::integer AS count FROM public.agenda_study_guide_subjects s
          JOIN public.agenda_study_guides g ON g.id=s.guide_id
          WHERE g.id=${guidePatch[1]}::uuid AND g.institution_id=${institution}::uuid`;
        if(!total[0]?.count||pending[0]?.count)return reply({error:"Aprove todas as disciplinas antes de publicar"},409,cors);
      }
      const rows=await sql`WITH changed AS (UPDATE public.agenda_study_guides SET status=${body.status},updated_at=now()
        WHERE id=${guidePatch[1]}::uuid AND institution_id=${institution}::uuid AND status<>'published' AND status<>${body.status} RETURNING id,updated_at,title), notices AS (INSERT INTO public.agenda_notifications(institution_id,recipient_id,guide_id,event_key,title,message) SELECT DISTINCT ${institution}::uuid,s.teacher_user_id,c.id,c.id::text||':'||${body.status}||':'||c.updated_at::text,CASE WHEN ${body.status}='open' THEN 'Roteiro liberado' ELSE 'Roteiro publicado' END,c.title FROM changed c JOIN public.agenda_study_guide_subjects s ON s.guide_id=c.id WHERE ${body.status} IN ('open','published') ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM changed`;
      return rows.length?reply({saved:true},200,cors):reply({error:"Roteiro não encontrado"},404,cors);
    }
    return reply({error:"Operação não encontrada"},404,cors);
  }catch(error){console.error("study-guides",error?.code||"server_error");return reply({error:"Não foi possível processar a operação"},503,cors)}
}
