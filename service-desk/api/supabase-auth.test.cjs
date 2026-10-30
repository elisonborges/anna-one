'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSupabaseVerifier}=require('./supabase-auth.cjs');
const config={SD_SUPABASE_URL:'https://example-project.supabase.co',SD_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const token='Bearer abc.def.ghi';
const id='d32fa7d5-e68c-45db-8a12-95a838be0234';
test('accepts only Supabase Auth validated authenticated user',async()=>{
 let called=0;
 const verify=createSupabaseVerifier(config,async(url,opts)=>{called++;assert.equal(url,'https://example-project.supabase.co/auth/v1/user');assert.equal(opts.headers.authorization,token);return {ok:true,json:async()=>({id,aud:'authenticated'})};});
 assert.deepEqual(await verify(token),{id});
 assert.equal(called,1);
 assert.equal(await verify('Bearer bad'),null);
 assert.equal(called,1);
});
test('rejects revoked tokens, malformed user and network failure',async()=>{
 assert.equal(await createSupabaseVerifier(config,async()=>({ok:false}))(token),null);
 assert.equal(await createSupabaseVerifier(config,async()=>({ok:true,json:async()=>({id,aud:'anon'})}))(token),null);
 assert.equal(await createSupabaseVerifier(config,async()=>{throw Error('secret error');})(token),null);
});
