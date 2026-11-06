(()=>{'use strict';
const $=id=>document.getElementById(id);
let token='',clientId=0,panels=[],busy=false;
const status=s=>$('commStatus').textContent=s;
const headers=()=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
async function api(method='GET',body=null,panelId=null){
 const url='/api/institution-communication'+(panelId?'?panel='+encodeURIComponent(panelId):'');
 const r=await fetch(url,{method,headers:headers(),body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const d=await r.json();if(!r.ok)throw Error(d.error||'Falha na comunicação');return d;
}
async function show(){
 const panelId=Number($('commPanel').value);
 $('commNotice').value='';$('commMessages').value='';$('commVideoUrl').value='';$('commVideoEnabled').checked=false;
 if(!panelId)return status('Nenhum painel cadastrado. Cadastre um na guia Painéis de TV.');
 try{
  const d=await api('GET',null,panelId);
  if(Number(d.institution?.id)!==clientId||Number(d.panel?.id)!==panelId)throw Error('Painel incompatível com a instituição');
  $('commNotice').value=d.panel.notice||'';
  $('commMessages').value=Array.isArray(d.panel.messages)?d.panel.messages.join('\n'):'';
  $('commVideoUrl').value=d.media?.video_url||'';
  $('commVideoEnabled').checked=d.media?.enabled===true;
  $('commPanelDescription').textContent='Unidade: '+d.panel.unit_name+' · '+d.panel.name;
  status('Comunicação carregada para '+d.panel.name+'.');
 }catch(e){status(e.message)}
}
async function load(){
 if(!token||busy)return;
 busy=true;status('Consultando painéis da instituição...');
 try{
  const d=await api();
  if(Number(d.institution?.id)!==clientId)throw Error('Instituição inconsistente');
  const prev=$('commPanel').value;panels=Array.isArray(d.panels)?d.panels:[];
  const sel=$('commPanel');
  sel.replaceChildren(...panels.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.unit_name+' · '+p.name;return o}));
  if(panels.some(p=>String(p.id)===prev))sel.value=prev;
  $('commSave').disabled=$('commVideoSave').disabled=!panels.length;
  $('commPanelDescription').textContent=panels.length?'Instituição: '+d.institution.name:'Nenhum painel cadastrado nesta instituição';
  await show();
 }catch(e){status(e.message)}
 finally{busy=false}
}
async function save(type){
 const panelId=Number($('commPanel').value);if(!panelId)return status('Selecione um painel.');
 const payload={type,panelId};
 if(type==='communication'){
  payload.notice=$('commNotice').value.trim();
  payload.messages=$('commMessages').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(payload.notice.length>180||payload.messages.length>15||payload.messages.some(x=>x.length>220))return status('Máximo de 180 caracteres na orientação e 15 mensagens com até 220 caracteres.');
 }else{payload.videoUrl=$('commVideoUrl').value.trim();payload.enabled=$('commVideoEnabled').checked}
 try{await api('POST',payload);status(type==='media'?'Vídeo configurado para a TV.':'Orientações e mensagens salvas.')}catch(e){status(e.message)}
}
function localDatabase(){return new Promise((resolve,reject)=>{const r=indexedDB.open('anna-flow-local-media',1);r.onupgradeneeded=()=>r.result.createObjectStore('media');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function localSave(value){
 const db=await localDatabase();
 const panel=panels.find(p=>String(p.id)===$('commPanel').value);
 if(!panel?.public_key)throw Error('Chave do painel indisponível.');
 return new Promise((resolve,reject)=>{const tx=db.transaction('media','readwrite');tx.objectStore('media').put(value,panel.public_key);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})
}
const uploadStatus=t=>$('commUploadStatus').textContent=t;
async function uploadFiles(){
 const selected=panels.find(p=>String(p.id)===$('commPanel').value);
 if(!selected)return uploadStatus('Selecione primeiro um painel de TV.');
 const files=Array.from($('commUploadFiles').files||[]),mode=$('commUploadMode').value;
 if(!files.length)return uploadStatus('Selecione arquivos para esta TV.');
 if(mode==='video'&&(files.length!==1||!['video/mp4','video/webm'].includes(files[0].type)))return uploadStatus('Selecione apenas um vídeo MP4 ou WebM.');
 if(mode==='images'&&(!files.every(f=>['image/png','image/jpeg','image/webp'].includes(f.type))||files.length>80))return uploadStatus('Selecione até 80 imagens JPG, PNG ou WebP.');
 const seconds=Math.min(120,Math.max(2,Number($('commSlideSeconds').value)||8));
 try{await localSave({mode,files,seconds,updatedAt:Date.now()});uploadStatus('Mídia guardada neste navegador. Abra ou recarregue a TV neste mesmo dispositivo.')}catch(e){uploadStatus('Não foi possível salvar neste dispositivo: '+(e?.name==='QuotaExceededError'?'Espaço de armazenamento insuficiente.':e.message))}
}
async function clearFiles(){
 if(!panels.some(p=>String(p.id)===$('commPanel').value))return uploadStatus('Selecione um painel.');
 if(!confirm('Remover as mídias deste painel armazenadas neste navegador?'))return;
 try{await localSave(null);uploadStatus('Mídia local removida neste dispositivo.')}catch(e){uploadStatus(e.message)}
}
$('commUploadSave').onclick=uploadFiles;
$('commUploadClear').onclick=clearFiles;
window.flowInstitutionCommunicationLogin=(value,id)=>{
 token=value;clientId=Number(id);
 $('commPanel').onchange=show;
 $('commLoad').onclick=load;
 $('commSave').onclick=()=>save('communication');
 $('commVideoSave').onclick=()=>save('media');
 $('commInstitutionIntro').hidden=false;
 $('commLocalMedia').hidden=false;
 load();
};
document.querySelector('[data-view-btn="communication"]')?.addEventListener('click',()=>{if(token)load()});
})();
