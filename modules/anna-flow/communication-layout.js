(()=>{'use strict';
const $=id=>document.getElementById(id);
const tabs=[['notice','commPaneNotice'],['messages','commPaneMessages'],['media','commPaneMedia']];
function select(name){
 for(const [key,id] of tabs){
  const active=name===key,pane=$(id),tab=document.querySelector('[data-comm-tab="'+key+'"]');
  if(pane)pane.hidden=!active;
  if(tab){tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1}
 }
}
function updatePreview(){
 const notice=$('commNotice').value.trim(),messages=$('commMessages').value.split('\n').map(v=>v.trim()).filter(Boolean);
 const panel=$('commPanel'),selected=panel?.selectedOptions?.[0];
 $('commPreviewPanel').textContent=selected?.textContent||'Nenhum painel selecionado';
 $('commPreviewNotice').textContent=notice||'Acompanhe sua senha na tela.';
 $('commPreviewMessage').textContent=$('commVideoEnabled').checked&&$('commVideoUrl').value.trim()?'Vídeo institucional configurado':messages[0]||'Bem-vindo!';
 $('commNoticeCount').textContent=notice.length+' / 180 caracteres';
 $('commMessagesCount').textContent=messages.length+' / 15 mensagens';
}
for(const [name] of tabs){const b=document.querySelector('[data-comm-tab="'+name+'"]');b?.addEventListener('click',()=>select(name))}
$('commSaveNotice').addEventListener('click',()=>{$('commSave').click()});
for(const id of ['commNotice','commMessages','commVideoUrl','commVideoEnabled','commPanel']){
 const e=$(id);e.addEventListener('input',updatePreview);e.addEventListener('change',updatePreview);
}
const status=$('commStatus');if(status&&typeof MutationObserver==='function'){
 new MutationObserver(updatePreview).observe(status,{subtree:true,childList:true,characterData:true});
}
window.flowCommunicationPreviewUpdate=updatePreview;
select('notice');updatePreview();
})();