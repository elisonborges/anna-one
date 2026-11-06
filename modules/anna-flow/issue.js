(()=>{'use strict';
const $=id=>document.getElementById(id);
let token='',deviceMode=false,deviceCredential='';
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
function fill(id,items){
 const sel=$(id);sel.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=String(item.id);option.textContent=item.name;return option}));
}
async function catalog(){
 const unit=$('unit').value;
 if(!unit)return;
 const data=await api('/api/catalog?unit='+encodeURIComponent(unit));
 fill('service',data.services);
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
    $('unit').disabled=true;fill('service',catalog.services);authorized();
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
$('unit').onchange=()=>catalog().catch(e=>note('message',e.message));
$('issue').onclick=async()=>{
 try{
  const unit=$('unit').value,serviceId=$('service').value;
  if(!unit||!serviceId)throw Error('Selecione a unidade e o serviço');
  const d=await api('/api/tenant?unit='+encodeURIComponent(unit),'POST',{type:'issue',serviceId:Number(serviceId),priority:$('priority').value});
  note('ticket',d.result.code);note('message','Senha emitida com sucesso.');
 }catch(e){note('message',e.message)}
};
$('logout').onclick=async()=>{
 if(deviceMode){location.assign('/device.html');return}
 try{await api('/api/logout','POST',{})}catch{}
 token='';sessionStorage.removeItem('flowProductionSession');
 $('ticket').textContent='';$('emit').hidden=true;$('auth').hidden=false;
 note('authStatus','Sessão encerrada. Entre novamente na Produção.');
};
resume().catch(e=>note('authStatus','Não foi possível consultar o acesso: '+e.message));
})();