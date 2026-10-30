'use strict';
const {verifyToken}=require('./auth.cjs');
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
function createBrandingHandler(poolFactory,config=process.env){
 return async function branding(req,res){
  const identity=verifyToken(req.headers.authorization,config);
  if(!identity)return send(res,401,{error:'unauthorized'});
  const pool=poolFactory();if(!pool)return send(res,503,{error:'service_unavailable'});
  let data=null;
  if(req.method==='PUT'){
   let raw='';
   try{for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>5000)return send(res,413,{error:'payload_too_large'});}data=JSON.parse(raw);}
   catch(_){return send(res,400,{error:'invalid_json'});}
  }
  const tenantId=req.headers['x-tenant-id'];
  if(typeof tenantId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(tenantId))return send(res,400,{error:'invalid_tenant'});
  let client;
  try{
   client=await pool.connect();
   const guard=await client.query('SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user');
   const role=guard.rows[0];if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_api_runtime')throw Error('unsafe role');
   await client.query('BEGIN');
   await client.query('SET LOCAL ROLE anna_sd_api_runtime');
   await client.query("SELECT set_config('anna_sd.actor_id',$1,true)",[identity.id]);
   let result;
   if(req.method==='GET'){
    result=await client.query('SELECT * FROM anna_sd.get_tenant_email_branding_v1($1)',[tenantId]);
   }else{
    if(!data||['display_name','logo_url','signature','contact_email','contact_phone'].some(k=>typeof data[k]!=='string')){await client.query('ROLLBACK');return send(res,400,{error:'invalid_fields'});}
    await client.query('SELECT anna_sd.set_tenant_email_branding_v1($1,$2,$3,$4,$5,$6)',[tenantId,data.display_name,data.logo_url,data.signature,data.contact_email,data.contact_phone]);
   }
   await client.query('COMMIT');
   return send(res,200,req.method==='GET'?{branding:result.rows[0]||null}:{saved:true});
  }catch(e){if(client){try{await client.query('ROLLBACK');}catch(_){}}return send(res,e.code==='42501'?403:e.code==='22023'?400:503,{error:e.code==='42501'?'forbidden':e.code==='22023'?'invalid_fields':'service_unavailable'});}
  finally{if(client)client.release();}
 };
}
module.exports={createBrandingHandler};
