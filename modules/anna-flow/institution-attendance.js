(()=>{'use strict';
const $=id=>document.getElementById(id);
let token='',clientId=0,busy=false;
const put=(id,x)=>$(id).textContent=String(x??'—');
const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=String(text??'');if(cls)e.className=cls;return e};
async function api(unit,body){
 const r=await fetch('/api/institution-attendance'+(unit?'?unit='+encodeURIComponent(unit):''),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Erro de consulta');return d;
}
function draw(items,where,make){
 const root=$(where);root.replaceChildren();
 if(!items?.length){root.append(node('p','Nenhum registro disponível nesta unidade.','note'));return}
 for(const item of items)root.append(make(item));
}
function card(title,subtitle,extra){
 const article=node('article','','ia-item'),a=node('div',''),name=node('strong',title),desc=node('small',subtitle),side=node('strong',extra,'ia-side');
 a.append(name,desc);article.append(a,side);return article;
}
function showTab(tab){
 for(const [name,id] of [['queues','iaQueues'],['desks','iaDesks'],['history','iaHistory']]){
  const active=tab===name;$(id).hidden=!active;
  document.querySelector('[data-ia-tab="'+name+'"]').setAttribute('aria-selected',String(active));
 }
}
async function load(){
 const unit=Number($('iaUnit').value);
 if(!token||!unit||busy)return;
 busy=true;
 try{
  const d=await api(unit);if(Number(d.unit?.id)!==unit)throw Error('Unidade incompatível');
  put('iaWaiting',d.totals.waiting);put('iaActive',d.totals.active);put('iaCompleted',d.totals.completed);
  draw(d.services,'iaQueues',x=>card(x.name,'Normal: '+x.normal+' · Preferencial: '+x.preferential,(x.normal+x.preferential)+' aguardando'));
  draw(d.desks,'iaDesks',x=>card(x.name,x.code?'Em atendimento':'Disponível',x.code||'—'));
  draw(d.history,'iaHistory',x=>card(x.code||'—',x.destination+' · '+(x.status||'chamado'),x.calledAt?new Date(x.calledAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''));
  const s=d.settings||{};
  $('iaStartNumber').value=s.startNumber||1;
  $('iaOpeningTime').value=s.openingTime||'';
  $('iaTimezone').value=s.timezone||'America/Fortaleza';
  put('iaStatus','Atualizado às '+new Date().toLocaleTimeString('pt-BR')+' · '+d.unit.name);
 }catch(e){put('iaStatus','Não foi possível consultar: '+e.message)}finally{busy=false}
}
async function units(){
 try{
  const d=await api();const sel=$('iaUnit'),old=sel.value;
  sel.replaceChildren(...(d.units||[]).map(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name;return o}));
  if((d.units||[]).some(x=>String(x.id)===old))sel.value=old;
  if(!sel.value){put('iaStatus','Nenhuma unidade autorizada nesta instituição.');return}
  await load();
 }catch(e){put('iaStatus',e.message)}
}
async function save(){
 const n=Number($('iaStartNumber').value),openingTime=$('iaOpeningTime').value,timezone=$('iaTimezone').value;
 if(!Number.isSafeInteger(n)||n<1||n>999999)return put('iaSettingsStatus','Informe um número inicial de 1 a 999999.');
 try{
  const d=await api(Number($('iaUnit').value),{type:'ticket_settings',startNumber:n,openingTime,timezone});
  put('iaSettingsStatus',d.notice||'Configuração salva.');
 }catch(e){put('iaSettingsStatus',e.message)}
}
for(const tab of ['queues','desks','history'])document.querySelector('[data-ia-tab="'+tab+'"]')?.addEventListener('click',()=>showTab(tab));
$('iaUnit').addEventListener('change',load);$('iaRefresh').addEventListener('click',load);$('iaSaveSettings').addEventListener('click',save);
document.querySelector('[data-view-btn="attendance"]')?.addEventListener('click',()=>{if(token)units()});
window.flowInstitutionAttendanceLogin=(t,id)=>{token=t;clientId=Number(id);$('institutionAttendance').hidden=false;units()};
showTab('queues');
setInterval(()=>{if(token&&!document.hidden&&document.querySelector('section.ia-attendance')?.classList.contains('visible'))load()},15000);
})();