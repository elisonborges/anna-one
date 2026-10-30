'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const tenant=require('../tenant-api'),panel=require('../panel-api');
const send=(res,status,payload)=>{res.status=status;res.data=payload;return payload};
const authToken='f_'+'a'.repeat(64),tokenHash=crypto.createHash('sha256').update(authToken).digest('hex');
function request(url,method='GET',payload=null){return {url,method,headers:{authorization:'Bearer '+authToken},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(payload)yield JSON.stringify(payload)}}}
test('nega acesso de atendente a unidade de outro cliente antes de ler filas',async()=>{
let reads=[];
const pool={async query(sql,args){reads.push(sql);if(sql.includes('FROM flow_sessions')){assert.equal(args[0],tokenHash);return {rows:[{id:11,client_id:3,role:'atendente',active:true,session_id:'s'}],rowCount:1}}if(sql.includes('FROM flow_user_units'))return {rows:[],rowCount:0};throw Error('Acesso indevido à fila')}};
const res={};await tenant(request('/api/tenant?unit=99'),res,{pool,auth:()=>false,send});
assert.equal(res.status,403);assert.equal(reads.length,2);
});
test('nega acesso sem credenciais',async()=>{
const pool={async query(){throw Error('Não deveria consultar banco')}};
const res={};await tenant({url:'/api/tenant?unit=1',method:'GET',headers:{}},res,{pool,auth:()=>false,send});assert.equal(res.status,401)
});
test('painel público filtra chamadas e histórico para serviços vinculados',async()=>{
const key='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
let count=0;const pool={async query(sql){count++;if(sql.includes('FROM flow_signage_profiles'))return {rowCount:1,rows:[{id:7,unit_id:40,name:'Recepção',theme:'escuro',notice:'Aguarde',messages:['Olá'],unit_name:'Centro',client_name:'Clínica Exemplo'}]};if(sql.includes('FROM flow_panel_service_links'))return {rows:[{id:21,name:'Recepção'}]};if(sql.includes('FROM flow_client_runtime'))return {rows:[{revision:2,state:{queue:[{serviceId:21,code:'A-21-001'},{serviceId:22,code:'A-22-001'}],current:{serviceId:22,code:'A-22-009'},history:[{serviceId:22,code:'A-22-008'},{serviceId:21,code:'A-21-008',status:'chamado',destination:'Guichê 1'}]}}]};throw Error('SQL inesperado')}};
const res={};await panel({url:'/api/panel?key='+key,method:'GET'},res,{pool,send});
assert.equal(res.status,200);assert.equal(res.data.waiting,1);assert.equal(res.data.current,null);assert.equal(res.data.history.length,1);assert.equal(res.data.history[0].serviceId,21);assert.equal(count,3);
});
test('chave de painel inválida não consulta banco',async()=>{
const res={};await panel({url:'/api/panel?key=1',method:'GET'},res,{pool:{query(){throw Error('Consulta indevida')}},send});assert.equal(res.status,400)
});
