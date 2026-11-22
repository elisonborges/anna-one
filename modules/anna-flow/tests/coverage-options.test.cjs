'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const coverage=require('../coverage-api');
test('instituições não configuradas mantêm emissão clássica',()=>{
 assert.deepEqual(coverage.normalized(null),{enabled:false,allowPrivate:true,providers:[]});
});
test('configura modalidade particular sem cadastrar convênios',()=>{
 assert.equal(coverage.validate({enabled:true,allowPrivate:true,providers:[]}).enabled,true);
});
test('configura convênios e desabilita particular',()=>{
 const x=coverage.validate({enabled:true,allowPrivate:false,providers:['Unimed','Outro convênio']});
 assert.deepEqual(x.providers,['Unimed','Outro convênio']);
});
test('não aceita modalidade sem alternativa de atendimento',()=>{
 assert.throws(()=>coverage.validate({enabled:true,allowPrivate:false,providers:[]}));
});
test('não aceita nomes duplicados ou insuficientes',()=>{
 assert.throws(()=>coverage.validate({enabled:true,allowPrivate:true,providers:['A']}));
 assert.throws(()=>coverage.validate({enabled:true,allowPrivate:true,providers:['Plano ABC','plano abc']}));
});
test('limite de 30 convênios por unidade',()=>{
 assert.throws(()=>coverage.validate({enabled:true,allowPrivate:true,providers:Array.from({length:31},(_,i)=>'Plano '+i)}));
});
test('configuração de cada unidade é independente',()=>{
 const a=coverage.validate({enabled:true,allowPrivate:true,providers:['Plano A']});
 const b=coverage.validate({enabled:true,allowPrivate:false,providers:['Plano B']});
 assert.notDeepEqual(a,b);
});
