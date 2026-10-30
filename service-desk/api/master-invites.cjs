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
   if(!config.RESEND_API_KEY){await client.query('ROLLBACK');return send(res,503,{error:'email_not_configured'});}
   const url='https://elisonborges.github.io/anna-one/service-desk/activate.html?token='+encodeURIComponent(token);
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:config.SD_EMAIL_FROM||'AnnA Service Desk <sevicedesk@annaone.com.br>',to:[data.email.trim().toLowerCase()],subject:'Convite para administrar uma instituição — AnnA One',text:'Você foi convidado para administrar uma instituição no AnnA Service Desk. Para ativar seu acesso, abra este link em até 48 horas:\n'+url+'\n\nSe não solicitou esse acesso, ignore esta mensagem.'})});
   if(!response.ok){await client.query('ROLLBACK');return send(res,502,{error:'email_delivery_failed'});}
   await client.query('COMMIT');return send(res,201,{ok:true,invitation_id:result.rows[0].id});
  }catch(e){if(client)try{await client.query('ROLLBACK');}catch(_){}return send(res,e.code==='42501'?403:e.code==='22023'?400:503,{error:e.code==='42501'?'forbidden':e.code==='22023'?'invalid_fields':'service_unavailable'});}
  finally{if(client)client.release();}
 };
}
module.exports={createInvitesHandler};
