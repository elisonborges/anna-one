'use strict';
const {verifyToken}=require('./auth.cjs');
const {sendTicketConfirmation}=require('./ticket-email.cjs');
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function createTicketWriter(poolFactory,config=process.env){
 return async function writeTicket(req,res){
  const identity=verifyToken(req.headers.authorization,config);
  if(!identity)return send(res,401,{error:'unauthorized'});
  let raw='';
  try{
   for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>12000)return send(res,413,{error:'payload_too_large'});}
  }catch(_){return send(res,400,{error:'invalid_body'});}
  let data;try{data=JSON.parse(raw);}catch(_){return send(res,400,{error:'invalid_json'});}
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!data||!uuid.test(data.unit_id||'')||typeof data.title!=='string'||data.title.trim().length<3||data.title.trim().length>200||typeof data.description!=='string'||!data.description.trim()||data.description.length>5000||typeof data.category_code!=='string'||!(/^[A-Z0-9_-]{2,20}$/).test(data.category_code)||typeof data.category_label!=='string'||data.category_label.trim().length<2||data.category_label.length>100||!['low','normal','high'].includes(data.priority||'normal'))return send(res,400,{error:'invalid_fields'});
  const pool=poolFactory();if(!pool)return send(res,503,{error:'service_unavailable'});
  let client;
  try{
   client=await pool.connect();
   const guard=await client.query("SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user");
   const role=guard.rows[0];if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_api_runtime')throw Error('unsafe role');
   await client.query('BEGIN');
   await client.query('SET LOCAL ROLE anna_sd_api_runtime');
   await client.query("SELECT set_config('anna_sd.actor_id',$1,true)",[identity.id]);
   const result=await client.query('SELECT * FROM anna_sd.create_ticket_v1($1,$2,$3,$4,$5,$6)',[data.unit_id,data.category_code,data.category_label,data.title,data.description,data.priority||'normal']);
   await client.query('COMMIT');
   // A confirmed ticket must never be rolled back because of an email delivery failure.
   // Resolve the recipient on the server, never from the browser payload.
   let emailStatus='not_configured';
   try{
    const emailResult=await client.query("SELECT email FROM anna_sd.local_credentials WHERE user_id=$1 LIMIT 1",[identity.id]);
    const recipient=emailResult.rows[0]?.email;
    emailStatus=(await sendTicketConfirmation({to:recipient,protocol:result.rows[0].public_protocol,title:data.title,config})).status;
   }catch(_){emailStatus='failed';}
   return send(res,201,{ticket:result.rows[0],email_status:emailStatus});
  }catch(e){
   if(client){try{await client.query('ROLLBACK');}catch(_){}}
   return send(res,e.code==='42501'?403:e.code==='22023'?400:503,{error:e.code==='42501'?'forbidden':e.code==='22023'?'invalid_fields':'service_unavailable'});
  }finally{if(client)client.release();}
 };
}
module.exports={createTicketWriter};
