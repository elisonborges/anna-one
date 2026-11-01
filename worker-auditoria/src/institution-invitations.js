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
 try{identity=await verifyBearer(request,accept?{...env,AUTH_ISSUER:"https://ep-square-field-b64vxfr0.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth",AUTH_JWKS_URL:"https://ep-square-field-b64vxfr0.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth/.well-known/jwks.json",AUTH_AUDIENCE:undefined}:env);}catch{return reply({error:"Autenticação necessária"},401,cors);}
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
   const origin=new URL(request.url).origin;
   if(!origin.startsWith("https://")||!origin.includes("anna-one-auditoria-homolog."))return reply({error:"Ambiente de homologação inválido"},503,cors);
   const link=new URL("/activate-invitation?token="+token,origin).toString();
   const institution=escape(item.institution_name);
   const safeLink=escape(link);
   const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:28px 12px;background:#edf4fc;font-family:Arial,Helvetica,sans-serif;color:#173451"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #d7e3ee;border-radius:16px"><tr><td style="padding:26px 32px;background:#0c2646;border-radius:16px 16px 0 0"><img src="https://annaone.com.br/assets/anna-symbol.svg" width="54" height="54" alt="Símbolo AnnA One" style="vertical-align:middle;border:0"><span style="font-size:27px;font-weight:800;color:#ffffff;vertical-align:middle;margin-left:12px">AnnA <span style="color:#59b7ff">One</span></span><p style="margin:12px 0 0;color:#c9e4ff;font-size:11px;letter-spacing:1.6px;font-weight:bold">TECNOLOGIA E EDUCAÇÃO JUNTAS</p></td></tr><tr><td style="padding:34px 32px"><p style="font-size:12px;color:#0870ca;font-weight:bold;letter-spacing:1px;margin:0 0 10px">CONVITE INSTITUCIONAL</p><h1 style="margin:0 0 18px;font-size:25px;line-height:1.25;color:#123965">Você foi convidado para administrar uma instituição</h1><p style="font-size:15px;line-height:1.65;margin:0 0 14px">Olá! Você recebeu um convite para atuar como <strong>administrador institucional</strong> na plataforma AnnA One.</p><p style="font-size:15px;line-height:1.6;padding:15px;background:#f2f7ff;border-left:4px solid #087cff;border-radius:6px"><strong>Instituição:</strong> ${institution}</p><p style="font-size:15px;line-height:1.65">Clique no botão abaixo, crie sua conta (ou entre com uma conta existente) e confirme seu e-mail quando solicitado. A ativação do vínculo será feita na própria página.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td style="background:#0870ca;border-radius:9px"><a href="${safeLink}" style="display:inline-block;padding:15px 25px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Ativar convite institucional</a></td></tr></table><p style="font-size:13px;line-height:1.6;color:#526b83">Este convite é individual, de uso único e válido por <strong>48 horas</strong>. Se você não esperava este convite, ignore a mensagem.</p><p style="font-size:12px;color:#526b83;line-height:1.5;overflow-wrap:anywhere">Se o botão não funcionar, copie este endereço no navegador:<br><a href="${safeLink}" style="color:#0759b3;word-break:break-all">${safeLink}</a></p></td></tr><tr><td style="padding:22px 32px;background:#f5f9ff;border-top:1px solid #dce7f2;border-radius:0 0 16px 16px;text-align:center"><strong style="font-size:15px;color:#123965">AnnA One</strong><p style="font-size:12px;color:#536982;line-height:1.7;margin:8px 0">© 2026 AnnA One. Todos os direitos reservados.<br>Desenvolvido por Prof. Elison Borges · Projeto e desenvolvimento original.</p></td></tr></table></body></html>`;
   const textBody="AnnA One — Tecnologia e Educação Juntas\\n\\nConvite para administrador institucional\\nInstituição: "+item.institution_name+"\\n\\nAtive seu convite (válido por 48 horas, uso único): "+link+"\\n\\nCrie sua conta ou entre e confirme seu e-mail na página.\\n\\n© 2026 AnnA One. Todos os direitos reservados.\\nDesenvolvido por Prof. Elison Borges · Projeto e desenvolvimento original.";
   let response;
   try{response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.RESEND_FROM_EMAIL,to:[item.email],subject:"AnnA One | Convite institucional — "+item.institution_name,html,text:textBody})});}
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
