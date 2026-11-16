const $=id=>document.getElementById(id);
const AUTH='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const state={jwt:null,org:null,role:null,projects:[],tasks:[],project:null,view:'overview',subject:null,auth:null,members:[],organizations:[]};
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=(s,error=false)=>{const el=$('status');el.textContent=s;el.style.background=error?'#fff0ef':'';el.style.color=error?'#a31931':''};
const show=(view)=>{state.view=view;for(const id of ['overview','projects','board','mytasks','team','reports'])$(id).hidden=id!==view;$('welcome-banner').hidden=view!=='overview';
document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false')});
 $('title').textContent=view==='overview'?'Visão geral':view==='projects'?'Projetos':view==='board'?state.project?.name||'Quadro':view==='team'?'Equipe':view==='reports'?'Relatórios':'Minhas tarefas';
 $('subtitle').textContent=view==='overview'?'Acompanhe os projetos e as atividades da sua equipe.':view==='projects'?'Organize seus projetos e entregas.':view==='board'?'Acompanhe o trabalho por etapas.':view==='team'?'Pessoas autorizadas da organização.':view==='reports'?'Histórico e tempo dedicado a pendências.':'Atividades sob sua responsabilidade.';
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
 const projectRows=state.projects.map(p=>{
  const progress=p.total?Math.round(p.done/p.total*100):0;
  const cell=document.createElement('div');cell.className='project-entry';
  const name=document.createElement('strong');name.className='project-name';name.textContent=p.name;
  const open=makeAction('Abrir',()=>openProject(p));open.classList.add('project-open-button');
  cell.append(name,open);
  return [cell,p.description||'—',String(p.total),progress+'%'];
 });
 renderTable('overview-projects',['Projeto','Descrição','Tarefas','Progresso'],overviewRows);
 renderTable('projects-list',['Projeto / abrir','Descrição','Tarefas','Progresso'],projectRows);
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
   if(!['admin','manager','member'].includes(state.role)&&key!=='open')btn.disabled=true;
   controls.append(btn);
  }
  const stateLabel=task.archived_at?'Arquivada':task.paused_at?'Pausada':({todo:'A fazer',doing:'Em andamento',done:'Concluída'})[task.status]||task.status;
  return [task.title,task.project_name,stateLabel,
   task.due_at?new Date(task.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'—',controls];
 });
 renderTable('mine',['Tarefa','Projeto','Situação','Prazo','Ações'],rows);
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
 for(const x of data.pauses)lines.push(['Pausa',data.projects.find(p=>p.project_id===x.project_id)?.project_name||'',x.task_id||x.project_id,x.reason,x.started_at,x.ended_at||'Em aberto',x.elapsed_seconds,'']);
 const csv='\uFEFF'+lines.map(cols=>cols.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download='nexus-relatorio-pendencias.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('report-export').addEventListener('click',exportReport);
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
  const rows=data.items.map(t=>{
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
async function refreshProjects(){
 const data=await api('/api/projects'+qs());state.projects=data.projects;state.role=data.role;renderProjects();
 $('new-project').disabled=!['admin','manager'].includes(state.role);
 const summary=await api('/api/dashboard'+qs());$('stat-projects').textContent=summary.summary.projects;$('stat-open').textContent=summary.summary.open;$('stat-doing').textContent=summary.summary.doing;$('stat-done').textContent=summary.summary.done;$('stat-attention').textContent=summary.summary.attention||0;await loadAttention();
}
async function openProject(p){
 state.project=p;const data=await api('/api/projects/'+encodeURIComponent(p.id)+'/tasks'+qs());
 state.tasks=data.tasks;$('board-description').textContent=p.description||'Quadro de tarefas do projeto.';
 $('project-pause').disabled=!['admin','manager'].includes(state.role);
 $('project-pause').textContent=p.paused_at?'Retomar projeto':'Pausar projeto';
 $('project-pause-status').textContent=p.paused_at?'Pausado por pendência':'Projeto ativo';
 renderTasks();show('board');
}
function renderTasks(){
 let done=0,doing=0;const board=$('board-columns');
 for(const col of board.querySelectorAll('.column')){
  const status=col.dataset.status,list=col.querySelector('.tasklist');list.replaceChildren();
  const filter=$('filter-treatment').value;
  const tasks=state.tasks.filter(t=>t.status===status&&(filter==='all'||(t.treatment_status||'pending')===filter));col.querySelector('.count').textContent=tasks.length;
  for(const t of tasks){
   const card=document.createElement('article');card.className='task';const title=document.createElement('strong');title.textContent=t.title;
   const footer=document.createElement('footer');
   const select=document.createElement('select');select.setAttribute('aria-label','Etapa da tarefa '+t.title);
   [['todo','A fazer'],['doing','Em andamento'],['done','Concluído']].forEach(([v,n])=>{const opt=document.createElement('option');opt.value=v;opt.textContent=n;select.append(opt)});
   select.value=t.status;select.disabled=!['admin','manager','member'].includes(state.role);
   select.addEventListener('change',async()=>{const next=select.value;select.disabled=true;try{await api('/api/tasks/'+t.id+qs(),{method:'PATCH',body:JSON.stringify({status:next})});t.status=next;renderTasks();await refreshProjects();message('Tarefa atualizada.')}catch(e){select.value=t.status;message(e.message,true)}finally{select.disabled=false}});
   const label=document.createElement('span');label.className='priority';label.textContent=({high:'Alta',medium:'Média',low:'Baixa'})[t.priority]||'Média';
   const badge=document.createElement('span');badge.className='treatment-badge '+(t.treatment_status||'pending');badge.textContent=treatmentLabels[t.treatment_status]||'Pendente';
   const meta=document.createElement('div');meta.className='task-meta';
   if(t.due_at){const due=document.createElement('span');due.textContent='Prazo: '+new Date(t.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'});meta.append(due);}
   const assignedIds=Array.isArray(t.assignees)?t.assignees:(t.assignee_subject?[t.assignee_subject]:[]);
   if(assignedIds.length){const assigned=document.createElement('span');assigned.textContent='Responsáveis: '+assignedIds.map(memberName).join(', ');meta.append(assigned);}
   const edit=document.createElement('button');edit.type='button';edit.className='task-edit';edit.textContent='Editar tarefa';edit.disabled=!['admin','manager','member'].includes(state.role);edit.onclick=()=>modal('edit',t);
   if(t.pending_reason){const p=document.createElement('span');p.className='pending-summary';p.textContent='Pendência: '+t.pending_reason;meta.append(p);}
   if(t.next_action){const p=document.createElement('span');p.textContent='Próxima ação: '+t.next_action;meta.append(p);}
   footer.append(label,select);card.append(title,badge,meta,footer,edit);list.append(card);
  }
 }
 $('filter-count').textContent=state.tasks.filter(t=>$('filter-treatment').value==='all'||(t.treatment_status||'pending')===$('filter-treatment').value).length+' tarefa(s)';
 $('new-task').disabled=!['admin','manager','member'].includes(state.role);
 const all=state.tasks;done=all.filter(t=>t.status==='done').length;doing=all.filter(t=>t.status==='doing').length;
 /* Indicadores gerais calculados pela API da organização, não pelo quadro atual. */
 const mine=all.filter(t=>t.assignee_subject&&t.assignee_subject===state.subject);
 $('mine').textContent=mine.length?mine.map(t=>t.title).join(' · '):'Sem tarefas atribuídas neste projeto.';
}
function todayInFortaleza(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=k=>parts.find(p=>p.type===k).value;
 return part('year')+'-'+part('month')+'-'+part('day');
}
let mode=null,editing=null;
function modal(type,task=null){
 mode=type;editing=task;
 $('modal-title').textContent=type==='project'?'Novo projeto':type==='edit'?'Editar tarefa':'Nova tarefa';
 $('field-name').value=task?.title||'';
 $('field-description').value=task?.description||'';
 $('task-fields').hidden=type==='project';
 $('field-priority').value=task?.priority||'medium';
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
 $('history-add').disabled=!['admin','manager','member'].includes(state.role);
 $('task-history-wrap').hidden=type!=='edit';
 if(type==='edit')loadHistory(task.id);

 $('field-description').maxLength=type==='project'?1000:2000;
 $('dialog').showModal();$('field-name').focus();
}

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
  select.addEventListener('change',async()=>{state.org=select.value;state.tasks=[];state.project=null;await loadMembers();await refreshProjects();renderBrand();show('overview')});
  await loadMembers();await refreshProjects();renderBrand();$('app').hidden=false;show('overview');message('');
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
document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',async()=>{if(!state.org)return;try{if(x.dataset.view==='projects'||x.dataset.view==='overview')await refreshProjects();if(x.dataset.view==='mytasks')await loadMyTasks();if(x.dataset.view==='team'){await loadMembers();await loadInvitations()}if(x.dataset.view==='reports')await loadReports();show(x.dataset.view)}catch(e){message(e.message,true)}}));
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
  await api('/api/tasks/'+editing.id+'/history'+qs(),{method:'POST',body:JSON.stringify({summary})});
  $('history-new-note').value='';
  await loadHistory(editing.id);
  message('Andamento registrado no histórico.');
 }catch(e){message(e.message,true)}finally{button.disabled=false}
});
$('editor').addEventListener('submit',async e=>{
 e.preventDefault();const name=$('field-name').value.trim(),description=$('field-description').value.trim();$('save').disabled=true;
 try{
  if(mode==='project'){
   await api('/api/projects'+qs(),{method:'POST',body:JSON.stringify({name,description})});
   await refreshProjects();show('projects');
  }else{
   const priority=$('field-priority').value;
   const due_at=$('field-due').value||null;
   const assignees=[...$('field-assignees').querySelectorAll('input:checked')].map(x=>x.value);
   const assignee_subject=assignees[0]||null;
   const tracking={treatment_status:$('field-treatment').value,treatment_notes:$('field-treatment-notes').value.trim(),pending_reason:$('field-pending').value.trim(),next_action:$('field-next').value.trim()};
   const update_note=$('field-update-note').value.trim();

   if(due_at&&due_at<todayInFortaleza())throw Error('Escolha um prazo igual ou posterior à data de hoje.');
   if(mode==='edit'){
    await api('/api/tasks/'+editing.id+qs(),{method:'PATCH',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,assignees,...tracking,update_note})});
   }else{
    await api('/api/projects/'+state.project.id+'/tasks'+qs(),{method:'POST',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,assignees,...tracking})});
   }
   await openProject(state.project);await refreshProjects();
  }
  $('dialog').close();message('Dados salvos com sucesso.');
 }catch(e){message(e.message,true)}finally{$('save').disabled=false}
});
$('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';localStorage.setItem('anna-teamhub-theme',dark?'light':'dark')};
const preference=localStorage.getItem('anna-teamhub-theme');document.documentElement.dataset.theme=preference|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
boot();
