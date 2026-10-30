'use strict';
// Only short-lived credentials in this browser tab; no secrets in URLs or persistent storage.
const SESSION_KEY='anna_sd_session';
const API='https://anna-one.onrender.com/api/v1/tickets';
function session(){
 try{
  const value=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');
  return value&&typeof value.token==='string'&&value.expiresAt>Date.now()?value:null;
 }catch(_){return null;}
}
function logout(){
 sessionStorage.removeItem(SESSION_KEY);
 window.location.replace('login.html');
}
const current=session();
if(!current){logout();}
else{
 const user=document.getElementById('session-user');
 if(user)user.textContent=current.email||'Conta autenticada';
 document.getElementById('session-logout')?.addEventListener('click',logout);
 const masterNav=document.getElementById('master-companies-nav');
 const masterForm=document.getElementById('master-company-form');
 const masterStatus=document.getElementById('master-company-status');
 const masterList=document.getElementById('master-company-list');
 const masterCount=document.getElementById('master-company-count');
 const masterApi='https://anna-one.onrender.com/api/v1/master/companies';
 let masterBusy=false;
 let editingCompany=null;
 let cachedCompanies=[];
 const digits=value=>String(value||'').replace(/\D/g,'');
 function maskBrazil(value,kind){
  const d=digits(value).slice(0,kind==='cnpj'?14:kind==='cep'?8:11);
  if(kind==='cep')return d.replace(/^(\d{5})(\d)/,'$1-$2');
  if(kind==='cnpj')return d.replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2}\.\d{3})(\d)/,'$1.$2').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\d{4})(\d)/,'$1-$2');
  return d.length>10?d.replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d{4})$/,'$1-$2'):d.replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{4})(\d{4})$/,'$1-$2');
 }
 function validCnpj(value){
  const d=digits(value);if(!d)return true;if(d.length!==14||/^(\d)\1+$/.test(d))return false;
  for(let size=12;size<=13;size++){
   const weights=size===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
   const sum=weights.reduce((a,w,i)=>a+Number(d[i])*w,0);
   if(Number(d[size])!==(sum%11<2?0:11-sum%11))return false;
  }return true;
 }
 const companyFields=[...masterForm.querySelectorAll('[data-company-field]')];
 for(const input of companyFields){
  const kind=({tax_id:'cnpj',zip_code:'cep',phone:'phone',whatsapp:'phone'})[input.dataset.companyField];
  if(kind)input.addEventListener('input',()=>{input.value=maskBrazil(input.value,kind);});
 }
 for(const id of ['master-invite-phone','master-invite-whatsapp']){
  const input=document.getElementById(id);input?.addEventListener('input',()=>{input.value=maskBrazil(input.value,'phone');});
 }
 const cepInput=masterForm.querySelector('[data-company-field="zip_code"]');
 cepInput.addEventListener('blur',async()=>{
  const cep=digits(cepInput.value);if(cep.length!==8)return;
  const before=cep;
  try{
   const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/',{cache:'no-store'});
   if(!response.ok)throw Error('CEP indisponível');
   const address=await response.json();
   if(address.erro||digits(cepInput.value)!==before){masterStatus.textContent='CEP não encontrado.';return;}
   for(const [key,value] of Object.entries({street:address.logradouro,district:address.bairro,city:address.localidade,state:address.uf})){
    const input=masterForm.querySelector('[data-company-field="'+key+'"]');if(input&&value)input.value=value;
   }
   masterStatus.textContent='Endereço localizado pelo CEP. Confira o número e complemento.';
  }catch(_){masterStatus.textContent='Não foi possível consultar o CEP. Preencha o endereço manualmente.';}
 });
 function resetCompanyEdit(){
  editingCompany=null;masterForm.reset();
  document.getElementById('master-company-save').textContent='Cadastrar empresa';
  document.getElementById('master-company-cancel').hidden=true;
 }
 document.getElementById('master-company-cancel').addEventListener('click',()=>{resetCompanyEdit();masterStatus.textContent='Edição cancelada.';});
 function editCompany(company){
  editingCompany=company.id;
  document.getElementById('master-company-name').value=company.name;
  for(const input of companyFields)input.value=company.details?.[input.dataset.companyField]||'';
  document.getElementById('master-company-save').textContent='Salvar alterações';
  document.getElementById('master-company-cancel').hidden=false;
  masterStatus.textContent='Editando '+company.name;
  masterForm.scrollIntoView({behavior:'smooth',block:'start'});
 }
 function renderCompanyRows(){
  const q=document.getElementById('master-company-search').value.trim().toLowerCase();
  masterList.replaceChildren();
  for(const company of cachedCompanies.filter(c=>(c.name+' '+c.code+' '+(c.details?.tax_id||'')).toLowerCase().includes(q))){
   const tr=document.createElement('tr');
   const labels={active:'Ativa',suspended:'Suspensa',closed:'Encerrada'};
   for(const value of [company.name,company.code,labels[company.status]||company.status]){
    const td=document.createElement('td');td.textContent=String(value||'');tr.append(td);
   }
   const td=document.createElement('td'),edit=document.createElement('button');
   edit.type='button';edit.className='secondary';edit.textContent='Editar';edit.onclick=()=>editCompany(company);td.append(edit);
   for(const [status,label] of [['active','Ativar'],['suspended','Suspender'],['closed','Encerrar']]){
    if(company.status===status||company.status==='closed')continue;
    const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;
    b.onclick=()=>changeMasterStatus(company.id,null,status,company.name);td.append(b);
   }
   tr.append(td);masterList.append(tr);
  }
 }
 document.getElementById('master-company-search').addEventListener('input',renderCompanyRows);

 async function masterRequest(method,body){
  const auth=session();if(!auth){logout();throw Error('Sessão expirada');}
  const response=await fetch(masterApi,{method,headers:{Authorization:'Bearer '+auth.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  if(response.status===401){logout();throw Error('Sessão expirada');}
  if(response.status===403)throw Error('Acesso exclusivo do Administrador Master.');
  if(response.status===409)throw Error('Já existe uma empresa com esse código.');
  if(response.status===400)throw Error('Confira o nome e o código da empresa.');
  if(!response.ok)throw Error('Não foi possível concluir a operação (HTTP '+response.status+').');
  return response.json();
 }
 async function changeMasterStatus(tenant_id,user_id,status,label){
  const reason=prompt('Motivo da alteração para '+label+' (mínimo 5 caracteres):');
  if(reason===null)return;
  if(reason.trim().length<5){alert('Informe um motivo com pelo menos 5 caracteres.');return;}
  if(!confirm('Confirma a alteração de '+label+' para '+status+'?'))return;
  try{await masterRequest('PATCH',{tenant_id,user_id,status,reason:reason.trim()});await loadMasterCompanies();}
  catch(error){alert(error.message);}
 }
 async function loadMasterCompanies(){
  if(masterBusy)return;
  masterBusy=true;masterCount.textContent='Consultando empresas...';
  try{
   const data=await masterRequest('GET');
   if(!Array.isArray(data.companies))throw Error('Resposta inválida da API.');
   masterNav.hidden=false;masterList.replaceChildren();
   const select=document.getElementById('master-invite-tenant'),previous=select.value;
   select.replaceChildren(new Option('Selecione a empresa',''));
   for(const company of data.companies)if(company.status==='active')select.add(new Option(company.name,company.id));
   if([...select.options].some(x=>x.value===previous))select.value=previous;
   const labels={active:'Ativa',suspended:'Suspensa',closed:'Encerrada'};
   cachedCompanies=data.companies;renderCompanyRows();
   const admins=document.getElementById('master-admin-list');admins.replaceChildren();
   for(const admin of data.administrators||[]){
    const company=data.companies.find(x=>x.id===admin.tenant_id);
    const tr=document.createElement('tr');
    for(const value of [company?.name||'—',admin.name||admin.email,admin.status==='active'?'Ativo':'Suspenso']){
     const td=document.createElement('td');td.textContent=value;tr.append(td);
    }
    const td=document.createElement('td'),b=document.createElement('button');
    b.type='button';b.className='secondary';b.textContent=admin.status==='active'?'Suspender':'Reativar';
    b.onclick=()=>changeMasterStatus(admin.tenant_id,admin.user_id,admin.status==='active'?'suspended':'active',admin.name||admin.email);
    td.append(b);tr.append(td);admins.append(tr);
   }
   const events=document.getElementById('master-events-list');events.replaceChildren();
   for(const item of data.events||[]){
    const p=document.createElement('p');p.textContent=new Date(item.created_at).toLocaleString('pt-BR')+' · '+item.kind+' · '+item.new_status+' · '+item.reason;events.append(p);
   }
   masterCount.textContent=data.companies.length+' empresa(s) cadastrada(s).';
  }catch(e){masterCount.textContent=e.message;}
  finally{masterBusy=false;}
 }
 masterForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(masterBusy)return;
  const name=document.getElementById('master-company-name').value.trim();
  const details=Object.fromEntries([...masterForm.querySelectorAll('[data-company-field]')].map(input=>[input.dataset.companyField,input.value.trim()]));
  if(name.length<2){masterStatus.textContent='Confira os dados da empresa.';return;}
  const button=document.getElementById('master-company-save');button.disabled=true;masterStatus.textContent='Cadastrando empresa...';
  try{
   if(!validCnpj(details.tax_id))throw Error('CNPJ inválido. Confira os dígitos verificadores.');
   if(details.zip_code&&digits(details.zip_code).length!==8)throw Error('CEP deve ter 8 dígitos.');
   for(const key of ['phone','whatsapp'])if(details[key]&&![10,11].includes(digits(details[key]).length))throw Error('Telefone e WhatsApp precisam de DDD e 10 ou 11 dígitos.');
   const created=await masterRequest(editingCompany?'PUT':'POST',{...(editingCompany?{tenant_id:editingCompany}:{}),name,details});
   masterStatus.textContent=editingCompany?'Cadastro atualizado com sucesso.':'Empresa cadastrada. Código: '+created.code+'.';
   resetCompanyEdit();
   await loadMasterCompanies();
  }catch(e){masterStatus.textContent=e.message;}
  finally{button.disabled=false;}
 });
 document.getElementById('master-invite-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const tenant_id=document.getElementById('master-invite-tenant').value;
  const email=document.getElementById('master-invite-email').value.trim().toLowerCase();
  const name=document.getElementById('master-invite-name').value.trim();
  const position=document.getElementById('master-invite-position').value.trim();
  const phone=document.getElementById('master-invite-phone').value.trim();
  const whatsapp=document.getElementById('master-invite-whatsapp').value.trim();
  const status=document.getElementById('master-invite-status');
  const button=document.getElementById('master-invite-send');
  if(!tenant_id||!email||name.length<2){status.textContent='Selecione a empresa, informe o nome e o e-mail.';return;}
  button.disabled=true;status.textContent='Enviando convite...';
  try{
   const auth=session();if(!auth){logout();return;}
   const response=await fetch('https://anna-one.onrender.com/api/v1/master/invitations',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify({tenant_id,email,name,position,phone,whatsapp})});
   if(response.status===401){logout();return;}
   if(!response.ok)throw Error(response.status===403?'Acesso exclusivo do Master.':'Falha ao enviar convite (HTTP '+response.status+').');
   status.textContent='Convite enviado para '+email+'. Validade: 48 horas.';
   document.getElementById('master-invite-form').reset();
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
 });
 document.getElementById('master-reload')?.addEventListener('click',loadMasterCompanies);
 loadMasterCompanies();

 const brandingNav=document.getElementById('branding-nav');
 const brandingTenant=document.getElementById('branding-tenant');
 const brandingForm=document.getElementById('branding-form');
 const brandingStatus=document.getElementById('branding-status');
 const brandingApi='https://anna-one.onrender.com/api/v1/admin/branding';
 const brandingLogo=document.getElementById('branding-logo');
 const brandingPreview=document.getElementById('branding-logo-preview');
 const brandingEmpty=document.getElementById('branding-logo-empty');
 function updateBrandingPreview(){
  const url=brandingLogo.value.trim();
  const valid=/^https:\/\//i.test(url);
  brandingPreview.hidden=!valid;brandingEmpty.hidden=valid;
  if(valid)brandingPreview.src=url;else brandingPreview.removeAttribute('src');
 }
 brandingLogo?.addEventListener('input',updateBrandingPreview);
 brandingPreview?.addEventListener('error',()=>{brandingPreview.hidden=true;brandingEmpty.hidden=false;brandingEmpty.textContent='Não foi possível carregar a imagem';});
 document.getElementById('branding-logo-upload')?.addEventListener('click',async()=>{
  const file=document.getElementById('branding-logo-file').files[0];
  if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>1048576||file.size<32){brandingStatus.textContent='Selecione um arquivo JPG ou PNG de até 1 MB.';return;}
  if(!brandingTenant.value){brandingStatus.textContent='Selecione uma instituição.';return;}
  const button=document.getElementById('branding-logo-upload');button.disabled=true;brandingStatus.textContent='Enviando logotipo...';
  try{
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Falha ao ler imagem'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
   const auth=session();if(!auth){logout();return;}
   const response=await fetch('https://anna-one.onrender.com/api/v1/branding-logo/'+brandingTenant.value,{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify({mime:file.type,base64})});
   if(response.status===401){logout();return;}
   if(!response.ok)throw Error(response.status===403?'Sem permissão para enviar o logotipo.':'Falha no envio (HTTP '+response.status+').');
   const result=await response.json();brandingLogo.value=result.logo_url;updateBrandingPreview();
   brandingStatus.textContent='Logotipo enviado. Clique em Salvar personalização para vinculá-lo à instituição.';
  }catch(e){brandingStatus.textContent=e.message;}
  finally{button.disabled=false;}
 });
 const brandingFields={display_name:'branding-name',logo_url:'branding-logo',signature:'branding-signature',contact_email:'branding-email',contact_phone:'branding-phone'};
 async function brandingRequest(method,tenant,body){
  const auth=session();if(!auth){logout();throw Error('Sessão expirada');}
  const headers={Authorization:'Bearer '+auth.token};
  if(tenant)headers['X-Tenant-Id']=tenant;
  if(body){headers['Content-Type']='application/json';}
  const response=await fetch(brandingApi,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  if(response.status===401){logout();throw Error('Sessão expirada');}
  if(!response.ok)throw Error(response.status===403?'Sem permissão para esta instituição.':'Falha na operação (HTTP '+response.status+').');
  return response.json();
 }
 async function loadBranding(){
  if(!brandingTenant.value)return;
  brandingStatus.textContent='Carregando configurações...';
  try{
   const data=await brandingRequest('GET',brandingTenant.value);
   for(const [key,id] of Object.entries(brandingFields))document.getElementById(id).value=data.branding?.[key]||'';
   updateBrandingPreview();
   brandingStatus.textContent='Configurações carregadas.';
  }catch(e){brandingStatus.textContent=e.message;}
 }
 brandingTenant?.addEventListener('change',loadBranding);
 brandingForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!brandingTenant.value)return;
  const body=Object.fromEntries(Object.entries(brandingFields).map(([key,id])=>[key,document.getElementById(id).value.trim()]));
  const button=document.getElementById('branding-save');button.disabled=true;brandingStatus.textContent='Salvando...';
  try{await brandingRequest('PUT',brandingTenant.value,body);brandingStatus.textContent='Personalização salva com sucesso.';}
  catch(e){brandingStatus.textContent=e.message;}
  finally{button.disabled=false;}
 });
 async function initBranding(){
  try{
   const data=await brandingRequest('GET');
   if(!Array.isArray(data.tenants)||!data.tenants.length)return;
   brandingNav.hidden=false;
   brandingTenant.replaceChildren(...data.tenants.map(t=>new Option(t.name,t.id)));
   await loadBranding();
  }catch(_){/* Non-managers never see the editor. */}
 }
 initBranding();

 const unitSelect=document.getElementById('real-unit');
 const createForm=document.getElementById('real-create-form');
 const createStatus=document.getElementById('real-create-status');
 const createButton=document.getElementById('real-submit');
 const success=document.getElementById('real-success');
 const successProtocol=document.getElementById('real-success-protocol');
 const copyFeedback=document.getElementById('real-copy-feedback');
 document.getElementById('real-copy-protocol')?.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(successProtocol.textContent);copyFeedback.textContent='Protocolo copiado!';}
  catch(_){copyFeedback.textContent='Selecione o número acima para copiar.';}
 });
 let unitsLoaded=false;
 async function loadUnits(){
  const auth=session();if(!auth){logout();return;}
  unitSelect.replaceChildren(new Option('Carregando unidades...',''));
  try{
   const response=await fetch('https://anna-one.onrender.com/api/v1/units',{headers:{Authorization:'Bearer '+auth.token},cache:'no-store'});
   if(response.status===401){logout();return;}
   if(!response.ok)throw Error('HTTP '+response.status);
   const data=await response.json();if(!Array.isArray(data.units))throw Error('invalid units');
   unitSelect.replaceChildren(new Option(data.units.length?'Selecione a unidade':'Nenhuma unidade autorizada',''));
   for(const unit of data.units){
    if(typeof unit.id==='string'&&typeof unit.name==='string')unitSelect.add(new Option(unit.tenant_code+' · '+unit.name,unit.id));
   }
   unitsLoaded=true;
  }catch(_){unitSelect.replaceChildren(new Option('Não foi possível carregar unidades',''));unitsLoaded=false;}
 }
 createForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!unitsLoaded||!unitSelect.value){createStatus.textContent='Selecione uma unidade autorizada.';return;}
  const auth=session();if(!auth){logout();return;}
  createButton.disabled=true;createStatus.textContent='Registrando chamado...';
  const category=document.getElementById('real-category');
  const data={unit_id:unitSelect.value,category_code:category.value,category_label:category.selectedOptions[0].textContent,title:document.getElementById('real-title').value.trim(),description:document.getElementById('real-description').value.trim(),priority:document.getElementById('real-priority').value};
  try{
   const response=await fetch(API,{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store'});
   if(response.status===401){logout();return;}
   if(!response.ok){createStatus.textContent=response.status===403?'Sem permissão para registrar nesta unidade.':'Falha no cadastro (HTTP '+response.status+').';return;}
   const result=await response.json();
   const protocol=result.ticket?.public_protocol;
   if(protocol){successProtocol.textContent=protocol;success.hidden=false;copyFeedback.textContent='';success.scrollIntoView({behavior:'smooth',block:'start'});}
   const emailInfo=result.email_status==='sent'?' Confirmação enviada por e-mail.':result.email_status==='failed'?' Chamado salvo, mas não foi possível confirmar o envio do e-mail.':result.email_status==='not_configured'?' Envio por e-mail aguardando configuração do servidor.':' E-mail do solicitante indisponível.';
   createStatus.textContent=(protocol?'Cadastro concluído. Protocolo destacado acima.':'Cadastro concluído. Consulte o protocolo na lista.')+emailInfo;
   createForm.reset();
   await loadTickets();
  }catch(_){createStatus.textContent='Falha de conexão ao registrar. Confira a lista antes de tentar novamente para evitar duplicação.';}
  finally{createButton.disabled=false;}
 });
 const status=document.getElementById('real-tickets-status');
 const tbody=document.getElementById('real-tickets-body');
 const detail=document.getElementById('real-ticket-detail');
 const detailContent=document.getElementById('real-ticket-detail-content');
 const statusNames={open:'Aberto',in_progress:'Em atendimento',pending:'Pendente',resolved:'Resolvido',closed:'Fechado'};
 const priorityNames={low:'Baixa',normal:'Normal',high:'Alta'};
 document.getElementById('real-detail-close')?.addEventListener('click',()=>{detail.hidden=true;detailContent.replaceChildren();});
 function showTicketDetail(ticket){
  detailContent.replaceChildren();
  const date=ticket.created_at?new Date(ticket.created_at):null;
  const fields=[['Protocolo',ticket.public_protocol],['Assunto',ticket.title],['Descrição',ticket.description],['Categoria',ticket.category_label],['Situação',statusNames[ticket.status]||ticket.status],['Prioridade',priorityNames[ticket.priority]||ticket.priority],['Criado em',date&&!Number.isNaN(date.valueOf())?date.toLocaleString('pt-BR'):'']];
  for(const [label,value] of fields){const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value||'—';detailContent.append(dt,dd);}
  detail.hidden=false;detail.scrollIntoView({behavior:'smooth',block:'nearest'});
 }
 let pending=false;
 async function loadTickets(){
  if(pending)return;
  const auth=session();
  if(!auth){logout();return;}
  pending=true;status.textContent='Consultando chamados autorizados...';
  tbody.replaceChildren();
  detail.hidden=true;detailContent.replaceChildren();
  try{
   const response=await fetch(API,{headers:{Authorization:'Bearer '+auth.token},cache:'no-store',mode:'cors'});
   if(response.status===401){logout();return;}
   if(!response.ok){status.textContent='Não foi possível consultar os chamados (HTTP '+response.status+').';return;}
   const data=await response.json();
   if(!Array.isArray(data.tickets))throw Error('invalid response');
   status.textContent=data.tickets.length?data.tickets.length+' chamado(s) autorizado(s).':'Nenhum chamado real disponível para esta conta.';
   for(const ticket of data.tickets){
    const tr=document.createElement('tr');
    const date=ticket.created_at?new Date(ticket.created_at):null;
    const first=document.createElement('td');const open=document.createElement('button');open.type='button';open.className='real-protocol-button';open.textContent=ticket.public_protocol||ticket.id||'Consultar';open.title='Consultar detalhes do chamado';open.addEventListener('click',()=>showTicketDetail(ticket));first.append(open);tr.append(first);
    for(const value of [ticket.title||'',statusNames[ticket.status]||ticket.status||'',priorityNames[ticket.priority]||ticket.priority||'',date&&!Number.isNaN(date.valueOf())?date.toLocaleString('pt-BR'):'']){
     const td=document.createElement('td');td.textContent=String(value);tr.append(td);
    }
    tbody.append(tr);
   }
  }catch(_){status.textContent='Falha ao consultar a API. Tente novamente.';}
  finally{pending=false;}
 }
 document.getElementById('reload-real-tickets')?.addEventListener('click',loadTickets);
 document.querySelector('[data-view="reais"]')?.addEventListener('click',()=>{loadTickets();loadUnits();});
 // Never fetch private records while showing the public demonstration.
}
