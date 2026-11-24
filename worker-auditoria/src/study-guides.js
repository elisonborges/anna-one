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
      const rows=await sql`UPDATE public.agenda_study_guide_subjects s
        SET topics=${clean(body.topics,20000)},materials=${clean(body.materials,20000)},status=${status},updated_at=now()
        FROM public.agenda_study_guides g
        WHERE s.id=${id}::uuid AND s.guide_id=g.id AND g.institution_id=${institution}::uuid
          AND g.status<>'published' AND ( ${manager} OR (s.teacher_user_id=${user}::uuid AND g.status='open' AND ${body.action} IN ('draft','submitted')))
          AND ( ${manager} OR s.status IN ('pending','revision','submitted'))
        RETURNING s.id`;
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
      const rows=await sql`UPDATE public.agenda_study_guides SET status=${body.status},updated_at=now()
        WHERE id=${guidePatch[1]}::uuid AND institution_id=${institution}::uuid AND status<>'published' RETURNING id`;
      return rows.length?reply({saved:true},200,cors):reply({error:"Roteiro não encontrado"},404,cors);
    }
    return reply({error:"Operação não encontrada"},404,cors);
  }catch(error){console.error("study-guides",error?.code||"server_error");return reply({error:"Não foi possível processar a operação"},503,cors)}
}
