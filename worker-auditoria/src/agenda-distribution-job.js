import { neon } from "@neondatabase/serverless";
export async function runAgendaDistribution(env){
 if(env.AGENDA_DISTRIBUTION_ENABLED!=="true"||!env.DATABASE_URL||!env.RESEND_API_KEY||!env.RESEND_FROM_EMAIL)return;
 const sql=neon(env.DATABASE_URL);
 await sql`UPDATE public.agenda_distribution SET status='failed',error='Resultado incerto; conferir no Resend antes de reenviar',attempts=3 WHERE status='sending' AND attempted_at<now()-interval '30 minutes'`;
 const rows=await sql`WITH picked AS (SELECT q.id FROM public.agenda_distribution q JOIN public.institutions i ON i.id=q.institution_id AND i.status='active' JOIN public.memberships m ON m.institution_id=q.institution_id AND m.user_id=q.recipient_id AND m.active=true JOIN public.agenda_communications_central d ON d.id=q.document_id AND d.institution_id=q.institution_id AND d.status='approved' JOIN public.app_users u ON u.id=q.recipient_id AND u.email IS NOT NULL AND u.email<>'' WHERE q.status='pending' AND q.scheduled_at<=now() AND q.attempts<3 ORDER BY q.scheduled_at LIMIT 10 FOR UPDATE OF q SKIP LOCKED), claimed AS (UPDATE public.agenda_distribution q SET status='sending',attempts=attempts+1,attempted_at=now() FROM picked p WHERE q.id=p.id RETURNING q.*) SELECT c.id,u.email,d.content FROM claimed c JOIN public.app_users u ON u.id=c.recipient_id JOIN public.agenda_communications_central d ON d.id=c.document_id`;
 for(const row of rows){
  try{
   const f=row.content.fields;
   const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"agenda-distribution-"+row.id},body:JSON.stringify({from:env.RESEND_FROM_EMAIL,to:[row.email],subject:"AnnA Agenda — "+f.titulo,text:[f.escola,f.tipo,f.titulo,f.texto,f.eventos,f.assinatura,f.cargo].filter(Boolean).join("\n\n")})});
   if(response.ok)await sql`UPDATE public.agenda_distribution SET status='sent',sent_at=now(),error=NULL WHERE id=${row.id}::uuid`;
   else await sql`UPDATE public.agenda_distribution SET status='failed',error=${"HTTP "+response.status} WHERE id=${row.id}::uuid`;
  }catch{await sql`UPDATE public.agenda_distribution SET status='failed',attempts=3,error='Resultado incerto; conferir no Resend' WHERE id=${row.id}::uuid`;}
 }
}
