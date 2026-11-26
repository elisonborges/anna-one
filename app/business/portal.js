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
async function refreshPortal(){const rev=++revision,b=$('portal-refresh'),host=$('portal-grants'),status=$('portal-status');host.replaceChildren();b.disabled=true;status.textContent='Verificando identidade e concessões...';try{const jwt=await getJwt();const response=await fetch(REGISTRY_URL+'/v1/portal/me',{headers:{Authorization:'Bearer '+jwt},cache:'no-store'});const d=await response.json().catch(()=>null);if(!response.ok)throw Error(d?.error||'Consulta indisponível.');if(rev!==revision)return;if(!Array.isArray(d?.grants))throw Error('Resposta inválida.');for(const g of d.grants){const article=node('article',undefined,'business-card');article.append(node('h2',roles[g.portal_role]||'Acesso externo'),node('p','Vigência: '+g.valid_from+' a '+g.valid_until),node('p','Empresa: '+g.company_id,'muted small'),node('p','Parceiro: '+g.party_id,'muted small'));host.append(article);}status.textContent=d.grants.length?'Concessões vigentes: '+d.grants.length:'Nenhuma concessão vigente para esta identidade.';}catch(e){if(rev===revision){host.replaceChildren();status.textContent=e.message;}}finally{if(rev===revision)b.disabled=false;}}
$('portal-refresh').addEventListener('click',refreshPortal);$('portal-theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('portal-theme').textContent=dark?'Tema claro':'Tema escuro';});
refreshPortal();
