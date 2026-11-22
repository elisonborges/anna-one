(()=>{'use strict';
const $=id=>document.getElementById(id);
let token='',deviceMode=false,deviceCredential='';
let coverage={enabled:false,allowPrivate:true,providers:[]},paymentType='';
const note=(id,text)=>$(id).textContent=text;
function linked(){try{const x=JSON.parse(localStorage.getItem('annaFlowDevice')||'null');return x?.status==='active'&&typeof x.credential==='string'?x:null}catch{return null}}
function storedProduction(){try{const x=JSON.parse(sessionStorage.getItem('flowProductionSession')||'null');return x?.token&&x?.clientId?x:null}catch{return null}}
async function api(path,method='GET',body){
 const headers={'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 if(deviceMode)headers['X-Flow-Device']=deviceCredential;
 const response=await fetch(path,{method,headers,cache:'no-store',body:body?JSON.stringify(body):undefined});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Falha no servidor');
 return data;
}
function formatEmission(iso,zone){
 try{return new Intl.DateTimeFormat('pt-BR',{timeZone:zone||'America/Fortaleza',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}
 catch{return new Date(iso).toLocaleString('pt-BR')}
}
function showReceipt(data,serviceId,priority){
 const value=data.result||{},zone=value.timeZone||'America/Fortaleza';
 if(['58','80','a4'].includes(value.paperWidth))$('receiptWidth').value=value.paperWidth;
 const service=$('service').selectedOptions?.[0]?.textContent||'Serviço';
 const unit=$('unit').selectedOptions?.[0]?.textContent||'Unidade';
 const start=value.serviceStartLocal;
 const formattedStart=start?start.slice(8,10)+'/'+start.slice(5,7)+'/'+start.slice(0,4)+' às '+start.slice(11,16):'Não informado';
 note('receiptInstitution',value.institutionName||'Instituição');
 note('receiptUnit',value.unitName||unit);
 note('receiptCode',value.code);
 note('receiptType',priority==='preferencial'?'Atendimento preferencial':'Atendimento normal');
 note('receiptService',value.serviceName||service);
 const coverageText=value.paymentType==='particular'?'Particular':value.paymentType==='convenio'?'Convênio: '+value.providerName:'';
 $('receiptCoverageRow').hidden=!coverageText;note('receiptCoverage',coverageText);
 note('receiptIssued',value.issuedAt?formatEmission(value.issuedAt,zone):'Não informado');
 note('receiptStart',formattedStart);
 $('receipt').hidden=false;$('receiptTools').hidden=false;
 $('receipt').dataset.width=$('receiptWidth').value;
}
function sampleReceipt(){
 const now=new Date(),zone='America/Fortaleza';
 const local=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const p=Object.fromEntries(local.map(x=>[x.type,x.value]));
 const serviceName=$('service').selectedOptions?.[0]?.textContent||'Serviço de exemplo';
 const unitName=$('unit').selectedOptions?.[0]?.textContent||'Unidade de exemplo';
 showReceipt({result:{code:'A-001-001',institutionName:'INSTITUIÇÃO EXEMPLO',unitName,serviceName,issuedAt:now.toISOString(),serviceStartLocal:p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute,timeZone:zone,paperWidth:$('receiptWidth').value}},null,'normal');
 $('receipt').dataset.sample='true';
 $('receiptSample').hidden=false;
 $('receiptCoverageRow').hidden=true;
 note('message','AMOSTRA de impressão criada sem emissão de senha nem alteração na fila. Selecione o papel e clique em Imprimir senha para testar.');
}
function clearReceipt(){
 $('receipt').hidden=true;$('receiptTools').hidden=true;$('receipt').dataset.sample='false';$('receiptSample').hidden=true;
}
function choosePriority(value){
 $('priority').value=value;
 for(const [id,key] of [['chooseNormal','normal'],['choosePriority','preferencial']]){
  const b=$(id),on=key===value;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));
 }
}
function chooseCoverage(value){
 paymentType=value;
 for(const [id,key] of [['choosePrivate','particular'],['chooseInsurance','convenio']]){
  const b=$(id),on=key===value;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));
 }
 $('providerField').hidden=value!=='convenio';
}
async function loadCoverage(){
 coverage={enabled:false,allowPrivate:true,providers:[]};paymentType='';
 $('coverageStep').hidden=true;$('providerField').hidden=true;
 const unit=$('unit').value;if(!unit)return;
 const d=await api('/api/coverage-options?unit='+encodeURIComponent(unit));
 const x=d.options||{};coverage={enabled:x.enabled===true,allowPrivate:x.allowPrivate!==false,providers:Array.isArray(x.providers)?x.providers:[]};
 $('coverageStep').hidden=!coverage.enabled;
 $('choosePrivate').hidden=!coverage.allowPrivate;
 $('chooseInsurance').hidden=!coverage.providers.length;
 $('providerSelect').replaceChildren(...coverage.providers.map(n=>new Option(n,n)));
 if(coverage.enabled){
  chooseCoverage(coverage.allowPrivate?'particular':'convenio');
  if(!coverage.allowPrivate&&!coverage.providers.length)throw Error('Não há modalidades ativas para esta unidade.');
 }else chooseCoverage('');
}
function fill(id,items){
 const sel=$(id);sel.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=String(item.id);option.textContent=item.name;return option}));
}
async function catalog(){
 const unit=$('unit').value;
 if(!unit)return;
 const data=await api('/api/catalog?unit='+encodeURIComponent(unit));
 fill('service',data.services);
 await loadCoverage();
}
function authorized(){
 $('auth').hidden=true;$('emit').hidden=false;
}
async function resume(){
 const device=linked();
 if(device){
  try{
   deviceCredential=device.credential;deviceMode=true;
   const catalog=await api('/api/device/catalog');
   if(['totem','recepcao'].includes(catalog.kind)){
    fill('unit',[{id:catalog.unitId,name:'Unidade vinculada'}]);
    $('unit').disabled=true;fill('service',catalog.services);await loadCoverage();authorized();
    note('message','Equipamento autorizado para emissão de senhas.');return;
   }
  }catch(e){note('authStatus','O vínculo do dispositivo não está disponível. Verificando a sessão da Produção...')}
  deviceMode=false;deviceCredential='';
 }
 const saved=storedProduction();
 if(!saved){note('authStatus','Entre na Produção com sua conta de funcionário para emitir senhas, ou vincule um totem/recepção.');return}
 try{
  token=saved.token;
  const me=await api('/api/me');
  if(me.role!=='atendente'||Number(me.clientId)!==Number(saved.clientId))throw Error('Sessão operacional sem permissão');
  if(!me.units?.length)throw Error('Funcionário sem unidade autorizada');
  fill('unit',me.units);$('unit').disabled=false;await catalog();authorized();
  note('message','Sessão da Produção reconhecida. Escolha o serviço para emitir a senha.');
 }catch(e){
  token='';sessionStorage.removeItem('flowProductionSession');
  note('authStatus','Sessão da Produção expirada ou inválida. Faça login novamente.');
 }
}
$('unit').onchange=()=>{clearReceipt();$('ticket').textContent='';catalog().catch(e=>note('message',e.message))};
$('issue').onclick=async()=>{
 try{
  const unit=$('unit').value,serviceId=$('service').value;
  if(coverage.enabled&&(!paymentType||(paymentType==='convenio'&&!$('providerSelect').value)))throw Error('Selecione uma modalidade e um convênio válido.');
  if(!unit||!serviceId)throw Error('Selecione a unidade e o serviço');
  $('issue').disabled=true;
  const d=await api('/api/tenant?unit='+encodeURIComponent(unit),'POST',{type:'issue',serviceId:Number(serviceId),priority:$('priority').value,...(coverage.enabled?{paymentType,providerName:paymentType==='convenio'?$('providerSelect').value:null}:{})});
  note('ticket',d.result.code);showReceipt(d,serviceId,$('priority').value);$('receipt').dataset.sample='false';$('receiptSample').hidden=true;note('message','Senha emitida com sucesso. Utilize Imprimir senha se desejar um comprovante.');
 }catch(e){note('message',e.message)}finally{$('issue').disabled=false}
};
$('chooseNormal').onclick=()=>choosePriority('normal');
$('choosePriority').onclick=()=>choosePriority('preferencial');
$('choosePrivate').onclick=()=>chooseCoverage('particular');
$('chooseInsurance').onclick=()=>chooseCoverage('convenio');
$('testPrint').onclick=sampleReceipt;
$('receiptWidth').addEventListener('change',()=>{$('receipt').dataset.width=$('receiptWidth').value});
$('printTicket').onclick=()=>{if(!$('receipt').hidden)window.print()};
$('logout').onclick=async()=>{
 if(deviceMode){location.assign('/device.html');return}
 try{await api('/api/logout','POST',{})}catch{}
 token='';sessionStorage.removeItem('flowProductionSession');
 $('ticket').textContent='';clearReceipt();$('emit').hidden=true;$('auth').hidden=false;
 note('authStatus','Sessão encerrada. Entre novamente na Produção.');
};
resume().catch(e=>note('authStatus','Não foi possível consultar o acesso: '+e.message));
})();