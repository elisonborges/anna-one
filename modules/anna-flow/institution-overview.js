(()=>{'use strict';
const $=id=>document.getElementById(id);
const status=s=>$('ioStatus').textContent=s;
let token='',clientId=0,busy=false;
function set(id,n){$(id).textContent=String(n??0)}
function queueRow(item,max){
 const root=document.createElement('div');root.className='io-queue';
 const head=document.createElement('div');head.className='io-queue-head';
 const name=document.createElement('span');name.textContent=item.name+' · '+item.unitName;
 const count=document.createElement('small');count.textContent=item.waiting+' aguardando';
 head.append(name,count);
 const track=document.createElement('div');track.className='io-track';
 const fill=document.createElement('div');fill.className='io-fill';fill.style.width=Math.round(100*item.waiting/Math.max(1,max))+'%';
 track.append(fill);root.append(head,track);return root;
}
async function load(){
 if(!token||busy||$('ioDashboard').hidden||!document.querySelector('section[data-view="overview"]')?.classList.contains('visible'))return;
 busy=true;
 try{
  const res=await fetch('/api/institution-overview',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  const d=await res.json();if(!res.ok)throw Error(d.error||'Falha ao consultar indicadores');
  if(Number(d.institution?.id)!==clientId)throw Error('Instituição inconsistente');
  $('ioInstitution').textContent=d.institution.name;
  set('ioWaiting',d.totals.waiting);set('ioActive',d.totals.active);set('ioCompleted',d.totals.completed);set('ioDevices',d.totals.devices);
  set('ioUnits',d.totals.units);set('ioServices',d.totals.services);set('ioPanels',d.totals.panels);
  $('ioCompletedLabel').textContent=d.completedLabel||'Atendimentos concluídos';
  const rows=Array.isArray(d.queues)?d.queues:[];
  const root=$('ioQueues');root.replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='note';p.textContent='Nenhum serviço ativo cadastrado.';root.append(p)}
  else{const max=Math.max(1,...rows.map(x=>Number(x.waiting)||0));for(const item of rows)root.append(queueRow(item,max))}
  status('Indicadores atualizados · '+new Date().toLocaleTimeString('pt-BR'));
 }catch(e){status('Não foi possível atualizar: '+e.message)}
 finally{busy=false}
}
$('ioRefresh').onclick=load;
for(const b of document.querySelectorAll('[data-io-view]'))b.addEventListener('click',()=>document.querySelector('[data-view-btn="'+b.dataset.ioView+'"]')?.click());
document.querySelector('[data-view-btn="overview"]')?.addEventListener('click',()=>{if(token)load()});
window.flowInstitutionOverviewLogin=(value,id)=>{token=value;clientId=Number(id);$('ioDashboard').hidden=false;load()};
setInterval(()=>{if(token&&!document.hidden)load()},15000);
})();