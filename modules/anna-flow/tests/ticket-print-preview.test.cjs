'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'..','issue.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','issue.html'),'utf8');
test('test print is independent from real issue API',()=>{
 const from=script.indexOf('function sampleReceipt()'),to=script.indexOf('function clearReceipt()',from);
 assert.ok(from>=0&&to>from);
 const sample=script.slice(from,to);
 assert.ok(sample.includes('showReceipt('));
 assert.ok(!sample.includes('fetch(')&&!sample.includes("api('/api/tenant"));
 assert.ok(script.includes("$('testPrint').onclick=sampleReceipt"));
});
test('test tickets have a visible non-valid watermark',()=>{
 assert.match(html,/id="receiptSample"/);
 assert.match(html,/AMOSTRA — NÃO VÁLIDA/);
 assert.match(html,/\.receipt\[data-sample="true"\] \.receipt-sample/);
 assert.ok(script.includes("$('receipt').dataset.sample='true'"));
});
test('real tickets clear test watermark',()=>{
 assert.ok(script.includes("$('receipt').dataset.sample='false';$('receiptSample').hidden=true;"));
});
test('changing unit hides older printed receipt',()=>{
 assert.ok(script.includes("$('unit').onchange=()=>{clearReceipt()"));
});
test('ticket identifies system version and printed widths',()=>{
 assert.ok(html.includes('Sistema: AnnA Flow · Versão 1.5.17'));
 for(const size of ['58','80','a4'])assert.ok(html.includes('value="'+size+'"'));
});
