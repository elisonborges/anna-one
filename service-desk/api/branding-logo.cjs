'use strict';
const {verifyToken}=require('./auth.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createLogoHandler(poolFactory,config=process.env){
 return async function logo(req,res,id){
  const upload=req.method==='POST';
  const identity=upload?verifyToken(req.headers.authorization,config):null;
  if(upload&&!identity){res.writeHead(401);return res.end();}
  if(!uuid.test(id||'')){res.writeHead(400);return res.end();}
  let body;
  if(upload){
   let raw='';
   try{for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1450000){res.writeHead(413);return res.end();}}body=JSON.parse(raw);}
   catch(_){res.writeHead(400);return res.end();}
   if(!body||!['image/png','image/jpeg'].includes(body.mime)||typeof body.base64!=='string'||body.base64.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)){res.writeHead(400);return res.end();}
  }
  const pool=poolFactory();if(!pool){res.writeHead(503);return res.end();}
  let client;
  try{
   client=await pool.connect();
   const guard=await client.query('SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user');
   const role=guard.rows[0];if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_api_runtime')throw Error('unsafe role');
   await client.query('BEGIN');
   await client.query('SET LOCAL ROLE anna_sd_api_runtime');
   if(upload)await client.query("SELECT set_config('anna_sd.actor_id',$1,true)",[identity.id]);
   const result=upload?await client.query("SELECT anna_sd.save_tenant_branding_logo_v1($1,$2,decode($3,'base64')) AS id",[id,body.mime,body.base64]):await client.query('SELECT * FROM anna_sd.read_branding_logo_v1($1)',[id]);
   await client.query('COMMIT');
   if(upload){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({logo_url:'https://anna-one.onrender.com/api/v1/branding-logo/'+result.rows[0].id}));}
   if(!result.rows.length){res.writeHead(404);return res.end();}
   res.writeHead(200,{'Content-Type':result.rows[0].mime_type,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(Buffer.from(result.rows[0].image_base64,'base64'));
  }catch(e){if(client){try{await client.query('ROLLBACK');}catch(_){}}res.writeHead(e.code==='42501'?403:e.code==='22023'?400:503);res.end();}
  finally{if(client)client.release();}
 };
}
module.exports={createLogoHandler};
