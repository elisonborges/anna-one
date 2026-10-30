'use strict';
// Administrative, one-off provisioning. Requires a separate admin connection,
// never the runtime DATABASE_URL. No password or hash is printed.
const {randomUUID}=require('node:crypto');
const {hashPassword}=require('./local-identity.cjs');
async function provision(client,{email,password,tenantId,role='requester'}) {
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email||'')||email!==email.trim().toLowerCase()) throw Error('invalid email');
 if(!/^[0-9a-f-]{36}$/i.test(tenantId||'')) throw Error('invalid tenant id');
 if(!['requester','technician','supervisor','approver','manager'].includes(role)) throw Error('invalid role');
 const hash=hashPassword(password);
 const id=randomUUID();
 await client.query('BEGIN');
 try {
  const tenant=await client.query('SELECT id FROM anna_sd.tenants WHERE id=$1 AND active=true FOR SHARE',[tenantId]);
  if(tenant.rows.length!==1) throw Error('tenant unavailable');
  await client.query('INSERT INTO anna_sd.platform_users(id) VALUES($1)',[id]);
  await client.query('INSERT INTO anna_sd.local_credentials(user_id,email,password_hash) VALUES($1,$2,$3)',[id,email,hash]);
  await client.query("INSERT INTO anna_sd.memberships(tenant_id,user_id,role,status) VALUES($1,$2,$3,'active')",[tenantId,id,role]);
  await client.query('COMMIT');
  return {userId:id};
 } catch(err) {await client.query('ROLLBACK');throw err;}
}
module.exports={provision};
