import test from 'node:test';
import assert from 'node:assert/strict';
import {nexusOrganizations,nexusProjects,verifyNexusProject} from '../src/nexus.js';
import worker from '../src/index.js';
const token='Bearer e30.e30.fixture',org='00000000-0000-4000-8000-000000000001',project='00000000-0000-4000-8000-000000000002',prod='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000004';
const json=(x,status=200)=>Response.json(x,{status});
const data={projects:[{id:project,name:'Projeto',card_type:'project',completion_status:'active',owner_subject:'private',description:'private'},{id:prod,name:'Produção',card_type:'production'}]};
test('109: consulta fixa, bearer, sem redirecionamento, retorno mínimo',async()=>{
 const rows=await nexusOrganizations(token,async(url,opts)=>{assert.equal(url,'https://nexus.annaone.com.br/api/me');assert.equal(opts.headers.Authorization,token);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return json({organizations:[{id:org,name:'Organização',logo_url:'private',role:'admin'}]});});
 assert.deepEqual(rows,[{id:org,name:'Organização'}]);
 const projects=await nexusProjects(token,org,async(url,opts)=>{assert.equal(url,'https://nexus.annaone.com.br/api/projects?org='+org);assert.equal(opts.redirect,'error');return json(data);});
 assert.deepEqual(projects,[{id:project,name:'Projeto',kind:'project',status:'active',paused:false}]);
});
test('109: verificação rejeita projeto ausente ou card de produção',async()=>{
 assert.equal((await verifyNexusProject(token,org,project,async()=>json(data))).id,project);
 for(const id of [other,prod])await assert.rejects(verifyNexusProject(token,org,id,async()=>json(data)),{status:409});
});
test('109: sessão ou organização inválida não dispara chamadas',async()=>{
 let count=0;const f=async()=>{count++;return json(data);};
 await assert.rejects(nexusProjects(token,'https://other.invalid',f),{status:400});
 await assert.rejects(nexusProjects('invalid',org,f),{status:401});assert.equal(count,0);
});
test('109: falha segura para 401, 403, 429, redirect, HTML, JSON inválido e duplicidade',async()=>{
 for(const status of [401,403])await assert.rejects(nexusProjects(token,org,async()=>json({},status)),{status:403});
 for(const f of [async()=>json({},429),async()=>json({},500),async()=>{throw Error('redirect');},async()=>new Response('<html>challenge</html>',{headers:{'Content-Type':'text/html'}}),async()=>new Response('{bad',{headers:{'Content-Type':'application/json'}}),async()=>json({projects:[data.projects[0],data.projects[0]]}),async()=>json({projects:[{id:'bad',name:'x',card_type:'project'}]})])await assert.rejects(nexusProjects(token,org,f),{status:503});
});
test('109: limite de resposta e listagem',async()=>{
 await assert.rejects(nexusProjects(token,org,async()=>json({projects:Array(501).fill(data.projects[0])})),{status:503});
 await assert.rejects(nexusProjects(token,org,async()=>json({padding:'x'.repeat(1048577),projects:[]})),{status:503});
});
test('109: novas rotas exigem sessão Business',async()=>{
 const env={DATABASE_URL:'postgresql://fixture:fixture@example.invalid/fixture',INTERNAL_TENANT_ID:org};
 for(const p of ['/v1/nexus/organizations','/v1/nexus/projects']){const r=await worker.fetch(new Request('https://business.example'+p),env);assert.equal(r.status,401);}
});
