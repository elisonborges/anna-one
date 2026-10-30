'use strict';
const {verifyPassword,issueToken}=require('./local-identity.cjs');
const DUMMY_HASH = ['scrypt','16384','8','1',Buffer.alloc(16).toString('base64url'),Buffer.alloc(64).toString('base64url')].join(String.fromCharCode(36));
function send(res,status,payload) {
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 res.end(JSON.stringify(payload));
}
function createLoginHandler(poolFactory,config=process.env) {
 return async function login(req,res) {
  if(!config.SD_JWT_SECRET||Buffer.byteLength(config.SD_JWT_SECRET)<32||!config.SD_JWT_ISSUER||!config.SD_JWT_AUDIENCE) {console.error('[service-desk/login] signing configuration incomplete');return send(res,503,{error:'service_unavailable'});}
  let data='';
  try {
   for await(const chunk of req) {
    data+=chunk;
    if(Buffer.byteLength(data)>4096) return send(res,413,{error:'request_too_large'});
   }
   const body=JSON.parse(data);
   if(!body || typeof body!=='object' || Array.isArray(body)) return send(res,400,{error:'invalid_request'});
   const email=body && typeof body.email==='string' ? body.email.trim().toLowerCase() : '';
   const password=body && body.password;
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length===0||Buffer.byteLength(password)>1024) return send(res,400,{error:'invalid_request'});
   const pool=poolFactory();
   if(!pool) return send(res,503,{error:'service_unavailable'});
   let client;
   try {
    client=await pool.connect();
    const check=await client.query("SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user");
    const role=check.rows[0];
    if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolname==='anna_sd_identity_runtime') throw Error('unsafe role');
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE anna_sd_identity_runtime');
    const result=await client.query('SELECT user_id,password_hash,enabled,failed_attempts,locked_until FROM anna_sd.local_credentials WHERE email=$1 FOR UPDATE',[email]);
    const account=result.rows[0];
    // Fixed-cost password check for unknown users, reducing timing differences.
    const valid=verifyPassword(password,account?.password_hash||DUMMY_HASH);
    const locked=account?.locked_until && new Date(account.locked_until)>new Date();
    if(!account||!account.enabled||locked||!valid) {
     if(account && account.enabled && !locked) await client.query("UPDATE anna_sd.local_credentials SET failed_attempts=LEAST(failed_attempts+1,100), locked_until=CASE WHEN failed_attempts>=4 THEN now()+interval '15 minutes' ELSE locked_until END, updated_at=now() WHERE user_id=$1",[account.user_id]);
     await client.query('COMMIT');
     return send(res,401,{error:'invalid_credentials'});
    }
    const membership=await client.query("SELECT 1 FROM anna_sd.memberships WHERE user_id=$1 AND status='active' AND anna_sd.actor_tenant_allowed_v1(tenant_id,user_id) LIMIT 1",[account.user_id]);
    const master=await client.query('SELECT 1 FROM anna_sd.platform_admins WHERE user_id=$1 AND active=true LIMIT 1',[account.user_id]);
    if(!membership.rows.length&&!master.rows.length) {await client.query('COMMIT');return send(res,401,{error:'invalid_credentials'});}
    await client.query("UPDATE anna_sd.local_credentials SET failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=$1",[account.user_id]);
    await client.query('COMMIT');
    return send(res,200,{access_token:issueToken(account.user_id,config),token_type:'Bearer',expires_in:900});
   }catch(err) {
    // Log only a fixed stage and PostgreSQL SQLSTATE; never log SQL, credentials or tokens.
    console.error('[service-desk/login] database/auth failure', {code: typeof err?.code==='string' ? err.code : 'internal', category: err?.message==='unsafe role' ? 'unsafe_role' : 'database_operation'});
    if(client) try{await client.query('ROLLBACK');}catch(_){}
    return send(res,503,{error:'service_unavailable'});
   }finally{if(client)client.release();}
  }catch(_){return send(res,400,{error:'invalid_request'});}
 };
}
module.exports={createLoginHandler};
