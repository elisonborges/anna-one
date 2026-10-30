'use strict';
const {ticketEmail}=require('./ticket-email-template.cjs');
async function sendTicketConfirmation({to,protocol,title,category='',subcategory='',description='',config=process.env}){
 const apiKey=config.RESEND_API_KEY;
 if(!apiKey)return {status:'not_configured'};
 const sender=config.SD_EMAIL_FROM||'sevicedesk@annaone.com.br';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to||''))return {status:'recipient_unavailable'};
 const message=ticketEmail({protocol,title,category,subcategory,description,clientName:config.SD_CLIENT_NAME||'AnnA One',supportEmail:config.SD_SUPPORT_EMAIL||'',supportPhone:config.SD_SUPPORT_PHONE||'',logoUrl:config.SD_LOGO_URL||'',signature:config.SD_EMAIL_SIGNATURE||'Equipe AnnA Service Desk',portalUrl:config.SD_PORTAL_URL||'https://elisonborges.github.io/anna-one/service-desk/'});
 try{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({from:sender,to:[to],subject:message.subject,html:message.html,text:message.text}),signal:AbortSignal.timeout(7000)});
  return {status:response.ok?'sent':'failed'};
 }catch(_){return {status:'failed'};}
}
module.exports={sendTicketConfirmation};
