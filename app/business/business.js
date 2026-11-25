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
function resetWorkspace(){resetCrm();maintenanceOrgTarget=null;resetMaintenance();resetOrganogram();resetBrands();resetContacts();resetOwnership();resetCorporate();resetLinks();resetRegistry();authorized=false;institutions=[];groups=[];groupsAvailable=false;clearProfile();$('workspace').hidden=true;$('access').hidden=false;$('institution-rows').replaceChildren();$('group-list').replaceChildren();for(const id of ['metric-total','metric-active','metric-matrix','metric-groups'])txt(id,'—');txt('result-count','');txt('groups-status','');txt('data-status','Aguardando consulta…');}
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
function showView(view){for(const b of document.querySelectorAll('[data-view]')){const active=b.dataset.view===view;b.setAttribute('aria-pressed',String(active));$('view-'+b.dataset.view).hidden=!active;}if(view!=='institutions')clearProfile();if(view==='registry')refreshRegistry();else resetRegistry();if(view==='links')refreshLinks();else resetLinks();if(view==='corporate')refreshCorporate();else resetCorporate();if(view==='ownership')refreshOwnership();else resetOwnership();if(view==='contacts')refreshContacts();else resetContacts();if(view==='brands')refreshBrands();else resetBrands();if(view==='organogram')refreshOrganogram();else resetOrganogram();if(view==='maintenance')refreshMaintenance();else resetMaintenance();if(view==='crm')refreshCrm();else resetCrm();}
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


let linksRevision=0,linkEstRevision=0,linksBusy=false,linksSaving=false;
const linksForm=$('links-form'),linkField=name=>linksForm.elements.namedItem(name);
function options(select,items,placeholder){select.replaceChildren();const first=node('option',placeholder);first.value='';select.append(first);for(const item of items){const opt=node('option',item.label);opt.value=item.id;select.append(opt);}}
function resetLinks(){linksRevision++;linkEstRevision++;$('links-content').hidden=true;linksForm.hidden=true;linksForm.reset();$('links-rows').replaceChildren();linkField('establishment_id').disabled=true;linksForm.querySelector('[type=submit]').disabled=true;txt('links-status','Aguardando consulta.');}
function linkSubmitState(){linksForm.querySelector('[type=submit]').disabled=linksSaving||!linkField('institution_id').value||!linkField('party_id').value||linkField('establishment_id').disabled;}
async function refreshLinks(){
 if(!authorized||linksBusy)return;linksBusy=true;resetLinks();const rev=linksRevision;$('links-refresh').disabled=true;
 txt('links-status','Consultando vínculos e permissões...');
 try{
 const context=await registryRequest('/v1/context');if(rev!==linksRevision||!authorized)return;
 if(context?.institution_links!==true)throw Error('Serviço de vínculos ainda não ativado.');
 const [data,parties]=await Promise.all([registryRequest('/v1/institution-links'),registryRequest('/v1/parties')]);if(rev!==linksRevision||!authorized)return;
 if(!Array.isArray(data?.items)||!Array.isArray(parties?.items))throw Error('Resposta cadastral inválida.');
 const rows=$('links-rows');const linked=new Set(data.items.map(x=>x.institution_id.toLowerCase()));
 for(const l of data.items){const institution=institutions.find(x=>x.id===l.institution_id);const tr=node('tr');for(const value of [institution?[institution.name,institution.client_code].filter(Boolean).join(' · '):'Instituição do Master',l.party_name,l.establishment_name?[l.establishment_name,l.cnpj].filter(Boolean).join(' · '):'Não informado',String(l.valid_from||'').slice(0,10)])tr.append(node('td',value||'—'));rows.append(tr);}
 if(!data.items.length){const tr=node('tr'),td=node('td','Nenhum vínculo registrado.');td.colSpan=4;tr.append(td);rows.append(tr);}
 options(linkField('institution_id'),institutions.filter(x=>!linked.has(x.id.toLowerCase())).map(x=>({id:x.id,label:[x.name,x.client_code].filter(Boolean).join(' · ')})),'Selecione a instituição');
 options(linkField('party_id'),parties.items.filter(p=>p.kind==='PJ'&&p.status==='active').map(p=>({id:p.id,label:[p.legal_name,p.cnpj_root].filter(Boolean).join(' · ')})),'Selecione a pessoa jurídica');
 options(linkField('establishment_id'),[],'Selecione a pessoa jurídica primeiro');linkField('establishment_id').disabled=true;
 linksForm.hidden=context.role!=='owner';$('links-content').hidden=false;linkSubmitState();txt('links-status',data.items.length+' vínculo(s) vigente(s). '+(context.role==='owner'?'Cadastro autorizado.':'Somente consulta.'));
 }catch(e){if(rev===linksRevision)txt('links-status',e.message+' Nenhum dado foi alterado.');}
 finally{linksBusy=false;$('links-refresh').disabled=false;}
}
linkField('institution_id').addEventListener('change',linkSubmitState);
linkField('party_id').addEventListener('change',async()=>{
 const rev=++linkEstRevision,parent=linksRevision,party=linkField('party_id').value,select=linkField('establishment_id');select.disabled=true;options(select,[],'Consultando...');linkSubmitState();
 if(!party){options(select,[],'Selecione a pessoa jurídica primeiro');return;}
 try{const result=await registryRequest('/v1/parties/'+encodeURIComponent(party)+'/establishments');if(rev!==linkEstRevision||parent!==linksRevision)return;if(!Array.isArray(result?.items))throw Error('Resposta inválida.');
 options(select,result.items.filter(e=>e.status==='active').map(e=>({id:e.id,label:[e.name,e.cnpj].filter(Boolean).join(' · ')})),'Sem estabelecimento específico');select.disabled=false;linkSubmitState();
 }catch(e){if(rev===linkEstRevision&&parent===linksRevision){options(select,[],'Consulta indisponível');txt('links-status',e.message);}}
});
$('links-refresh').addEventListener('click',refreshLinks);
linksForm.addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||linksForm.hidden||linksSaving||linkField('establishment_id').disabled)return;
 linksSaving=true;const rev=linksRevision;linkSubmitState();const data=Object.fromEntries(new FormData(linksForm));data.request_id=crypto.randomUUID();
 try{const result=await registryRequest('/v1/institution-links','POST',data);if(rev!==linksRevision||!authorized)return;if(!result?.item?.link_id)throw Error('Confirmação não recebida. Consulte antes de repetir.');await refreshLinks();if(authorized&&!$('links-content').hidden)txt('links-status','Vínculo registrado com sucesso.');}
 catch(e){if(rev===linksRevision)txt('links-status',e.message+' Consulte antes de reenviar.');}
 finally{linksSaving=false;linkSubmitState();}
});


let corporateRevision=0,corporateBusy=false,corporateSaving=false,corporateGroups=[],corporateParties=[],corporateRelations=[];
const groupForm=$('corp-group-form'),memberForm=$('corp-member-form'),adminForm=$('corp-admin-form');
function corpField(form,name){return form.elements.namedItem(name);}
function resetCorporate(){corporateRevision++;corporateGroups=[];corporateParties=[];corporateRelations=[];$('corporate-content').hidden=true;for(const form of [groupForm,memberForm,adminForm]){form.hidden=true;form.reset();}$('corp-group-list').replaceChildren();$('corp-admin-list').replaceChildren();txt('corporate-status','Aguardando consulta.');}
function corpMemberOptions(){const group=corporateGroups.find(g=>g.id===corpField(memberForm,'group_id').value);const members=new Set((group?.members||[]).map(m=>m.party_id));options(corpField(memberForm,'party_id'),corporateParties.filter(p=>!members.has(p.id)).map(p=>({id:p.id,label:[p.legal_name,p.cnpj_root].filter(Boolean).join(' · ')})),'Selecione a pessoa jurídica');}
function corpAdminOptions(){const supervisor=corpField(adminForm,'supervisor_id').value;const parents=new Set(corporateRelations.map(r=>r.subordinate_id));options(corpField(adminForm,'subordinate_id'),institutions.filter(i=>i.id!==supervisor&&!parents.has(i.id)).map(i=>({id:i.id,label:[i.name,i.client_code].filter(Boolean).join(' · ')})),'Selecione a instituição');}
function renderCorporate(){
 const list=$('corp-group-list');list.replaceChildren();
 if(!corporateGroups.length)list.append(node('p','Nenhum grupo empresarial cadastrado.','muted small'));
 for(const g of corporateGroups){const card=node('div',undefined,'corp-item');card.append(node('strong',g.name));const members=Array.isArray(g.members)?g.members:[];card.append(node('p',members.length+' pessoa(s) jurídica(s)','muted small'));for(const m of members)card.append(node('p',m.party_name+' · '+(m.membership_kind==='coordinator'?'Coordenadora':'Integrante'),'small'));list.append(card);}
 const rels=$('corp-admin-list');rels.replaceChildren();
 if(!corporateRelations.length)rels.append(node('p','Nenhuma supervisão cadastrada.','muted small'));
 for(const r of corporateRelations){const s=institutions.find(i=>i.id===r.supervisor_id),d=institutions.find(i=>i.id===r.subordinate_id);const card=node('div',undefined,'corp-item');card.append(node('strong',(s?.name||'Instituição do Master')+' → '+(d?.name||'Instituição do Master')),node('p',r.autonomy==='delegated'?'Gestão delegada / autonomia local':'Gestão centralizada','muted small'));rels.append(card);}
 options(corpField(memberForm,'group_id'),corporateGroups.map(g=>({id:g.id,label:g.name})),'Selecione o grupo');corpMemberOptions();
 options(corpField(adminForm,'supervisor_id'),institutions.map(i=>({id:i.id,label:[i.name,i.client_code].filter(Boolean).join(' · ')})),'Selecione a instituição');corpAdminOptions();
}
async function refreshCorporate(){
 if(!authorized||corporateBusy)return;corporateBusy=true;resetCorporate();const rev=corporateRevision;$('corporate-refresh').disabled=true;txt('corporate-status','Consultando estrutura corporativa...');
 try{const context=await registryRequest('/v1/context');if(rev!==corporateRevision||!authorized)return;if(context?.corporate_structure!==true)throw Error('Serviço de estrutura corporativa ainda não ativado.');
 const [groupsData,partiesData,relationsData]=await Promise.all([registryRequest('/v1/corporate-groups'),registryRequest('/v1/parties'),registryRequest('/v1/admin-relations')]);if(rev!==corporateRevision||!authorized)return;
 if(![groupsData,partiesData,relationsData].every(d=>Array.isArray(d?.items)))throw Error('Resposta cadastral inválida.');
 corporateGroups=groupsData.items;corporateParties=partiesData.items.filter(p=>p.kind==='PJ'&&p.status==='active');corporateRelations=relationsData.items;
 renderCorporate();const owner=context.role==='owner';groupForm.hidden=!owner;memberForm.hidden=!owner||!corporateGroups.length;adminForm.hidden=!owner;
 $('corporate-content').hidden=false;txt('corporate-status',corporateGroups.length+' grupo(s) · '+corporateRelations.length+' relação(ões) administrativa(s). '+(owner?'Cadastro autorizado.':'Somente consulta.'));
 }catch(e){if(rev===corporateRevision)txt('corporate-status',e.message+' Nenhum dado foi alterado.');}finally{corporateBusy=false;$('corporate-refresh').disabled=false;}
}
corpField(memberForm,'group_id').addEventListener('change',corpMemberOptions);
corpField(adminForm,'supervisor_id').addEventListener('change',corpAdminOptions);
$('corporate-refresh').addEventListener('click',refreshCorporate);
for(const form of [groupForm,memberForm,adminForm])form.addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||form.hidden||corporateBusy||corporateSaving)return;corporateSaving=true;const rev=corporateRevision;
 const buttons=[...document.querySelectorAll('#view-corporate form button[type=submit]')];buttons.forEach(b=>b.disabled=true);
 const data=Object.fromEntries(new FormData(form));data.request_id=crypto.randomUUID();
 const path=form===groupForm?'/v1/corporate-groups':form===adminForm?'/v1/admin-relations':'/v1/corporate-groups/'+encodeURIComponent(data.group_id)+'/members';
 try{const result=await registryRequest(path,'POST',data);if(rev!==corporateRevision||!authorized)return;if(!result?.item?.[form===groupForm?'group_id':form===memberForm?'member_id':'relation_id'])throw Error('Confirmação não recebida. Consulte antes de repetir.');
 await refreshCorporate();if(authorized&&!$('corporate-content').hidden)txt('corporate-status','Registro efetuado com sucesso.');}
 catch(e){if(rev===corporateRevision)txt('corporate-status',e.message+' Consulte antes de reenviar.');}
 finally{corporateSaving=false;buttons.forEach(b=>b.disabled=false);}
});


let ownershipRevision=0,ownershipBusy=false,ownershipSaving=false,ownershipParties=[],ownershipRows=[];
const ownershipForm=$('ownership-form'),ownershipField=n=>ownershipForm.elements.namedItem(n);
const controlLabels={unspecified:'Não informado',individual:'Individual',joint:'Compartilhado',none:'Sem controle declarado'};
const percentage=v=>v===null||v===undefined?'Não informado':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:6})+'%';
function resetOwnership(){ownershipRevision++;ownershipParties=[];ownershipRows=[];$('ownership-content').hidden=true;ownershipForm.hidden=true;ownershipForm.reset();$('ownership-rows').replaceChildren();$('ownership-summary').replaceChildren();$('ownership-filter').replaceChildren();txt('ownership-status','Aguardando consulta.');}
function ownershipOptions(){
 const company=ownershipField('company_id').value,registered=new Set(ownershipRows.filter(r=>r.company_id===company).map(r=>r.shareholder_id));
 options(ownershipField('shareholder_id'),ownershipParties.filter(p=>p.id!==company&&!registered.has(p.id)).map(p=>({id:p.id,label:p.legal_name+' · '+p.kind})),'Selecione o sócio');
}
function renderOwnership(){
 const company=$('ownership-filter').value,rows=ownershipRows.filter(r=>!company||r.company_id===company),body=$('ownership-rows');body.replaceChildren();$('ownership-summary').replaceChildren();
 for(const r of rows){const tr=node('tr');for(const v of [r.company_name,r.shareholder_name,r.shareholder_kind,percentage(r.capital_pct),percentage(r.vote_pct),controlLabels[r.declared_control]||'Não informado',String(r.valid_from||'').slice(0,10)])tr.append(node('td',v||'—'));body.append(tr);}
 if(!rows.length){const tr=node('tr'),td=node('td','Nenhuma participação registrada.');td.colSpan=7;tr.append(td);body.append(tr);}
 if(company){const sum=k=>rows.reduce((a,r)=>a+Math.round(Number(r[k]||0)*1000000),0)/1000000;const capital=sum('capital_pct'),votes=sum('vote_pct'),unknown=rows.filter(r=>r.vote_pct===null||r.vote_pct===undefined).length;
 for(const [label,value] of [['Capital registrado',percentage(capital)],['Capital restante',percentage(Math.max(0,100-capital))],['Votos informados',percentage(votes)],['Sócios sem votos informados',String(unknown)]]){const card=node('article',undefined,'business-card');card.append(node('span',label),node('strong',value));$('ownership-summary').append(card);}
 }
}
async function refreshOwnership(){
 if(!authorized||ownershipBusy)return;ownershipBusy=true;resetOwnership();const rev=ownershipRevision;$('ownership-refresh').disabled=true;txt('ownership-status','Consultando estrutura societária...');
 try{const context=await registryRequest('/v1/context');if(rev!==ownershipRevision||!authorized)return;if(context?.ownership!==true)throw Error('Serviço societário ainda não ativado.');
 const [data,parties]=await Promise.all([registryRequest('/v1/ownership'),registryRequest('/v1/parties')]);if(rev!==ownershipRevision||!authorized)return;if(!Array.isArray(data?.items)||!Array.isArray(parties?.items))throw Error('Resposta cadastral inválida.');
 ownershipRows=data.items;ownershipParties=parties.items.filter(p=>p.status==='active');
 const companies=ownershipParties.filter(p=>p.kind==='PJ').map(p=>({id:p.id,label:p.legal_name}));
 const filters=new Map(companies.map(p=>[p.id,p]));for(const r of ownershipRows)if(!filters.has(r.company_id))filters.set(r.company_id,{id:r.company_id,label:r.company_name});
 options($('ownership-filter'),[...filters.values()],'Todas as empresas');options(ownershipField('company_id'),companies,'Selecione a empresa');ownershipOptions();renderOwnership();
 ownershipForm.hidden=context.role!=='owner';$('ownership-content').hidden=false;txt('ownership-status',data.items.length+' participação(ões) registrada(s). '+(context.role==='owner'?'Cadastro autorizado.':'Somente consulta.'));
 }catch(e){if(rev===ownershipRevision)txt('ownership-status',e.message+' Nenhum dado foi alterado.');}finally{ownershipBusy=false;$('ownership-refresh').disabled=false;}
}
$('ownership-filter').addEventListener('change',renderOwnership);
ownershipField('company_id').addEventListener('change',ownershipOptions);
$('ownership-refresh').addEventListener('click',refreshOwnership);
ownershipForm.addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||ownershipForm.hidden||ownershipBusy||ownershipSaving)return;ownershipSaving=true;const rev=ownershipRevision,button=ownershipForm.querySelector('[type=submit]');button.disabled=true;
 const data=Object.fromEntries(new FormData(ownershipForm));data.capital_pct=data.capital_pct.trim().replace(',','.');data.vote_pct=data.vote_pct.trim().replace(',','.')||null;data.request_id=crypto.randomUUID();
 try{const result=await registryRequest('/v1/ownership','POST',data);if(rev!==ownershipRevision||!authorized)return;if(!result?.item?.interest_id)throw Error('Confirmação não recebida. Consulte antes de repetir.');const company=data.company_id;await refreshOwnership();if(authorized&&!$('ownership-content').hidden){$('ownership-filter').value=company;renderOwnership();txt('ownership-status','Participação registrada com sucesso.');}}
 catch(e){if(rev===ownershipRevision)txt('ownership-status',e.message+' Consulte antes de reenviar.');}
 finally{ownershipSaving=false;button.disabled=false;}
});


let contactsRevision=0,contactsBusy=false,contactsSaving=false,contactsRecords=[];
const contactsForm=$('contacts-form'),contactField=n=>contactsForm.elements.namedItem(n);
const contactLabels={commercial:'Comercial',administrative:'Administrativo',financial:'Financeiro',technical:'Técnico',legal_contact:'Contato jurídico',legal_representative:'Representante legal',attorney:'Procurador'};
const validityLabels={active:'Vigente',scheduled:'Futura',expired:'Expirada'};
function localDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function contactLegalFields(){const legal=['legal_representative','attorney'].includes(contactField('role').value);$('contacts-legal-fields').hidden=!legal;for(const n of ['document_ref','authority_scope']){const field=contactField(n);field.disabled=!legal;field.required=legal;if(!legal)field.value='';}}
function resetContacts(){contactsRevision++;contactsRecords=[];$('contacts-content').hidden=true;contactsForm.hidden=true;contactsForm.reset();$('contacts-rows').replaceChildren();$('contacts-count').textContent='';for(const id of ['contacts-company-filter','contacts-role-filter'])$(id).replaceChildren();$('contacts-validity-filter').value='';contactLegalFields();txt('contacts-status','Aguardando consulta.');}
function renderContacts(){const company=$('contacts-company-filter').value,role=$('contacts-role-filter').value,validity=$('contacts-validity-filter').value;
 const rows=contactsRecords.filter(r=>(!company||r.company_id===company)&&(!role||r.role===role)&&(!validity||r.validity===validity)),body=$('contacts-rows');body.replaceChildren();txt('contacts-count',rows.length+' de '+contactsRecords.length+' registro(s). CPF não exibido.');
 for(const r of rows){const tr=node('tr');for(const v of [r.company_name,[r.person_name,r.job_title].filter(Boolean).join(' · '),contactLabels[r.role]||r.role,[r.email,r.phone].filter(Boolean).join(' · '),[validityLabels[r.validity]||r.validity,String(r.valid_from||'').slice(0,10),r.valid_until?'até '+String(r.valid_until).slice(0,10):'sem término informado'].join(' · '),[r.document_ref,r.authority_scope].filter(Boolean).join(' · ')])tr.append(node('td',v||'—'));body.append(tr);}
 if(!rows.length){const tr=node('tr'),td=node('td','Nenhum contato encontrado.');td.colSpan=6;tr.append(td);body.append(tr);}
}
async function refreshContacts(){
 if(!authorized||contactsBusy)return;contactsBusy=true;resetContacts();const rev=contactsRevision;$('contacts-refresh').disabled=true;txt('contacts-status','Consultando contatos e permissões...');
 try{const context=await registryRequest('/v1/context');if(rev!==contactsRevision||!authorized)return;if(context?.company_contacts!==true)throw Error('Módulo de contatos indisponível ou acesso restrito.');
 const [data,parties]=await Promise.all([registryRequest('/v1/company-contacts'),registryRequest('/v1/parties')]);if(rev!==contactsRevision||!authorized)return;if(!Array.isArray(data?.items)||!Array.isArray(parties?.items))throw Error('Resposta cadastral inválida.');
 contactsRecords=data.items;const active=parties.items.filter(p=>p.status==='active'),companies=active.filter(p=>p.kind==='PJ').map(p=>({id:p.id,label:p.legal_name})),people=active.filter(p=>p.kind==='PF').map(p=>({id:p.id,label:p.legal_name+' · '+p.code}));
 const filters=new Map(companies.map(p=>[p.id,p]));for(const r of contactsRecords)if(!filters.has(r.company_id))filters.set(r.company_id,{id:r.company_id,label:r.company_name});
 options($('contacts-company-filter'),[...filters.values()],'Todas as empresas');options($('contacts-role-filter'),Object.entries(contactLabels).map(([id,label])=>({id,label})),'Todas as funções');
 options(contactField('company_id'),companies,'Selecione a empresa');options(contactField('person_id'),people,'Selecione a pessoa física');
 options(contactField('role'),Object.entries(contactLabels).filter(([id])=>context.role==='owner'||!['legal_representative','attorney'].includes(id)).map(([id,label])=>({id,label})),'Selecione a função');contactField('valid_from').value=localDate();contactLegalFields();
 contactsForm.hidden=!['owner','registry_editor'].includes(context.role);$('contacts-content').hidden=false;renderContacts();txt('contacts-status','Cadastro de contatos conectado. '+(context.role==='owner'?'Representação legal e contatos autorizados.':'Cadastro de contatos funcionais autorizado.'));
 }catch(e){if(rev===contactsRevision)txt('contacts-status',e.message+' Nenhum dado foi alterado.');}finally{contactsBusy=false;$('contacts-refresh').disabled=false;}
}
for(const id of ['contacts-company-filter','contacts-role-filter','contacts-validity-filter'])$(id).addEventListener('change',renderContacts);
contactField('role').addEventListener('change',contactLegalFields);
$('contacts-refresh').addEventListener('click',refreshContacts);
contactsForm.addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||contactsForm.hidden||contactsBusy||contactsSaving)return;contactsSaving=true;const rev=contactsRevision,button=contactsForm.querySelector('[type=submit]');button.disabled=true;
 const data=Object.fromEntries(new FormData(contactsForm));data.request_id=crypto.randomUUID();
 try{const result=await registryRequest('/v1/company-contacts','POST',data);if(rev!==contactsRevision||!authorized)return;if(!result?.item?.contact_id)throw Error('Confirmação não recebida. Consulte antes de repetir.');await refreshContacts();if(authorized&&!$('contacts-content').hidden){$('contacts-company-filter').value=data.company_id;renderContacts();txt('contacts-status','Contato registrado com sucesso.');}}
 catch(e){if(rev===contactsRevision)txt('contacts-status',e.message+' Consulte antes de reenviar.');}finally{contactsSaving=false;button.disabled=false;}
});


let brandsRevision=0,brandsBusy=false,brandsSaving=false,brandRecords=[],networkRecords=[],franchiseRecords=[],brandParties=[];
const brandForm=$('brand-form'),networkForm=$('network-form'),franchiseForm=$('franchise-form');
const brandField=(form,n)=>form.elements.namedItem(n);
function resetBrands(){brandsRevision++;brandRecords=[];networkRecords=[];franchiseRecords=[];brandParties=[];$('brands-content').hidden=true;for(const form of [brandForm,networkForm,franchiseForm]){form.hidden=true;form.reset();}for(const id of ['brands-list','networks-list','brands-metrics','franchise-rows','franchise-network-filter'])$(id).replaceChildren();$('franchise-count').textContent='';$('franchise-validity-filter').value='';txt('brands-status','Aguardando consulta.');}
function brandNetworkOptions(){const brand=brandField(networkForm,'brand_id').value;const used=new Set(networkRecords.filter(n=>n.brand_id===brand).map(n=>n.franchisor_id));options(brandField(networkForm,'franchisor_id'),brandParties.filter(p=>p.kind==='PJ'&&!used.has(p.id)).map(p=>({id:p.id,label:p.legal_name})),'Selecione a franqueadora');}
function franchiseOptions(){const network=networkRecords.find(n=>n.id===brandField(franchiseForm,'network_id').value);options(brandField(franchiseForm,'franchisee_id'),brandParties.filter(p=>p.kind==='PJ'&&p.id!==network?.franchisor_id).map(p=>({id:p.id,label:p.legal_name})),'Selecione o franqueado');}
function renderFranchises(){const network=$('franchise-network-filter').value,validity=$('franchise-validity-filter').value;const rows=franchiseRecords.filter(r=>(!network||r.network_id===network)&&(!validity||r.validity===validity)),body=$('franchise-rows');body.replaceChildren();txt('franchise-count',rows.length+' de '+franchiseRecords.length+' vínculo(s).');
 for(const r of rows){const tr=node('tr');for(const v of [[r.brand_name,r.franchisor_name].filter(Boolean).join(' · '),r.franchisee_name,r.agreement_ref,r.territory,[validityLabels[r.validity]||r.validity,String(r.valid_from||'').slice(0,10),r.valid_until?'até '+String(r.valid_until).slice(0,10):'sem término informado'].join(' · ')])tr.append(node('td',v||'—'));body.append(tr);}
 if(!rows.length){const tr=node('tr'),td=node('td','Nenhum vínculo encontrado.');td.colSpan=5;tr.append(td);body.append(tr);}
}
function renderBrands(){
 const metrics=$('brands-metrics');metrics.replaceChildren();
 for(const [label,value] of [['Marcas',brandRecords.length],['Redes franqueadoras',networkRecords.length],['Vínculos vigentes',franchiseRecords.filter(r=>r.validity==='active').length],['Franqueados vigentes',new Set(franchiseRecords.filter(r=>r.validity==='active').map(r=>r.franchisee_id)).size]]){const card=node('article',undefined,'business-card');card.append(node('span',label),node('strong',value));metrics.append(card);}
 const brands=$('brands-list');brands.replaceChildren();if(!brandRecords.length)brands.append(node('p','Nenhuma marca cadastrada.','muted small'));
 for(const b of brandRecords){const card=node('div',undefined,'corp-item');card.append(node('strong',b.name),node('p','Titular: '+b.holder_name,'muted small'));if(b.registration_ref)card.append(node('p','Referência: '+b.registration_ref,'small'));brands.append(card);}
 const nets=$('networks-list');nets.replaceChildren();if(!networkRecords.length)nets.append(node('p','Nenhuma rede cadastrada.','muted small'));
 for(const n of networkRecords){const card=node('div',undefined,'corp-item');card.append(node('strong',n.brand_name+' · '+n.franchisor_name),node('p','Referência: '+n.authority_ref,'muted small'));nets.append(card);}
 const networkOpts=networkRecords.map(n=>({id:n.id,label:n.brand_name+' · '+n.franchisor_name}));
 options(brandField(brandForm,'holder_id'),brandParties.map(p=>({id:p.id,label:p.legal_name+' · '+p.kind})),'Selecione o titular');
 options(brandField(networkForm,'brand_id'),brandRecords.map(b=>({id:b.id,label:b.name+' · '+b.holder_name})),'Selecione a marca');brandNetworkOptions();
 options(brandField(franchiseForm,'network_id'),networkOpts,'Selecione a rede');franchiseOptions();
 options($('franchise-network-filter'),networkOpts,'Todas as redes');brandField(franchiseForm,'valid_from').value=localDate();renderFranchises();
}
async function refreshBrands(){
 if(!authorized||brandsBusy)return;brandsBusy=true;resetBrands();const rev=brandsRevision;$('brands-refresh').disabled=true;txt('brands-status','Consultando marcas e franquias...');
 try{const context=await registryRequest('/v1/context');if(rev!==brandsRevision||!authorized)return;if(context?.brands_franchises!==true)throw Error('Serviço de marcas e franquias ainda não ativado.');
 const [brands,nets,relations,parties]=await Promise.all(['/v1/brands','/v1/franchise-networks','/v1/franchise-relationships','/v1/parties'].map(path=>registryRequest(path)));if(rev!==brandsRevision||!authorized)return;
 if(![brands,nets,relations,parties].every(d=>Array.isArray(d?.items)))throw Error('Resposta cadastral inválida.');
 brandRecords=brands.items;networkRecords=nets.items;franchiseRecords=relations.items;brandParties=parties.items.filter(p=>p.status==='active');renderBrands();
 const owner=context.role==='owner';brandForm.hidden=!owner;networkForm.hidden=!owner||!brandRecords.length;franchiseForm.hidden=!owner||!networkRecords.length;$('brands-content').hidden=false;txt('brands-status',brandRecords.length+' marca(s) · '+networkRecords.length+' rede(s) · '+franchiseRecords.length+' vínculo(s). '+(owner?'Cadastro autorizado.':'Somente consulta.'));
 }catch(e){if(rev===brandsRevision)txt('brands-status',e.message+' Nenhum dado foi alterado.');}finally{brandsBusy=false;$('brands-refresh').disabled=false;}
}
brandField(networkForm,'brand_id').addEventListener('change',brandNetworkOptions);
brandField(franchiseForm,'network_id').addEventListener('change',franchiseOptions);
for(const id of ['franchise-network-filter','franchise-validity-filter'])$(id).addEventListener('change',renderFranchises);
$('brands-refresh').addEventListener('click',refreshBrands);
for(const form of [brandForm,networkForm,franchiseForm])form.addEventListener('submit',async event=>{
 event.preventDefault();if(!authorized||form.hidden||brandsBusy||brandsSaving)return;brandsSaving=true;const rev=brandsRevision,buttons=[brandForm,networkForm,franchiseForm].map(f=>f.querySelector('[type=submit]'));buttons.forEach(b=>b.disabled=true);
 const data=Object.fromEntries(new FormData(form));data.request_id=crypto.randomUUID();
 const path=form===brandForm?'/v1/brands':form===networkForm?'/v1/franchise-networks':'/v1/franchise-relationships';
 try{const result=await registryRequest(path,'POST',data);if(rev!==brandsRevision||!authorized)return;if(!result?.item?.[form===brandForm?'brand_id':form===networkForm?'network_id':'relationship_id'])throw Error('Confirmação não recebida. Consulte antes de repetir.');await refreshBrands();if(authorized&&!$('brands-content').hidden)txt('brands-status','Registro efetuado com sucesso.');}
 catch(e){if(rev===brandsRevision)txt('brands-status',e.message+' Consulte antes de reenviar.');}finally{brandsSaving=false;buttons.forEach(b=>b.disabled=false);}
});


let orgRevision=0,orgBusy=false,orgNodes=new Map(),orgEdges=[],orgHistory=[];
const orgKindLabels={PF:'Pessoa física',PJ:'Pessoa jurídica',establishment:'Estabelecimento',group:'Grupo empresarial',brand:'Marca',network:'Rede franqueadora',institution:'Instituição operacional',master_group:'Grupo do Master'};
const orgCategories={legal:'Jurídica / fiscal',operational:'Operacional',group:'Grupo empresarial',administrative:'Administrativa',ownership:'Societária',commercial:'Marcas e franquias',contact:'Contatos e representantes'};
function resetOrganogram(){orgRevision++;orgNodes=new Map();orgEdges=[];orgHistory=[];$('org-content').hidden=true;$('org-map').hidden=true;$('org-search').value='';$('org-category').value='';for(const id of ['org-focus','org-metrics','org-center','org-incoming','org-outgoing','org-rows'])$(id).replaceChildren();$('org-back').disabled=true;txt('org-trail','');txt('org-focus-status','');txt('org-status','Aguardando consulta.');}
function buildOrganogram(data,masterInstitutions,masterGroups,canUseGroups){
 const nodes=new Map(),edges=[];
 for(const n of data.nodes){if(n&&typeof n.id==='string'&&typeof n.label==='string'&&Object.hasOwn(orgKindLabels,n.kind))nodes.set(n.id,n);}
 const scope=new Set(data.institution_ids.map(x=>String(x).toLowerCase()));
 const allowed=masterInstitutions.filter(i=>scope.has(String(i.id).toLowerCase()));
 for(const i of allowed)nodes.set('institution:'+i.id.toLowerCase(),{id:'institution:'+i.id.toLowerCase(),kind:'institution',label:i.name,meta:{code:i.client_code,status:i.status,kind:i.organization_kind}});
 const validEdge=e=>e&&typeof e.id==='string'&&Object.hasOwn(orgCategories,e.category)&&typeof e.label==='string'&&nodes.has(e.source)&&nodes.has(e.target);
 for(const e of data.edges)if(validEdge(e)&&(e.category!=='contact'||data.contacts_visible===true))edges.push(e);
 if(canUseGroups){const used=new Set(allowed.map(i=>String(i.group_id||'').toLowerCase()).filter(Boolean));for(const g of masterGroups){const gid=String(g.id).toLowerCase();if(used.has(gid))nodes.set('master_group:'+gid,{id:'master_group:'+gid,kind:'master_group',label:g.name||'Grupo do Master',meta:{}});}for(const i of allowed){const e={id:'master_group_member:'+i.id,category:'operational',source:'master_group:'+String(i.group_id||'').toLowerCase(),target:'institution:'+i.id.toLowerCase(),label:'Grupo direto no Master'};if(validEdge(e))edges.push(e);}}
 for(const i of allowed){
  const target='institution:'+i.id.toLowerCase(),source='institution:'+String(i.parent_institution_id||'').toLowerCase();
  const e={id:'master_parent:'+i.id,category:'operational',source,target,label:'Matriz / filial no Master'};
  if(validEdge(e)&&source!==target)edges.push(e);
 }
 return {nodes,edges};
}
function orgMatching(search){const query=norm(search.trim());return [...orgNodes.values()].filter(n=>!query||norm([n.label,n.meta?.code,orgKindLabels[n.kind]].filter(Boolean).join(' ')).includes(query)).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR')||a.id.localeCompare(b.id));}
function updateOrgOptions(preferred){const matches=orgMatching($('org-search').value),select=$('org-focus');options(select,matches.map(n=>({id:n.id,label:n.label+' · '+orgKindLabels[n.kind]})),'Selecione a entidade');if(matches.some(n=>n.id===preferred))select.value=preferred;else if(matches.length===1)select.value=matches[0].id;}
function orgFocus(id,remember=true){if(!orgNodes.has(id))return;const current=$('org-focus').value;if(remember&&current&&current!==id)orgHistory.push(current);$('org-search').value='';updateOrgOptions(id);renderOrganogram();}
function orgNodeCard(n,edge=null){const card=node('div',undefined,'org-node'+(edge?' org-related':''));if(edge){card.append(node('span',(edge.target===$('org-focus').value?'Origem · ':'Destino · ')+edge.label,'org-relation'));card.append(node('span',orgCategories[edge.category],'org-dimension'));}
 const heading=node(edge?'button':'strong',n.label,edge?'org-node-link':'org-node-title');if(edge){heading.type='button';heading.addEventListener('click',()=>orgFocus(n.id));}card.append(heading,node('span',orgKindLabels[n.kind],'muted small'));
 if(n.meta?.code)card.append(node('span','Código: '+n.meta.code,'muted small'));if(n.meta?.own_company)card.append(node('span','Empresa própria','org-dimension'));if(Array.isArray(n.meta?.roles)&&n.meta.roles.length)card.append(node('span',n.meta.roles.map(r=>classLabels[r]||r).join(' · '),'muted small'));return card;}
function renderOrganogram(){const focus=$('org-focus').value,category=$('org-category').value,n=orgNodes.get(focus);for(const id of ['org-center','org-incoming','org-outgoing','org-rows'])$(id).replaceChildren();$('org-back').disabled=!orgHistory.length;$('org-map').hidden=!n;txt('org-trail',orgHistory.length?'Navegação: '+orgHistory.length+' etapa(s) anterior(es)':'');
 if(!n){txt('org-focus-status',orgNodes.size?'Selecione uma entidade para explorar suas relações.':'Nenhuma entidade disponível no escopo autorizado.');return;}
 const edges=orgEdges.filter(e=>(e.source===focus||e.target===focus)&&(!category||e.category===category));const incoming=edges.filter(e=>e.target===focus),outgoing=edges.filter(e=>e.source===focus);$('org-center').append(orgNodeCard(n));txt('org-focus-status',edges.length+' relação(ões) direta(s) · '+n.label);
 for(const [id,list,side] of [['org-incoming',incoming,'source'],['org-outgoing',outgoing,'target']]){const host=$(id);if(!list.length)host.append(node('p','Nenhuma relação neste filtro.','muted small'));for(const e of list)host.append(orgNodeCard(orgNodes.get(e[side]),e));}
 for(const e of edges){const tr=node('tr');for(const v of [orgNodes.get(e.source).label,e.label,orgNodes.get(e.target).label,orgCategories[e.category]])tr.append(node('td',v));$('org-rows').append(tr);}
 if(!edges.length){const tr=node('tr'),td=node('td','Nenhuma relação direta neste filtro.');td.colSpan=4;tr.append(td);$('org-rows').append(tr);}
}
async function refreshOrganogram(){
 if(!authorized||orgBusy)return;orgBusy=true;resetOrganogram();const rev=orgRevision;$('org-refresh').disabled=true;txt('org-status','Consultando estruturas integradas...');
 try{const context=await registryRequest('/v1/context');if(rev!==orgRevision||!authorized)return;if(context?.organogram!==true)throw Error('Organograma ainda não ativado no serviço.');
 const data=await registryRequest('/v1/organogram');if(rev!==orgRevision||!authorized)return;if(![data?.nodes,data?.edges,data?.institution_ids].every(Array.isArray))throw Error('Resposta integrada inválida.');
 const model=buildOrganogram(data,institutions,groups,groupsAvailable);orgNodes=model.nodes;orgEdges=model.edges;const contactOption=$('org-category').querySelector('option[value=contact]');contactOption.disabled=data.contacts_visible!==true;
 for(const [label,value] of [['Entidades',orgNodes.size],['Relações diretas',orgEdges.length],['Pessoas jurídicas',[...orgNodes.values()].filter(n=>n.kind==='PJ').length],['Instituições',[...orgNodes.values()].filter(n=>n.kind==='institution').length]]){const card=node('article',undefined,'business-card');card.append(node('span',label),node('strong',value));$('org-metrics').append(card);}
 const first=[...orgNodes.values()].find(n=>n.kind==='PJ'&&n.meta?.own_company)||[...orgNodes.values()].find(n=>n.kind==='PJ')||orgMatching('')[0];const requested=maintenanceOrgTarget;maintenanceOrgTarget=null;updateOrgOptions(requested&&orgNodes.has(requested)?requested:first?.id);$('org-content').hidden=false;renderOrganogram();txt('org-status','Consulta integrada concluída. '+(data.contacts_visible===true?'Contatos incluídos conforme permissões.':'Contatos restritos neste perfil.')+(!groupsAvailable?' Grupos do Master indisponíveis.':''));
 }catch(e){if(rev===orgRevision)txt('org-status',e.message+' Nenhum dado foi alterado.');}finally{orgBusy=false;$('org-refresh').disabled=false;}
}
$('org-search').addEventListener('input',()=>{updateOrgOptions($('org-focus').value);renderOrganogram();});
$('org-focus').addEventListener('change',()=>{orgHistory=[];renderOrganogram();});
$('org-category').addEventListener('change',renderOrganogram);
$('org-back').addEventListener('click',()=>{const id=orgHistory.pop();if(id)orgFocus(id,false);});
$('org-refresh').addEventListener('click',refreshOrganogram);


let maintenanceRevision=0,maintenanceBusy=false,maintenanceSaving=false,maintenanceNodes=new Map(),maintenanceEntities=new Map(),maintenanceLinks=[],maintenanceAudit=[],maintenanceCanEdit=false,maintenanceCanClose=false,maintenanceSelected=null,maintenanceClosing=null,maintenanceOrgTarget=null;
const maintenanceEdit=$('maintenance-edit'),maintenanceClose=$('maintenance-close');
const maintenanceField=(form,n)=>form.elements.namedItem(n);
const maintenanceLinkLabels={institution_link:'Institucional',company_contact:'Contato / representação',franchise_relationship:'Franquia'};
const maintenanceActions={create:'Criação',update:'Alteração',link:'Vínculo',unlink:'Encerramento',activate:'Ativação',deactivate:'Desativação'};
const maintenanceAuditTypes={opportunity:'Oportunidade comercial',crm_interaction:'Interação comercial',party:'Pessoa física/jurídica',establishment:'Estabelecimento',corporate_group:'Grupo empresarial',corporate_group_member:'Integrante de grupo',ownership_interest:'Participação societária',company_contact:'Contato / representação',brand:'Marca',franchise_network:'Rede franqueadora',franchise_relationship:'Franquia',institution_link:'Vínculo institucional',institution_admin_relation:'Supervisão administrativa'};
function cancelMaintenanceEdit(){maintenanceSelected=null;maintenanceEdit.reset();maintenanceEdit.hidden=true;}
function cancelMaintenanceClose(){maintenanceClosing=null;maintenanceClose.reset();maintenanceClose.hidden=true;}
function resetMaintenance(){maintenanceRevision++;maintenanceNodes=new Map();maintenanceEntities=new Map();maintenanceLinks=[];maintenanceAudit=[];maintenanceCanEdit=false;maintenanceCanClose=false;cancelMaintenanceEdit();cancelMaintenanceClose();$('maintenance-content').hidden=true;$('maintenance-audit').hidden=true;for(const id of ['maintenance-search','maintenance-link-kind','maintenance-link-validity','maintenance-audit-search','maintenance-audit-action'])$(id).value='';$('maintenance-kind').replaceChildren();for(const id of ['maintenance-rows','maintenance-link-rows','maintenance-audit-rows'])$(id).replaceChildren();txt('maintenance-count','');txt('maintenance-audit-status','');txt('maintenance-status','Aguardando consulta.');}
function maintenanceButton(label,handler){const b=node('button',label,'btn light');b.type='button';b.addEventListener('click',handler);return b;}
function editMaintenance(entity){if(!maintenanceCanEdit||maintenanceSaving)return;cancelMaintenanceClose();maintenanceSelected=entity;txt('maintenance-edit-title','Editar · '+entity.name);maintenanceField(maintenanceEdit,'name').value=entity.name;maintenanceField(maintenanceEdit,'display_name').value=entity.display_name||'';$('maintenance-display-label').hidden=entity.kind!=='party';maintenanceField(maintenanceEdit,'display_name').disabled=entity.kind!=='party';maintenanceEdit.hidden=false;maintenanceField(maintenanceEdit,'name').focus();}
function openMaintenanceOrganogram(id){maintenanceOrgTarget=id;showView('organogram');}
function renderMaintenanceEntities(){
 const query=norm($('maintenance-search').value.trim()),kind=$('maintenance-kind').value,rows=$('maintenance-rows');rows.replaceChildren();
 const matches=[...maintenanceNodes.values()].filter(n=>{const entity=maintenanceEntities.get(n.id);return (!kind||n.kind===kind)&&(!query||norm([n.label,n.meta?.code,entity?.display_name,entity?.parent_name,orgKindLabels[n.kind]].filter(Boolean).join(' ')).includes(query));}).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR')||a.id.localeCompare(b.id));
 const visible=matches.slice(0,150);txt('maintenance-count',matches.length+' entidade(s) encontrada(s). '+(matches.length>150?'Exibindo as primeiras 150; refine a pesquisa.':''));
 for(const n of visible){const tr=node('tr'),entity=maintenanceEntities.get(n.id),actions=node('td');for(const v of [n.label,orgKindLabels[n.kind]||n.kind,n.meta?.code||entity?.code||'—'])tr.append(node('td',v));if(maintenanceCanEdit&&entity)actions.append(maintenanceButton('Editar',()=>editMaintenance(entity)));actions.append(maintenanceButton('Organograma',()=>openMaintenanceOrganogram(n.id)));tr.append(actions);rows.append(tr);}
 if(!visible.length){const tr=node('tr'),td=node('td','Nenhuma entidade encontrada.');td.colSpan=4;tr.append(td);rows.append(tr);}
}
function maintenanceLinkName(l){const institution=l.institution_id?institutions.find(i=>String(i.id).toLowerCase()===String(l.institution_id).toLowerCase()):null;return [institution?.name,l.label].filter(Boolean).join(' · ');}
function closeMaintenance(l){if(!maintenanceCanClose||maintenanceSaving)return;cancelMaintenanceEdit();maintenanceClosing=l;txt('maintenance-close-title','Encerrar · '+maintenanceLinkName(l));const field=maintenanceField(maintenanceClose,'last_day');field.min=l.valid_from;field.max=l.last_day?new Date(Date.parse(l.last_day+'T00:00:00Z')-86400000).toISOString().slice(0,10):'9999-12-30';field.value=localDate()<l.valid_from?l.valid_from:localDate()>field.max?field.max:localDate();maintenanceClose.hidden=false;field.focus();}
function renderMaintenanceLinks(){
 const kind=$('maintenance-link-kind').value,validity=$('maintenance-link-validity').value,body=$('maintenance-link-rows');body.replaceChildren();
 const rows=maintenanceLinks.filter(l=>(!kind||l.kind===kind)&&(!validity||l.validity===validity));
 for(const l of rows){const tr=node('tr'),actions=node('td');for(const v of [maintenanceLinkName(l),maintenanceLinkLabels[l.kind]||l.kind,l.valid_from,l.last_day||'Sem término',validityLabels[l.validity]||l.validity])tr.append(node('td',v||'—'));if(maintenanceCanClose&&l.validity!=='expired'&&(!l.last_day||l.last_day>l.valid_from))actions.append(maintenanceButton('Encerrar',()=>closeMaintenance(l)));else actions.textContent='—';tr.append(actions);body.append(tr);}
 if(!rows.length){const tr=node('tr'),td=node('td','Nenhum vínculo neste filtro.');td.colSpan=6;tr.append(td);body.append(tr);}
}
function renderMaintenanceAudit(){
 const query=norm($('maintenance-audit-search').value.trim()),action=$('maintenance-audit-action').value,body=$('maintenance-audit-rows');body.replaceChildren();
 const rows=maintenanceAudit.filter(a=>(!action||a.action===action)&&(!query||norm([a.created_at,a.entity_id,a.entity_type,maintenanceAuditTypes[a.entity_type],a.actor_id,a.request_id,a.action,maintenanceActions[a.action]].join(' ')).includes(query)));
 txt('maintenance-audit-status',rows.length+' de '+maintenanceAudit.length+' evento(s) carregado(s).');
 for(const a of rows){const tr=node('tr');const date=new Date(a.created_at),when=Number.isNaN(date.getTime())?String(a.created_at||'—'):date.toLocaleString('pt-BR');for(const v of [when,maintenanceActions[a.action]||a.action,(maintenanceAuditTypes[a.entity_type]||a.entity_type)+' · '+a.entity_id,a.actor_id+' / '+a.request_id])tr.append(node('td',v));const td=node('td'),details=node('details'),summary=node('summary','Ver detalhes');details.append(summary,node('pre',JSON.stringify(a.details||{},null,2),'maintenance-audit-json'));td.append(details);tr.append(td);body.append(tr);}
 if(!rows.length){const tr=node('tr'),td=node('td','Nenhum evento encontrado.');td.colSpan=5;tr.append(td);body.append(tr);}
}
async function refreshMaintenance(){
 if(!authorized||maintenanceBusy)return;maintenanceBusy=true;resetMaintenance();const rev=maintenanceRevision;$('maintenance-refresh').disabled=true;txt('maintenance-status','Consultando fundação corporativa...');
 try{const context=await registryRequest('/v1/context');if(rev!==maintenanceRevision||!authorized)return;if(context?.maintenance!==true)throw Error('Gestão cadastral ainda não ativada.');
 const [data,graph]=await Promise.all([registryRequest('/v1/maintenance'),registryRequest('/v1/organogram')]);if(rev!==maintenanceRevision||!authorized)return;
 if(![data?.entities,data?.links,graph?.nodes,graph?.edges,graph?.institution_ids].every(Array.isArray))throw Error('Resposta cadastral inválida.');
 const model=buildOrganogram(graph,institutions,groups,groupsAvailable);maintenanceNodes=model.nodes;maintenanceEntities=new Map(data.entities.map(e=>[e.kind+':'+e.id,e]));maintenanceLinks=data.links;maintenanceCanEdit=data.can_edit===true;maintenanceCanClose=data.can_close===true;
 options($('maintenance-kind'),Object.entries(orgKindLabels).map(([id,label])=>({id,label})),'Todos os tipos');
 renderMaintenanceEntities();renderMaintenanceLinks();$('maintenance-content').hidden=false;txt('maintenance-status','Consulta concluída. '+(maintenanceCanEdit?'Edição cadastral autorizada.':'Somente consulta.'));
 if(context.audit===true){$('maintenance-audit').hidden=false;txt('maintenance-audit-status','Consultando auditoria...');try{const audit=await registryRequest('/v1/audit');if(rev!==maintenanceRevision||!authorized)return;if(!Array.isArray(audit?.items))throw Error('Resposta de auditoria inválida.');maintenanceAudit=audit.items;renderMaintenanceAudit();}catch(e){if(rev===maintenanceRevision)txt('maintenance-audit-status',e.message);}}
 }catch(e){if(rev===maintenanceRevision)txt('maintenance-status',e.message+' Nenhum dado foi alterado.');}finally{maintenanceBusy=false;$('maintenance-refresh').disabled=false;}
}
for(const id of ['maintenance-search','maintenance-kind'])$(id).addEventListener(id==='maintenance-search'?'input':'change',renderMaintenanceEntities);
for(const id of ['maintenance-link-kind','maintenance-link-validity'])$(id).addEventListener('change',renderMaintenanceLinks);
for(const id of ['maintenance-audit-search','maintenance-audit-action'])$(id).addEventListener(id.endsWith('search')?'input':'change',renderMaintenanceAudit);
$('maintenance-refresh').addEventListener('click',refreshMaintenance);
$('maintenance-edit-cancel').addEventListener('click',cancelMaintenanceEdit);
$('maintenance-close-cancel').addEventListener('click',cancelMaintenanceClose);
for(const form of [maintenanceEdit,maintenanceClose])form.addEventListener('submit',async event=>{
 event.preventDefault();const editing=form===maintenanceEdit,selected=editing?maintenanceSelected:maintenanceClosing;if(!authorized||form.hidden||!selected||maintenanceBusy||maintenanceSaving||(editing?!maintenanceCanEdit:!maintenanceCanClose))return;
 maintenanceSaving=true;const rev=maintenanceRevision,button=form.querySelector('[type=submit]');button.disabled=true;
 const data=Object.fromEntries(new FormData(form));data.request_id=crypto.randomUUID();data.entity_id=selected.id;data.kind=selected.kind;
 if(editing){data.old_name=selected.name;data.old_display=selected.display_name||null;}
 try{const result=await registryRequest(editing?'/v1/maintenance/edit':'/v1/maintenance/close','POST',data);if(rev!==maintenanceRevision||!authorized)return;if(!result?.item)throw Error('Confirmação não recebida. Consulte antes de repetir.');await refreshMaintenance();if(authorized&&!$('maintenance-content').hidden)txt('maintenance-status',editing?'Cadastro atualizado.':'Encerramento registrado.');}
 catch(e){if(rev===maintenanceRevision)txt('maintenance-status',e.message+' Consulte antes de reenviar.');}finally{maintenanceSaving=false;button.disabled=false;}
});


let crmRevision=0,crmDetailRevision=0,crmBusy=false,crmSaving=false,crmRows=[],crmSelected=null;
const crmCreate=$('crm-create'),crmEdit=$('crm-edit'),crmInteraction=$('crm-interaction');
const crmField=(form,key)=>form.elements.namedItem(key);
const crmStages={prospecting:'Prospecção',qualified:'Qualificação',proposal:'Proposta',negotiation:'Negociação',won:'Ganha',lost:'Perdida'};
const crmChannels={phone:'Telefone',email:'E-mail',meeting:'Reunião',message:'Mensagem',visit:'Visita',other:'Outro'};
const crmClosed=r=>['won','lost'].includes(r.stage);
const crmMoney=v=>v===null||v===undefined?'Não estimado':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function closeCrmDetail(){crmDetailRevision++;crmSelected=null;crmEdit.reset();crmInteraction.reset();$('crm-detail').hidden=true;$('crm-interactions').replaceChildren();txt('crm-interaction-status','');}
function resetCrm(){crmRevision++;crmRows=[];closeCrmDetail();$('crm-content').hidden=true;crmCreate.reset();$('crm-search').value='';$('crm-stage-filter').replaceChildren();for(const id of ['crm-board','crm-metrics'])$(id).replaceChildren();txt('crm-count','');txt('crm-status','Aguardando consulta.');}
function renderCrm(){
 const metrics=$('crm-metrics');metrics.replaceChildren();const open=crmRows.filter(r=>!crmClosed(r)),sum=rows=>rows.reduce((a,r)=>a+Math.round(Number(r.estimated_value||0)*100),0)/100;
 for(const [label,value] of [['Oportunidades abertas',open.length],['Valor estimado em aberto',crmMoney(sum(open))],['Ganhas',crmRows.filter(r=>r.stage==='won').length],['Acompanhamentos atrasados',open.filter(r=>r.overdue).length]]){const card=node('article',undefined,'business-card');card.append(node('span',label),node('strong',value));metrics.append(card);}
 const query=norm($('crm-search').value.trim()),stage=$('crm-stage-filter').value,rows=crmRows.filter(r=>(!stage||r.stage===stage)&&(!query||norm([r.title,r.party_name].join(' ')).includes(query))),board=$('crm-board');board.replaceChildren();txt('crm-count',rows.length+' de '+crmRows.length+' oportunidade(s).');
 for(const [key,label] of Object.entries(crmStages)){if(stage&&key!==stage)continue;const column=node('section',undefined,'crm-column');const items=rows.filter(r=>r.stage===key);column.append(node('h4',label+' · '+items.length));for(const r of items){const card=node('article',undefined,'crm-card');const button=node('button',r.title,'crm-card-link');button.type='button';button.addEventListener('click',()=>openCrmDetail(r));card.append(button,node('p',r.party_name,'muted small'),node('strong',crmMoney(r.estimated_value)));if(r.next_followup&&!crmClosed(r))card.append(node('p',(r.overdue?'Atrasado: ':'Acompanhar: ')+r.next_followup,r.overdue?'crm-overdue small':'muted small'));if(r.expected_close)card.append(node('p','Previsão: '+r.expected_close,'muted small'));column.append(card);}if(!items.length)column.append(node('p','Sem oportunidades.','muted small'));board.append(column);}
}
function crmLossField(){const lost=crmField(crmEdit,'stage').value==='lost';$('crm-loss-label').hidden=!lost;const field=crmField(crmEdit,'loss_reason');field.disabled=!lost;field.required=lost;if(!lost)field.value='';}
async function openCrmDetail(row){
 if(!authorized||!row||crmSaving)return;closeCrmDetail();crmSelected=row;const rev=crmDetailRevision;txt('crm-detail-title',row.title);txt('crm-detail-state',[row.party_name,crmStages[row.stage],row.loss_reason?'Motivo: '+row.loss_reason:null].filter(Boolean).join(' · '));
 for(const key of ['title','estimated_value','expected_close','next_followup','loss_reason'])crmField(crmEdit,key).value=row[key]??'';
 options(crmField(crmEdit,'stage'),Object.entries(crmStages).map(([id,label])=>({id,label})),'Selecione a etapa');crmField(crmEdit,'stage').value=row.stage;crmLossField();crmEdit.hidden=crmClosed(row);
 crmField(crmInteraction,'interaction_date').value=localDate();$('crm-detail').hidden=false;txt('crm-interaction-status','Consultando histórico...');
 try{const data=await registryRequest('/v1/crm/opportunities/'+row.id+'/interactions');if(rev!==crmDetailRevision||!authorized)return;if(!Array.isArray(data?.items))throw Error('Resposta inválida.');const host=$('crm-interactions');host.replaceChildren();for(const i of data.items){const item=node('article',undefined,'corp-item');item.append(node('strong',i.interaction_date+' · '+(crmChannels[i.channel]||i.channel)),node('p',i.summary,'crm-interaction-text'));host.append(item);}txt('crm-interaction-status',data.items.length+' interação(ões).');}
 catch(e){if(rev===crmDetailRevision)txt('crm-interaction-status',e.message);}
}
async function refreshCrm(focus=null){
 if(!authorized||crmBusy)return;crmBusy=true;resetCrm();const rev=crmRevision;$('crm-refresh').disabled=true;txt('crm-status','Consultando CRM...');
 try{const context=await registryRequest('/v1/context');if(rev!==crmRevision||!authorized)return;if(context?.crm!==true)throw Error('CRM indisponível ou acesso restrito.');
 const [data,parties]=await Promise.all([registryRequest('/v1/crm/opportunities'),registryRequest('/v1/parties')]);if(rev!==crmRevision||!authorized)return;if(!Array.isArray(data?.items)||!Array.isArray(parties?.items))throw Error('Resposta cadastral inválida.');
 crmRows=data.items;options(crmField(crmCreate,'party_id'),parties.items.filter(p=>p.status==='active').map(p=>({id:p.id,label:p.legal_name+' · '+p.kind+' · '+p.code})),'Selecione a pessoa ou empresa');options($('crm-stage-filter'),Object.entries(crmStages).map(([id,label])=>({id,label})),'Todas as etapas');renderCrm();$('crm-content').hidden=false;txt('crm-status',crmRows.length+' oportunidade(s) no CRM.');if(focus){const row=crmRows.find(r=>r.id===focus);if(row)await openCrmDetail(row);}
 }catch(e){if(rev===crmRevision)txt('crm-status',e.message+' Nenhum dado foi alterado.');}finally{crmBusy=false;$('crm-refresh').disabled=false;}
}
$('crm-refresh').addEventListener('click',()=>refreshCrm());
$('crm-search').addEventListener('input',renderCrm);$('crm-stage-filter').addEventListener('change',renderCrm);
$('crm-detail-close').addEventListener('click',closeCrmDetail);crmField(crmEdit,'stage').addEventListener('change',crmLossField);
for(const form of [crmCreate,crmEdit,crmInteraction])form.addEventListener('submit',async event=>{
 event.preventDefault();const creating=form===crmCreate,editing=form===crmEdit,selected=crmSelected;if(!authorized||crmBusy||crmSaving||$('crm-content').hidden||(!creating&&(!selected||$('crm-detail').hidden))||(editing&&crmClosed(selected)))return;
 crmSaving=true;const rev=crmRevision,detailRev=crmDetailRevision,buttons=[crmCreate,crmEdit,crmInteraction].map(f=>f.querySelector('[type=submit]'));buttons.forEach(b=>b.disabled=true);const data=Object.fromEntries(new FormData(form));data.request_id=crypto.randomUUID();if(creating||editing){data.estimated_value=data.estimated_value.trim().replace(',','.')||null;}if(editing)data.revision=selected.revision;
 const path=creating?'/v1/crm/opportunities':'/v1/crm/opportunities/'+selected.id+(editing?'/update':'/interactions');
 try{const result=await registryRequest(path,'POST',data);if(rev!==crmRevision||!authorized||(!creating&&detailRev!==crmDetailRevision))return;const id=creating?result?.item?.opportunity_id:selected.id;if(!result?.item?.[creating||editing?'opportunity_id':'interaction_id'])throw Error('Confirmação não recebida. Consulte antes de repetir.');crmSaving=false;await refreshCrm(id);if(authorized&&!$('crm-content').hidden)txt('crm-status','Registro efetuado com sucesso.');}
 catch(e){if(rev===crmRevision)txt('crm-status',e.message+' Consulte antes de reenviar.');}finally{crmSaving=false;buttons.forEach(b=>b.disabled=false);}
});

window.addEventListener('hashchange',route);route();