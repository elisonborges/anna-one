import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceDeskOrigin,serviceDeskTickets,verifyServiceDeskTicket} from '../src/service-desk.js';
import worker from '../src/index.js';
const origin='https://fixture-service-desk.annaone.com.br',token='Bearer e30.e30.fixture',inst='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',member='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000004';
const row={id,ticket_number:42,status:'open',priority:'normal',title:'private',description:'private'};
const json=(x,status=200)=>Response.json(x,{status});
const session={membership:{id:member,institution_id:inst}};
const stub=(payload)=>async(url,opts)=>{assert.ok(url.startsWith(origin+'/v1/'));assert.equal(opts.headers.Authorization,token);assert.equal(opts.headers['X-Institution-Id'],inst);assert.equal(opts.redirect,'error');assert.equal(opts.method,'GET');return json(url.endsWith('/session')?session:payload);};
test('110: configuração restrita e nenhuma chamada sem configuração',async()=>{
 assert.equal(serviceDeskOrigin(origin),origin);
 for(const bad of [undefined,'http://fixture-service-desk.annaone.com.br','https://annaone.com.br.evil.invalid','https://demo.github.io','https://a.annaone.com.br:444','https://x@y.annaone.com.br','https://a.annaone.com.br/path','https://a.annaone.com.br/?x=y'])assert.equal(serviceDeskOrigin(bad),null);
 let n=0;await assert.rejects(serviceDeskTickets('',token,inst,async()=>{n++;}),{status:503});assert.equal(n,0);
});
test('110: sessão institucional, listagem e detalhe minimizados',async()=>{
 assert.deepEqual(await serviceDeskTickets(origin,token,inst,stub({tickets:[row]})),[{id,number:'42',status:'open',priority:'normal'}]);
 assert.deepEqual(await verifyServiceDeskTicket(origin,token,inst,id,stub({ticket:row,events:[{details:'private'}]})),{id,number:'42',status:'open',priority:'normal'});
});
test('110: associação incompatível bloqueia antes de listar',async()=>{
 let calls=0;await assert.rejects(serviceDeskTickets(origin,token,inst,async()=>{calls++;return json({membership:{id:member,institution_id:other}});}),{status:403});assert.equal(calls,1);
});
test('110: erro de autenticação, instituição ou chamado negado',async()=>{
 for(const code of [401,403,404])await assert.rejects(verifyServiceDeskTicket(origin,token,inst,id,async(url)=>url.endsWith('/session')?json(session):json({},code)),{status:403});
 await assert.rejects(verifyServiceDeskTicket(origin,token,inst,id,stub({ticket:{...row,id:other}})),{status:503});
});
test('110: falha segura em indisponibilidade, HTML, duplicidade e formato inválido',async()=>{
 for(const f of [async()=>json({},429),async()=>json({},500),async()=>{throw Error('redirect');},async()=>new Response('<html>challenge</html>',{headers:{'Content-Type':'text/html'}}),async()=>new Response('{bad',{headers:{'Content-Type':'application/json'}})])await assert.rejects(serviceDeskTickets(origin,token,inst,f),{status:503});
 for(const data of [{tickets:[row,row]},{tickets:[{...row,status:'invalid'}]},{tickets:Array(101).fill(row)}])await assert.rejects(serviceDeskTickets(origin,token,inst,stub(data)),{status:503});
});
test('110: rotas exigem sessão Business',async()=>{
 for(const path of ['/v1/service-desk/status','/v1/service-desk/tickets','/v1/service-desk/ticket']){const r=await worker.fetch(new Request('https://business.example'+path),{DATABASE_URL:'postgresql://fixture:fixture@example.invalid/fixture',INTERNAL_TENANT_ID:inst});assert.equal(r.status,401);}
});
