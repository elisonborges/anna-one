// AnnA Business — incremento 01: consultas protegidas, sem escrita.
const WORKER='https://anna-one-auditoria.elisonborg.workers.dev';
const AUTH_URL='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const $=id=>document.getElementById(id);
const node=(tag,value,cls)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(cls)el.className=cls;return el;};
const txt=(id,value)=>{$(id).textContent=String(value);};
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const kind=item=>['matrix','branch','independent'].includes(item.organization_kind)?item.organization_kind:'unknown';
const labels={matrix:'Matriz',branch:'Filial',independent:'Independente',unknown:'Não informada',active:'Ativa',suspended:'Suspensa'};
const areas=['Estrutura corporativa','Comercial e marketing','Financeiro e tesouraria','Fiscal e tributário','Contabilidade e controladoria','RH e departamento pessoal','Suprimentos e operações','Patrimônio e infraestrutura','Serviços e projetos','Governança e qualidade','Processos e automação','Estratégia e inteligência'];
for(const [i,name] of areas.entries()){const card=node('article',undefined,'business-card');card.append(node('h3',name),node('p',i===0?'Fundação em desenvolvimento':'Planejado','module-state'));$('module-list').append(card);}
let authClient=null, institutions=[],groups=[],groupsAvailable=false,authorized=false,loading=false,revision=0,profileRevision=0;
const themeButton=$('theme');
function applyTheme(dark){document.documentElement.dataset.theme=dark?'dark':'light';themeButton.setAttribute('aria-pressed',String(dark));themeButton.textContent=dark?'Tema claro':'Tema escuro';}
let theme='light';try{theme=localStorage.getItem('anna-business-theme')||'light';}catch{}applyTheme(theme==='dark');
themeButton.addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';applyTheme(dark);try{localStorage.setItem('anna-business-theme',dark?'dark':'light');}catch{}});
function clearProfile(){profileRevision++;$('profile').hidden=true;$('profile-fields').replaceChildren();txt('profile-status','');}
function resetWorkspace(){resetRegistry();authorized=false;institutions=[];groups=[];groupsAvailable=false;clearProfile();$('workspace').hidden=true;$('access').hidden=false;$('institution-rows').replaceChildren();$('group-list').replaceChildren();for(const id of ['metric-total','metric-active','metric-matrix','metric-groups'])txt(id,'—');txt('result-count','');txt('groups-status','');txt('data-status','Aguardando consulta…');}
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
async function read(path,jwt){
 const response=await fetch(WORKER+path,{method:'GET',headers:{Authorization:'Bearer '+jwt},cache:'no-store'});
 if(response.status===401||response.status===403)throw new AccessError('Acesso não autorizado ou sessão expirada.');
 if(!response.ok)throw new Error('Consulta indisponível (HTTP '+response.status+').');
 return response.json();
}
async function authorize(jwt){const data=await read('/v1/admin/authorize',jwt);if(data?.authenticated!==true||data?.admin_authorized!==true)throw new AccessError('Acesso Master não autorizado pelo servidor.');}
function items(data){if(!Array.isArray(data?.items))throw new Error('Resposta administrativa inválida.');return data.items.filter(x=>x&&typeof x.id==='string');}
function render(){
 txt('metric-total',institutions.length);txt('metric-active',institutions.filter(x=>x.status==='active').length);txt('metric-matrix',institutions.filter(x=>kind(x)==='matrix').length);txt('metric-groups',groupsAvailable?groups.length:'—');renderInstitutions();renderGroups();
}
function renderInstitutions(){
 const query=norm($('search').value.trim()),k=$('kind').value,s=$('status-filter').value;
 const matches=institutions.filter(x=>(!query||norm(x.name+' '+(x.client_code||'')).includes(query))&&(!k||kind(x)===k)&&(!s||x.status===s)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
 const rows=$('institution-rows');rows.replaceChildren();txt('result-count',matches.length+' de '+institutions.length+' instituição(ões).');
 if(!matches.length){const tr=node('tr');const td=node('td','Nenhuma instituição encontrada.');td.colSpan=5;tr.append(td);rows.append(tr);return;}
 for(const item of matches){const tr=node('tr');for(const value of [item.name||'—',item.client_code||'—',labels[kind(item)],labels[item.status]||'Não informada'])tr.append(node('td',value));const td=node('td'),button=node('button','Consultar','btn light');button.type='button';button.addEventListener('click',()=>openProfile(item));td.append(button);tr.append(td);rows.append(tr);}
}
function renderGroups(){
 const box=$('group-list');box.replaceChildren();
 txt('groups-status',!groupsAvailable?'Consulta de grupos indisponível. Não é possível determinar a quantidade.':groups.length?'Vínculos diretos registrados no Master; não representam propriedade jurídica.':'Nenhum grupo cadastrado.');
 if(!groupsAvailable)return;
 for(const g of groups){const card=node('article',undefined,'business-card');card.append(node('h3',g.name||'Grupo sem nome'));const members=institutions.filter(x=>x.group_id===g.id);card.append(node('p',members.length+' vínculo(s) direto(s).','muted'));if(members.length){const ul=node('ul');for(const m of members)ul.append(node('li',m.name||'—'));card.append(ul);}box.append(card);}
}
const profileLabels={legal_name:'Razão social',tax_id:'CNPJ informado',acronym:'Sigla',website:'Site',email:'E-mail institucional',phone:'Telefone',address_city:'Município',address_state:'UF',address_postal_code:'CEP'};
function profileField(label,value){const div=node('div');div.append(node('dt',label),node('dd',value??'—'));$('profile-fields').append(div);}
async function openProfile(item){
 if(!authorized)return;
 const req=++profileRevision,rev=revision;$('profile').hidden=false;txt('profile-name',item.name||'Ficha institucional');txt('profile-status','Carregando perfil cadastral…');$('profile-fields').replaceChildren();$('profile').focus();
 profileField('Código CLI',item.client_code||'—');profileField('Classificação',labels[kind(item)]);profileField('Matriz vinculada',item.parent_institution_id?(institutions.find(x=>x.id===item.parent_institution_id)?.name||'Vínculo não encontrado'):'—');profileField('Grupo direto',item.group_id?(groups.find(x=>x.id===item.group_id)?.name||'Vínculo não identificado'):'—');
 try{const jwt=await getJwt();await authorize(jwt);const data=await read('/v1/admin/institutions/'+encodeURIComponent(item.id)+'/profile',jwt);if(req!==profileRevision||rev!==revision||!authorized)return;if(!data?.item||typeof data.item!=='object')throw new Error('Perfil não disponível.');for(const [key,label] of Object.entries(profileLabels)){const value=data.item[key];profileField(label,typeof value==='string'&&value.trim()?value:'—');}txt('profile-status','Dados consultados na origem. Nenhum registro alterado.');}
 catch(e){if(req!==profileRevision||rev!==revision)return;if(e instanceof AccessError){resetWorkspace();txt('auth-status',e.message);}else txt('profile-status','Perfil indisponível. Tente novamente.');}
}
async function load(){
 if(loading)return;
 loading=true;const rev=++revision;resetWorkspace();$('retry').disabled=true;$('refresh').disabled=true;txt('auth-status','Verificando autorização e carregando cadastro…');
 try{
  const jwt=await getJwt();await authorize(jwt);
  const source=items(await read('/v1/admin/institutions',jwt));
  let gs=[],available=false;try{gs=items(await read('/v1/admin/institution-groups',jwt));available=true;}catch(e){if(e instanceof AccessError)throw e;}
  if(rev!==revision||location.hash!=='#painel')return;
  institutions=source;groups=gs;groupsAvailable=available;authorized=true;render();$('access').hidden=true;$('workspace').hidden=false;txt('data-status','Consulta protegida concluída. Dados em memória, sem gravação no navegador ou no banco.');
 }catch(e){if(rev!==revision)return;resetWorkspace();txt('auth-status',e instanceof AccessError?e.message:'Não foi possível consultar o serviço existente. Verifique a conexão e tente novamente.');}
 finally{loading=false;$('retry').disabled=false;$('refresh').disabled=false;if(rev!==revision&&location.hash==='#painel')load();}
}
function showView(view){for(const b of document.querySelectorAll('[data-view]')){const active=b.dataset.view===view;b.setAttribute('aria-pressed',String(active));$('view-'+b.dataset.view).hidden=!active;}if(view!=='institutions')clearProfile();if(view==='registry')refreshRegistry();else resetRegistry();}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>showView(b.dataset.view));
for(const id of ['search','kind','status-filter'])$(id).addEventListener(id==='search'?'input':'change',()=>{clearProfile();renderInstitutions();});
$('close-profile').addEventListener('click',clearProfile);$('retry').addEventListener('click',load);$('refresh').addEventListener('click',load);
function route(){const panel=location.hash==='#painel';$('presentation').hidden=panel;$('areas').hidden=panel;$('painel').hidden=!panel;if(panel){showView('dashboard');load();}else{revision++;resetWorkspace();}window.scrollTo(0,0);}

const REGISTRY_URL='https://anna-one-business.elisonborg.workers.dev';
let registryRole=null,selectedParty=null,registryRevision=0,estRevision=0,registryBusy=false;
let partyRecords=[],classificationSupported=false,classificationParty=null,classificationRevision=0;
const classLabels={customer:'Cliente',supplier:'Fornecedor',partner:'Parceiro',service_provider:'Prestador',representative:'Representante',own_company:'Empresa própria'};
const classifications=p=>[...(Array.isArray(p.roles)?p.roles.filter(r=>Object.hasOwn(classLabels,r)&&r!=='own_company'):[]),...(p.own_company?['own_company']:[])];
const canWrite=()=>['owner','registry_editor'].includes(registryRole);
function resetRegistry(){
 registryRevision++;estRevision++;registryRole=null;selectedParty=null;partyRecords=[];classificationSupported=false;closeClassification();$('party-search').value='';$('party-filter').value='';$('party-count').textContent='';
 $('registry-content').hidden=true;$('party-form').hidden=true;$('establishment-panel').hidden=true;$('establishment-form').hidden=true;
 $('party-form').reset();$('establishment-form').reset();$('party-rows').replaceChildren();$('establishment-rows').replaceChildren();txt('registry-context','');txt('registry-status','Serviço cadastral não consultado.');
}
async function registryRequest(path,method='GET',payload){
 const jwt=await getJwt();
 const response=await fetch(REGISTRY_URL+path,{method,headers:{Authorization:'Bearer '+jwt,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(data?.error||'Serviço cadastral indisponível (HTTP '+response.status+').');
 return data;
}
function closeEstablishments(){estRevision++;selectedParty=null;$('establishment-panel').hidden=true;$('establishment-form').reset();$('establishment-rows').replaceChildren();}
function closeClassification(){classificationRevision++;classificationParty=null;$('classification-panel').hidden=true;$('classification-form').reset();}
function openClassification(p){
 if(!authorized||!canWrite()||!classificationSupported)return;
 closeEstablishments();closeClassification();classificationParty=p;
 const existing=classifications(p);
 const choices=Object.keys(classLabels).filter(k=>!existing.includes(k)&&(k!=='own_company'||(registryRole==='owner'&&p.kind==='PJ')));
 const select=$('classification-form').elements.namedItem('classification');select.replaceChildren();
 for(const k of choices){const opt=node('option',classLabels[k]);opt.value=k;select.append(opt);}
 txt('classification-title','Classificações · '+p.legal_name);
 txt('classification-status',existing.length?'Atuais: '+existing.map(k=>classLabels[k]).join(' · '):'Nenhuma classificação cadastrada.');
 $('classification-form').hidden=!choices.length;$('classification-panel').hidden=false;
}
function drawParties(rows=partyRecords){
 const body=$('party-rows');body.replaceChildren();
 const search=norm($('party-search').value.trim()),filter=$('party-filter').value;
 const visible=rows.filter(p=>{const cl=classifications(p);return (!search||norm([p.legal_name,p.display_name,p.code,p.cnpj_root].filter(Boolean).join(' ')).includes(search))&&(!filter||(filter==='unclassified'?!cl.length:cl.includes(filter)));});
 txt('party-count',visible.length+' de '+rows.length+' registro(s) carregado(s). CPF não é exibido.');
 if(!visible.length){const tr=node('tr'),td=node('td','Nenhum cadastro encontrado.');td.colSpan=6;tr.append(td);body.append(tr);}
 for(const p of visible){
  const tr=node('tr');for(const value of [p.code,p.kind,p.legal_name,p.cnpj_root||'—',classifications(p).map(k=>classLabels[k]).join(' · ')||'—'])tr.append(node('td',value||'—'));
  const td=node('td');td.className='party-actions';
  if(classificationSupported&&canWrite()){const button=node('button','Classificar','btn light');button.type='button';button.addEventListener('click',()=>openClassification(p));td.append(button);}
  if(p.kind==='PJ'){const button=node('button','Estabelecimentos','btn light');button.type='button';button.addEventListener('click',()=>openEstablishments(p));td.append(button);}
  if(!td.childNodes.length)td.textContent='—';tr.append(td);body.append(tr);
 }
}
async function refreshRegistry(){
 if(!authorized||registryBusy)return;registryBusy=true;resetRegistry();const rev=registryRevision;
 $('registry-refresh').disabled=true;txt('registry-status','Consultando autorização Business…');
 try{
  const context=await registryRequest('/v1/context');
  const result=await registryRequest('/v1/parties');
  if(rev!==registryRevision||!authorized)return;
  if(!context?.tenant||!Array.isArray(result?.items))throw new Error('Resposta cadastral inválida.');
  registryRole=context.role;classificationSupported=context.classifications===true;partyRecords=result.items;$('party-filter').disabled=!classificationSupported;txt('registry-context',context.tenant.name+' · '+(canWrite()?'Cadastro e consulta':'Somente consulta'));
  drawParties();$('party-form').hidden=!canWrite();$('registry-content').hidden=false;txt('registry-status','Cadastro conectado ao Neon. '+result.items.length+' registro(s) exibido(s).');
 }catch(e){if(rev===registryRevision)txt('registry-status',e.message+' O cadastro não está habilitado. Nenhum dado foi gravado.');}
 finally{registryBusy=false;$('registry-refresh').disabled=false;}
}
async function openEstablishments(p){
 if(!authorized||!registryRole)return;
 closeClassification();closeEstablishments();selectedParty=p;const rev=++estRevision;
 $('establishment-panel').hidden=false;$('establishment-form').hidden=true;txt('establishment-title','Estabelecimentos · '+p.legal_name);txt('establishment-status','Consultando…');
 try{const data=await registryRequest('/v1/parties/'+encodeURIComponent(p.id)+'/establishments');if(rev!==estRevision||!authorized)return;if(!Array.isArray(data?.items))throw new Error('Resposta inválida.');
 const body=$('establishment-rows');body.replaceChildren();for(const item of data.items){const tr=node('tr');for(const value of [item.name,item.cnpj,labels[item.kind]||item.kind,item.status==='active'?'Ativo':'Inativo'])tr.append(node('td',value||'—'));body.append(tr);}
 txt('establishment-status',data.items.length+' estabelecimento(s).');$('establishment-form').hidden=!canWrite();
 }catch(e){if(rev===estRevision)txt('establishment-status',e.message);}
}
$('party-search').addEventListener('input',()=>drawParties());
$('party-filter').addEventListener('change',()=>drawParties());
$('close-classification').addEventListener('click',closeClassification);
$('classification-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||!canWrite()||!classificationSupported||!classificationParty||registryBusy)return;
 const form=event.currentTarget,p=classificationParty,rev=classificationRevision,button=form.querySelector('button[type=submit]');
 button.disabled=true;
 try{
  const data=Object.fromEntries(new FormData(form));data.request_id=crypto.randomUUID();
  const result=await registryRequest('/v1/parties/'+encodeURIComponent(p.id)+'/classifications','POST',data);
  if(rev!==classificationRevision||!authorized)return;
  if(!result?.item||typeof result.item.inserted!=='boolean')throw new Error('Confirmação não recebida. Consulte antes de repetir.');
  await refreshRegistry();if(authorized&&registryRole)txt('registry-status',result.item.inserted?'Classificação registrada.':'Classificação já existente.');
 }catch(e){if(rev===classificationRevision)txt('classification-status',e.message+' Consulte antes de reenviar.');}
 finally{button.disabled=false;}
});
$('registry-refresh').addEventListener('click',refreshRegistry);
$('close-establishments').addEventListener('click',closeEstablishments);
$('party-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||!canWrite()||registryBusy)return;
 const form=event.currentTarget,button=form.querySelector('button[type=submit]'),rev=registryRevision;button.disabled=true;
 const data=Object.fromEntries(new FormData(form));data.request_id=crypto.randomUUID();
 try{const result=await registryRequest('/v1/parties','POST',data);if(rev!==registryRevision||!authorized)return;if(!result?.item?.party_id)throw new Error('Confirmação não recebida. Consulte antes de repetir.');
 form.reset();await refreshRegistry();if(authorized&&registryRole)txt('registry-status','Parceiro cadastrado com sucesso.');}
 catch(e){if(rev===registryRevision)txt('registry-status',e.message+' Consulte o cadastro antes de reenviar.');}
 finally{button.disabled=false;}
});
$('establishment-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||!canWrite()||!selectedParty)return;
 const form=event.currentTarget,button=form.querySelector('button[type=submit]'),p=selectedParty,rev=estRevision;button.disabled=true;
 const data=Object.fromEntries(new FormData(form));data.request_id=crypto.randomUUID();
 try{const result=await registryRequest('/v1/parties/'+encodeURIComponent(p.id)+'/establishments','POST',data);if(rev!==estRevision||!authorized)return;if(!result?.item?.establishment_id)throw new Error('Confirmação não recebida. Consulte antes de repetir.');form.reset();await openEstablishments(p);}
 catch(e){if(rev===estRevision)txt('establishment-status',e.message+' Consulte antes de reenviar.');}
 finally{button.disabled=false;}
});

window.addEventListener('hashchange',route);route();