// Teste não destrutivo do AnnA Flow publicado.
// Uso: FLOW_BASE_URL=https://endereco.exemplo node scripts/smoke.mjs
import assert from 'node:assert/strict';
const base=(process.env.FLOW_BASE_URL||'').replace(/\/$/,'');
if(!/^https:\/\//.test(base)){console.error('Defina FLOW_BASE_URL com URL HTTPS válida.');process.exit(1)}
async function json(route,options){const res=await fetch(base+route,{signal:AbortSignal.timeout(12000),...options});const body=await res.json();return {res,body}}
const h=await json('/health');assert.equal(h.res.status,200);assert.equal(h.body.ok,true);
const s=await json('/api/state');assert.equal(s.res.status,200);assert.ok(Array.isArray(s.body.state.services));assert.ok(Array.isArray(s.body.state.queue));
const unauthorized=await json('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'issue',service:s.body.state.services[0]})});assert.equal(unauthorized.res.status,401);
console.log('OK: health, estado público e bloqueio de escrita anônima. Nenhum dado alterado.');
