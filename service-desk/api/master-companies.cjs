'use strict';
const {verifyToken}=require('./auth.cjs');
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
function createMasterCompaniesHandler(poolFactory,config=process.env){
 return async function handle(req,res){
  const identity=verifyToken(req.headers.authorization,config);
  if(!identity)return send(res,401,{error:'unauthorized'});
  let body;
  if(req.method==='POST'||req.method==='PATCH'){
   let raw='';
   try{for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(res,413,{error:'payload_too_large'});}body=JSON.parse(raw);}
   catch(_){return send(res,400,{error:'invalid_json'});}
   if(req.method==='POST'&&(!body||typeof body.name!=='string'||!body.details||typeof body.details!=='object'||Array.isArray(body.details)))return send(res,400,{error:'invalid_fields'});
   if(req.method==='PATCH'&&(!body||!body.tenant_id||!['active','suspended','closed'].includes(body.status)||typeof body.reason!=='string'||body.reason.trim().length<5))return send(res,400,{error:'invalid_fields'});
  }
  const pool=poolFactory();if(!pool)return send(res,503,{error:'service_unavailable'});
  let client;
  try{
   client=await pool.connect();
   const guard=await client.query('SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user');
   const role=guard.rows[0];if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_api_runtime')throw Error('unsafe role');
   await client.query('BEGIN');
   await client.query('SET LOCAL ROLE anna_sd_api_runtime');
   await client.query("SELECT set_config('anna_sd.actor_id',$1,true)",[identity.id]);
   const result=req.method==='GET'?await client.query('SELECT anna_sd.master_overview_v1() AS overview'):req.method==='PATCH'?await client.query('SELECT anna_sd.master_manage_v1($1,$2,$3,$4)',[body.tenant_id,body.user_id||null,body.status,body.reason]):await client.query('SELECT id,code FROM anna_sd.master_create_tenant_profile_v2($1,$2::jsonb)',[body.name,JSON.stringify(body.details)]);
   await client.query('COMMIT');
   return send(res,req.method==='GET'?200:req.method==='PATCH'?200:201,req.method==='GET'?result.rows[0].overview:req.method==='PATCH'?{ok:true}:{id:result.rows[0].id,code:result.rows[0].code});
  }catch(e){
   if(client)try{await client.query('ROLLBACK');}catch(_){}
   return send(res,e.code==='42501'?403:e.code==='22023'?400:e.code==='23505'?409:503,{error:e.code==='42501'?'forbidden':e.code==='22023'?'invalid_fields':e.code==='23505'?'company_exists':'service_unavailable'});
  }finally{if(client)client.release();}
 };
}
module.exports={createMasterCompaniesHandler};
