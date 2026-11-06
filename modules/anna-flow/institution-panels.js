(()=>{'use strict';
const $=id=>document.getElementById(id);
let token='',clientId=0,data={units:[],services:[],panels:[]},loading=false;
const status=s=>$('ipStatus').textContent=s;
const node=(tag,text)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;return x};
const button=(label,fn)=>{const x=node('button',label);x.type='button';x.onclick=fn;return x};
const labels={escuro:'Premium',claro:'Institucional',acolhedor:'Acolhedor'};
async function request(body){
 const r=await fetch('/api/institution-panels',{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Falha na consulta');return d;
}
function fillUnits(){
 const el=$('ipUnit'),prev=el.value;el.replaceChildren(...data.units.map(u=>{const op=node('option',u.name);op.value=u.id;return op}));
 if(data.units.some(u=>String(u.id)===prev))el.value=prev;el.disabled=!data.units.length;$('ipAdd').disabled=!data.units.length;
}
function labeled(label,control){const el=node('label',label);el.append(control);return el}
function render(){
 $('ipCards').replaceChildren();$('ipCountPanels').textContent=String(data.panels.length);
 $('ipCountDevices').textContent=String(data.panels.reduce((n,p)=>n+Number(p.tvCount||0),0));
 if(!data.panels.length){const msg=node('p','Nenhum painel cadastrado. Utilize “Novo painel de TV” abaixo.');msg.className='note';$('ipCards').append(msg);return}
 for(const p of data.panels){
  const card=node('article');card.className='ip-card';
  const title=node('h3',p.name),unit=data.units.find(u=>Number(u.id)===Number(p.unit_id));
  const detail=node('small','Unidade: '+(unit?.name||'Não identificada'));
  const services=data.services.filter(s=>Number(s.unit_id)===Number(p.unit_id));
  const subtitle=node('small',p.serviceIds.length+' serviço(s) · Tema '+(labels[p.theme]||p.theme));
  const tv=node('span',Number(p.tvCount)>0?Number(p.tvCount)+' TV(s) vinculada(s)':'Sem TV vinculada');tv.className='ip-badge';
  const actions=node('div');actions.className='ip-buttons';
  const form=node('div');form.className='ip-config';form.hidden=true;
  const input=node('input');input.value=p.name;input.maxLength=100;
  const theme=node('select');for(const [value,label] of Object.entries(labels)){const option=node('option',label);option.value=value;theme.append(option)}theme.value=p.theme;
  const list=node('div');list.className='ip-services';
  const checks=[];
  for(const s of services){const checkbox=node('input');checkbox.type='checkbox';checkbox.value=String(s.id);checkbox.checked=p.serviceIds.some(x=>Number(x)===Number(s.id));checks.push(checkbox);list.append(labeled(s.name,checkbox))}
  if(!services.length)list.append(node('small','Nenhum serviço cadastrado nesta unidade.'));
  // Prévia local e ilustrativa: não altera o painel nem emite chamadas.
  const preview=node('section');preview.className='ip-preview';preview.dataset.theme=theme.value;
  preview.setAttribute('aria-label','Prévia visual da TV sem dados reais');
  const previewHead=node('div');previewHead.className='ip-preview-head';
  const previewBrand=node('strong','AnnA Flow');const previewUnit=node('span',unit?.name||'Unidade');
  previewHead.append(previewBrand,previewUnit);
  const previewTicket=node('div');previewTicket.className='ip-preview-ticket';
  const previewCaption=node('small','CHAMANDO AGORA');
  const previewNumber=node('strong','A001');
  const previewDesk=node('span','Guichê 01');
  previewTicket.append(previewCaption,previewNumber,previewDesk);
  const previewServices=node('div');previewServices.className='ip-preview-services';
  const previewHint=node('small','Prévia ilustrativa — não representa chamadas reais nem salva alterações.');
  const previewTitle=node('strong','Prévia da TV');
  function updatePreview(){
   preview.dataset.theme=theme.value;
   previewBrand.textContent=(input.value.trim()||'AnnA Flow').slice(0,100);
   previewServices.replaceChildren();
   const chosen=services.filter((s,i)=>checks[i]?.checked);
   if(!chosen.length){previewServices.append(node('span','Nenhum serviço selecionado'));return}
   for(const s of chosen){const chip=node('span',s.name);chip.className='ip-preview-chip';previewServices.append(chip)}
  }
  preview.append(previewHead,previewTicket,previewServices);
  theme.addEventListener('change',updatePreview);
  input.addEventListener('input',updatePreview);
  for(const check of checks)check.addEventListener('change',updatePreview);
  updatePreview();
  const saveInfo=button('Salvar nome e tema',async()=>{const name=input.value.trim();if(name.length<2)return status('Nome deve ter pelo menos dois caracteres.');await save({type:'panel_update',panelId:p.id,name,theme:theme.value})});
  const saveServices=button('Salvar serviços',async()=>save({type:'panel_services',panelId:p.id,serviceIds:checks.filter(x=>x.checked).map(x=>Number(x.value))}));
  form.append(labeled('Nome do painel',input),labeled('Tema',theme),node('strong','Serviços exibidos'),list,previewTitle,preview,previewHint,saveInfo,saveServices);
  const config=button('Configurar',()=>{form.hidden=!form.hidden;config.setAttribute('aria-expanded',String(!form.hidden))});config.setAttribute('aria-expanded','false');
  const open=button('Abrir TV',()=>{if(p.public_key)window.open('/panel.html?key='+encodeURIComponent(p.public_key),'_blank','noopener');else status('URL do painel indisponível')});
  actions.append(config,open);card.append(title,detail,subtitle,tv,actions,form);$('ipCards').append(card);
 }
}
async function save(body){
 if(!token)return status('Sessão institucional necessária.');
 try{await request(body);await load();status('Configuração salva com sucesso.')}catch(e){status(e.message)}
}
async function load(){
 if(!token||loading)return;
 loading=true;status('Consultando painéis e unidades...');
 try{
  const d=await request();
  if(Number(d.institution?.id)!==clientId)throw Error('Instituição inconsistente');
  data=d;
  $('ipInstitution').textContent='Instituição: '+d.institution.name;
  fillUnits();render();
  if(d.warnings?.length)status('Unidades carregadas. Consulta parcial indisponível: '+d.warnings.join(', ')+'. Tente atualizar.');
  else status('Painéis e unidades da instituição atualizados.');
 }catch(e){
  // Consulta independente já existente, para manter as unidades visíveis.
  try{
   const r=await fetch('/api/institution-units',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   const d=await r.json();if(!r.ok)throw Error(d.error||'Consulta indisponível');
   if(Number(d.institution?.id)!==clientId)throw Error('Instituição inconsistente');
   data={institution:d.institution,units:d.units||[],services:d.services||[],panels:[]};
   $('ipInstitution').textContent='Instituição: '+d.institution.name;
   fillUnits();render();
   status('Unidades carregadas, mas os painéis não puderam ser consultados. Use Atualizar. '+e.message);
  }catch(fallbackError){
   $('ipInstitution').textContent='Instituição não carregada';
   $('ipUnit').replaceChildren();$('ipUnit').disabled=true;$('ipAdd').disabled=true;
   status('Falha ao carregar os dados da instituição: '+fallbackError.message);
  }
 }finally{loading=false}
}
$('ipAdd').onclick=async()=>{const name=$('ipName').value.trim(),unitId=Number($('ipUnit').value),theme=$('ipTheme').value;
 if(name.length<2||!unitId)return status('Informe o nome e a unidade do painel.');
 try{await request({type:'panel_create',unitId,name,theme});$('ipName').value='';$('ipCreate').open=false;await load();status('Painel cadastrado com sucesso.')}catch(e){status(e.message)}
};
$('ipRefresh').onclick=load;
document.querySelector('[data-view-btn="panels"]')?.addEventListener('click',load);
window.flowInstitutionPanelsLogin=(value,id)=>{token=value;clientId=Number(id);load()};
})();
