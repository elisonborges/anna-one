import test from 'node:test';
import assert from 'node:assert/strict';
import { validCpf,validCnpj,actor } from '../src/index.js';
test('CPF',()=>{assert.equal(validCpf('52998224725'),true);assert.equal(validCpf('52998224724'),false);assert.equal(validCpf('00000000000'),false);});
test('CNPJ numérico e alfanumérico',()=>{assert.equal(validCnpj('11222333000181'),true);assert.equal(validCnpj('12ABC34501DE35'),true);assert.equal(validCnpj('12ABC34501DE34'),false);assert.equal(validCnpj('00000000000000'),false);});

const subject='00000000-0000-4000-8000-000000000001';
const bearer='Bearer e30.'+Buffer.from(JSON.stringify({sub:subject})).toString('base64url')+'.test';
const request=new Request('https://anna-one-business.example/v1/context',{headers:{Authorization:bearer}});
const binding=(status,data)=>({MASTER_AUTH:{fetch:async req=>{
 assert.equal(new URL(req.url).pathname,'/v1/admin/authorize');
 assert.equal(req.headers.get('Authorization'),bearer);
 assert.equal(req.headers.get('Origin'),'https://annaone.com.br');
 return Response.json(data,{status});
}}});
test('autorização central exige resposta afirmativa do Master',async()=>{
 assert.equal(await actor(request,binding(200,{authenticated:true,admin_authorized:true})),subject);
 await assert.rejects(actor(request,binding(200,{authenticated:true,admin_authorized:false})),{status:403});
 await assert.rejects(actor(request,binding(401,{})),{status:401});
 await assert.rejects(actor(request,{}),{status:503});
 await assert.rejects(actor(request,{MASTER_AUTH:{fetch:async()=>{throw Error('offline')}}}),{status:503});
 await assert.rejects(actor(new Request(request.url),binding(200,{})),{status:401});
});
