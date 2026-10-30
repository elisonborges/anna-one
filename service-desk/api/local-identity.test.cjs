'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {hashPassword,verifyPassword,issueToken}=require('./local-identity.cjs');
const {verifyToken}=require('./auth.cjs');
test('password hashes use distinct salts and reject wrong passwords',()=>{
 const password='A-long-password-with-20-characters!';
 const a=hashPassword(password),b=hashPassword(password);
 assert.notEqual(a,b);
 assert.equal(verifyPassword(password,a),true);
 assert.equal(verifyPassword('wrong',a),false);
 assert.equal(verifyPassword(password,'malformed'),false);
 assert.throws(()=>hashPassword('short'));
});
test('locally issued JWT verifies and expires in 15 minutes',()=>{
 const cfg={SD_JWT_SECRET:'an-isolated-random-secret-at-least-32-bytes-long',SD_JWT_ISSUER:'anna-service-desk',SD_JWT_AUDIENCE:'anna-service-desk-api'};
 const id='d32fa7d5-e68c-45db-8a12-95a838be0234';
 const jwt=issueToken(id,cfg);
 assert.deepEqual(verifyToken('Bearer '+jwt,cfg),{id});
 const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));
 assert.equal(claims.exp-claims.iat,900);
 assert.equal(verifyToken('Bearer '+jwt,{...cfg,SD_JWT_SECRET:'another-long-secret-with-32-bytes-at-least'}),null);
});
