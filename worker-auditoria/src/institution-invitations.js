import { neon } from "@neondatabase/serverless";
import { verifyBearer } from "./auth.js";
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store",...headers}});
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,"0")).join("");
const escape=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export async function handleInstitutionInvitation(request,env,cors={}){
 const path=new URL(request.url).pathname;
 const send=/^\/v1\/admin\/institution-admin-invitations\/([0-9a-f-]{36})\/send$/i.exec(path);
 const accept=path==="/v1/invitations/accept";
 if(request.method!=="POST"||(!send&&!accept))return null;
 if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return reply({error:"Envie JSON"},415,cors);
 let identity;
 try{identity=await verifyBearer(request,env);}catch{return reply({error:"Autenticação necessária"},401,cors);}
 if(!env.DATABASE_URL)return reply({error:"Banco indisponível"},503,cors);
 const sql=neon(env.DATABASE_URL);
 try{
  if(send){
   if(!env.RESEND_API_KEY||!env.RESEND_FROM_EMAIL)return reply({error:"Resend indisponível"},503,cors);
   const id=send[1];
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
   const hash=await digest(token);
   const rows=await sql`UPDATE public.institution_admin_invitations inv
    SET token_hash=${hash},expires_at=now()+interval '48 hours',delivery_status='preparing',updated_at=now()
    WHERE inv.id=${id}::uuid AND inv.status='pending'
      AND (inv.delivery_status IS NULL OR inv.delivery_status='failed')
      AND EXISTS(SELECT 1 FROM public.platform_admins p WHERE p.user_id=${identity.userId}::uuid)
      AND EXISTS(SELECT 1 FROM public.institutions i WHERE i.id=inv.institution_id AND i.status='active')
      AND NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.app_users u ON u.id=m.user_id
       WHERE m.institution_id=inv.institution_id AND lower(u.email)=lower(inv.email) AND m.active AND m.role='institution_admin')
    RETURNING inv.id,inv.email,inv.institution_id,(SELECT name FROM public.institutions WHERE id=inv.institution_id) AS institution_name`;
   if(!rows.length)return reply({error:"Convite não disponível para envio"},409,cors);
   const item=rows[0];
   const origin=new URL(env.APP_ORIGIN||"https://annaone.com.br");
   if(origin.protocol!=="https:")return reply({error:"Origem inválida"},503,cors);
   const link=new URL("/app/activate-invitation.html?token="+token,origin).toString();
   const html='<div style="font:16px Arial;padding:24px"><h1>AnnA One</h1><p>Convite para administrar '+escape(item.institution_name)+'</p><p><a href="'+escape(link)+'">Ativar convite</a></p><p>Válido por 48 horas, uso único.</p></div>';
   let response;
   try{response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.RESEND_FROM_EMAIL,to:[item.email],subject:"AnnA One — convite institucional",html,text:"Ative seu convite: "+link})});}
   catch{return reply({error:"Resultado de envio desconhecido; verifique o Resend antes de reenviar"},502,cors);}
   if(!response.ok){
    await sql`UPDATE public.institution_admin_invitations SET delivery_status='failed',updated_at=now() WHERE id=${id}::uuid AND token_hash=${hash} AND delivery_status='preparing'`;
    return reply({error:"Resend recusou o envio",provider_status:response.status},502,cors);
   }
   const provider=await response.json().catch(()=>({}));
   await sql`WITH marked AS (
    UPDATE public.institution_admin_invitations SET delivery_status='sent',sent_at=now(),provider_message_id=${String(provider.id||"")},updated_at=now()
    WHERE id=${id}::uuid AND token_hash=${hash} AND delivery_status='preparing'
    RETURNING id,institution_id,email
   ) INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details)
   SELECT ${identity.userId}::uuid,institution_id,'institution.admin.invitation.sent','institution_admin_invitation',id::text,jsonb_build_object('email',email,'provider','resend') FROM marked`;
   return reply({accepted_by_provider:true,invitation_id:id},200,cors);
  }
  const raw=await request.text();
  if(raw.length>1024)return reply({error:"Dados excedem limite"},413,cors);
  let data;try{data=JSON.parse(raw);}catch{return reply({error:"JSON inválido"},400,cors);}
  if(typeof data?.token!=="string"||!/^[0-9a-f]{64}$/i.test(data.token))return reply({error:"Token inválido"},422,cors);
  const hash=await digest(data.token);
  const rows=await sql`WITH verified AS (
   SELECT lower(email) AS email FROM neon_auth."user"
   WHERE id=${identity.userId}::uuid AND "emailVerified"=true AND banned IS NOT TRUE AND email IS NOT NULL
  ), candidate AS (
   SELECT inv.id,inv.institution_id,inv.email FROM public.institution_admin_invitations inv
   JOIN public.institutions i ON i.id=inv.institution_id AND i.status='active'
   JOIN verified v ON lower(inv.email)=v.email
   WHERE inv.token_hash=${hash} AND inv.status='pending' AND inv.delivery_status='sent' AND inv.expires_at>now()
  ), person AS (
   INSERT INTO public.app_users(id,email) SELECT ${identity.userId}::uuid,lower(email) FROM candidate
   ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email
   WHERE public.app_users.email IS NULL OR lower(public.app_users.email)=EXCLUDED.email RETURNING id
  ), chosen AS (
   UPDATE public.institution_admin_invitations inv SET status='accepted',accepted_at=now(),token_hash=NULL,updated_at=now()
   FROM candidate,person WHERE inv.id=candidate.id AND inv.token_hash=${hash} AND inv.status='pending'
   RETURNING inv.id,inv.institution_id,inv.email
  ), linked AS (
   INSERT INTO public.memberships(institution_id,user_id,role,active)
   SELECT chosen.institution_id,person.id,'institution_admin',true FROM chosen CROSS JOIN person
   ON CONFLICT(institution_id,user_id) DO UPDATE SET role='institution_admin',active=true RETURNING institution_id
  ), logged AS (
   INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details)
   SELECT ${identity.userId}::uuid,chosen.institution_id,'institution.admin.invitation.accepted','institution_admin_invitation',chosen.id::text,jsonb_build_object('email',chosen.email)
   FROM chosen JOIN linked ON linked.institution_id=chosen.institution_id RETURNING institution_id
  ) SELECT institution_id FROM logged`;
  if(!rows.length)return reply({error:"Convite inválido, expirado, usado ou e-mail não verificado"},409,cors);
  return reply({activated:true,institution_id:rows[0].institution_id},200,cors);
 }catch(error){console.error("invitation error",error?.code||"unexpected");return reply({error:"Operação indisponível"},503,cors);}
}
