'use strict';
const {verifyToken} = require('./auth.cjs');
function send(res,status,payload) {
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
 res.end(JSON.stringify(payload));
}
function createTicketReader(poolFactory, config=process.env) {
 return async function readTickets(req,res) {
   const identity = verifyToken(req.headers.authorization,config);
   if (!identity) return send(res,401,{error:'unauthorized'});
   const pool=poolFactory();
   if (!pool) return send(res,503,{error:'service_unavailable'});
   let client;
   try {
     client=await pool.connect();
     await client.query('BEGIN READ ONLY');
     await client.query('SET LOCAL ROLE anna_sd_api_runtime');
     await client.query("SELECT set_config('anna_sd.actor_id', $1, true)",[identity.id]);
     const result=await client.query('SELECT id, public_protocol, title, status, priority, created_at FROM anna_sd.tickets ORDER BY created_at DESC LIMIT 50');
     await client.query('COMMIT');
     return send(res,200,{tickets:result.rows});
   } catch (_) {
     if(client) { try { await client.query('ROLLBACK'); } catch (_) {} }
     return send(res,503,{error:'service_unavailable'});
   } finally { if(client) client.release(); }
 };
}
module.exports={createTicketReader};
