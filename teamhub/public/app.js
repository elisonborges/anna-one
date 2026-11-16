const $=id=>document.getElementById(id);
const AUTH='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const state={jwt:null,org:null,role:null,projects:[],tasks:[],project:null,view:'overview',subject:null,auth:null,members:[],organizations:[]};
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=(s,error=false)=>{const el=$('status');el.textContent=s;el.style.background=error?'#fff0ef':'';el.style.color=error?'#a31931':''};
const show=(view)=>{state.view=view;for(const id of ['overview','projects','board','mytasks','team','reports','notifications','calendar'])$(id).hidden=id!==view;$('welcome-banner').hidden=view!=='overview';
document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false')});
 $('title').textContent=view==='overview'?'Visão geral':view==='projects'?'Projetos':view==='board'?state.project?.name||'Quadro':view==='team'?'Equipe':view==='reports'?'Relatórios':view==='notifications'?'Notificações':view==='calendar'?'Calendário':'Minhas tarefas';
 $('subtitle').textContent=view==='overview'?'Acompanhe os projetos e as atividades da sua equipe.':view==='projects'?'Organize seus projetos e entregas.':view==='board'?'Acompanhe o trabalho por etapas.':view==='team'?'Pessoas autorizadas da organização.':view==='reports'?'Histórico e tempo dedicado a pendências.':view==='notifications'?'Atribuições e avisos importantes.':view==='calendar'?'Prazos e entregas por mês.':'Atividades sob sua responsabilidade.';
};
async function api(route,options={}){
 const res=await fetch(route,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.jwt,...(options.headers||{})},cache:'no-store'});
 let data;try{data=await res.json()}catch{throw Error('Resposta inválida do servidor');}
 if(!res.ok){if(res.status===401)message('Sessão expirada. Entre novamente pelo Portal AnnA One.',true);throw Error(data.error||'Falha na operação');}
 return data;
}
const qs=()=>'?org='+encodeURIComponent(state.org);
const treatmentLabels={pending:'Pendente',analysis:'Em análise',executing:'Em execução',waiting:'Aguardando retorno',blocked:'Bloqueada',resolved:'Resolvida'};

function renderTable(id,headings,rows){
 const host=$(id);host.replaceChildren();
 if(!rows.length){host.textContent='Nenhum registro disponível.';return;}
 const scroll=document.createElement('div');scroll.className='table-scroll';
 const table=document.createElement('table');table.className='nexus-table';
 const thead=document.createElement('thead'),header=document.createElement('tr');
 for(const heading of headings){const th=document.createElement('th');th.scope='col';th.textContent=heading;header.append(th);}
 thead.append(header);
 const tbody=document.createElement('tbody');
 for(const cells of rows){
  const tr=document.createElement('tr');
  for(const item of cells){
   const td=document.createElement('td');
   if(item instanceof Node)td.append(item);else td.textContent=item==null?'—':String(item);
   tr.append(td);
  }
  tbody.append(tr);
 }
 table.append(thead,tbody);scroll.append(table);host.append(scroll);
}
function makeAction(label,handler){
 const button=document.createElement('button');button.type='button';button.className='table-action';button.textContent=label;
 button.addEventListener('click',handler);return button;
}
function renderProjects(){
 const overviewRows=state.projects.slice(0,6).map(p=>{
  const progress=p.total?Math.round(p.done/p.total*100):0;
  const name=makeAction(p.name,()=>openProject(p));name.classList.add('recent-project-link');
  return [name,p.description||'—',String(p.total),progress+'%'];
 });
 renderTable('overview-projects',['Projeto','Descrição','Tarefas','Progresso'],overviewRows);
 const container=$('projects-list');container.replaceChildren();
 const allowed=['blue','violet','green','orange','pink','teal','slate'];
 for(const p of state.projects){
  const card=document.createElement('article');card.className='project-card color-'+(allowed.includes(p.card_color)?p.card_color:'blue');
  const cover=document.createElement('div');cover.className='project-card-cover';
  const title=document.createElement('h3');title.textContent=p.name;
  const description=document.createElement('p');description.textContent=p.description||'Sem descrição';
  const tags=document.createElement('div');tags.className='project-card-tags';
  const percent=p.total?Math.round(p.done/p.total*100):0;
  for(const label of [p.total+' tarefas',percent+'% concluído',p.paused_at?'Em pausa':'Ativo',p.access_mode==='restricted'?'Acesso restrito':'Equipe da organização']){
   const span=document.createElement('span');span.textContent=label;tags.append(span);
  }
  const progress=document.createElement('div');progress.className='project-card-progress';
  const bar=document.createElement('span');bar.style.width=percent+'%';progress.append(bar);
  const owner=document.createElement('small');owner.textContent='Responsável: '+memberName(p.owner_subject);
  const actions=document.createElement('div');actions.className='project-card-actions';
  const open=makeAction('Abrir projeto',()=>openProject(p));open.classList.add('project-card-open');
  actions.append(open);
  if(['admin','manager'].includes(state.role)){
   const edit=makeAction('Personalizar',()=>modal('project-edit',p));
   actions.append(edit);
   if(state.role==='admin'){
    const invite=makeAction('Convidar',async()=>{try{await loadMembers();await loadInvitations();show('team');$('invite-email').focus();}catch(e){message(e.message,true)}});
    actions.append(invite);
   }
  }
  card.append(cover,title,description,owner,tags,progress,actions);container.append(card);
 }
 const add=document.createElement('button');add.type='button';add.className='project-card-add';add.disabled=!['admin','manager'].includes(state.role);
 add.textContent='+ Criar novo card';add.onclick=()=>modal('project');container.append(add);
 $('stat-projects').textContent=state.projects.length;
}
function memberName(subject){
 if(!subject)return 'Sem responsável';
 if(subject===state.subject)return 'Você';
 const index=state.members.findIndex(m=>m.auth_subject===subject);
 return index<0?'Integrante inativo':'Integrante '+(index+1);
}
async function loadMembers(){
 const data=await api('/api/members'+qs());state.members=data.members;
 const projectOwner=$('project-owner');projectOwner.replaceChildren();
 const option=document.createElement('option');option.value='';option.textContent='Não atribuído';projectOwner.append(option);
 for(const member of state.members.filter(x=>x.active)){
  const opt=document.createElement('option');opt.value=member.auth_subject;opt.textContent=memberName(member.auth_subject);projectOwner.append(opt);
 }
 const subChoices=$('subtask-assignees');subChoices.replaceChildren();
 for(const m of state.members.filter(x=>x.active)){
  const label=document.createElement('label');label.className='assignee-choice';
  const input=document.createElement('input');input.type='checkbox';input.value=m.auth_subject;
  const span=document.createElement('span');span.textContent=memberName(m.auth_subject);
  label.append(input,span);subChoices.append(label);
 }
 const mentionBox=$('history-mentions');mentionBox.replaceChildren();
 for(const member of state.members.filter(m=>m.active)){
  const choice=document.createElement('label');choice.className='assignee-choice';
  const input=document.createElement('input');input.type='checkbox';input.value=member.auth_subject;
  const name=document.createElement('span');name.textContent=memberName(member.auth_subject);
  choice.append(input,name);mentionBox.append(choice);
 }
 const checks=$('field-assignees');checks.replaceChildren();
 const active=state.members.filter(m=>m.active);
 if(!active.length)checks.textContent='Nenhum membro disponível.';
 for(const m of active){
  const label=document.createElement('label');label.className='assignee-choice';
  const input=document.createElement('input');input.type='checkbox';input.value=m.auth_subject;
  const span=document.createElement('span');span.textContent=memberName(m.auth_subject);
  label.append(input,span);checks.append(label);
 }
 const admin=state.role==='admin';
 const rows=state.members.map(m=>{
  const roleNames={admin:'Administrador',manager:'Gestor',member:'Membro',guest:'Convidado'};
  let action='—';
  if(admin){
   const controls=document.createElement('div');controls.className='member-actions';
   const select=document.createElement('select');select.className='member-role';select.setAttribute('aria-label','Perfil de '+memberName(m.auth_subject));
   for(const [key,name] of Object.entries(roleNames)){
    const option=document.createElement('option');option.value=key;option.textContent=name;select.append(option);
   }
   select.value=m.role;select.disabled=m.auth_subject===state.subject;
   select.addEventListener('change',async()=>{
    select.disabled=true;
    try{await api('/api/members/'+encodeURIComponent(m.auth_subject)+qs(),{method:'PATCH',body:JSON.stringify({role:select.value})});message('Perfil atualizado.');await loadMembers();}
    catch(e){message(e.message,true);select.value=m.role;select.disabled=false}
   });
   const toggle=makeAction(m.active?'Remover acesso':'Reativar',async()=>{
    if(!confirm((m.active?'Remover':'Reativar')+' acesso deste integrante? O histórico será preservado.'))return;
    toggle.disabled=true;
    try{await api('/api/members/'+encodeURIComponent(m.auth_subject)+qs(),{method:'PATCH',body:JSON.stringify({active:!m.active})});message('Acesso atualizado.');await loadMembers()}
    catch(e){message(e.message,true);toggle.disabled=false}
   });
   if(m.auth_subject===state.subject)toggle.disabled=true;
   controls.append(select,toggle);action=controls;
  }
  return [memberName(m.auth_subject),roleNames[m.role]||m.role,m.active?'Ativo':'Desativado',action];
 });
 renderTable('members-list',['Integrante','Perfil','Situação','Gerenciar'],rows);
}
async function loadInvitations(){
 const admin=state.role==='admin';
 $('invite-admin').hidden=!admin;$('invite-history-panel').hidden=!admin;
 if(!admin)return;
 $('invite-list').textContent='Carregando convites…';
 try{
  const data=await api('/api/invitations'+qs());
  const rows=data.invitations.map(invite=>{
   const expired=invite.status==='pending'&&Date.parse(invite.expires_at)<=Date.now();
   const status=invite.status==='accepted'?'Aceito':invite.status==='cancelled'?'Cancelado':expired?'Expirado':'Pendente';
   const role=({admin:'Administrador',manager:'Gestor',member:'Membro',guest:'Convidado'})[invite.role]||invite.role;
   let action='—';
   if(invite.status==='pending'){
    action=makeAction('Cancelar',async()=>{
     if(!confirm('Cancelar este convite?'))return;
     action.disabled=true;
     try{await api('/api/invitations/'+invite.id+'/cancel'+qs(),{method:'POST'});message('Convite cancelado.');await loadInvitations()}
     catch(e){message(e.message,true);action.disabled=false}
    });
   }
   return [invite.email,role,status,new Date(invite.expires_at).toLocaleDateString('pt-BR'),action];
  });
  renderTable('invite-list',['E-mail','Perfil','Situação','Validade','Ação'],rows);
 }catch(e){$('invite-list').textContent='Erro ao consultar convites: '+e.message;}
}
async function redeemInvitation(){
 const match=/^#invite=([a-f0-9]{64})$/i.exec(window.location.hash);
 if(!match)return false;
 const token=match[1].toLowerCase();
 await api('/api/invitations/accept',{method:'POST',body:JSON.stringify({token})});
 history.replaceState(null,'',location.pathname);
 message('Convite aceito! Bem-vindo à organização.');
 return true;
}
let logoUploadData=null;
async function optimizeLogo(file){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Escolha uma imagem PNG, JPG ou WebP.');
 if(file.size>5*1024*1024)throw Error('Escolha uma imagem de até 5 MB.');
 const url=URL.createObjectURL(file);
 try{
  const image=await new Promise((resolve,reject)=>{
   const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Não foi possível abrir essa imagem.'));img.src=url;
  });
  const maxSide=320,ratio=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));
  canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  let result=canvas.toDataURL('image/webp',0.8);
  if(!result.startsWith('data:image/webp;'))result=canvas.toDataURL('image/png');
  if(result.length>103000)throw Error('O logotipo ficou grande após a otimização. Tente uma imagem mais simples.');
  return result;
 }finally{URL.revokeObjectURL(url);}
}
$('brand-file').addEventListener('change',async()=>{
 logoUploadData=null;$('brand-file-info').textContent='';
 const file=$('brand-file').files[0];
 if(!file)return;
 try{
  logoUploadData=await optimizeLogo(file);
  $('brand-file-info').textContent='Imagem pronta: '+file.name+' (otimizada). Clique em Salvar identidade.';
  message('Logotipo preparado para salvar.');
 }catch(e){$('brand-file').value='';$('brand-file-info').textContent=e.message;message(e.message,true);}
});
function renderBrand(){
 const org=state.organizations.find(o=>o.id===state.org);
 const display=(org?.display_name||'').trim();
 $('client-name').textContent=display;
 $('brand-name').value=display;
 $('brand-logo').value=org?.logo_url?.startsWith('https://')?org.logo_url:'';
 $('brand-admin').hidden=state.role!=='admin';
 const logo=$('client-logo'),defaultLogo=$('default-banner-symbol');
 logo.hidden=!org?.logo_url;defaultLogo.hidden=!!org?.logo_url;
 if(org?.logo_url){logo.src=org.logo_url;logo.onerror=()=>{logo.hidden=true;defaultLogo.hidden=false};}
 else logo.removeAttribute('src');
}
$('brand-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('brand-save');button.disabled=true;
 try{
  const org=state.organizations.find(o=>o.id===state.org);
  const urlInput=$('brand-logo').value.trim();
  const logo_url=logoUploadData||urlInput||(org?.logo_url?.startsWith('data:image/')?org.logo_url:'');
  const data=await api('/api/organization'+qs(),{method:'PATCH',body:JSON.stringify({display_name:$('brand-name').value.trim(),logo_url})});
  const i=state.organizations.findIndex(o=>o.id===state.org);
  if(i!==-1)state.organizations[i]={...state.organizations[i],...data.organization};
  logoUploadData=null;$('brand-file').value='';$('brand-file-info').textContent='';
  renderBrand();message('Identidade da empresa atualizada.');
 }catch(error){message(error.message,true)}finally{button.disabled=false}
});
const secondsLabel=n=>{let s=Math.max(0,Number(n)||0);const days=Math.floor(s/86400),hours=Math.floor(s%86400/3600),minutes=Math.floor(s%3600/60);return [days?days+'d':null,hours?hours+'h':null,minutes||(!days&&!hours)?minutes+'min':null].filter(Boolean).join(' ');};
async function openTaskFromList(task){
 let p=state.projects.find(p=>p.id===task.project_id);
 if(!p){await refreshProjects();p=state.projects.find(x=>x.id===task.project_id);}
 if(!p)throw Error('Projeto indisponível.');
 await openProject(p);return state.tasks.find(t=>t.id===task.id);
}
async function taskAction(task,action){
 if(action==='edit'){const current=await openTaskFromList(task);if(!current)throw Error('Tarefa não encontrada.');modal('edit',current);return;}
 if(action==='delete'&&!confirm('Excluir esta tarefa das listas? O histórico será preservado.'))return;
 const pause=action==='pause';
 const reason=pause?prompt('Qual pendência justifica a pausa? (obrigatório)'):null;
 if(pause&&(reason===null||reason.trim().length<3)){if(reason!==null)message('Informe um motivo com pelo menos 3 caracteres.',true);return;}
 await api('/api/tasks/'+task.id+'/'+action+qs(),{method:'POST',body:JSON.stringify(pause?{reason:reason.trim()}:{})});
 message(({pause:'Tarefa pausada.',resume:'Tarefa retomada.',archive:'Tarefa arquivada.',restore:'Tarefa restaurada.',delete:'Tarefa excluída das listas.'})[action]);
 await loadMyTasks();await refreshProjects();
}
async function loadNotifications(){
 const data=await api('/api/notifications'+qs());
 const counter=$('notification-count');counter.hidden=!data.unread;counter.textContent=data.unread>99?'99+':String(data.unread);
 const headerCount=$('notify-header-count');headerCount.hidden=!data.unread;headerCount.textContent=data.unread>99?'99+':String(data.unread);
 const rows=data.notifications.map(n=>{
  const status=n.read_at?'Lida':'Nova';
  const actions=document.createElement('div');actions.className='notification-actions';
  if(!n.read_at)actions.append(makeAction('Marcar lida',async()=>{
   try{await api('/api/notifications/'+n.id+'/read'+qs(),{method:'POST'});await loadNotifications()}catch(e){message(e.message,true)}
  }));
  if(n.project_id)actions.append(makeAction('Abrir projeto',async()=>{
   try{
    const p=state.projects.find(x=>x.id===n.project_id);
    if(!p)throw Error('Projeto indisponível.');
    await openProject(p);
    await api('/api/notifications/'+n.id+'/read'+qs(),{method:'POST'});
    await loadNotifications();
   }catch(e){message(e.message,true)}
  }));
  return [n.title,n.details||'—',new Date(n.created_at).toLocaleString('pt-BR'),status,actions];
 });
 renderTable('notifications-list',['Notificação','Detalhes','Quando','Situação','Ações'],rows);
}
$('notify-header').addEventListener('click',async()=>{try{await loadNotifications();show('notifications')}catch(e){message(e.message,true)}});
$('notify-read-all').addEventListener('click',async()=>{
 try{await api('/api/notifications/read-all'+qs(),{method:'POST'});await loadNotifications();message('Notificações marcadas como lidas.')}
 catch(e){message(e.message,true)}
});
let calendarItems=[],calendarCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);
const calendarDay=item=>String(item.due_at||'').slice(0,10);
function drawCalendar(){
 const year=calendarCursor.getFullYear(),month=calendarCursor.getMonth();
 $('calendar-month').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(calendarCursor);
 const grid=$('calendar-grid');grid.replaceChildren();
 for(const day of ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']){
  const header=document.createElement('div');header.className='calendar-weekday';header.textContent=day;grid.append(header);
 }
 const first=new Date(year,month,1),days=new Date(year,month+1,0).getDate();
 const offset=(first.getDay()+6)%7;
 for(let i=0;i<offset;i++){const empty=document.createElement('div');empty.className='calendar-day is-empty';grid.append(empty);}
 const monthPrefix=String(year)+'-'+String(month+1).padStart(2,'0')+'-';
 const monthly=calendarItems.filter(x=>calendarDay(x).startsWith(monthPrefix));
 const grouped=new Map();
 for(const item of monthly){const day=calendarDay(item);if(!grouped.has(day))grouped.set(day,[]);grouped.get(day).push(item);}
 const today=new Date(),todayKey=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
 for(let day=1;day<=days;day++){
  const key=monthPrefix+String(day).padStart(2,'0');
  const card=document.createElement('div');card.className='calendar-day';if(key===todayKey)card.classList.add('is-today');
  const number=document.createElement('strong');number.textContent=String(day);card.append(number);
  const items=grouped.get(key)||[];
  if(items.length){
   const count=document.createElement('span');count.className='calendar-day-count';count.textContent=items.length+' entrega'+(items.length===1?'':'s');card.append(count);
   const hints=document.createElement('div');hints.className='calendar-hints';
   for(const item of items.slice(0,2)){const hint=document.createElement('span');hint.className='calendar-hint';hint.title=item.title;hint.textContent=item.title;hints.append(hint);}
   card.append(hints);
  }
  grid.append(card);
 }
 const rows=monthly.sort((a,b)=>calendarDay(a).localeCompare(calendarDay(b))).map(item=>{
  const open=makeAction('Abrir',async()=>{
   const project=state.projects.find(p=>p.id===item.project_id);
   if(!project){message('Projeto não disponível.',true);return;}
   try{await openProject(project);}catch(e){message(e.message,true)}
  });
  return [new Date(calendarDay(item)+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'UTC'}),item.title,item.project_name,item.kind==='subtask'?'Subtarefa':'Tarefa',item.status==='done'?'Concluída':item.status==='doing'?'Em andamento':'A fazer',open];
 });
 renderTable('calendar-list',['Prazo','Atividade','Projeto','Tipo','Etapa','Ação'],rows);
 const display=$('timeline-list');display.replaceChildren();
 if(!monthly.length){display.textContent='Nenhuma entrega com prazo neste mês.';return;}
 const msDay=86400000,windowStart=Date.UTC(year,month,1),windowEnd=Date.UTC(year,month+1,0,23,59,59);
 const total=windowEnd-windowStart;
 for(const item of monthly){
  const end=Date.parse(String(item.due_at).slice(0,10)+'T12:00:00Z');
  const created=Date.parse(item.created_at);
  const start=Math.max(windowStart,Math.min(end,Number.isFinite(created)?created:end));
  const left=Math.max(0,Math.min(100,(start-windowStart)/total*100));
  const width=Math.max(1,Math.min(100-left,(end-start)/total*100));
  const line=document.createElement('div');line.className='timeline-row';
  const title=document.createElement('div');title.className='timeline-label';title.textContent=item.project_name+' · '+item.title;
  const rail=document.createElement('div');rail.className='timeline-rail';
  const bar=document.createElement('span');bar.className='timeline-bar';
  if(item.status==='done')bar.classList.add('is-complete');
  bar.style.left=left+'%';bar.style.width=width+'%';
  bar.title='Criada: '+new Date(item.created_at).toLocaleDateString('pt-BR')+' · Prazo: '+new Date(item.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'});
  rail.append(bar);line.append(title,rail);display.append(line);
 }
}
async function loadCalendar(){
 const data=await api('/api/calendar'+qs());calendarItems=data.items;drawCalendar();
}
$('calendar-prev').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);drawCalendar();});
$('calendar-next').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);drawCalendar();});
$('calendar-today').addEventListener('click',()=>{const now=new Date();calendarCursor=new Date(now.getFullYear(),now.getMonth(),1);drawCalendar();});
async function loadMySubtasks(){
 const data=await api('/api/my-subtasks'+qs());
 const rows=data.subtasks.map(sub=>{
  const actions=document.createElement('div');actions.className='subtask-personal-actions';
  const open=makeAction('Abrir tarefa',async()=>{
   try{
    const item=await openTaskFromList({project_id:sub.project_id,id:sub.task_id});
    if(!item)throw Error('Tarefa não disponível.');
    modal('edit',item);
   }catch(e){message(e.message,true)}
  });
  actions.append(open);
  if(['admin','manager','member'].includes(state.role)&&sub.status!=='done'){
   const complete=makeAction('Concluir',async()=>{
    complete.disabled=true;
    try{
     await api('/api/subtasks/'+sub.id+qs(),{method:'PATCH',body:JSON.stringify({status:'done'})});
     await loadMySubtasks();message('Subtarefa concluída.');
    }catch(e){message(e.message,true);complete.disabled=false}
   });
   actions.append(complete);
  }
  const status=({todo:'A fazer',doing:'Em andamento',done:'Concluída'})[sub.status]||sub.status;
  return [sub.title,sub.project_name,sub.task_title,status,sub.due_at?new Date(sub.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'—',actions];
 });
 renderTable('my-subtasks',['Subtarefa','Projeto','Tarefa principal','Situação','Prazo','Ações'],rows);
}
async function loadMyTasks(){
 const includeArchived=$('show-archived').checked?'&archived=1':'';
 const data=await api('/api/my-tasks'+qs()+includeArchived);
 const rows=data.tasks.map(task=>{
  const controls=document.createElement('div');controls.className='mytask-actions';
  const actions=[['Abrir','open'],['Editar','edit'],[task.paused_at?'Retomar':'Pausar',task.paused_at?'resume':'pause'],[task.archived_at?'Restaurar':'Arquivar',task.archived_at?'restore':'archive'],['Excluir','delete']];
  for(const [label,key] of actions){
   const btn=makeAction(label,async()=>{
    btn.disabled=true;try{if(key==='open')await openTaskFromList(task);else await taskAction(task,key);}catch(e){message(e.message,true)}finally{btn.disabled=false}
   });
   if(key==='delete'&&state.role!=='admin')btn.disabled=true;
   if(task.archived_at&&['edit','pause','resume','archive'].includes(key))btn.disabled=true;
   if(task.paused_at&&key==='archive')btn.title='Arquivar encerra a pausa atual';
   if(!['admin','manager','member'].includes(state.role)&&key!=='open')btn.disabled=true;
   controls.append(btn);
  }
  const stateLabel=task.archived_at?'Arquivada':task.paused_at?'Pausada':({todo:'A fazer',doing:'Em andamento',done:'Concluída'})[task.status]||task.status;
  return [task.title,task.project_name,stateLabel,
   task.due_at?new Date(task.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'—',controls];
 });
 renderTable('mine',['Tarefa','Projeto','Situação','Prazo','Ações'],rows);
 await loadMySubtasks();
}
let reportSnapshot=null;
async function loadReports(){
 const data=await api('/api/reports'+qs());reportSnapshot=data;
 const now=new Date(data.generated_at).getTime();
 const rows=data.projects.map(p=>[
  p.project_name,p.project_paused_at?'Em pausa':'Em andamento',
  secondsLabel((now-new Date(p.project_created_at).getTime())/1000),
  secondsLabel(p.project_pending_seconds),
  p.project_pauses+' pausa(s)',p.done_tasks+'/'+p.total_tasks
 ]);
 renderTable('reports-projects',['Projeto','Situação','Tempo total','Em pendência','Pausas','Concluídas'],rows);
 const taskRows=data.tasks.map(t=>{
  const name=data.projects.find(p=>p.project_id===t.project_id)?.project_name||'Projeto';
  const status=t.deleted_at?'Excluída':t.archived_at?'Arquivada':t.paused_at?'Pausada':({todo:'A fazer',doing:'Em andamento',done:'Concluída'})[t.status]||t.status;
  return [t.title,name,status,secondsLabel((Math.min(now,t.archived_at?new Date(t.archived_at).getTime():t.deleted_at?new Date(t.deleted_at).getTime():now)-new Date(t.created_at).getTime())/1000),secondsLabel(t.pending_seconds),String(t.pauses)];
 });
 renderTable('reports-tasks',['Tarefa','Projeto','Situação','Tempo total','Em pendência','Pausas'],taskRows);
 const subRows=(data.subtasks||[]).map(sub=>[
  sub.project_name,sub.parent_title,sub.title,
  ({todo:'A fazer',doing:'Em andamento',done:'Concluída'})[sub.status]||sub.status,
  (Array.isArray(sub.assignees)&&sub.assignees.length?sub.assignees.map(memberName).join(', '):memberName(sub.owner_subject)),
  sub.due_at?new Date(sub.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'—',
  secondsLabel((now-new Date(sub.created_at).getTime())/1000)
 ]);
 renderTable('reports-subtasks',['Projeto','Tarefa','Subtarefa','Situação','Responsáveis','Prazo','Tempo total'],subRows);
 const workload=new Map();
 const collect=(ids,type)=>{
  for(const id of [...new Set(ids.filter(Boolean))]){
   if(!workload.has(id))workload.set(id,{id,tasks:0,subtasks:0});
   workload.get(id)[type]++;
  }
 };
 for(const t of data.tasks){
  if(t.deleted_at||t.archived_at||t.status==='done')continue;
  collect(Array.isArray(t.assignees)&&t.assignees.length?t.assignees:[t.assignee_subject],'tasks');
 }
 for(const st of data.subtasks||[]){
  const parent=data.tasks.find(t=>t.id===st.task_id);
  if(st.status==='done'||parent?.deleted_at||parent?.archived_at)continue;
  collect(Array.isArray(st.assignees)&&st.assignees.length?st.assignees:[st.owner_subject],'subtasks');
 }
 const load=[...workload.values()].sort((a,b)=>(b.tasks+b.subtasks)-(a.tasks+a.subtasks));
 renderTable('reports-workload',['Integrante','Tarefas em aberto','Subtarefas em aberto','Total de atribuições'],
  load.map(x=>[memberName(x.id),String(x.tasks),String(x.subtasks),String(x.tasks+x.subtasks)]));
 const pauses=data.pauses.map(p=>[
  data.projects.find(x=>x.project_id===p.project_id)?.project_name||'Projeto',
  p.task_id?'Tarefa':'Projeto',p.reason,
  new Date(p.started_at).toLocaleString('pt-BR'),
  p.ended_at?new Date(p.ended_at).toLocaleString('pt-BR'):'Em aberto',
  secondsLabel(p.elapsed_seconds)
 ]);
 renderTable('reports-pauses',['Projeto','Tipo','Motivo','Início','Fim','Duração'],pauses);
 $('reports-summary').textContent='Relatório gerado em '+new Date(data.generated_at).toLocaleString('pt-BR')+'. O tempo total continua correndo durante as pausas.';
}
function exportReport(){
 if(!reportSnapshot)return;
 const data=reportSnapshot;
 const lines=[['Tipo','Projeto','Referência','Motivo ou situação','Início','Fim','Segundos em pendência','Pausas']];
 for(const p of data.projects)lines.push(['Projeto',p.project_name,p.project_id,p.project_paused_at?'Em pausa':'Ativo',p.project_created_at,'',p.project_pending_seconds,p.project_pauses]);
 for(const t of data.tasks)lines.push(['Tarefa',data.projects.find(p=>p.project_id===t.project_id)?.project_name||'',t.title,t.deleted_at?'Excluída':t.archived_at?'Arquivada':t.paused_at?'Pausada':t.status,t.created_at,'',t.pending_seconds,t.pauses]);
 for(const x of (data.subtasks||[]))lines.push(['Subtarefa',x.project_name,x.parent_title+' / '+x.title,x.status,x.created_at,'',0,0]);
 for(const x of data.pauses)lines.push(['Pausa',data.projects.find(p=>p.project_id===x.project_id)?.project_name||'',x.task_id||x.project_id,x.reason,x.started_at,x.ended_at||'Em aberto',x.elapsed_seconds,'']);
 const csv='\uFEFF'+lines.map(cols=>cols.map(v=>{let x=String(v??'');if(/^[=+@\-]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download='nexus-relatorio-pendencias.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('report-export').addEventListener('click',exportReport);
$('projects-invite').addEventListener('click',async()=>{try{await loadMembers();await loadInvitations();show('team');$('invite-email').focus();}catch(e){message(e.message,true)}});
$('show-archived').addEventListener('change',()=>loadMyTasks().catch(e=>message(e.message,true)));
$('project-pause').addEventListener('click',async()=>{
 if(!state.project)return;
 const paused=!!state.project.paused_at;
 const reason=paused?null:prompt('Motivo da pendência que exige pausar o projeto:');
 if(!paused&&(reason===null||reason.trim().length<3)){if(reason!==null)message('Informe o motivo da pendência.',true);return;}
 try{
  await api('/api/projects/'+state.project.id+'/'+(paused?'resume':'pause')+qs(),{method:'POST',body:JSON.stringify(paused?{}:{reason:reason.trim()})});
  await refreshProjects();const p=state.projects.find(x=>x.id===state.project.id);if(p)await openProject(p);
  message(paused?'Projeto retomado.':'Projeto pausado. O tempo total e o tempo em pendência continuam contando.');
 }catch(e){message(e.message,true)}
});
async function loadAttention(){
 $('attention-list').textContent='Carregando pendências…';
 try{
  const data=await api('/api/attention'+qs());
  const selected=$('dash-project').value;
  const rows=data.items.filter(t=>!selected||t.project_id===selected).map(t=>{
   const button=makeAction('Abrir',async()=>{try{
    let project=state.projects.find(x=>x.id===t.project_id);
    if(!project){await refreshProjects();project=state.projects.find(x=>x.id===t.project_id);}
    if(!project)throw Error('Projeto não encontrado.');
    await openProject(project);
   }catch(e){message(e.message,true)}});
   return [t.title,t.project_name,t.treatment_status==='blocked'?'Bloqueada':'Aguardando retorno',
    t.pending_reason||'—',t.next_action||'—',button];
  });
  renderTable('attention-list',['Tarefa','Projeto','Situação','Pendência','Próxima ação','Abrir'],rows);
 }catch(e){$('attention-list').textContent='Não foi possível carregar as pendências.';}
}
let dashboardSnapshot=null;
function dashboardCsv(){
 if(!dashboardSnapshot)return;
 const data=dashboardSnapshot;
 const rows=[['Projeto','Tarefas','A fazer','Em andamento','Concluídas','Atrasadas','Exigem atenção','Pausado']];
 for(const p of data.projects)rows.push([p.name,p.tasks,p.todo,p.doing,p.completed,p.overdue,p.attention,p.paused_at?'Sim':'Não']);
 rows.push([],['Resumo','Projetos','Tarefas','Subtarefas','Concluídas','Atrasadas','Em atenção','Segundos de pendência']);
 rows.push(['Total',data.summary.projects,data.summary.tasks,data.summary.subtasks,data.summary.done,data.summary.overdue,data.summary.attention,data.summary.pending_seconds]);
 const csv='\uFEFF'+rows.map(cols=>cols.map(v=>{let x=String(v??'');if(/^[=+@\-]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='nexus-dashboard-'+data.period+'dias.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function loadDashboard(){
 const selector=$('dash-project'),period=Number($('dash-period').value)||30;
 const selected=state.projects.some(p=>p.id===selector.value)?selector.value:'';
 const url='/api/dashboard/insights'+qs()+'&days='+period+(selected?'&project='+encodeURIComponent(selected):'');
 const data=await api(url);dashboardSnapshot=data;
 const summary=data.summary,total=Number(summary.tasks)||0,done=Number(summary.done)||0,
  todo=Number(summary.todo)||0,doing=Number(summary.doing)||0;
 const values=[todo,doing,done],palette=['#8da6c5','#f5a623','#2bb783'];
 const degrees=values.map(v=>total?v/total*360:0);
 const degrees1=degrees[0],degrees2=degrees[0]+degrees[1];
 $('stat-projects').textContent=summary.projects;
 $('stat-open').textContent=todo+doing;
 $('stat-doing').textContent=doing;
 $('stat-done').textContent=done;
 $('stat-attention').textContent=summary.attention;
 $('dash-overdue').textContent=summary.overdue;
 $('dash-paused').textContent=summary.paused_projects;
 $('dash-subtasks').textContent=summary.subtasks_done+'/'+summary.subtasks;
 $('dash-pending').textContent=secondsLabel(summary.pending_seconds);
 $('dash-task-count').textContent=total+' tarefa(s)';
 $('dash-donut-percent').textContent=(total?Math.round(done/total*100):0)+'%';
 const donut=$('dash-donut');
 donut.style.background=total?'conic-gradient('+palette[0]+' 0deg '+degrees1+'deg,'+palette[1]+' '+degrees1+'deg '+degrees2+'deg,'+palette[2]+' '+degrees2+'deg 360deg)':'conic-gradient(var(--line) 0deg 360deg)';
 donut.setAttribute('aria-label',total?'Tarefas: '+todo+' a fazer, '+doing+' em andamento, '+done+' concluídas':'Nenhuma tarefa');
 const legend=$('dash-legend');legend.replaceChildren();
 for(const [i,label] of ['A fazer','Em andamento','Concluídas'].entries()){
  const line=document.createElement('div');line.className='dash-legend-row';
  const dot=document.createElement('span');dot.className='dash-color-dot';dot.style.background=palette[i];
  const text=document.createElement('span');text.textContent=label;
  const num=document.createElement('strong');num.textContent=String(values[i]);
  line.append(dot,text,num);legend.append(line);
 }
 const projects=data.projects.map(p=>{
  const ratio=Number(p.tasks)?Math.round(p.completed/p.tasks*100):0;
  const info=document.createElement('div');info.className='dash-project-progress';
  const pct=document.createElement('span');pct.textContent=ratio+'%';
  const rail=document.createElement('div');rail.className='dash-progress-track';
  const bar=document.createElement('div');bar.style.width=ratio+'%';rail.append(bar);
  info.append(pct,rail);
  const open=makeAction('Abrir',()=>{const item=state.projects.find(x=>x.id===p.id);if(item)openProject(item);});
  return [p.name,info,p.tasks,p.overdue,p.attention,p.paused_at?'Em pausa':'Ativo',open];
 });
 renderTable('dash-project-rows',['Projeto','Progresso','Tarefas','Atrasadas','Pendências','Situação','Ação'],projects);
 const counts=new Map(data.activity.map(x=>[x.day,Number(x.total)]));
 const day=new Date();
 const dayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(day);
 const daily=[];
 for(let i=period-1;i>=0;i--){
  const current=new Date(Date.now()-i*86400000);
  const key=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(current);
  daily.push({date:key,count:counts.get(key)||0});
 }
 const buckets=period===7?7:period===30?10:15,bucketSize=Math.ceil(daily.length/buckets);
 const grouped=[];
 for(let i=0;i<daily.length;i+=bucketSize){
  const subset=daily.slice(i,i+bucketSize);grouped.push({start:subset[0].date,end:subset.at(-1).date,total:subset.reduce((sum,x)=>sum+x.count,0)});
 }
 const totalActivities=daily.reduce((sum,x)=>sum+x.count,0);
 $('dash-activity-total').textContent=totalActivities+' registro(s) em '+period+' dias';
 const chart=$('dash-activity-chart');chart.replaceChildren();
 const max=Math.max(1,...grouped.map(x=>x.total));
 for(const bucket of grouped){
  const cell=document.createElement('div');cell.className='dash-bar-cell';
  const column=document.createElement('div');column.className='dash-bar';
  column.style.height=Math.max(bucket.total?6:2,Math.round(bucket.total/max*100))+'%';
  column.title=bucket.start+(bucket.start!==bucket.end?' a '+bucket.end:'')+': '+bucket.total+' atividades';
  const num=document.createElement('span');num.textContent=bucket.total?String(bucket.total):'';
  const cap=document.createElement('small');cap.textContent=bucket.end.slice(8,10)+'/'+bucket.end.slice(5,7);
  column.append(num);cell.append(column,cap);chart.append(cell);
 }
 $('dash-export').disabled=false;
}
$('dash-period').addEventListener('change',()=>loadDashboard().catch(e=>message(e.message,true)));
$('dash-project').addEventListener('change',()=>Promise.all([loadDashboard(),loadAttention()]).catch(e=>message(e.message,true)));
$('dash-refresh').addEventListener('click',()=>Promise.all([loadDashboard(),loadAttention()]).catch(e=>message(e.message,true)));
$('dash-export').addEventListener('click',dashboardCsv);
async function refreshProjects(){
 const data=await api('/api/projects'+qs());state.projects=data.projects;state.role=data.role;renderProjects();
 $('new-project').disabled=!['admin','manager'].includes(state.role);
 $('projects-invite').disabled=state.role!=='admin';
 const selector=$('dash-project'),selected=selector.value;selector.replaceChildren();
 const any=document.createElement('option');any.value='';any.textContent='Todos os projetos';selector.append(any);
 for(const p of state.projects){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;selector.append(option);}
 selector.value=state.projects.some(p=>p.id===selected)?selected:'';
 await loadDashboard();await loadAttention();
}
async function openProject(p){
 state.project=p;const data=await api('/api/projects/'+encodeURIComponent(p.id)+'/tasks'+qs());
 state.tasks=data.tasks;$('board-description').textContent=p.description||'Quadro de tarefas do projeto.';
 $('project-pause').disabled=!['admin','manager'].includes(state.role);
 $('project-pause').textContent=p.paused_at?'Retomar projeto':'Pausar projeto';
 $('project-pause-status').textContent=p.paused_at?'Pausado por pendência':'Projeto ativo';
 renderTasks();show('board');
}
const taskFilterMatches=t=>{
 const treatment=$('filter-treatment').value,priority=$('filter-priority').value,label=$('filter-label').value,due=$('filter-due').value,search=$('filter-search').value.trim().toLocaleLowerCase('pt-BR');
 const today=todayInFortaleza(),date=t.due_at?String(t.due_at).slice(0,10):null;
 const week=new Date(today+'T12:00:00Z');week.setUTCDate(week.getUTCDate()+7);
 const deadline=due==='all'||(due==='none'&&!date)||(due==='overdue'&&date&&date<today&&t.status!=='done')||(due==='week'&&date&&date>=today&&date<=week.toISOString().slice(0,10));
 return (treatment==='all'||(t.treatment_status||'pending')===treatment)
 &&(priority==='all'||t.priority===priority)
 &&(label==='all'||(Array.isArray(t.labels)&&t.labels.includes(label)))&&deadline
 &&(!search||[t.title,t.description,t.pending_reason,t.next_action].some(x=>String(x||'').toLocaleLowerCase('pt-BR').includes(search)));
};
let draggedTaskId=null;
async function moveTaskTo(taskId,status){
 const task=state.tasks.find(t=>t.id===taskId);
 if(!task||task.status===status||!['admin','manager','member'].includes(state.role))return;
 if(task.paused_at)throw Error('Retome a tarefa antes de mudar sua etapa.');
 await api('/api/tasks/'+task.id+qs(),{method:'PATCH',body:JSON.stringify({status})});
 task.status=status;renderTasks();await refreshProjects();message('Etapa atualizada.');
}
function renderTasks(){
 const board=$('board-columns');
 for(const col of board.querySelectorAll('.column')){
  const status=col.dataset.status,list=col.querySelector('.tasklist');list.replaceChildren();
  const tasks=state.tasks.filter(t=>t.status===status&&taskFilterMatches(t));
  col.querySelector('.count').textContent=tasks.length;
  for(const t of tasks){
   const card=document.createElement('article');card.className='task';card.dataset.taskId=t.id;
   const editable=['admin','manager','member'].includes(state.role);
   card.draggable=editable&&!t.paused_at;
   if(card.draggable){
    card.title='Arraste para outra coluna ou use o seletor de etapa';
    card.addEventListener('dragstart',e=>{draggedTaskId=t.id;card.classList.add('is-dragged');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id);});
    card.addEventListener('dragend',()=>{draggedTaskId=null;card.classList.remove('is-dragged');board.querySelectorAll('.column').forEach(c=>c.classList.remove('is-drop-target'));});
   }
   const title=document.createElement('strong');title.textContent=t.title;
   const labels=document.createElement('div');labels.className='task-labels';
   for(const name of (Array.isArray(t.labels)?t.labels:[])){
    const tag=document.createElement('span');tag.className='task-label-tag label-'+({Urgente:'urgent',Cliente:'client','Revisão':'review',Bug:'bug',Melhoria:'improvement','Aprovação':'approval'}[name]||'default');tag.textContent=name;labels.append(tag);
   }
   const footer=document.createElement('footer');
   const select=document.createElement('select');select.setAttribute('aria-label','Etapa da tarefa '+t.title);
   [['todo','A fazer'],['doing','Em andamento'],['done','Concluído']].forEach(([v,n])=>{const opt=document.createElement('option');opt.value=v;opt.textContent=n;select.append(opt)});
   select.value=t.status;select.disabled=!editable||!!t.paused_at;
   select.addEventListener('change',async()=>{const next=select.value;select.disabled=true;try{await moveTaskTo(t.id,next)}catch(e){select.value=t.status;message(e.message,true)}finally{select.disabled=!editable||!!t.paused_at}});
   const priority=document.createElement('span');priority.className='priority';priority.textContent=({high:'Alta',medium:'Média',low:'Baixa'})[t.priority]||'Média';
   const badge=document.createElement('span');badge.className='treatment-badge '+(t.treatment_status||'pending');badge.textContent=treatmentLabels[t.treatment_status]||'Pendente';
   const meta=document.createElement('div');meta.className='task-meta';
   if(t.due_at){const due=document.createElement('span');const late=String(t.due_at).slice(0,10)<todayInFortaleza()&&t.status!=='done';due.textContent=(late?'Atrasada · ':'Prazo: ')+new Date(t.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'});if(late)due.className='task-overdue';meta.append(due);}
   const assignedIds=Array.isArray(t.assignees)?t.assignees:(t.assignee_subject?[t.assignee_subject]:[]);
   if(assignedIds.length){const assigned=document.createElement('span');assigned.textContent='Responsáveis: '+assignedIds.map(memberName).join(', ');meta.append(assigned);}
   const edit=document.createElement('button');edit.type='button';edit.className='task-edit';edit.textContent='Editar tarefa';edit.disabled=!editable;edit.onclick=()=>modal('edit',t);
   if(t.pending_reason){const p=document.createElement('span');p.className='pending-summary';p.textContent='Pendência: '+t.pending_reason;meta.append(p);}
   if(t.next_action){const p=document.createElement('span');p.textContent='Próxima ação: '+t.next_action;meta.append(p);}
   if(t.subtask_total){const p=document.createElement('span');p.textContent='Subtarefas: '+t.subtask_done+'/'+t.subtask_total+' concluídas';meta.append(p);}
   footer.append(priority,select);card.append(title,labels,badge,meta,footer,edit);list.append(card);
  }
 }
 $('filter-count').textContent=state.tasks.filter(taskFilterMatches).length+' de '+state.tasks.length+' tarefa(s)';
 $('new-task').disabled=!['admin','manager','member'].includes(state.role);
}
for(const column of $('board-columns').querySelectorAll('.column')){
 column.addEventListener('dragover',event=>{if(!draggedTaskId||!['admin','manager','member'].includes(state.role))return;event.preventDefault();event.dataTransfer.dropEffect='move';column.classList.add('is-drop-target');});
 column.addEventListener('dragleave',event=>{if(!column.contains(event.relatedTarget))column.classList.remove('is-drop-target');});
 column.addEventListener('drop',async event=>{
  event.preventDefault();column.classList.remove('is-drop-target');
  const id=draggedTaskId||event.dataTransfer.getData('text/plain');draggedTaskId=null;
  if(!id||!state.tasks.some(t=>t.id===id))return;
  try{await moveTaskTo(id,column.dataset.status);}catch(e){message(e.message,true);renderTasks();}
 });
}
for(const id of ['filter-treatment','filter-priority','filter-label','filter-due'])$(id).addEventListener('change',renderTasks);
$('filter-search').addEventListener('input',renderTasks);
$('clear-filters').addEventListener('click',()=>{
 $('filter-treatment').value='all';$('filter-priority').value='all';$('filter-label').value='all';$('filter-due').value='all';$('filter-search').value='';renderTasks();
});
function todayInFortaleza(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=k=>parts.find(p=>p.type===k).value;
 return part('year')+'-'+part('month')+'-'+part('day');
}
let mode=null,editing=null;
function modal(type,task=null){
 mode=type;editing=task;
 $('modal-title').textContent=type==='project'?'Novo projeto':type==='project-edit'?'Personalizar projeto':type==='edit'?'Editar tarefa':'Nova tarefa';
 $('field-name').value=type==='project-edit'?task?.name||'':task?.title||'';
 $('field-description').value=task?.description||'';
 $('task-fields').hidden=type==='project'||type==='project-edit';
 $('project-fields').hidden=!(type==='project'||type==='project-edit');
 $('project-template-field').hidden=type!=='project';
 $('project-template').value='blank';
 $('project-access-fields').hidden=type!=='project-edit';
 projectAccessReady=type!=='project-edit';
 if(type==='project-edit')loadProjectAccess(task).catch(e=>message(e.message,true));
 $('project-color').value=task?.card_color||'blue';
 $('project-owner').value=task?.owner_subject||'';
 $('field-priority').value=task?.priority||'medium';
 for(const x of $('field-labels').querySelectorAll('input'))x.checked=Array.isArray(task?.labels)&&task.labels.includes(x.value);
 $('field-due').value=task?.due_at?String(task.due_at).slice(0,10):'';
 $('field-due').min=todayInFortaleza();
 const ids=Array.isArray(task?.assignees)?task.assignees:(task?.assignee_subject?[task.assignee_subject]:[]);
 for(const checkbox of $('field-assignees').querySelectorAll('input[type=checkbox]'))checkbox.checked=ids.includes(checkbox.value);
 $('field-treatment').value=task?.treatment_status||'pending';
 $('field-treatment-notes').value=task?.treatment_notes||'';
 $('field-pending').value=task?.pending_reason||'';
 $('field-next').value=task?.next_action||'';
 $('field-update-note').value='';
 $('history-new-note').value='';
 $('history-mentions').querySelectorAll('input').forEach(x=>x.checked=false);
 $('history-add').disabled=!['admin','manager','member'].includes(state.role);
 $('task-history-wrap').hidden=type!=='edit';
 $('subtasks-panel').hidden=type!=='edit';
 $('subtask-add').disabled=!['admin','manager','member'].includes(state.role);
 $('subtask-name').value='';$('subtask-due').value='';
 $('subtask-assignees').querySelectorAll('input:checked').forEach(x=>x.checked=false);
 $('subtask-due').min=todayInFortaleza();
 if(type==='edit')loadSubtasks(task.id);
 if(type==='edit')loadHistory(task.id);

 $('field-description').maxLength=type==='project'||type==='project-edit'?1000:2000;
 $('dialog').showModal();$('field-name').focus();
}

let projectAccessReady=false;
async function loadProjectAccess(project){
 const panel=$('project-member-choices');panel.replaceChildren();
 const data=await api('/api/projects/'+project.id+'/access'+qs());
 if(mode!=='project-edit'||editing?.id!==project.id)return;
 $('project-access-mode').value=data.access_mode;
 const active=state.members.filter(m=>m.active);
 for(const member of active){
  const label=document.createElement('label');label.className='assignee-choice';
  const input=document.createElement('input');input.type='checkbox';input.value=member.auth_subject;input.checked=data.members.includes(member.auth_subject);
  const caption=document.createElement('span');caption.textContent=memberName(member.auth_subject);
  label.append(input,caption);panel.append(label);
 }
 projectAccessReady=true;
}
async function loadSubtasks(taskId){
 const host=$('subtasks-list');host.textContent='Carregando subtarefas…';
 try{
  const data=await api('/api/tasks/'+taskId+'/subtasks'+qs());
  $('subtasks-summary').textContent=data.subtasks.filter(x=>x.status==='done').length+'/'+data.subtasks.length+' concluídas';
  host.replaceChildren();
  if(!data.subtasks.length){host.textContent='Nenhuma subtarefa. Adicione a primeira abaixo.';return;}
  for(const item of data.subtasks){
   const row=document.createElement('div');row.className='subtask-row';
   const name=document.createElement('strong');name.textContent=item.title;
   const status=document.createElement('select');status.setAttribute('aria-label','Situação da subtarefa '+item.title);
   for(const [v,label] of [['todo','A fazer'],['doing','Em andamento'],['done','Concluída']]){
    const option=document.createElement('option');option.value=v;option.textContent=label;status.append(option);
   }
   status.value=item.status;status.disabled=!['admin','manager','member'].includes(state.role);
   status.onchange=async()=>{status.disabled=true;try{await api('/api/subtasks/'+item.id+qs(),{method:'PATCH',body:JSON.stringify({status:status.value})});await loadSubtasks(taskId);message('Subtarefa atualizada.')}catch(e){message(e.message,true);status.disabled=false;}};
   const details=document.createElement('small');
   const assigned=Array.isArray(item.assignees)?item.assignees:(item.owner_subject?[item.owner_subject]:[]);
   details.textContent=(assigned.length?assigned.map(memberName).join(', '):'Sem responsáveis')+(item.due_at?' · '+new Date(item.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):' · Sem prazo');
   const edit=makeAction('Editar',async()=>{
    const title=prompt('Título da subtarefa:',item.title);
    if(title===null)return;
    edit.disabled=true;
    try{await api('/api/subtasks/'+item.id+qs(),{method:'PATCH',body:JSON.stringify({title:title.trim()})});await loadSubtasks(taskId);message('Subtarefa renomeada.')}
    catch(e){message(e.message,true);edit.disabled=false;}
   });
   edit.disabled=!['admin','manager','member'].includes(state.role);
   const assign=makeAction('Atribuir',()=>{
    const panel=document.createElement('div');panel.className='subtask-assign-editor';
    for(const member of state.members.filter(m=>m.active)){
     const choice=document.createElement('label');choice.className='assignee-choice';
     const input=document.createElement('input');input.type='checkbox';input.value=member.auth_subject;input.checked=assigned.includes(member.auth_subject);
     const text=document.createElement('span');text.textContent=memberName(member.auth_subject);
     choice.append(input,text);panel.append(choice);
    }
    const save=makeAction('Salvar responsáveis',async()=>{
     save.disabled=true;
     try{
      const assignees=[...panel.querySelectorAll('input:checked')].map(x=>x.value);
      await api('/api/subtasks/'+item.id+qs(),{method:'PATCH',body:JSON.stringify({assignees,owner_subject:assignees[0]||null})});
      await loadSubtasks(taskId);message('Responsáveis atualizados.');
     }catch(e){message(e.message,true);save.disabled=false;}
    });
    panel.append(save);row.append(panel);assign.disabled=true;
   });
   assign.disabled=edit.disabled;
   const text=document.createElement('div');text.append(name,details);
   row.append(text,status,edit,assign);host.append(row);
  }
 }catch(e){host.textContent='Erro ao consultar subtarefas: '+e.message;}
}
$('subtask-add').addEventListener('click',async()=>{
 if(mode!=='edit'||!editing)return;
 const title=$('subtask-name').value.trim();
 if(title.length<2){message('Informe o título da subtarefa.',true);return;}
 const button=$('subtask-add');button.disabled=true;
 try{
  await api('/api/tasks/'+editing.id+'/subtasks'+qs(),{method:'POST',body:JSON.stringify({
   title,assignees:[...$('subtask-assignees').querySelectorAll('input:checked')].map(x=>x.value),
   owner_subject:[...$('subtask-assignees').querySelectorAll('input:checked')][0]?.value||null,
   due_at:$('subtask-due').value||null,priority:$('subtask-priority').value
  })});
  $('subtask-name').value='';$('subtask-due').value='';
  $('subtask-assignees').querySelectorAll('input:checked').forEach(x=>x.checked=false);
  await loadSubtasks(editing.id);message('Subtarefa adicionada.');
 }catch(e){message(e.message,true)}finally{button.disabled=false;}
});
async function loadHistory(taskId){
 const list=$('task-history');list.textContent='Carregando histórico…';
 try{
  const result=await api('/api/tasks/'+taskId+'/history'+qs());list.replaceChildren();
  if(!result.history.length){list.textContent='Ainda não há registros.';return;}
  for(const entry of result.history){
   const item=document.createElement('div');item.className='history-item';
   const content=document.createElement('p');content.textContent=entry.summary;
   const small=document.createElement('small');small.textContent=new Date(entry.created_at).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})+' · '+(entry.actor_subject===state.subject?'Você':'Integrante da equipe');
   item.append(content,small);list.append(item);
  }
 }catch(e){list.textContent='Não foi possível carregar o histórico.';}
}
$('filter-treatment').addEventListener('change',renderTasks);
async function boot(){
 message('Verificando login do Portal AnnA One…');
 try{
  const {createAuthClient}=await import('https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle');
  state.auth=createAuthClient(AUTH);
  const session=await state.auth.getSession();const account=session?.data?.user||session?.data?.session?.user;
  if(!account){$('account').textContent='Não conectado';$('signin').hidden=false;message('Entre com sua conta existente do Portal AnnA One.');return;}
  $('signin').hidden=true;
  state.subject=String(account.id||'');$('account').textContent=account.email||'Conta AnnA One';
  let token=session?.data?.session?.access_token;
  if(typeof token!=='string'||token.split('.').length!==3){
   const r=await fetch(AUTH+'/token',{credentials:'include',cache:'no-store'});
   if(r.ok){const j=await r.json();token=typeof j==='string'?j:j?.token||j?.data?.token||j?.access_token;}
  }
  if(typeof token!=='string'||token.split('.').length!==3)throw Error('Não foi possível obter token de acesso validável. Confira a configuração central de identidade.');
  state.jwt=token;
  if(window.location.hash.startsWith('#invite=')){
   try{await redeemInvitation()}
   catch(e){
    message(e.message,true);
    $('signin').hidden=false;
    $('app').hidden=true;
    return;
   }
  }
  const me=await api('/api/me');state.organizations=me.organizations;if(!me.organizations.length){message('Login reconhecido, mas sua conta ainda não possui acesso ao Nexus.',true);return;}
  const select=$('org');select.replaceChildren(...me.organizations.map(o=>{const opt=document.createElement('option');opt.value=o.id;opt.textContent=o.name;return opt}));
  state.org=me.organizations[0].id;
  select.addEventListener('change',async()=>{state.org=select.value;state.tasks=[];state.project=null;await loadMembers();await refreshProjects();renderBrand();await loadNotifications();show('overview')});
  await loadMembers();await refreshProjects();renderBrand();await loadNotifications();$('app').hidden=false;show('overview');message('');
 }catch(e){message(e.message||'Não foi possível iniciar o Nexus.',true);$('signin').hidden=false;$('app').hidden=true;}
}
 $('signin-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('signin-button');button.disabled=true;message('Autenticando com sua conta AnnA One…');
 try{
  const result=await state.auth.signIn.email({email:$('signin-email').value.trim(),password:$('signin-password').value});
  if(result?.error)throw Error('Credenciais inválidas ou acesso indisponível.');
  $('signin-password').value='';await boot();
 }catch(error){message('Não foi possível entrar. Confira seus dados no Portal AnnA One e tente novamente.',true)}finally{button.disabled=false}
});
document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',async()=>{if(!state.org)return;try{if(x.dataset.view==='projects'||x.dataset.view==='overview')await refreshProjects();if(x.dataset.view==='mytasks')await loadMyTasks();if(x.dataset.view==='team'){await loadMembers();await loadInvitations()}if(x.dataset.view==='reports')await loadReports();if(x.dataset.view==='notifications')await loadNotifications();if(x.dataset.view==='calendar')await loadCalendar();show(x.dataset.view)}catch(e){message(e.message,true)}}));
$('invite-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('invite-create');button.disabled=true;
 const email=$('invite-email').value.trim().toLowerCase(),role=$('invite-role').value;
 try{
  const data=await api('/api/invitations'+qs(),{method:'POST',body:JSON.stringify({email,role})});
  $('invite-link').value=data.invite_url;
  $('invite-result').hidden=false;
  $('invite-mail').href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent('Convite para AnnA Nexus')+'&body='+encodeURIComponent('Você foi convidado para colaborar na AnnA Nexus. Entre com sua conta do Portal AnnA One usando o mesmo e-mail e acesse o convite válido por 7 dias:\n\n'+data.invite_url+'\n\nO acesso será liberado após aceitar o convite.');
  $('invite-email').value='';
  message('Convite gerado. Compartilhe o link com o destinatário.');
  await loadInvitations();
 }catch(e){message(e.message,true)}finally{button.disabled=false}
});
$('invite-copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText($('invite-link').value);message('Link copiado. Compartilhe somente com o destinatário.')}
 catch{ $('invite-link').focus();$('invite-link').select();message('Selecione e copie o link apresentado.');}
});
$('back-projects').onclick=async()=>{await refreshProjects();show('projects')};
$('new-project').onclick=()=>modal('project');
$('new-task').onclick=()=>modal('task');
$('close-modal').onclick=$('cancel').onclick=()=>$('dialog').close();
$('history-add').addEventListener('click',async()=>{
 if(mode!=='edit'||!editing)return;
 const summary=$('history-new-note').value.trim();
 if(!summary){message('Descreva o andamento antes de registrar.',true);return;}
 const button=$('history-add');button.disabled=true;
 try{
  await api('/api/tasks/'+editing.id+'/history'+qs(),{method:'POST',body:JSON.stringify({summary,mentions:[...$('history-mentions').querySelectorAll('input:checked')].map(x=>x.value)})});
  $('history-new-note').value='';
  $('history-mentions').querySelectorAll('input:checked').forEach(x=>x.checked=false);
  await loadHistory(editing.id);
  message('Andamento registrado no histórico.');
 }catch(e){message(e.message,true)}finally{button.disabled=false}
});
$('editor').addEventListener('submit',async e=>{
 e.preventDefault();const name=$('field-name').value.trim(),description=$('field-description').value.trim();$('save').disabled=true;
 try{
  if(mode==='project'||mode==='project-edit'){
   const payload={name,description,card_color:$('project-color').value,owner_subject:$('project-owner').value||null,template:mode==='project'?$('project-template').value:undefined};
   if(mode==='project')await api('/api/projects'+qs(),{method:'POST',body:JSON.stringify(payload)});
   else{
    if(!projectAccessReady)throw Error('Aguarde o carregamento dos participantes antes de salvar.');
    await api('/api/projects/'+editing.id+qs(),{method:'PATCH',body:JSON.stringify(payload)});
    const members=[...$('project-member-choices').querySelectorAll('input:checked')].map(x=>x.value);
    await api('/api/projects/'+editing.id+'/access'+qs(),{method:'PATCH',body:JSON.stringify({access_mode:$('project-access-mode').value,members})});
   }
   await refreshProjects();show('projects');
  }else{
   const priority=$('field-priority').value;
   const labels=[...$('field-labels').querySelectorAll('input:checked')].map(x=>x.value);
   const due_at=$('field-due').value||null;
   const assignees=[...$('field-assignees').querySelectorAll('input:checked')].map(x=>x.value);
   const assignee_subject=assignees[0]||null;
   const tracking={treatment_status:$('field-treatment').value,treatment_notes:$('field-treatment-notes').value.trim(),pending_reason:$('field-pending').value.trim(),next_action:$('field-next').value.trim()};
   const update_note=$('field-update-note').value.trim();

   if(due_at&&due_at<todayInFortaleza())throw Error('Escolha um prazo igual ou posterior à data de hoje.');
   if(mode==='edit'){
    await api('/api/tasks/'+editing.id+qs(),{method:'PATCH',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,assignees,labels,...tracking,update_note})});
   }else{
    await api('/api/projects/'+state.project.id+'/tasks'+qs(),{method:'POST',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,assignees,labels,...tracking})});
   }
   await openProject(state.project);await refreshProjects();
  }
  $('dialog').close();message('Dados salvos com sucesso.');
 }catch(e){message(e.message,true)}finally{$('save').disabled=false}
});
$('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';localStorage.setItem('anna-teamhub-theme',dark?'light':'dark')};
const preference=localStorage.getItem('anna-teamhub-theme');document.documentElement.dataset.theme=preference|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
boot();
