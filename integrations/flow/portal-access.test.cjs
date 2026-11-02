'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {makePortalAccessCheck}=require('./portal-access.cjs');
const valid={authorized:true,institution_id:'00000000-0000-4000-8000-000000000001'};
const config={url:'https://portal.example/v1/internal/flow/access',token:'a'.repeat(48)};
test('autoriza apenas resposta positiva e identificada',async()=>{
 const check=makePortalAccessCheck({...config,fetchImpl:async(_url,opts)=>{assert.equal(opts.method,'POST');assert.equal(opts.headers['X-Flow-Service-Token'],config.token);return {ok:true,json:async()=>valid}}});
 assert.equal(await check(3),true);
});
test('nega respostas inválidas, falhas de rede e configuração incompleta',async()=>{
 for(const data of [{authorized:false}, {authorized:true}, {authorized:'true',institution_id:valid.institution_id}]){
  const check=makePortalAccessCheck({...config,fetchImpl:async()=>({ok:true,json:async()=>data})});
  assert.equal(await check(3),false);
 }
 assert.equal(await makePortalAccessCheck({...config,fetchImpl:async()=>{throw Error('offline')}})(3),false);
 assert.equal(await makePortalAccessCheck({...config,fetchImpl:async()=>({ok:false})})(3),false);
 assert.equal(await makePortalAccessCheck({token:'short'})(3),false);
 assert.equal(await makePortalAccessCheck(config)(0),false);
});
