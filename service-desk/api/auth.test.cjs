'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {verifyToken} = require('./auth.cjs');
const {createTicketReader} = require('./tickets.cjs');
const cfg={SD_JWT_SECRET:'test-only-secret-not-for-production-123456789',SD_JWT_ISSUER:'test-issuer',SD_JWT_AUDIENCE:'service-desk'};
const user='d32fa7d5-e68c-45db-8a12-95a838be0234';
function token(claims={}) {
 const now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const p=Buffer.from(JSON.stringify({sub:user,iss:cfg.SD_JWT_ISSUER,aud:cfg.SD_JWT_AUDIENCE,iat:now,exp:now+300,...claims})).toString('base64url');
 const s=crypto.createHmac('sha256',cfg.SD_JWT_SECRET).update(h+'.'+p).digest('base64url');
 return 'Bearer '+h+'.'+p+'.'+s;
}
test('rejects unsigned, expired, wrong audience and forged identity',()=>{
 assert.equal(verifyToken(null,cfg),null);
 assert.equal(verifyToken(token({exp:1}),cfg),null);
 assert.equal(verifyToken(token({aud:'another'}),cfg),null);
 assert.equal(verifyToken(token({sub:'admin'}),cfg),null);
 assert.deepEqual(verifyToken(token(),cfg),{id:user});
});
test('handler uses verified identity and transaction-local restricted role',async()=>{
 const statements=[];
 const db={connect:async()=>({query:async(sql,args)=>{statements.push([sql,args]);return {rows:[]};},release(){}})};
 let response;
 const res={writeHead(status){this.status=status;},end(data){response=JSON.parse(data);}};
 await createTicketReader(()=>db,cfg)({headers:{authorization:token()}},res);
 assert.equal(res.status,200);
 assert.deepEqual(response,{tickets:[]});
 assert.equal(statements[0][0],'BEGIN');
 assert.equal(statements[1][0],'SET LOCAL ROLE anna_sd_api_runtime');
 assert.equal(statements[2][1][0],user);
 assert.equal(statements[4][0],'COMMIT');
});
