'use strict';
const crypto=require('node:crypto');
const {verifyToken}=require('./auth.cjs');
const {hashPassword}=require('./local-identity.cjs');
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function parse(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Error('large');}return JSON.parse(raw);}
function createInvitesHandler(poolFactory,config=process.env){
 return async(req,res,accept=false)=>{
  let data;try{data=await parse(req);}catch(_){return send(res,400,{error:'invalid_request'});}
  const actor=accept?null:verifyToken(req.headers.authorization,config);
  if(!accept&&!actor)return send(res,401,{error:'unauthorized'});
  if(accept&&(!/^[a-f0-9]{64}$/.test(crypto.createHash('sha256').update(String(data.token||'')).digest('hex'))||typeof data.password!=='string'||data.password.length<12))return send(res,400,{error:'invalid_request'});
  if(!accept&&(!/^[0-9a-f-]{36}$/i.test(data.tenant_id||'')||typeof data.email!=='string'||!/^\S+@\S+\.\S+$/.test(data.email)||typeof data.name!=='string'||data.name.trim().length<2||data.name.length>120))return send(res,400,{error:'invalid_request'});
  const pool=poolFactory();if(!pool)return send(res,503,{error:'service_unavailable'});
  let client;
  try{
   const token=accept?null:crypto.randomBytes(32).toString('base64url');
   const tokenHash=crypto.createHash('sha256').update(accept?String(data.token||''):token).digest('hex');
   const passwordHash=accept?hashPassword(data.password):null;
   client=await pool.connect();
   const role=(await client.query('SELECT rolsuper,rolbypassrls,rolcreaterole,rolname FROM pg_roles WHERE rolname=current_user')).rows[0];
   if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_api_runtime')throw Error('unsafe_role');
   await client.query('BEGIN');await client.query('SET LOCAL ROLE anna_sd_api_runtime');
   if(actor)await client.query("SELECT set_config('anna_sd.actor_id',$1,true)",[actor.id]);
   if(accept){
    const result=await client.query('SELECT anna_sd.accept_admin_invite_v1($1,$2) AS ok',[tokenHash,passwordHash]);
    await client.query('COMMIT');
    return send(res,result.rows[0].ok?200:400,{ok:result.rows[0].ok,error:result.rows[0].ok?undefined:'invalid_or_expired_invitation'});
   }
   // Email must be delivered before committing the invitation.
   const result=await client.query('SELECT anna_sd.master_invite_admin_v1($1,$2,$3,$4,$5,$6,$7) AS id',[data.tenant_id,data.email.trim().toLowerCase(),tokenHash,data.name,data.position||'',data.phone||'',data.whatsapp||'']);
   const overview=(await client.query('SELECT anna_sd.master_overview_v1() AS overview')).rows[0]?.overview;
   const company=overview?.companies?.find(item=>item.id===data.tenant_id)?.name||'Instituição convidante';
   if(!config.RESEND_API_KEY){await client.query('ROLLBACK');return send(res,503,{error:'email_not_configured'});}
   const url='https://elisonborges.github.io/anna-one/service-desk/activate.html?token='+encodeURIComponent(token);
   const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   const invitationHtml='<div style="margin:0;padding:24px 12px;background:#f3f7fc;font-family:Arial,sans-serif;color:#173553"><div style="max-width:560px;margin:auto;background:#ffffff;border:1px solid #d7e3ee;border-radius:14px;overflow:hidden"><div style="background:#102f55;padding:28px 24px;text-align:center;color:#ffffff"><div style="font-size:27px;font-weight:800">AnnA One</div><div style="font-size:11px;letter-spacing:1px;color:#bdd9f2;margin-top:6px">TECNOLOGIA E EDUCAÇÃO JUNTAS</div></div><div style="padding:30px 26px"><h1 style="font-size:22px;line-height:1.3;color:#173553;margin:0 0 22px">Convite para administrador institucional</h1><p style="font-size:15px;line-height:1.6">Olá, '+escapeHtml(data.name.trim())+'!</p><p style="font-size:15px;line-height:1.7">Você foi convidado para administrar a instituição <strong>'+escapeHtml(company)+'</strong> na plataforma AnnA One, por meio do AnnA Service Desk.</p><p style="font-size:15px;line-height:1.6">Para configurar seu acesso, utilize o botão abaixo:</p><p style="margin:28px 0;text-align:center"><a href="'+escapeHtml(url)+'" style="display:inline-block;background:#147bd1;color:#ffffff;padding:14px 25px;border-radius:9px;text-decoration:none;font-weight:bold;font-size:15px">Ativar minha conta</a></p><p style="font-size:13px;line-height:1.6;color:#61758c">Este convite é pessoal, válido por 48 horas e de uso único. Se você já possui uma conta, sua senha atual será preservada.</p><p style="font-size:12px;line-height:1.6;color:#61758c;overflow-wrap:anywhere">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="'+escapeHtml(url)+'" style="color:#135a96">'+escapeHtml(url)+'</a></p><p style="font-size:12px;color:#61758c">Se não reconhece este convite, ignore esta mensagem.</p></div><div style="border-top:1px solid #d7e3ee;background:#f7faff;padding:20px 24px;text-align:center;font-size:12px;line-height:1.7;color:#61758c">AnnA One · Tecnologia e Educação Juntas<br>© 2026 AnnA One. Todos os direitos reservados.<br>Desenvolvido por Prof. Elison Borges · Projeto e desenvolvimento original.</div></div></div>';
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:config.SD_EMAIL_FROM||'AnnA Service Desk <sevicedesk@annaone.com.br>',to:[data.email.trim().toLowerCase()],subject:'AnnA One | Convite de acesso — '+company,html:invitationHtml,text:'AnnA One · AnnA Service Desk\n\nOlá, '+data.name.trim()+'!\n\nVocê recebeu um convite para administrar a instituição '+company+'.\n\nAtive seu acesso em até 48 horas:\n'+url+'\n\nSe já possui uma conta, sua senha atual será preservada.\n\nSe não reconhece o convite, ignore esta mensagem.\n\nAnnA One · Service Desk\n© 2026 AnnA One. Todos os direitos reservados.'})});
   if(!response.ok){await client.query('ROLLBACK');return send(res,502,{error:'email_delivery_failed'});}
   await client.query('COMMIT');return send(res,201,{ok:true,invitation_id:result.rows[0].id});
  }catch(e){if(client)try{await client.query('ROLLBACK');}catch(_){}return send(res,e.code==='42501'?403:e.code==='22023'?400:503,{error:e.code==='42501'?'forbidden':e.code==='22023'?'invalid_fields':'service_unavailable'});}
  finally{if(client)client.release();}
 };
}
module.exports={createInvitesHandler};
