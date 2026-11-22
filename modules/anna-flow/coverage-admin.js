(()=>{'use strict';
const $=id=>document.getElementById(id);
let token='',pending=0;
const status=s=>$('flowCoverageStatus').textContent=s;
async function api(unit,body){
 const r=await fetch('/api/coverage-options?unit='+encodeURIComponent(unit),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Falha ao consultar modalidades');return d;
}
async function load(){
 const unit=Number($('iaUnit').value);
 if(!token||!unit)return status('Escolha uma unidade na parte superior.');
 const id=++pending;
 try{
  const d=await api(unit);if(id!==pending||Number($('iaUnit').value)!==unit)return;
  const x=d.options||{};$('flowCoverageEnabled').checked=x.enabled===true;
  $('flowCoveragePrivate').checked=x.allowPrivate!==false;
  $('flowCoverageProviders').value=(x.providers||[]).join('\n');
  status('Modalidades carregadas para a unidade selecionada.');
 }catch(e){if(id===pending)status(e.message)}
}
async function save(){
 const unit=Number($('iaUnit').value);if(!unit)return status('Selecione uma unidade.');
 const providers=$('flowCoverageProviders').value.split('\n').map(s=>s.trim()).filter(Boolean);
 const body={enabled:$('flowCoverageEnabled').checked,allowPrivate:$('flowCoveragePrivate').checked,providers};
 try{
  const d=await api(unit,body);
  status(d.saved?'Modalidades salvas. Novas emissões já usarão esta configuração.':'Não foi possível salvar.');
 }catch(e){status(e.message)}
}
$('flowCoverageSave').onclick=save;$('flowCoverageReload').onclick=load;
$('iaUnit').addEventListener('change',load);
document.querySelector('[data-view-btn="attendance"]')?.addEventListener('click',()=>{if(token)load()});
window.flowCoverageAdminLogin=(value)=>{token=value;load()};
})();