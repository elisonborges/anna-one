import { neon } from "@neondatabase/serverless";
export async function runAgendaNotifications(env){
 if(!env.DATABASE_URL)return;
 const sql=neon(env.DATABASE_URL);
 await sql`INSERT INTO public.agenda_notifications(institution_id,recipient_id,guide_id,event_key,title,message)
 SELECT g.institution_id,m.user_id,g.id,s.id::text||':'||g.deadline::text||':'||CASE WHEN g.deadline < (now() AT TIME ZONE 'America/Fortaleza')::date THEN 'late' ELSE 'due' END,
 CASE WHEN g.deadline < (now() AT TIME ZONE 'America/Fortaleza')::date THEN 'Prazo vencido' ELSE 'Prazo próximo' END,g.title||' · '||s.subject
 FROM public.agenda_study_guides g JOIN public.agenda_study_guide_subjects s ON s.guide_id=g.id JOIN public.institutions i ON i.id=g.institution_id AND i.status='active'
 JOIN public.memberships m ON m.institution_id=g.institution_id AND m.active=true AND (m.user_id=s.teacher_user_id OR (m.role IN ('manager','institution_admin') AND g.deadline < (now() AT TIME ZONE 'America/Fortaleza')::date))
 JOIN public.institution_modules im ON im.institution_id=g.institution_id AND im.enabled=true JOIN public.modules mo ON mo.id=im.module_id AND mo.code='agenda' AND mo.status='available'
 WHERE g.status IN ('open','review') AND s.status IN ('pending','revision') AND g.deadline <= (now() AT TIME ZONE 'America/Fortaleza')::date+2 ON CONFLICT DO NOTHING`;
 if(!env.RESEND_API_KEY||!env.RESEND_FROM_EMAIL)return;
 const rows=await sql`WITH picked AS (SELECT n.id FROM public.agenda_notifications n JOIN public.memberships m ON m.institution_id=n.institution_id AND m.user_id=n.recipient_id AND m.active=true JOIN public.institutions i ON i.id=n.institution_id AND i.status='active' JOIN public.app_users u ON u.id=n.recipient_id WHERE n.email_sent_at IS NULL AND n.email_attempts<3 AND n.created_at>now()-interval '20 hours' AND (n.email_attempt_at IS NULL OR n.email_attempt_at<now()-interval '15 minutes') AND u.email IS NOT NULL AND u.email<>'' ORDER BY n.created_at LIMIT 30 FOR UPDATE OF n SKIP LOCKED), claimed AS (UPDATE public.agenda_notifications n SET email_attempts=email_attempts+1,email_attempt_at=now() FROM picked p WHERE n.id=p.id RETURNING n.*) SELECT c.*,u.email FROM claimed c JOIN public.app_users u ON u.id=c.recipient_id`;
 for(const n of rows){
  try{
   const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"agenda-"+n.id},body:JSON.stringify({from:env.RESEND_FROM_EMAIL,to:[n.email],subject:"AnnA Agenda — "+n.title,text:"Há uma atualização na sua Agenda Educacional. Acesse https://agenda.annaone.com.br/roteiros-estudos/institucional.html para consultar sua notificação."})});
   if(response.ok){await sql`UPDATE public.agenda_notifications SET email_sent_at=now(),email_error=NULL WHERE id=${n.id}::uuid`;}
   else await sql`UPDATE public.agenda_notifications SET email_error=${"HTTP "+response.status} WHERE id=${n.id}::uuid`;
  }catch{await sql`UPDATE public.agenda_notifications SET email_error='Falha de comunicação' WHERE id=${n.id}::uuid`;}
 }
}
