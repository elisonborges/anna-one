const $=id=>document.getElementById(id);
const AUTH='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const state={jwt:null,org:null,role:null,projects:[],tasks:[],project:null,view:'overview',subject:null,auth:null,members:[]};
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=(s,error=false)=>{const el=$('status');el.textContent=s;el.style.background=error?'#fff0ef':'';el.style.color=error?'#a31931':''};
const show=(view)=>{state.view=view;for(const id of ['overview','projects','board','mytasks','team'])$(id).hidden=id!==view;$('welcome-banner').hidden=view!=='overview';
document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false')});
 $('title').textContent=view==='overview'?'Visão geral':view==='projects'?'Projetos':view==='board'?state.project?.name||'Quadro':view==='team'?'Equipe':'Minhas tarefas';
 $('subtitle').textContent=view==='overview'?'Acompanhe os projetos e as atividades da sua equipe.':view==='projects'?'Organize seus projetos e entregas.':view==='board'?'Acompanhe o trabalho por etapas.':view==='team'?'Pessoas autorizadas da organização.':'Atividades sob sua responsabilidade.';
};
async function api(route,options={}){
 const res=await fetch(route,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.jwt,...(options.headers||{})},cache:'no-store'});
 let data;try{data=await res.json()}catch{throw Error('Resposta inválida do servidor');}
 if(!res.ok){if(res.status===401)message('Sessão expirada. Entre novamente pelo Portal AnnA One.',true);throw Error(data.error||'Falha na operação');}
 return data;
}
const qs=()=>'?org='+encodeURIComponent(state.org);
const treatmentLabels={pending:'Pendente',analysis:'Em análise',executing:'Em execução',waiting:'Aguardando retorno',blocked:'Bloqueada',resolved:'Resolvida'};

function projectButton(p){
 const btn=document.createElement('button');btn.className='project';btn.type='button';
 const progress=p.total?Math.round(p.done/p.total*100):0;
 btn.innerHTML='<strong>'+escapeHtml(p.name)+'</strong><small>'+escapeHtml(p.description||'Projeto AnnA One')+'</small><div class="meter"><b style="width:'+progress+'%"></b></div><small>'+progress+'% concluído · '+p.total+' tarefas</small>';
 btn.addEventListener('click',()=>openProject(p));return btn;
}
function renderProjects(){
 $('projects-list').replaceChildren(...state.projects.map(projectButton));
 $('overview-projects').replaceChildren(...state.projects.slice(0,6).map(projectButton));
 if(!state.projects.length){$('projects-list').textContent='Nenhum projeto cadastrado. Crie o primeiro projeto para começar.';$('overview-projects').textContent='Nenhum projeto disponível.';}
 $('stat-projects').textContent=state.projects.length;
}
function memberName(subject){
 if(!subject)return 'Sem responsável';
 if(subject===state.subject)return 'Você';
 const index=state.members.findIndex(m=>m.auth_subject===subject);
 return index<0?'Integrante inativo':'Integrante '+(index+1);
}
async function loadMembers(){
 const data=await api('/api/members'+qs());
 state.members=data.members;
 const select=$('field-assignee');
 select.replaceChildren();
 const empty=document.createElement('option');empty.value='';empty.textContent='Sem responsável';select.append(empty);
 for(const member of state.members){
  const opt=document.createElement('option');opt.value=member.auth_subject;
  opt.textContent=memberName(member.auth_subject)+' · '+({admin:'Administrador',manager:'Gestor',member:'Membro',guest:'Convidado'}[member.role]||member.role);
  select.append(opt);
 }
 const list=$('members-list');list.replaceChildren();
 if(!state.members.length){list.textContent='Nenhum membro ativo.';return;}
 for(const member of state.members){
  const item=document.createElement('div');item.className='member-row';
  const avatar=document.createElement('span');avatar.className='member-avatar';avatar.textContent=member.auth_subject===state.subject?'EU':'•';
  const info=document.createElement('div');
  const label=document.createElement('strong');label.textContent=memberName(member.auth_subject);
  const role=document.createElement('small');role.textContent=({admin:'Administrador',manager:'Gestor',member:'Membro',guest:'Convidado'})[member.role]||member.role;
  info.append(label,role);item.append(avatar,info);list.append(item);
 }
}
async function loadMyTasks(){
 const data=await api('/api/my-tasks'+qs());
 const list=$('mine');list.replaceChildren();
 if(!data.tasks.length){list.textContent='Nenhuma tarefa atribuída a você nesta organização.';return;}
 for(const task of data.tasks){
  const card=document.createElement('article');card.className='mytask-card';
  const title=document.createElement('strong');title.textContent=task.title;
  const details=document.createElement('small');
  details.textContent=task.project_name+' · '+({todo:'A fazer',doing:'Em andamento',done:'Concluído'})[task.status]+(task.due_at?' · Prazo '+new Date(task.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'');
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Abrir projeto';
  button.onclick=async()=>{try{
   const project=state.projects.find(p=>p.id===task.project_id);
   if(!project){await refreshProjects();}
   const selected=state.projects.find(p=>p.id===task.project_id);
   if(!selected)throw Error('Projeto indisponível.');
   await openProject(selected);
  }catch(e){message(e.message,true)}};
  card.append(title,details,button);list.append(card);
 }
}
async function loadAttention(){
 const list=$('attention-list');list.textContent='Carregando pendências…';
 try{
  const data=await api('/api/attention'+qs());list.replaceChildren();
  if(!data.items.length){list.textContent='Nenhuma tarefa bloqueada ou aguardando retorno. ';return;}
  for(const t of data.items){
   const card=document.createElement('div');card.className='attention-item';
   const info=document.createElement('div');
   const name=document.createElement('strong');name.textContent=t.title;
   const desc=document.createElement('small');desc.textContent=t.project_name+' · '+(t.treatment_status==='blocked'?'Bloqueada':'Aguardando retorno');
   info.append(name,desc);
   if(t.pending_reason){const pending=document.createElement('p');pending.textContent=t.pending_reason;info.append(pending);}
   if(t.next_action){const next=document.createElement('p');next.textContent='Próxima ação: '+t.next_action;info.append(next);}
   const button=document.createElement('button');button.className='secondary';button.type='button';button.textContent='Abrir projeto';
   button.onclick=async()=>{try{
    let project=state.projects.find(x=>x.id===t.project_id);
    if(!project){await refreshProjects();project=state.projects.find(x=>x.id===t.project_id);}
    if(!project)throw Error('Projeto não encontrado.');
    await openProject(project);
   }catch(e){message(e.message,true)}};
   card.append(info,button);list.append(card);
  }
 }catch(e){list.textContent='Não foi possível carregar as pendências.';}
}
async function refreshProjects(){
 const data=await api('/api/projects'+qs());state.projects=data.projects;state.role=data.role;renderProjects();
 $('new-project').disabled=!['admin','manager'].includes(state.role);
 const summary=await api('/api/dashboard'+qs());$('stat-projects').textContent=summary.summary.projects;$('stat-open').textContent=summary.summary.open;$('stat-doing').textContent=summary.summary.doing;$('stat-done').textContent=summary.summary.done;$('stat-attention').textContent=summary.summary.attention||0;await loadAttention();
}
async function openProject(p){
 state.project=p;const data=await api('/api/projects/'+encodeURIComponent(p.id)+'/tasks'+qs());
 state.tasks=data.tasks;$('board-description').textContent=p.description||'Quadro de tarefas do projeto.';
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
   if(t.assignee_subject){const assigned=document.createElement('span');assigned.textContent='Responsável: '+memberName(t.assignee_subject);meta.append(assigned);}
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
 $('field-assignee').value=task?.assignee_subject||'';
 $('field-treatment').value=task?.treatment_status||'pending';
 $('field-treatment-notes').value=task?.treatment_notes||'';
 $('field-pending').value=task?.pending_reason||'';
 $('field-next').value=task?.next_action||'';
 $('field-update-note').value='';
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
  const me=await api('/api/me');if(!me.organizations.length){message('Login reconhecido, mas sua conta ainda não possui acesso ao Nexus.',true);return;}
  const select=$('org');select.replaceChildren(...me.organizations.map(o=>{const opt=document.createElement('option');opt.value=o.id;opt.textContent=o.name;return opt}));
  state.org=me.organizations[0].id;
  select.addEventListener('change',async()=>{state.org=select.value;state.tasks=[];state.project=null;await loadMembers();await refreshProjects();show('overview')});
  await loadMembers();await refreshProjects();$('app').hidden=false;show('overview');message('');
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
document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',async()=>{if(!state.org)return;try{if(x.dataset.view==='projects'||x.dataset.view==='overview')await refreshProjects();if(x.dataset.view==='mytasks')await loadMyTasks();if(x.dataset.view==='team')await loadMembers();show(x.dataset.view)}catch(e){message(e.message,true)}}));
$('back-projects').onclick=async()=>{await refreshProjects();show('projects')};
$('new-project').onclick=()=>modal('project');
$('new-task').onclick=()=>modal('task');
$('close-modal').onclick=$('cancel').onclick=()=>$('dialog').close();
$('editor').addEventListener('submit',async e=>{
 e.preventDefault();const name=$('field-name').value.trim(),description=$('field-description').value.trim();$('save').disabled=true;
 try{
  if(mode==='project'){
   await api('/api/projects'+qs(),{method:'POST',body:JSON.stringify({name,description})});
   await refreshProjects();show('projects');
  }else{
   const priority=$('field-priority').value;
   const due_at=$('field-due').value||null;
   const assignee_subject=$('field-assignee').value||null;
   const tracking={treatment_status:$('field-treatment').value,treatment_notes:$('field-treatment-notes').value.trim(),pending_reason:$('field-pending').value.trim(),next_action:$('field-next').value.trim()};
   const update_note=$('field-update-note').value.trim();

   if(due_at&&due_at<todayInFortaleza())throw Error('Escolha um prazo igual ou posterior à data de hoje.');
   if(mode==='edit'){
    await api('/api/tasks/'+editing.id+qs(),{method:'PATCH',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,...tracking,update_note})});
   }else{
    await api('/api/projects/'+state.project.id+'/tasks'+qs(),{method:'POST',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,...tracking})});
   }
   await openProject(state.project);await refreshProjects();
  }
  $('dialog').close();message('Dados salvos com sucesso.');
 }catch(e){message(e.message,true)}finally{$('save').disabled=false}
});
$('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';localStorage.setItem('anna-teamhub-theme',dark?'light':'dark')};
const preference=localStorage.getItem('anna-teamhub-theme');document.documentElement.dataset.theme=preference|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
boot();
