(()=>{'use strict';
const $=id=>document.getElementById(id);
let token='',clientId=0;
const state={units:[],services:[],destinations:[],transferPolicies:[]};
const status=s=>$('iuStatus').textContent=s;
async function request(body){
 const r=await fetch('/api/institution-units',{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const d=await r.json();
 if(!r.ok)throw Error(d.error||'Não foi possível consultar os cadastros');
 return d;
}
function select(id,rows){
 const el=$(id),old=el.value;
 el.replaceChildren(...rows.map(x=>new Option(x.name,String(x.id))));
 if(rows.some(x=>String(x.id)===old))el.value=old;
 el.disabled=!rows.length;
}
const destinationTypes={guiche:'Guichê',sala:'Sala',consultorio:'Consultório',setor:'Setor',outro:'Destino'};
function destinationLabel(kind,name){const type=destinationTypes[kind]||'Destino';const raw=String(name||'').trim();return new RegExp('^'+type+'(?:\\s|$)','i').test(raw)?raw:type+' '+raw}
function rawDestinationName(name){return String(name||'').trim().replace(/^(Guichê|Sala|Consultório|Setor|Destino)\\s+/i,'')}
function destinationList(rows,unitName){
 const el=$('iuDestinations');el.replaceChildren();
 if(!rows.length){const empty=document.createElement('li');empty.className='iu-empty';empty.textContent='Nenhum destino cadastrado.';el.append(empty);return}
 for(const row of rows){
  const li=document.createElement('li');li.className='iu-destination-card';
  const heading=document.createElement('strong');heading.textContent=destinationLabel(row.destination_type,row.name);
  const unit=document.createElement('small');unit.textContent='Unidade: '+unitName(row.unit_id);
  const edit=document.createElement('button');edit.type='button';edit.className='iu-edit-btn';edit.textContent='Editar';
  const form=document.createElement('div');form.className='iu-edit-form';form.hidden=true;
  const field=document.createElement('label');field.textContent='Número ou identificação';
  const input=document.createElement('input');input.maxLength=80;input.value=rawDestinationName(row.name);field.append(input);
  const kindField=document.createElement('label');kindField.textContent='Tipo';
  const kindSelect=document.createElement('select');
  for(const [value,label] of Object.entries(destinationTypes)){const option=document.createElement('option');option.value=value;option.textContent=label;kindSelect.append(option)}
  kindSelect.value=row.destination_type;kindField.append(kindSelect);
  const actions=document.createElement('div');actions.className='iu-edit-actions';
  const save=document.createElement('button');save.type='button';save.textContent='Salvar';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='iu-secondary';cancel.textContent='Cancelar';
  actions.append(save,cancel);form.append(field,kindField,actions);
  edit.onclick=()=>{form.hidden=false;edit.hidden=true;input.focus()};
  cancel.onclick=()=>{form.hidden=true;edit.hidden=false;input.value=rawDestinationName(row.name);kindSelect.value=row.destination_type};
  save.onclick=async()=>{
   const raw=input.value.trim(),kind=kindSelect.value;
   if(!raw||!fieldValid(raw))return status('Informe uma identificação válida para o destino.');
   const name=destinationLabel(kind,raw);
   save.disabled=true;cancel.disabled=true;
   try{
    await request({type:'destination_update',destinationId:Number(row.id),name,kind});
    await load();status('Destino atualizado: '+name);
   }catch(e){status(e.message)}finally{save.disabled=false;cancel.disabled=false}
  };
  li.append(heading,unit,edit,form);el.append(li);
 }
}
function serviceList(rows,unitName){
 const el=$('iuServices');el.replaceChildren();
 if(!rows.length){const empty=document.createElement('li');empty.className='iu-empty';empty.textContent='Nenhum serviço cadastrado.';el.append(empty);return}
 for(const row of rows){
  const li=document.createElement('li');li.className='iu-service-card';
  const name=document.createElement('strong');name.textContent=row.name;
  const unit=document.createElement('small');unit.textContent='Unidade: '+unitName(row.unit_id);
  const edit=document.createElement('button');edit.type='button';edit.className='iu-edit-btn';edit.textContent='Editar';
  const form=document.createElement('div');form.className='iu-edit-form';form.hidden=true;
  const label=document.createElement('label');label.textContent='Nome do serviço';
  const input=document.createElement('input');input.maxLength=100;input.value=row.name;label.append(input);
  const actions=document.createElement('div');actions.className='iu-edit-actions';
  const save=document.createElement('button');save.type='button';save.textContent='Salvar';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='iu-secondary';cancel.textContent='Cancelar';
  actions.append(save,cancel);form.append(label,actions);
  edit.onclick=()=>{form.hidden=false;edit.hidden=true;input.focus()};
  cancel.onclick=()=>{input.value=row.name;form.hidden=true;edit.hidden=false};
  save.onclick=async()=>{
   const updatedName=input.value.trim().replace(/\\s+/g,' ');
   if(updatedName.length<2||updatedName.length>100)return status('Nome do serviço deve ter entre 2 e 100 caracteres.');
   if(updatedName===row.name){cancel.onclick();return}
   save.disabled=true;cancel.disabled=true;
   try{await request({type:'service_update',serviceId:Number(row.id),name:updatedName});await load();status('Serviço atualizado: '+updatedName)}
   catch(e){status(e.message)}finally{save.disabled=false;cancel.disabled=false}
  };
  li.append(name,unit,edit,form);el.append(li);
 }
}
function fieldValid(value){return /^[\\p{L}\\p{N} ._-]+$/u.test(value)&&value.length<=80}

function list(id,rows,describe){
 const el=$(id);el.replaceChildren();
 if(!rows.length){el.replaceChildren();const empty=document.createElement('li');empty.className='iu-empty';empty.textContent='Nenhum cadastro ainda. Use o botão abaixo para adicionar.';el.append(empty);return}
 for(const row of rows){const li=document.createElement('li');li.textContent=describe(row);el.append(li)}
}
async function load(){
 if(!token)return;
 try{
  const data=await request();
  if(Number(data.institution?.id)!==clientId)throw Error('Instituição inconsistente');
  state.units=data.units||[];state.services=data.services||[];state.destinations=data.destinations||[];state.transferPolicies=data.transferPolicies||[];
  $('iuInstitution').textContent='Instituição: '+data.institution.name;
  $('iuCountUnits').textContent=state.units.length;
  $('iuCountServices').textContent=state.services.length;
  $('iuCountDestinations').textContent=state.destinations.length;
  select('iuServiceUnit',state.units);select('iuDestinationUnit',state.units);select('iuPolicyUnit',state.units);showPolicy();
  const unitName=id=>state.units.find(u=>String(u.id)===String(id))?.name||'Unidade desconhecida';
  list('iuUnits',state.units,u=>u.name);
  serviceList(state.services,unitName);
  destinationList(state.destinations,unitName);
  $('iuAddService').disabled=!state.units.length;
  $('iuAddDestination').disabled=!state.units.length;$('iuSavePolicy').disabled=!state.units.length;
  status('Cadastros da instituição atualizados.');
 }catch(e){status(e.message)}
}
async function create(type,fields,inputId){
 if(!token)return status('Acesso institucional necessário.');
 const name=$(inputId).value.trim();
 if(!name)return status('Informe um nome para cadastrar.');
 try{
  await request({type,name,...fields});
  $(inputId).value='';
  await load();
  status('Cadastro realizado.');
 }catch(e){status(e.message)}
}
$('iuAddUnit').onclick=()=>create('unit',{},'iuUnitName');
$('iuAddService').onclick=()=>create('service',{unitId:Number($('iuServiceUnit').value)},'iuServiceName');
$('iuAddDestination').onclick=async()=>{const kind=$('iuDestinationKind').value,raw=$('iuDestinationName').value.trim();if(!raw)return status('Informe o número ou identificação do destino.');if(!/^[\p{L}\p{N} ._-]+$/u.test(raw))return status('Identificação inválida.');const name=destinationLabel(kind,raw);if(!token)return status('Acesso institucional necessário.');try{await request({type:'destination',unitId:Number($('iuDestinationUnit').value),kind,name});$('iuDestinationName').value='';await load();status('Destino cadastrado: '+name)}catch(e){status(e.message)}};
function showPolicy(){const uid=$('iuPolicyUnit').value;const found=state.transferPolicies.find(x=>String(x.unit_id)===uid);$('iuPolicy').value=['start','end','original'].includes(found?.policy)?found.policy:'end';$('iuPolicyStatus').textContent=found?.policy?'Regra configurada para esta unidade.':'Padrão: fim da fila.'}
$('iuPolicyUnit').onchange=showPolicy;
$('iuSavePolicy').onclick=async()=>{try{if(!$('iuPolicyUnit').value)throw Error('Selecione uma unidade.');const unitId=Number($('iuPolicyUnit').value),policy=$('iuPolicy').value;await request({type:'transfer_policy',unitId,policy});await load();$('iuPolicyUnit').value=String(unitId);showPolicy();$('iuPolicyStatus').textContent='Regra salva com sucesso.';}catch(e){$('iuPolicyStatus').textContent=e.message}};
function openTab(name){const names=['units','services','destinations'];if(!names.includes(name))return;for(const tab of names){const selected=tab===name;const suffix=tab[0].toUpperCase()+tab.slice(1);$('iuPane'+suffix).hidden=!selected;$('iuTab'+suffix).setAttribute('aria-selected',String(selected));$('iuTab'+suffix).tabIndex=selected?0:-1}}
for(const b of document.querySelectorAll('[data-iu-tab]')){b.addEventListener('click',()=>openTab(b.dataset.iuTab));b.addEventListener('keydown',e=>{if(!['ArrowRight','ArrowLeft'].includes(e.key))return;const tabs=['units','services','destinations'];const at=tabs.indexOf(b.dataset.iuTab),next=tabs[(at+(e.key==='ArrowRight'?1:2))%3];openTab(next);$('iuTab'+next[0].toUpperCase()+next.slice(1)).focus();e.preventDefault()})}openTab('units');
$('iuRefresh').onclick=load;
document.querySelector('[data-view-btn="units"]')?.addEventListener('click',load);
window.flowInstitutionUnitsLogin=(value,id)=>{token=value;clientId=Number(id);load()};
})();