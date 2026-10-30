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
 const brandingNav=document.getElementById('branding-nav');
 const brandingTenant=document.getElementById('branding-tenant');
 const brandingForm=document.getElementById('branding-form');
 const brandingStatus=document.getElementById('branding-status');
 const brandingApi='https://anna-one.onrender.com/api/v1/admin/branding';
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
