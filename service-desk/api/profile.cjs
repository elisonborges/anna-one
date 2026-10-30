'use strict';
const {verifyToken}=require('./auth.cjs');
function createProfileReader(poolFactory,config=process.env){
 return async function readProfile(req,res){
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const actor=verifyToken(req.headers.authorization,config);
  if(!actor)return send(401,{error:'unauthorized'});
  const pool=poolFactory();if(!pool)return send(503,{error:'service_unavailable'});
  let client;
  try{
   client=await pool.connect();
   const guard=await client.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolname FROM pg_roles WHERE rolname=current_user");
   const role=guard.rows[0];
   if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_api_runtime')throw Error('unsafe role');
   await client.query('BEGIN READ ONLY');
   await client.query('SET LOCAL ROLE anna_sd_api_runtime');
   await client.query("SELECT set_config('anna_sd.actor_id',$1,true)",[actor.id]);
   const result=await client.query('SELECT anna_sd.current_profile_v1() AS profile');
   await client.query('COMMIT');
   return send(200,{profile:result.rows[0]?.profile||'none'});
  }catch(error){
   if(client)try{await client.query('ROLLBACK');}catch(_){}
   console.error('[service-desk/profile] lookup failed',{code:error?.code||'internal'});
   return send(503,{error:'service_unavailable'});
  }finally{if(client)client.release();}
 };
}
module.exports={createProfileReader};
