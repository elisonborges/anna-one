(()=>{'use strict';
const root=document.getElementById('anna-health-services');if(!root)return;
const primary=[['agenda_portal','Agenda'],['labpc_portal','LabPC'],['service_desk_portal','Service Desk'],['eduplay_portal','EduPlay'],['anna_flow_public','Flow']];
const secondary=[['anna_one','AnnA One'],['projetos_escolares','Projetos Escolares'],['agenda_educacional','Agenda Educacional'],['neon_agenda','Neon Agenda']];
const url='https://tnvghprwltbziivlxeod.supabase.co/rest/v1/health_monitor_public_status?select=service_code,healthy,checked_at';
const key='sb_publishable_yI9_7tD4RwGrjolPjiq9vg_oSGpxxFR';
const more=document.createElement('div');more.className='anna-health-more';more.id='anna-health-more';more.hidden=true;
root.insertAdjacentElement('afterend',more);
let expanded=false;
function status(row){
 const time=Date.parse(row?.checked_at||''),fresh=Number.isFinite(time)&&Date.now()-time<24*3600*1000&&Date.now()-time>-300000;
 return !fresh?'unknown':row.healthy===true?'ok':row.healthy===false?'down':'unknown';
}
function item(code,label,byCode){
 const row=byCode.get(code),state=status(row),box=document.createElement('div'),dot=document.createElement('span'),copy=document.createElement('span'),name=document.createElement('strong'),desc=document.createElement('small');
 box.className='anna-health-service';box.dataset.state=state;
 dot.className='anna-health-dot';dot.setAttribute('aria-hidden','true');
 name.textContent=label;desc.textContent=state==='ok'?'OK':state==='down'?'Falha':row?'Desatualizado':'Sem dados';
 copy.append(name,desc);box.append(dot,copy);
 box.setAttribute('aria-label',label+': '+desc.textContent);
 if(row?.checked_at&&Number.isFinite(Date.parse(row.checked_at)))box.title='Última verificação: '+new Date(row.checked_at).toLocaleString('pt-BR');
 return box;
}
function render(rows){
 const byCode=new Map(rows.map(x=>[x.service_code,x]));
 root.replaceChildren();more.replaceChildren();
 for(const [code,name] of primary)root.append(item(code,name,byCode));
 const button=document.createElement('button');button.type='button';button.className='anna-health-more-button';button.textContent='+ Outros';button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-controls','anna-health-more');
 button.addEventListener('click',()=>{expanded=!expanded;more.hidden=!expanded;button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'− Outros':'+ Outros';});
 root.append(button);
 for(const [code,name] of secondary)more.append(item(code,name,byCode));
 more.hidden=!expanded;
}
async function load(){
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  let response;try{response=await fetch(url,{headers:{apikey:key},signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}
  if(!response.ok)throw Error('HTTP '+response.status);
  const rows=await response.json();if(!Array.isArray(rows))throw Error('Formato inválido');render(rows);
 }catch(_){render([]);}
}
load();document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});setInterval(()=>{if(!document.hidden)load()},300000);
})();