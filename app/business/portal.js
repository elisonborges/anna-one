import { renderCustomerServices } from './customer-services.js';
import { createAccountingZip } from './accounting-zip.js';
import { renderAccountingCenter, accountingManifest, accountingDocuments } from './accounting-center.js';
// Identidade central e leitura exclusiva do portal.
const AUTH_URL='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const REGISTRY_URL='https://anna-one-business.elisonborg.workers.dev';
const $=id=>document.getElementById(id);
const node=(tag,value,cls)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(cls)el.className=cls;return el;};
let authClient=null,revision=0;
class AccessError extends Error{}
async function getJwt(){
 if(!authClient){const sdk=await import('https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle');authClient=sdk.createAuthClient(AUTH_URL);}
 const result=await authClient.getSession();
 const user=result?.data?.user||result?.data?.session?.user;
 if(!user)throw new AccessError('Sessão ausente. Entre com sua conta AnnA One.');
 const valid=v=>typeof v==='string'&&v.split('.').length===3;
 const session=result?.data?.session;
 if(valid(session?.access_token))return session.access_token;
 for(const name of ['getJWTToken','getJwtToken','token'])if(typeof authClient[name]==='function'){
  try{const r=await authClient[name]();const candidate=typeof r==='string'?r:r?.token||r?.data?.token||r?.data?.jwt||r?.data?.access_token||r?.data?.session?.access_token||r?.data?.session?.token;if(valid(candidate))return candidate;}catch{}
 }
 if(valid(session?.token))return session.token;
 throw new AccessError('Credencial JWT indisponível. Entre novamente pelo login central.');
}

const roles={customer:'Cliente',accountant:'Contador'};
async function portalRequest(path,method='GET',payload){const jwt=await getJwt();const response=await fetch(REGISTRY_URL+path,{method,headers:{Authorization:'Bearer '+jwt,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'});const d=await response.json().catch(()=>null);if(!response.ok)throw Error(d?.error||'Consulta indisponível.');return d;}
async function downloadPublication(p,button,status,rev){button.disabled=true;status.textContent='Conferindo autorização e integridade...';try{const d=await portalRequest('/v1/portal/publications/'+encodeURIComponent(p.id)+'/download');if(rev!==revision)return;const x=d?.item;if(!x||typeof x.content!=='string'||x.content.length>1398104||x.sha256_hex!==p.sha256_hex||x.size_bytes!==p.size_bytes)throw Error('Versão inválida. Atualize o portal.');const bytes=Uint8Array.from(atob(x.content),c=>c.charCodeAt(0)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==p.sha256_hex||bytes.length!==p.size_bytes||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw Error('Integridade não confirmada.');if(rev!==revision)return;const filename=String(p.filename).replace(/[/\\\u0000-\u001f\u007f]/g,'_'),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),link=node('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);status.textContent='Arquivo conferido. Download solicitado.';}catch(e){if(rev===revision)status.textContent=e.message;}finally{if(rev===revision)button.disabled=false;}}
async function exportAccounting(items,button,status,rev){
 button.disabled=true;status.textContent='Revalidando concessões...';
 try{
  if(!items.length||new Set(items.map(p=>p.grant_id)).size!==1)throw Error('Selecione uma única concessão para exportar o pacote.');
  const check=async()=>{const d=await portalRequest('/v1/portal/me');if(rev!==revision)throw Error('Consulta substituída.');const live=new Map(accountingDocuments(d.grants,d.publications).map(p=>[p.id,p]));const rows=items.map(p=>live.get(p.id));if(rows.some((p,i)=>!p||p.sha256_hex!==items[i].sha256_hex||p.grant_id!==items[i].grant_id))throw Error('Autorização ou versão alterada. Atualize o portal.');return rows;};
  const verified=await check();const entries=[];
  for(const [i,p] of verified.entries()){
   status.textContent='Conferindo PDF '+(i+1)+' de '+verified.length+'...';
   const d=await portalRequest('/v1/portal/publications/'+encodeURIComponent(p.id)+'/download');if(rev!==revision)return;
   const x=d?.item;if(!x||typeof x.content!=='string'||x.content.length>1398104||x.sha256_hex!==p.sha256_hex||x.size_bytes!==p.size_bytes)throw Error('Arquivo indisponível ou alterado.');
   const bytes=Uint8Array.from(atob(x.content),c=>c.charCodeAt(0)),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==p.sha256_hex||bytes.length!==p.size_bytes||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw Error('Integridade não confirmada.');
   entries.push({name:p.id+'.pdf',bytes});
  }
  await check();if(rev!==revision)return;
  const manifest=accountingManifest(verified);manifest.documents.forEach((p,i)=>p.archive_filename=entries[i].name);
  entries.push({name:'manifesto.json',bytes:new TextEncoder().encode(JSON.stringify(manifest,null,2))});
  const url=URL.createObjectURL(createAccountingZip(entries)),link=node('a');
  link.href=url;link.download='anna-central-contabil.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  status.textContent='Pacote conferido. Download solicitado.';
 }catch(e){if(rev===revision)status.textContent=e.message;}finally{if(rev===revision)button.disabled=false;}
}
async function refreshPortal(){const rev=++revision,b=$('portal-refresh'),host=$('portal-grants'),docs=$('portal-documents'),status=$('portal-status');host.replaceChildren();docs.replaceChildren();$('accounting-center').replaceChildren();$('accounting-center').hidden=true;$('customer-services').replaceChildren();$('customer-services').hidden=true;b.disabled=true;status.textContent='Verificando identidade e concessões...';try{const d=await portalRequest('/v1/portal/me');if(rev!==revision)return;if(!Array.isArray(d?.grants)||!Array.isArray(d?.publications))throw Error('Resposta inválida.');for(const g of d.grants){const article=node('article',undefined,'business-card'),related=d.publications.filter(p=>p.grant_id===g.id),sample=related[0];article.append(node('h2',roles[g.portal_role]||'Acesso externo'),node('p','Vigência: '+g.valid_from+' a '+g.valid_until),node('p',sample?sample.company_name+' / '+sample.party_name:'Escopo '+g.id,'muted small'),node('p',related.length+' documento(s) compartilhado(s)'));host.append(article);}renderAccountingCenter($('accounting-center'),d.grants,d.publications,(p,button,message)=>downloadPublication(p,button,message,rev),(items,button,message)=>exportAccounting(items,button,message,rev),Array.isArray(d.accounting_pendencies)?d.accounting_pendencies:[]);for(const p of d.publications){const g=d.grants.find(g=>g.id===p.grant_id);if(!g||g.portal_role==='accountant')continue;const article=node('article',undefined,'business-card'),button=node('button','Baixar PDF','btn light'),message=node('p','','muted small');button.type='button';message.setAttribute('role','status');article.append(node('h3',p.title+' · v'+p.version_no),node('p',p.company_name+' / '+p.party_name),node('p',roles[g.portal_role]+' · '+p.category+' · '+p.reference,'muted small'),node('p',p.filename+' · '+Math.ceil(p.size_bytes/1024)+' KiB'),button,message);button.addEventListener('click',()=>downloadPublication(p,button,message,rev));docs.append(article);}if(!docs.children.length)docs.append(node('p','Nenhum documento compartilhado.'));if(d.grants.some(g=>g.portal_role==='customer')){try{const services=await portalRequest('/v1/portal/services');if(rev!==revision)return;if(!Array.isArray(services?.items))throw Error('Resposta de serviços inválida.');renderCustomerServices($('customer-services'),d.grants,services.items,async payload=>{if(rev!==revision)throw Error('Atualize o portal.');const r=await portalRequest('/v1/portal/services','POST',payload);if(!r?.item?.case_id)throw Error('Confirmação não recebida.');if(rev===revision)await refreshPortal();});}catch(err){if(rev!==revision)return;$('customer-services').hidden=false;$('customer-services').append(node('p','Serviços: '+err.message));}}status.textContent=d.grants.length?'Concessões vigentes: '+d.grants.length:'Nenhuma concessão vigente para esta identidade.';}catch(e){if(rev===revision){host.replaceChildren();docs.replaceChildren();$('accounting-center').replaceChildren();$('accounting-center').hidden=true;$('customer-services').replaceChildren();$('customer-services').hidden=true;status.textContent=e.message;}}finally{if(rev===revision)b.disabled=false;}}
$('portal-refresh').addEventListener('click',refreshPortal);$('portal-theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('portal-theme').textContent=dark?'Tema claro':'Tema escuro';});
refreshPortal();
