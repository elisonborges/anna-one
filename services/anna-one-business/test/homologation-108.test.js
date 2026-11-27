import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{actor} from '../src/index.js';
const uid='00000000-0000-4000-8000-000000000003';
const tenant='00000000-0000-4000-8000-000000000001';
const token='e30.'+Buffer.from(JSON.stringify({sub:uid})).toString('base64url')+'.fixture';
const url='https://anna-one-business.example';
const request=(path,method='GET')=>new Request(url+path,{method,headers:{Authorization:'Bearer '+token}});
const env={DATABASE_URL:'postgresql://fixture:fixture@example.invalid/fixture',INTERNAL_TENANT_ID:tenant};
const json=(data,status=200)=>Response.json(data,{status});
const targets=[['/v1/business-integrity','GET'],['/v1/operations/asset-links','GET'],['/v1/operations/external-links','POST'],['/v1/tax/rules','POST'],['/v1/tax/simulations','POST'],['/v1/ledger/entries','POST'],['/v1/connect/events','GET']];
test('108: nega acesso central antes de consultar banco em todos os fluxos',async()=>{
 for(const [path,method] of targets){
  for(const [status,expected] of [[401,401],[403,403],[503,503]]){
   let calls=0;
   const r=await worker.fetch(request(path,method),{...env,MASTER_AUTH:{fetch:async req=>{calls++;assert.equal(req.headers.get('Authorization'),'Bearer '+token);return json({},status);}}});
   assert.equal(r.status,expected,path);assert.equal(calls,1,path);assert.equal(r.headers.get('Cache-Control'),'no-store');
  }
 }
});
test('108: identidade sem autorização administrativa, resposta inválida e indisponibilidade',async()=>{
 for(const [master,expected] of [
  [async()=>json({authenticated:true,admin_authorized:false}),403],
  [async()=>new Response('not json'),503],
  [async()=>{throw Error('offline');},503]
 ]){
  const r=await worker.fetch(request('/v1/business-integrity'),{...env,MASTER_AUTH:{fetch:master}});assert.equal(r.status,expected);
 }
});
test('108: identidade UUID vinculada ao mesmo token verificado',async()=>{
 const out=await actor(request('/v1/business-integrity'),{MASTER_AUTH:{fetch:async req=>{assert.equal(req.headers.get('Authorization'),'Bearer '+token);return json({authenticated:true,admin_authorized:true});}}});
 assert.equal(out,uid);
});
