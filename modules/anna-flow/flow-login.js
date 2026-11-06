import {createAuthClient} from 'https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle';
const auth=createAuthClient('https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth');
const $=id=>document.getElementById(id),msg=s=>$('msg').textContent=s;
let token='',verifiedEmail='',institutions=[];
function mode(production){$('institutionForm').hidden=production;$('centralForm').hidden=!production;$('institution').classList.toggle('active',!production);$('central').classList.toggle('active',production);msg('')}
$('institution').onclick=()=>mode(false);$('central').onclick=()=>mode(true);
async function getJwt(session){let value=session?.data?.session?.access_token;if(typeof value==='string'&&value.split('.').length===3)return value;
const r=await fetch('https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth/token',{credentials:'include',cache:'no-store'});
if(!r.ok)throw Error('Não foi possível obter a autorização do Portal.');
const d=await r.json(),jwt=typeof d==='string'?d:d?.token||d?.data?.token||d?.access_token;
if(typeof jwt!=='string'||jwt.split('.').length!==3)throw Error('O Portal não retornou uma autorização válida.');
return jwt}
async function access(action,id){const r=await fetch('/api/portal-institution-auth',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,portalInstitutionId:id})});const d=await r.json();if(!r.ok)throw Error(d.error||'Acesso institucional indisponível');return d}
async function identify(){const email=$('email').value.trim().toLowerCase();
if(token&&verifiedEmail===email)return;
const password=$('password').value;if(!password)throw Error('Informe sua senha do Portal AnnA One.');
let signed=await auth.getSession(),user=signed?.data?.user||signed?.data?.session?.user;
if(!user||String(user.email||'').toLowerCase()!==email){signed=await auth.signIn.email({email,password});if(signed?.error)throw Error('E-mail ou senha do Portal inválidos.');signed=await auth.getSession();user=signed?.data?.user||signed?.data?.session?.user}
$('password').value='';
if(!user||String(user.email||'').toLowerCase()!==email)throw Error('A sessão do Portal não corresponde ao e-mail informado.');
token=await getJwt(signed);verifiedEmail=email;
const data=await access('lookup');institutions=data.institutions||[];
const select=$('client');if(!institutions.length){select.disabled=true;select.replaceChildren(new Option('Nenhuma instituição autorizada',''));throw Error('Esta conta não possui administração institucional do AnnA Flow habilitada no Portal.')}
select.replaceChildren(...(institutions.length>1?[new Option('Selecione uma instituição','')]:[]),...institutions.map(i=>new Option(i.name,String(i.id))));
select.disabled=institutions.length===1;
msg(institutions.length>1?'Selecione a instituição para continuar.':'Instituição encontrada no Portal AnnA One.')}
$('email').oninput=()=>{token='';verifiedEmail='';institutions=[];$('client').disabled=true;$('client').replaceChildren(new Option('Identificação após autenticação',''))};
$('institutionForm').onsubmit=async e=>{e.preventDefault();try{const previous=!!token&&verifiedEmail===$('email').value.trim().toLowerCase();if(!previous)await identify();if(institutions.length>1&&!previous)return;const id=$('client').value;if(!institutions.some(i=>i.id===id))throw Error('Selecione uma instituição autorizada.');const d=await access('login',id);sessionStorage.setItem('flowInstitutionAdmin',JSON.stringify({token:d.token,clientId:d.clientId}));location.replace('/admin.html#devices')}catch(e){msg(e.message)}};
let productionLast='',productionPending=null;
async function resolveProduction(){const email=$('centralEmail').value.trim().toLowerCase(),sel=$('productionClient');if(!$('centralEmail').validity.valid||!email)return false;if(email===productionLast&&sel.value)return true;if(productionPending)return productionPending;
productionPending=(async()=>{try{const r=await fetch('/api/institutions-by-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,mode:'production'})});const d=await r.json();if(!r.ok)throw Error(d.error||'Consulta indisponível');if(email!==$('centralEmail').value.trim().toLowerCase())return false;productionLast=email;const list=d.institutions||[];sel.replaceChildren(...(list.length>1?[new Option('Selecione uma instituição','')]:[]),...list.map(i=>new Option(i.name+' · ID '+i.id,String(i.id))));sel.disabled=list.length===1;if(!list.length){sel.replaceChildren(new Option('Nenhuma instituição vinculada',''));msg('Funcionário não cadastrado na Produção.');return false}msg(list.length>1?'Selecione a instituição.':'Instituição identificada.');return true}catch(e){msg(e.message);return false}finally{productionPending=null}})();return productionPending}
$('centralEmail').addEventListener('input',()=>{productionLast='';$('productionClient').disabled=true;$('productionClient').replaceChildren(new Option('Informe o e-mail primeiro',''))});
$('centralEmail').addEventListener('blur',resolveProduction);$('centralPassword').addEventListener('focus',resolveProduction);
$('centralForm').onsubmit=async e=>{e.preventDefault();try{if(!await resolveProduction()||!$('productionClient').value)throw Error('Selecione a instituição.');const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:Number($('productionClient').value),email:$('centralEmail').value,password:$('centralPassword').value})});const d=await r.json();$('centralPassword').value='';if(!r.ok)throw Error(d.error||'Acesso negado');if(d.role!=='atendente')throw Error('Perfil Atendimento necessário.');sessionStorage.setItem('flowProductionSession',JSON.stringify({token:d.token,clientId:d.clientId}));location.replace('/operator.html')}catch(e){msg(e.message)}};
