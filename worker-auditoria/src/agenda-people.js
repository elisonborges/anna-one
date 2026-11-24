import {neon} from "@neondatabase/serverless";
import {verifyBearer} from "./auth.js";
const uuid=v=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function handleAgendaPeople(request,env,cors,url){
 const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store",...cors}});
 let actor;try{actor=(await verifyBearer(request,env)).userId}catch{return send({error:"Autenticação necessária"},401)}
 try{
 const sql=neon(env.DATABASE_URL);
 const master=(await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${actor}::uuid) AS ok`)[0]?.ok===true;
 const institution=url.searchParams.get("institution_id");
 if(!uuid(institution))return send({error:"Selecione uma instituição"},400);
 const scope=await sql`SELECT i.id,md.id AS module_id FROM public.institutions i JOIN public.institution_modules im ON im.institution_id=i.id AND im.enabled=true JOIN public.modules md ON md.id=im.module_id AND md.code='agenda' AND md.status='available' LEFT JOIN public.institutions p ON p.id=i.parent_institution_id LEFT JOIN public.institution_modules pm ON pm.institution_id=p.id AND pm.module_id=md.id WHERE i.id=${institution}::uuid AND i.status='active' AND (p.id IS NULL OR (p.status='active' AND pm.enabled=true)) AND (${master} OR EXISTS(SELECT 1 FROM public.memberships m WHERE m.institution_id=i.id AND m.user_id=${actor}::uuid AND m.active=true AND m.role='institution_admin'))`;
 if(!scope.length)return send({error:"Instituição ou módulo não autorizado"},403);
 const moduleId=scope[0].module_id;
 if(request.method==="GET"){
 const people=await sql`SELECT u.id,u.display_name,u.email,m.role,m.active,COALESCE(up.enabled,false) AS agenda_enabled FROM public.memberships m JOIN public.app_users u ON u.id=m.user_id LEFT JOIN public.user_module_permissions up ON up.institution_id=m.institution_id AND up.user_id=m.user_id AND up.module_id=${moduleId} WHERE m.institution_id=${institution}::uuid ORDER BY u.display_name,u.email`;
 return send({people,is_master:master});
 }
 if(request.method!=="PUT")return send({error:"Método inválido"},405);
 const b=await request.json().catch(()=>null);
 if(!b||typeof b.email!=="string"||b.email.length>254||!["teacher","manager","technician"].includes(b.role)||typeof b.enabled!=="boolean")return send({error:"Dados inválidos"},400);
 const target=await sql`SELECT u.id,m.role,m.active FROM public.app_users u LEFT JOIN public.memberships m ON m.user_id=u.id AND m.institution_id=${institution}::uuid WHERE lower(u.email)=lower(${b.email.trim()}) AND (${master} OR m.user_id IS NOT NULL) LIMIT 1`;
 if(!target.length)return send({error:"Conta central não encontrada ou não vinculada. Solicite o vínculo ao Master."},404);
 const t=target[0];if(t.id===actor||t.role==="institution_admin")return send({error:"Não é permitido alterar esta conta administrativa"},403);
 if(t.role&&t.role!==b.role)return send({error:"O perfil central existente é diferente. Altere-o no portal AnnA One."},409);
 if(t.role&&!t.active)return send({error:"Vínculo central inativo"},409);
 if(!t.role&&!b.enabled)return send({error:"Não existe vínculo para desativar"},409);
 await sql`WITH member AS (INSERT INTO public.memberships(institution_id,user_id,role,active) VALUES(${institution}::uuid,${t.id}::uuid,${b.role},true) ON CONFLICT(institution_id,user_id) DO NOTHING) INSERT INTO public.user_module_permissions(institution_id,user_id,module_id,enabled,granted_by,updated_at) VALUES(${institution}::uuid,${t.id}::uuid,${moduleId},${b.enabled},${actor}::uuid,now()) ON CONFLICT(institution_id,user_id,module_id) DO UPDATE SET enabled=excluded.enabled,granted_by=excluded.granted_by,updated_at=now()`;
 return send({saved:true});
 }catch(e){console.error("agenda people",e?.code||"error");return send({error:"Operação indisponível"},503)}
}
