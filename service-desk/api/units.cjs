'use strict';
const {verifyToken}=require('./auth.cjs');
function createUnitsReader(poolFactory,config=process.env){
 return async function readUnits(req,res){
  const identity=verifyToken(req.headers.authorization,config);
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  if(!identity)return send(401,{error:'unauthorized'});
  const pool=poolFactory();if(!pool)return send(503,{error:'service_unavailable'});
  let client;
  try{
   client=await pool.connect();
   const guard=await client.query("SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user");
   const role=guard.rows[0];if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_api_runtime')throw Error('unsafe role');
   await client.query('BEGIN READ ONLY');
   await client.query('SET LOCAL ROLE anna_sd_api_runtime');
   await client.query("SELECT set_config('anna_sd.actor_id',$1,true)",[identity.id]);
   const result=await client.query('SELECT id,name,tenant_code FROM anna_sd.available_ticket_units_v1()');
   await client.query('COMMIT');
   return send(200,{units:result.rows});
  }catch(_){if(client){try{await client.query('ROLLBACK');}catch(_){}}return send(503,{error:'service_unavailable'});}
  finally{if(client)client.release();}
 };
}
module.exports={createUnitsReader};
