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
function destinationList(rows,unitName){const el=$('iuDestinations');el.replaceChildren();if(!rows.length){const empty=document.createElement('li');empty.className='iu-empty';empty.textContent='Nenhum destino cadastrado.';el.append(empty);return}for(const row of rows){const li=document.createElement('li');li.className='iu-destination-card';const heading=document.createElement('strong');heading.textContent=destinationLabel(row.destination_type,row.name);const unit=document.createElement('small');unit.textContent='Unidade: '+unitName(row.unit_id);li.append(heading,unit);el.append(li)}}
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
  list('iuServices',state.services,x=>x.name+' · '+unitName(x.unit_id));
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