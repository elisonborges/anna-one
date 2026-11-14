const $=id=>document.getElementById(id);
const AUTH='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const state={jwt:null,org:null,role:null,projects:[],tasks:[],project:null,view:'overview',subject:null,auth:null};
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=(s,error=false)=>{const el=$('status');el.textContent=s;el.style.background=error?'#fff0ef':'';el.style.color=error?'#a31931':''};
const show=(view)=>{state.view=view;for(const id of ['overview','projects','board','mytasks'])$(id).hidden=id!==view;
 $('signin-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('signin-button');button.disabled=true;message('Autenticando com sua conta AnnA One…');
 try{
  const result=await state.auth.signIn.email({email:$('signin-email').value.trim(),password:$('signin-password').value});
  if(result?.error)throw Error('Credenciais inválidas ou acesso indisponível.');
  $('signin-password').value='';await boot();
 }catch(error){message('Não foi possível entrar. Confira seus dados no Portal AnnA One e tente novamente.',true)}finally{button.disabled=false}
});
document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false')});
 $('title').textContent=view==='overview'?'Visão geral':view==='projects'?'Projetos':view==='board'?state.project?.name||'Quadro':'Minhas tarefas';
 $('subtitle').textContent=view==='overview'?'Acompanhe os projetos e as atividades da sua equipe.':view==='projects'?'Organize seus projetos e entregas.':view==='board'?'Acompanhe o trabalho por etapas.':'Atividades sob sua responsabilidade.';
};
async function api(route,options={}){
 const res=await fetch(route,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.jwt,...(options.headers||{})},cache:'no-store'});
 let data;try{data=await res.json()}catch{throw Error('Resposta inválida do servidor');}
 if(!res.ok){if(res.status===401)message('Sessão expirada. Entre novamente pelo Portal AnnA One.',true);throw Error(data.error||'Falha na operação');}
 return data;
}
const qs=()=>'?org='+encodeURIComponent(state.org);
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
async function refreshProjects(){
 const data=await api('/api/projects'+qs());state.projects=data.projects;state.role=data.role;renderProjects();
 $('new-project').disabled=!['admin','manager'].includes(state.role);
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
  const tasks=state.tasks.filter(t=>t.status===status);col.querySelector('.count').textContent=tasks.length;
  for(const t of tasks){
   const card=document.createElement('article');card.className='task';const title=document.createElement('strong');title.textContent=t.title;
   const footer=document.createElement('footer');
   const select=document.createElement('select');select.setAttribute('aria-label','Etapa da tarefa '+t.title);
   [['todo','A fazer'],['doing','Em andamento'],['done','Concluído']].forEach(([v,n])=>{const opt=document.createElement('option');opt.value=v;opt.textContent=n;select.append(opt)});
   select.value=t.status;select.disabled=!['admin','manager','member'].includes(state.role);
   select.addEventListener('change',async()=>{const next=select.value;select.disabled=true;try{await api('/api/tasks/'+t.id+qs(),{method:'PATCH',body:JSON.stringify({status:next})});t.status=next;renderTasks();await refreshProjects();message('Tarefa atualizada.')}catch(e){select.value=t.status;message(e.message,true)}finally{select.disabled=false}});
   const label=document.createElement('span');label.className='priority';label.textContent=({high:'Alta',medium:'Média',low:'Baixa'})[t.priority]||'Média';
   footer.append(label,select);card.append(title,footer);list.append(card);
  }
 }
 $('new-task').disabled=!['admin','manager','member'].includes(state.role);
 const all=state.tasks;done=all.filter(t=>t.status==='done').length;doing=all.filter(t=>t.status==='doing').length;
 $('stat-open').textContent=all.length-done;$('stat-doing').textContent=doing;$('stat-done').textContent=done;
 const mine=all.filter(t=>t.assignee_subject&&t.assignee_subject===state.subject);
 $('mine').textContent=mine.length?mine.map(t=>t.title).join(' · '):'Sem tarefas atribuídas neste projeto.';
}
let mode=null;
function modal(type){mode=type;$('modal-title').textContent=type==='project'?'Novo projeto':'Nova tarefa';$('field-name').value='';$('field-description').value='';$('dialog').showModal();$('field-name').focus();}
async function boot(){
 message('Verificando login do Portal AnnA One…');
 try{
  const {createAuthClient}=await import('https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle');
  state.auth=createAuthClient(AUTH);
  const session=await state.auth.getSession();const account=session?.data?.user||session?.data?.session?.user;
  if(!account){$('account').textContent='Não conectado';$('signin').hidden=false;message('Entre com sua conta existente do Portal AnnA One.');return;}\n  $('signin').hidden=true;
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
  select.addEventListener('change',async()=>{state.org=select.value;state.tasks=[];state.project=null;await refreshProjects();show('overview')});
  $('app').hidden=false;await refreshProjects();show('overview');message('');
 }catch(e){message(e.message||'Não foi possível iniciar o Nexus.',true);if(!state.jwt)$('signin').hidden=false;}
}
document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',async()=>{if(!state.org)return;try{if(x.dataset.view==='projects'||x.dataset.view==='overview')await refreshProjects();if(x.dataset.view==='mytasks'&&!state.project){$('mine').textContent='Abra um projeto para consultar as tarefas.'}show(x.dataset.view)}catch(e){message(e.message,true)}}));
$('back-projects').onclick=async()=>{await refreshProjects();show('projects')};
$('new-project').onclick=()=>modal('project');
$('new-task').onclick=()=>modal('task');
$('close-modal').onclick=$('cancel').onclick=()=>$('dialog').close();
$('editor').addEventListener('submit',async e=>{
 e.preventDefault();const name=$('field-name').value.trim(),description=$('field-description').value.trim();$('save').disabled=true;
 try{
  if(mode==='project'){await api('/api/projects'+qs(),{method:'POST',body:JSON.stringify({name,description})});await refreshProjects();show('projects');}
  else{await api('/api/projects/'+state.project.id+'/tasks'+qs(),{method:'POST',body:JSON.stringify({title:name,description})});await openProject(state.project);}
  $('dialog').close();message('Dados salvos com sucesso.');
 }catch(e){message(e.message,true)}finally{$('save').disabled=false}
});
$('theme').onclick=()=>{const dark=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=dark?'light':'dark';localStorage.setItem('anna-teamhub-theme',dark?'light':'dark')};
const preference=localStorage.getItem('anna-teamhub-theme');document.documentElement.dataset.theme=preference|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
boot();
