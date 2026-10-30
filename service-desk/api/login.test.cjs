'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createLoginHandler}=require('./login.cjs');
const {hashPassword}=require('./local-identity.cjs');
const {verifyToken}=require('./auth.cjs');
const cfg={SD_JWT_SECRET:'an-isolated-random-secret-at-least-32-bytes-long',SD_JWT_ISSUER:'anna-service-desk',SD_JWT_AUDIENCE:'anna-service-desk-api'};
const user_id='d32fa7d5-e68c-45db-8a12-95a838be0234';
async function invoke(password,found=true) {
 const statements=[];
 const db={connect:async()=>({query:async(sql,args)=>{statements.push(sql);if(sql.startsWith('SELECT rolname'))return {rows:[{rolname:'sd_login',rolsuper:false,rolbypassrls:false,rolcreaterole:false}]};if(sql.startsWith('SELECT user_id'))return {rows:found?[{user_id,password_hash:hashPassword('correct-horse-battery-staple'),enabled:true,failed_attempts:0,locked_until:null}]:[]};return {rows:[]};},release(){}})};
 const req=Readable.from([JSON.stringify({email:'user@example.org',password})]);
 const res={writeHead(status){this.status=status;},end(data){this.data=JSON.parse(data);}};
 await createLoginHandler(()=>db,cfg)(req,res);
 return {res,statements};
}
test('login returns valid 15 minute bearer token',async()=>{
 const {res,statements}=await invoke('correct-horse-battery-staple');
 assert.equal(res.status,200);
 assert.deepEqual(verifyToken('Bearer '+res.data.access_token,cfg),{id:user_id});
 assert.ok(statements.includes('SET LOCAL ROLE anna_sd_identity_runtime'));
 assert.ok(statements.includes('COMMIT'));
});
test('bad password and unknown user do not issue tokens',async()=>{
 for(const found of [true,false]) {
  const {res}=await invoke('wrong-password',found);
  assert.equal(res.status,401);
  assert.equal(res.data.access_token,undefined);
 }
});
