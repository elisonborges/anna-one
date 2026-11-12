// AnnA One — permissões individuais v0.1
// Integração: registrar a rota /v1/admin/user-modules no Worker.
// Pré-condição: o Worker verificou o JWT e produziu actor a partir da sessão,
// nunca a partir do corpo da requisição. sql é a função neon() parametrizada.
// Este módulo NÃO implanta nem substitui as rotas existentes.

const send=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
const uuid=v=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const email=v=>typeof v==="string"&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export async function handleUserModulePermissions(request,{sql,actor}){
 if(!sql||!actor?.userId)return send({error:"Autenticação obrigatória"},401);
 const url=new URL(request.url);
 if(request.method==="GET"&&!url.searchParams.has("institution_id")){
  const institutions=actor.isMaster===true
   ? await sql`SELECT id,name FROM public.institutions WHERE status='active' ORDER BY name`
   : await sql`SELECT i.id,i.name FROM public.institutions i JOIN public.memberships m
      ON m.institution_id=i.id WHERE m.user_id=${actor.userId}
      AND m.role='institution_admin' AND m.active=true AND i.status='active'
      ORDER BY i.name`;
  return send({items:institutions});
 }
 const institutionId=url.searchParams.get("institution_id");
 const login=(url.searchParams.get("email")||"").trim().toLowerCase();
 if(!uuid(institutionId)||!email(login))return send({error:"Informe a instituição e o e-mail"},400);
 if(!["GET","PUT"].includes(request.method))return send({error:"Método não permitido"},405);
 const institution=await sql`SELECT id,status,parent_institution_id FROM public.institutions WHERE id=${institutionId} LIMIT 1`;
 if(!institution.length)return send({error:"Instituição não encontrada"},404);
 const isMaster=actor.isMaster===true;
 if(!isMaster){
  const admin=await sql`SELECT 1 FROM public.memberships
   WHERE institution_id=${institutionId} AND user_id=${actor.userId}
     AND active=true AND role='institution_admin' LIMIT 1`;
  if(!admin.length)return send({error:"Sem permissão nesta instituição"},403);
 }
 const target=await sql`SELECT u.id,u.email,u.display_name,m.role,m.active
   FROM public.app_users u JOIN public.memberships m ON m.user_id=u.id
   WHERE m.institution_id=${institutionId} AND lower(u.email)=${login} LIMIT 1`;
 if(!target.length)return send({error:"Login não possui vínculo com esta instituição"},404);
 const user=target[0];
 const rows=await sql`SELECT md.id,md.name,md.code,md.status,
  COALESCE(im.enabled,false) AS institution_enabled,
  CASE WHEN ins.parent_institution_id IS NULL THEN true ELSE
   (p.status='active' AND COALESCE(pim.enabled,false)) END AS parent_allowed,
  COALESCE(up.enabled,false) AS user_enabled
  FROM public.modules md
  CROSS JOIN public.institutions ins
  LEFT JOIN public.institutions p ON p.id=ins.parent_institution_id
  LEFT JOIN public.institution_modules im ON im.module_id=md.id AND im.institution_id=ins.id
  LEFT JOIN public.institution_modules pim ON pim.module_id=md.id AND pim.institution_id=p.id
  LEFT JOIN public.user_module_permissions up ON up.module_id=md.id
   AND up.institution_id=${institutionId} AND up.user_id=${user.id}
  WHERE ins.id=${institutionId} ORDER BY md.name`;
 if(request.method==="GET")return send({
  institution_id:institutionId,
  institution_status:institution[0].status,
  user:{id:user.id,email:user.email,display_name:user.display_name,role:user.role,active:user.active},
  modules:rows.map(m=>({...m,effective:!!(institution[0].status==="active"&&user.active&&m.status==="available"&&m.institution_enabled&&m.parent_allowed&&m.code!=="service-desk"&&m.user_enabled)}))
 });
 if(institution[0].status!=="active"||!user.active)return send({error:"Vínculo ou instituição inativo"},409);
 if(!isMaster&&(user.id===actor.userId||user.role==="institution_admin"))
  return send({error:"Administrador não pode alterar a própria permissão nem a de outro administrador"},403);
 let body;
 try{body=await request.json()}catch{return send({error:"JSON inválido"},400)}
 if(!uuid(body?.module_id)||typeof body?.enabled!=="boolean")
  return send({error:"Informe module_id e enabled booleano"},400);
 const mod=rows.find(m=>m.id===body.module_id);
 if(!mod)return send({error:"Módulo não encontrado"},404);
 if(body.enabled&&!(mod.institution_enabled&&mod.parent_allowed&&mod.status==="available"&&mod.code!=="service-desk"))
  return send({error:"Módulo não autorizado para esta instituição"},403);
 await sql`INSERT INTO public.user_module_permissions
 (institution_id,user_id,module_id,enabled,granted_by,updated_at)
 VALUES (${institutionId},${user.id},${mod.id},${body.enabled},${actor.userId},now())
 ON CONFLICT(institution_id,user_id,module_id)
 DO UPDATE SET enabled=excluded.enabled,granted_by=excluded.granted_by,updated_at=now()`;
 return send({saved:true,module_id:mod.id,enabled:body.enabled});
}
