'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','tenant-api.js'),'utf8');
const sandbox={module:{exports:{}},exports:{},require,Date,Intl,Number,Object,Array,Error,String,JSON};
vm.runInNewContext(source+'\nmodule.exports._nextTicketNumber=nextTicketNumber;',sandbox,{filename:'tenant-api.js'});
const next=sandbox.module.exports._nextTicketNumber;
const at=(day,hour=13)=>new Date(day+'T'+hour+':00:00Z');
function state(){return {counters:{'2:normal':8},queue:[],currents:{},noShows:[],ticketSettings:{startNumber:3,openingTime:'08:30',timezone:'America/Fortaleza'}}}
test('preserva contador na primeira emissão após migração',()=>{
 const s=state(),v=next(s,'2:normal',at('2026-11-06'));
 assert.equal(v.number,9);assert.equal(v.day,'2026-11-06');assert.equal(v.openingTime,'08:30');
});
test('mudança de número inicial só passa a valer no dia seguinte',()=>{
 const s=state();next(s,'2:normal',at('2026-11-06'));
 s.ticketSettings.startNumber=100;
 assert.equal(next(s,'2:normal',at('2026-11-06',14)).number,10);
 assert.equal(next(s,'2:normal',at('2026-11-07')).number,100);
});
test('não duplica senha pendente de dia anterior',()=>{
 const s=state();next(s,'2:normal',at('2026-11-06'));
 s.queue.push({code:'A-2-103',priority:'normal',serviceId:2});
 assert.equal(next(s,'2:normal',at('2026-11-07')).number,104);
});
test('sequência preferencial é independente',()=>{
 const s=state();next(s,'2:normal',at('2026-11-06'));
 assert.equal(next(s,'2:preferencial',at('2026-11-06')).number,3);
});
test('horário malformado não aparece no comprovante',()=>{
 const s=state();s.ticketSettings.openingTime='99:99';
 assert.equal(next(s,'2:normal',at('2026-11-06')).openingTime,'');
});
