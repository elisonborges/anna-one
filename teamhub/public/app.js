const $=id=>document.getElementById(id);
const AUTH='https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const state={jwt:null,org:null,role:null,projects:[],tasks:[],project:null,view:'overview',subject:null,auth:null,members:[],organizations:[],inviteOrg:null};
const invitationToken=()=>/^#invite=([a-f0-9]{64})$/i.exec(location.hash)?.[1]?.toLowerCase()||null;
async function loadInvitationPreview(){
 const token=invitationToken();if(!token)return;
 const response=await fetch('/api/invitations/preview',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({token}),cache:'no-store'
 });
 const info=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(info.error||'Não foi possível validar o convite.');
 // Only a server-validated, pending invitation can prefill the email field.
 const email=String(info.email||'').trim().toLowerCase();
 if(!email)throw Error('Convite sem e-mail de destinatário.');
 $('signup-email').value=email;$('signup-email').readOnly=true;
 $('signin-email').value=email;
 const roles={admin:'Administrador',manager:'Gestor',member:'Membro',guest:'Convidado'};
 const intro=$('invitation-intro').querySelector('p');
 intro.textContent='Organização: '+String(info.organization||'AnnA One')+
  (info.project_name?' · Card: '+String(info.project_name):'')+
  ' · Perfil: '+(roles[info.role]||'Colaborador')+
  '. Se este é seu primeiro acesso, crie uma senha para entrar. Seu e-mail já está preenchido.';
}

const canManageUI=p=>state.role==='admin'||(state.role==='manager'&&!!p&&p.manager_subject===state.subject);
const assignedUI=t=>!!t&&(t.assignee_subject===state.subject||(Array.isArray(t.assignees)&&t.assignees.includes(state.subject)));
const canExecuteUI=t=>canManageUI(state.project)||(['member','manager'].includes(state.role)&&assignedUI(t));
const roleViews={
 admin:['overview','projects','board','mytasks','calendar','approvals','reports','notifications','team'],
 manager:['overview','projects','board','mytasks','calendar','approvals','reports','notifications'],
 member:['overview','projects','board','mytasks','calendar','approvals','notifications'],
 guest:['projects','board','calendar','notifications']
};
function applyRoleMenus(){
 const allowed=roleViews[state.role]||[];
 document.body.dataset.nexusRole=state.role||'';
 for(const element of document.querySelectorAll('[data-view]')){
  element.hidden=!allowed.includes(element.dataset.view);
  if(element.dataset.view==='approvals'){
   const name=element.querySelector('span');if(name)name.textContent=state.role==='member'?'Minhas solicitações':'Solicitações e Aprovações';
  }
  if(element.dataset.view==='projects'){
   const name=element.querySelector('span');if(name&&element.closest('#nexus-sidebar'))name.textContent=state.role==='manager'?'Meus projetos':state.role==='guest'?'Projetos compartilhados':'Projetos';
  }
 }
 $('dash-alerts').hidden=state.role!=='admin';
 $('dash-export').hidden=!['admin','manager'].includes(state.role);
 $('dash-wallboard').hidden=state.role==='member';
 $('show-archived').disabled=state.role==='member';
 $('member-home').hidden=state.role!=='member';
}
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const message=(s,error=false)=>{const el=$('status');el.textContent=s;el.style.background=error?'#fff0ef':'';el.style.color=error?'#a31931':''};
const compactMedia=window.matchMedia('(max-width:850px)');
let mobileNavOpen=false;
const layoutPrefsKey='anna-nexus-sidebar-collapsed';
function setSidebarCollapsed(collapsed){
 const app=$('app');app.classList.toggle('sidebar-collapsed',!!collapsed);
 const button=$('sidebar-toggle');
 button.setAttribute('aria-expanded',String(!collapsed));
 button.setAttribute('aria-label',collapsed?'Expandir menu':'Recolher menu');
 button.title=collapsed?'Expandir menu':'Recolher menu';
 button.querySelector('[aria-hidden]').textContent=collapsed?'›':'‹';
 button.querySelector('.sidebar-toggle-label').textContent=collapsed?'Expandir menu':'Recolher menu';
 for(const item of $('nexus-sidebar').querySelectorAll('.nav')){
  const caption=item.querySelector('span');
  if(caption)item.title=caption.textContent.trim();
 }
 try{localStorage.setItem(layoutPrefsKey,collapsed?'true':'false')}catch{}
}
function setMobileNav(open){
 mobileNavOpen=!!open&&compactMedia.matches;
 $('app').classList.toggle('mobile-nav-open',mobileNavOpen);
 $('side-backdrop').hidden=!mobileNavOpen;
 const button=$('mobile-menu-toggle');button.setAttribute('aria-expanded',String(mobileNavOpen));
 button.setAttribute('aria-label',mobileNavOpen?'Fechar menu de navegação':'Abrir menu de navegação');
 button.textContent=mobileNavOpen?'×':'☰';
}
$('sidebar-toggle').addEventListener('click',()=>{
 if(compactMedia.matches){setMobileNav(false);return;}
 setSidebarCollapsed(!$('app').classList.contains('sidebar-collapsed'));
});
$('mobile-menu-toggle').addEventListener('click',()=>setMobileNav(!mobileNavOpen));
$('side-backdrop').addEventListener('click',()=>setMobileNav(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&mobileNavOpen)setMobileNav(false)});
compactMedia.addEventListener('change',()=>setMobileNav(false));
try{setSidebarCollapsed(localStorage.getItem(layoutPrefsKey)==='true')}catch{setSidebarCollapsed(false)}
const show=(view)=>{if(state.role&&!(roleViews[state.role]||[]).includes(view))return;setMobileNav(false);state.view=view;for(const id of ['overview','projects','board','mytasks','team','reports','notifications','calendar','approvals'])$(id).hidden=id!==view;$('welcome-banner').hidden=view!=='overview';
document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false')});
 $('title').textContent=view==='overview'?(state.role==='member'?'Meu painel':'Visão geral'):view==='projects'?'Projetos e Produções':view==='board'?state.project?.name||'Quadro':view==='team'?'Equipe':view==='approvals'?'Solicitações e Aprovações':view==='reports'?'Relatórios':view==='notifications'?'Notificações':view==='calendar'?'Calendário':'Minhas tarefas';
 $('subtitle').textContent=view==='overview'?'Acompanhe os projetos e as atividades da sua equipe.':view==='projects'?'Organize projetos, equipes, metas e produção.':view==='board'?'Acompanhe o trabalho por etapas.':view==='team'?'Pessoas autorizadas da organização.':view==='approvals'?'Acompanhe solicitações e registre decisões autorizadas.':view==='reports'?'Histórico e tempo dedicado a pendências.':view==='notifications'?'Atribuições e avisos importantes.':view==='calendar'?'Prazos e entregas por mês.':'Atividades sob sua responsabilidade.';
};
async function api(route,options={}){
 const res=await fetch(route,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.jwt,...(options.headers||{})},cache:'no-store'});
 let data;try{data=await res.json()}catch{throw Error('Resposta inválida do servidor');}
 if(!res.ok){if(res.status===401){state.jwt=null;$('app').hidden=true;$('signin').hidden=false;message('Sessão expirada. Entre novamente com sua conta AnnA One para continuar.',true);}throw Error(data.error||'Falha na operação');}
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
let currentApprovalProject=null;
async function showApproval(project){
 currentApprovalProject=project;
 const data=await api('/api/projects/'+project.id+'/completion'+qs());
 $('approval-title').textContent='Conferência · '+project.name;
 $('approval-description').textContent=({active:'Em andamento',review:'Aguardando aprovação',completed:'Projeto concluído'})[data.status]||data.status;
 const request=data.history.find(h=>h.action==='requested');
 if(data.status==='review'&&request){
  const marks=Object.values(request.checklist||{}).filter(Boolean).length;
  $('approval-description').textContent+=' · Solicitante conferiu '+marks+'/5 itens. O administrador deve realizar conferência independente.';
 }
 $('approval-progress').textContent=data.tasks.total+' tarefas ('+data.tasks.open+' abertas) · '+data.subtasks.total+' subtarefas ('+data.subtasks.open+' abertas) · '+data.tasks.blocked+' tratamentos pendentes · '+data.tasks.paused+' pausadas';
 for(const input of $('approval-checks').querySelectorAll('input'))input.checked=false;
 $('approval-note').value='';
 $('approval-checks').hidden=!['active','review'].includes(data.status);
 $('approval-request').hidden=data.status!=='active'||!['admin','manager','member'].includes(state.role);
 $('approval-approve').hidden=data.status!=='review'||state.role!=='admin';
 $('approval-reject').hidden=data.status!=='review'||state.role!=='admin';
 $('approval-reopen').hidden=data.status!=='completed'||state.role!=='admin';
 $('approval-approve').disabled=data.tasks.open>0||data.subtasks.open>0||data.tasks.blocked>0||data.tasks.paused>0;
 const lines=data.history.map(x=>[
  ({requested:'Solicitada',approved:'Aprovada',rejected:'Devolvida',reopened:'Reaberta'})[x.action]||x.action,
  x.actor_subject===state.subject?'Você':'Integrante da equipe',
  x.note||'—',new Date(x.created_at).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})
 ]);
 renderTable('approval-history',['Decisão','Responsável','Justificativa','Data'],lines);
 $('approval-dialog').showModal();
}
$('approval-close').addEventListener('click',()=>$('approval-dialog').close());
for(const action of ['request','approve','reject','reopen']){
 $('approval-'+action).addEventListener('click',async()=>{
  if(!currentApprovalProject)return;
  const note=$('approval-note').value.trim();
  const checks={};
  for(const input of $('approval-checks').querySelectorAll('input'))checks[input.value]=input.checked;
  if(['request','approve'].includes(action)&&!Object.values(checks).every(Boolean)){message('Confirme todos os itens do checklist antes de prosseguir.',true);return;}
  if(['reject','reopen'].includes(action)&&note.length<5){message('Informe uma justificativa com pelo menos 5 caracteres.',true);return;}
  if(action==='approve'&&!confirm('Confirmar que o projeto foi conferido e pode ser encerrado?'))return;
  const btn=$('approval-'+action);btn.disabled=true;
  try{
   await api('/api/projects/'+currentApprovalProject.id+'/completion/'+action+qs(),{method:'POST',body:JSON.stringify({...checks,note})});
   const previous=currentApprovalProject.id;
   $('approval-dialog').close();
   await refreshProjects();
   if(state.view==='approvals')await loadCentral();
   const project=state.projects.find(x=>x.id===previous);
   if(project&&state.view==='board')await openProject(project);
   message(({request:'Projeto enviado à fila de validação.',approve:'Projeto aprovado e concluído.',reject:'Projeto devolvido para ajustes.',reopen:'Projeto reaberto com histórico preservado.'})[action]);
  }catch(e){message(e.message,true)}finally{btn.disabled=false}
 });
}
// v0.1.40 — solicitações centralizadas e painel pessoal.
async function loadPersonalHome(){
 if(state.role!=='member')return;
 const host=$('member-home');if(!host)return;
 try{
  const [t,s]=await Promise.all([api('/api/my-tasks'+qs()),api('/api/my-subtasks'+qs())]);
  const tasks=t.tasks||[],subtasks=s.subtasks||s.items||[];
  const open=tasks.filter(x=>x.status!=='done');
  const doing=tasks.filter(x=>x.status==='doing');
  const today=todayInFortaleza(),soon=tasks.filter(x=>x.status!=='done'&&x.due_at&&String(x.due_at).slice(0,10)<=today);
  $('member-total').textContent=String(open.length);
  $('member-doing').textContent=String(doing.length);
  $('member-due').textContent=String(soon.length);
  $('member-subtasks').textContent=String(subtasks.filter(x=>x.status!=='done').length);
  $('member-home-list').replaceChildren();
  const rows=open.slice(0,12).map(task=>{
   const btn=makeAction('Abrir',async()=>{try{await openTaskFromList(task)}catch(e){message(e.message,true)}});
   return [task.title,task.project_name,task.status==='doing'?'Em andamento':'A fazer',btn];
  });
  renderTable('member-home-list',['Atividade','Projeto','Etapa','Ação'],rows);
 }catch(e){host.querySelector('#member-home-list').textContent='Não foi possível carregar o painel pessoal.';}
}
let centralData={requests:[],projects:[]};
async function loadCentral(){
 if(state.role==='guest')return;
 centralData=await api('/api/approvals/central'+qs());
 renderCentral();
}
function renderCentral(){
 const host=$('approvals-list');
 if(!host)return;
 const kind=$('approvals-type').value,filter=$('approvals-status').value;
 const rows=[];
 const allowedTask=kind==='all'||kind==='task',allowedProject=kind==='all'||kind==='project';
 if(allowedTask)for(const item of centralData.requests||[]){
  if(filter!=='all'&&item.status!==filter)continue;
  const status=({pending:'Pendente',approved:'Aprovada',rejected:'Recusada'})[item.status]||item.status;
  const actions=document.createElement('div');actions.className='nexus-central-actions';
  if(item.status==='pending'&&['admin','manager'].includes(state.role)&&
    (state.role==='admin'||canManageUI(state.projects.find(x=>x.id===item.project_id)))){
   for(const [label,decision] of [['Aprovar','approved'],['Recusar','rejected']]){
    const button=makeAction(label,async()=>{
     const note=prompt(decision==='rejected'?'Informe o motivo da recusa (obrigatório):':'Observação da aprovação (opcional):','');
     if(note===null)return;
     if(decision==='rejected'&&note.trim().length<3){message('Recusa exige justificativa de pelo menos 3 caracteres.',true);return;}
     if(!confirm((decision==='approved'?'Aprovar':'Recusar')+' esta solicitação de reabertura?'))return;
     button.disabled=true;
     try{
      await api('/api/reopen-requests/'+item.id+'/decide'+qs(),{
       method:'POST',body:JSON.stringify({decision,note:note.trim()})
      });
      await loadCentral();await refreshProjects();message('Decisão registrada na Central.');
     }catch(e){message(e.message,true);button.disabled=false}
    });
    actions.append(button);
   }
  }else actions.textContent='Consulta';
  rows.push(['Reabertura de tarefa',item.task_title||'Tarefa',item.project_name||'Projeto',status,
   item.reason+(item.decision_note?' | Decisão: '+item.decision_note:''),new Date(item.created_at).toLocaleString('pt-BR'),actions]);
 }
 if(allowedProject&&['all','pending'].includes(filter))for(const item of centralData.projects||[]){
  const action=makeAction(state.role==='admin'?'Analisar validação':'Ver validação',()=>{
   const p=state.projects.find(x=>x.id===item.id)||{id:item.id,name:item.name};
   showApproval(p).catch(e=>message(e.message,true));
  });
  rows.push(['Validação de projeto',item.name,item.name,'Pendente',item.completion_note||'—',
   item.completion_requested_at?new Date(item.completion_requested_at).toLocaleString('pt-BR'):'—',action]);
 }
 if(allowedProject)for(const item of centralData.project_history||[]){
  const itemStatus=({approved:'approved',rejected:'rejected',reopened:'reopened'})[item.action]||item.action;
  if(filter!=='all'&&filter!==itemStatus)continue;
  const labels={approved:'Aprovada',rejected:'Devolvida',reopened:'Reaberta'};
  const open=makeAction('Abrir projeto',async()=>{
   try{const p=state.projects.find(x=>x.id===item.project_id);if(!p)throw Error('Projeto indisponível.');await openProject(p)}
   catch(e){message(e.message,true)}
  });
  rows.push(['Decisão de projeto',item.project_name,item.project_name,labels[item.action]||item.action,
    item.note||'—',new Date(item.created_at).toLocaleString('pt-BR'),open]);
 }
 $('approvals-count').textContent=rows.length+' solicitação(ões)';
 renderTable('approvals-list',['Tipo','Tarefa/Projeto','Projeto','Situação','Justificativa','Solicitado em','Ação'],rows);
}
for(const key of ['approvals-type','approvals-status'])$(key).addEventListener('change',renderCentral);
$('approvals-refresh').addEventListener('click',()=>loadCentral().catch(e=>message(e.message,true)));
async function requestTaskReopen(task){
 if(!task||task.status!=='done'){message('Somente tarefas concluídas podem solicitar reabertura.',true);return;}
 const reason=prompt('Por que a tarefa precisa ser reaberta? (justificativa obrigatória)');
 if(reason===null)return;
 if(reason.trim().length<3){message('Informe uma justificativa com pelo menos 3 caracteres.',true);return;}
 try{
  await api('/api/tasks/'+task.id+'/reopen-requests'+qs(),{method:'POST',body:JSON.stringify({reason:reason.trim()})});
  message('Solicitação enviada à Central. O gestor responsável ou administrador será notificado.');
  if(state.view==='approvals')await loadCentral();
 }catch(e){message(e.message,true);}
}
async function refreshApprovalQueue(){
 const panel=$('approval-queue-panel');panel.hidden=true;return;
 /* antigo painel substituído pela Central
 panel.hidden=!['admin','manager'].includes(state.role);
 if(panel.hidden)return;
 try{
  const data=await api('/api/approvals/queue'+qs());
  $('approval-queue-count').textContent=data.projects.length+' aguardando decisão';
  const rows=data.projects.map(p=>{
   const button=makeAction('Conferir',()=>showApproval(state.projects.find(x=>x.id===p.id)||p));
   return [p.name,p.completion_note||'—',new Date(p.completion_requested_at).toLocaleString('pt-BR'),button];
  });
  renderTable('approval-queue-list',['Projeto','Observação','Solicitado em','Ação'],rows);
 }catch(e){message(e.message,true)}
 */
}
async function persistProjectCardOrder(){
 const container=$('projects-list');
 const ids=[...container.querySelectorAll(':scope > .project-card')].map(card=>card.dataset.projectId);
 const before=[...state.projects];
 const byId=new Map(before.map(p=>[p.id,p]));
 if(ids.length!==before.length||ids.some(id=>!byId.has(id)))return;
 state.projects=ids.map(id=>byId.get(id));
 try{
  await api('/api/projects/order'+qs(),{method:'PATCH',body:JSON.stringify({project_ids:ids})});
  renderProjects();
  message('Ordem dos projetos salva.');
 }catch(e){
  state.projects=before;renderProjects();message('Não foi possível salvar a ordem: '+e.message,true);
 }
}
function enableProjectCardReorder(card,handle){
 const container=$('projects-list');
 let drag=null;
 const cards=()=>[...container.querySelectorAll(':scope > .project-card')];
 const endDrag=(event,cancelled=false)=>{
  if(!drag||event.pointerId!==drag.id)return;
  const {initialOrder,started}=drag;
  drag=null;
  document.removeEventListener('pointermove',onMove,true);
  document.removeEventListener('pointerup',onUp,true);
  document.removeEventListener('pointercancel',onCancel,true);
  window.removeEventListener('blur',onBlur);
  card.classList.remove('is-reordering');
  document.body.classList.remove('project-reorder-active');
  if(cancelled){renderProjects();return;}
  if(!started)return;
  const finalOrder=cards().map(x=>x.dataset.projectId).join(',');
  if(finalOrder!==initialOrder)persistProjectCardOrder();
 };
 const onMove=event=>{
  if(!drag||event.pointerId!==drag.id)return;
  if(!drag.started&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
  drag.started=true;
  event.preventDefault();
  const others=cards().filter(x=>x!==card);
  const target=others.find(other=>{
   const b=other.getBoundingClientRect();
   return event.clientX>=b.left&&event.clientX<=b.right
      &&event.clientY>=b.top&&event.clientY<=b.bottom;
  });
  if(!target)return;
  const b=target.getBoundingClientRect();
  const current=card.getBoundingClientRect();
  const sameRow=Math.abs(b.top-current.top)<Math.min(b.height,current.height)*.5;
  const after=sameRow?event.clientX>b.left+b.width/2:event.clientY>b.top+b.height/2;
  if(after)target.after(card);else target.before(card);
 };
 const onUp=e=>endDrag(e);
 const onCancel=e=>endDrag(e,true);
 const onBlur=()=>{if(drag)endDrag({pointerId:drag.id},true);};
 const onDown=e=>{
  if(e.button!==0||drag)return;
  // Let action buttons and form controls keep their original click behavior.
  if(e.target.closest('button,a,input,select,textarea')&&e.target!==handle)return;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,started:false,initialOrder:cards().map(x=>x.dataset.projectId).join(',')};
  if(e.target===handle||e.pointerType==='touch')e.preventDefault();
  card.classList.add('is-reordering');
  document.body.classList.add('project-reorder-active');
  // Listeners belong to document, not the moving card: moving a captured
  // element inside the grid can otherwise discard pointer capture.
  document.addEventListener('pointermove',onMove,{capture:true,passive:false});
  document.addEventListener('pointerup',onUp,true);
  document.addEventListener('pointercancel',onCancel,true);
  window.addEventListener('blur',onBlur);
 };
 card.addEventListener('pointerdown',onDown);
 handle.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();
  const items=cards(),i=items.indexOf(card);
  const next=i+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1);
  if(next<0||next>=items.length)return;
  if(next<i)items[next].before(card);else items[next].after(card);
  persistProjectCardOrder();
 });
}
async function deleteCard(p){
 if(!canManageUI(p))return message('Você não tem permissão para excluir este card.',true);
 const kind=p.card_type==='production'?'Card de Produção':'card de projeto';
 const accepted=confirm('Excluir '+kind+' "'+p.name+'"?\\n\\nEle desaparecerá dos projetos e ficará indisponível para os participantes. O histórico será preservado.');
 if(!accepted)return;
 try{
  await api('/api/projects/'+encodeURIComponent(p.id)+qs(),{method:'DELETE'});
  if(state.project?.id===p.id){state.project=null;state.tasks=[];}
  await refreshProjects();
  show('projects');
  message('Card excluído. O histórico foi preservado.');
 }catch(e){message(e.message,true)}
}
const recentProjectControls={search:'',status:'all',order:'recent',limit:'6'};
function getRecentProjectInfo(p){
 const isProduction=p.card_type==='production';
 const target=Number(p.production_target)||0,done=Number(p.production_done)||0;
 const progress=isProduction&&target>0?Math.round(done/target*100):p.total?Math.round(p.done/p.total*100):0;
 const completed=p.completion_status==='completed'||(isProduction&&target>0&&done>=target);
 const productionLate=!!(isProduction&&!completed&&p.production_due_date&&String(p.production_due_date).slice(0,10)<todayInFortaleza());
 const overdue=Number(p.overdue_activities)||0;
 const label=completed?'Concluído':productionLate?'Produção atrasada':overdue?overdue+' atividade'+(overdue===1?' atrasada':'s atrasadas'):p.completion_status==='review'?'Aguardando validação':p.paused_at?'Em pausa':'Em andamento';
 const kind=completed?'complete':productionLate||overdue?'overdue':p.completion_status==='review'?'review':'active';
 return {isProduction,progress,label,kind,overdue,productionLate};
}
function renderRecentProjects(){
 const query=recentProjectControls.search.trim().toLocaleLowerCase('pt-BR');
 const filtered=state.projects.map((project,index)=>({project,index,info:getRecentProjectInfo(project)}))
  .filter(({project,info})=>(recentProjectControls.status==='all'||recentProjectControls.status===info.kind)
   &&(!query||(project.name+' '+(project.description||'')).toLocaleLowerCase('pt-BR').includes(query)));
 if(recentProjectControls.order==='urgent'){
  const order={overdue:0,review:1,active:2,complete:3};
  filtered.sort((a,b)=>order[a.info.kind]-order[b.info.kind]||b.info.overdue-a.info.overdue||a.index-b.index);
 }else if(recentProjectControls.order==='progress'){
  filtered.sort((a,b)=>b.info.progress-a.info.progress||a.index-b.index);
 }else if(recentProjectControls.order==='name'){
  filtered.sort((a,b)=>a.project.name.localeCompare(b.project.name,'pt-BR')||a.index-b.index);
 }
 const limit=recentProjectControls.limit==='all'?filtered.length:Number(recentProjectControls.limit)||6;
 const visible=filtered.slice(0,limit);
 $('recent-project-count').textContent=visible.length+' de '+filtered.length+' encontrado(s) · '+state.projects.length+' no total';
 if(!visible.length){
  $('overview-projects').textContent=state.projects.length?'Nenhum projeto corresponde aos filtros.':'Nenhum projeto cadastrado.';
  return;
 }
 const rows=visible.map(({project:p,info})=>{
  const name=makeAction(p.name,()=>openProject(p));name.classList.add('recent-project-link');
  const title=document.createElement('div');title.className='recent-project-title';
  const status=document.createElement('span');status.className='recent-project-status recent-project-status-'+info.kind;
  status.textContent=info.label;title.append(name,status);
  const progressCell=document.createElement('span');progressCell.className='recent-project-progress'+(info.kind==='complete'?' is-complete':info.kind==='overdue'?' is-overdue':'');
  progressCell.textContent=Math.max(0,Math.min(100,info.progress))+'%';
  return [title,p.description||'—',info.isProduction?'Meta '+prodFmt(p.production_target):String(p.total),progressCell];
 });
 renderTable('overview-projects',['Projeto','Descrição','Tarefas / Meta','Progresso'],rows);
}
for(const [id,key] of [['recent-project-search','search'],['recent-project-status-filter','status'],['recent-project-order','order'],['recent-project-limit','limit']]){
 const element=$(id);
 element.addEventListener(key==='search'?'input':'change',()=>{
  recentProjectControls[key]=element.value;
  renderRecentProjects();
 });
}
$('recent-project-clear').addEventListener('click',()=>{
 Object.assign(recentProjectControls,{search:'',status:'all',order:'recent',limit:'6'});
 for(const [id,key] of [['recent-project-search','search'],['recent-project-status-filter','status'],['recent-project-order','order'],['recent-project-limit','limit']])$(id).value=recentProjectControls[key];
 renderRecentProjects();
});
function renderProjects(){
 renderRecentProjects();
 const projectsContainer=$('projects-list'),productionsContainer=$('productions-list');
 projectsContainer.replaceChildren();productionsContainer.replaceChildren();
 const empty=$('guest-projects-empty');
 if(empty)empty.hidden=state.role!=='guest'||state.projects.length>0;
 const heading=$('projects-heading');if(heading)heading.textContent='Projetos e Produções';
 const help=$('projects-help');if(help)help.hidden=state.role==='guest';
 $('projects-invite').hidden=state.role!=='admin';
 $('new-project').hidden=!['admin','manager'].includes(state.role);
 $('new-production').hidden=!['admin','manager'].includes(state.role);
 const allowed=['blue','violet','green','orange','pink','teal','slate','indigo','coral','gold','mint','charcoal'];
 for(const p of state.projects){
  const isProduction=p.card_type==='production';
  const container=isProduction?productionsContainer:projectsContainer;
  const card=document.createElement('article');card.className='project-card color-'+(allowed.includes(p.card_color)?p.card_color:'blue');
  card.dataset.projectId=p.id;
  const cover=document.createElement('div');cover.className='project-card-cover';
  const handle=document.createElement('button');handle.type='button';handle.className='project-drag-handle';
  handle.textContent='⠿';handle.title='Arrastar para reordenar este projeto';
  handle.setAttribute('aria-label','Mover projeto '+p.name+'. Arraste ou use setas para mudar a ordem.');
  const cardKind=document.createElement('span');cardKind.className='project-card-kind';
  cardKind.textContent=isProduction?'⚙ PRODUÇÃO':'▣ PROJETO';
  cover.prepend(cardKind);cover.append(handle);
  const title=document.createElement('h3');title.textContent=p.name;
  const description=document.createElement('p');
  description.textContent=p.description||(isProduction?'Descrição da produção não informada.':'Sem descrição');
  if(isProduction)description.classList.add('production-card-description');
  const tags=document.createElement('div');tags.className='project-card-tags';
  const percent=p.card_type==='production'&&Number(p.production_target)>0?Math.round(Number(p.production_done)/Number(p.production_target)*100):p.total?Math.round(p.done/p.total*100):0;
  for(const label of [p.card_type==='production'?'Produção · Meta '+prodFmt(p.production_target):p.total+' tarefas',percent+'% concluído',(p.completion_status==='completed'?'Concluído':p.completion_status==='review'?'Aguardando validação':p.paused_at?'Em pausa':'Ativo'),p.access_mode==='restricted'?'Acesso restrito':'Equipe da organização']){
   const span=document.createElement('span');span.textContent=label;tags.append(span);
  }
  const progress=document.createElement('div');progress.className='project-card-progress';
  const bar=document.createElement('span');bar.style.width=percent+'%';progress.append(bar);
  const owner=document.createElement('small');owner.textContent='Responsável: '+memberName(p.manager_subject||p.owner_subject);
  const teamInfo=document.createElement('small');
  if(isProduction){
   const qty=Number(p.production_team_count||0),target=Number(p.production_target||0),done=Number(p.production_done||0);
   teamInfo.textContent='Equipe: '+qty+' funcionário(s) · Prazo: '+(p.production_due_date?String(p.production_due_date).slice(0,10).split('-').reverse().join('/'):'não definido')+
    ' · Meta: '+prodFmt(target)+' '+(p.production_unit||'un.')+' · Falta: '+prodFmt(Math.max(0,target-done));
  }
  const actions=document.createElement('div');actions.className='project-card-actions';
  const open=makeAction(p.card_type==='production'?'Abrir produção':'Abrir projeto',()=>openProject(p));open.classList.add('project-card-open');
  actions.append(open);
  if(canManageUI(p)){
   const edit=makeAction('Personalizar',()=>modal('project-edit',p));
   actions.append(edit);
   if(isProduction){
    const teamButton=makeAction('Equipe',async()=>{try{await openProject(p);setProductionTab('team')}catch(e){message(e.message,true)}});
    actions.append(teamButton);
   }
   const erase=makeAction('Excluir',()=>deleteCard(p));
   erase.classList.add('project-card-delete');
   erase.setAttribute('aria-label','Excluir card '+p.name);
   actions.append(erase);
   if(state.role==='admin'&&!isProduction){
    const invite=makeAction('Convidar',async()=>{try{await loadMembers();await loadInvitations();show('team');$('invite-email').focus();}catch(e){message(e.message,true)}});
    actions.append(invite);
   }
  }
  const validation=makeAction(p.completion_status==='review'?'Aguardando validação':p.completion_status==='completed'?'Conferir encerramento':'Checklist de conclusão',async()=>{try{await loadCentral();show('approvals')}catch(e){message(e.message,true)}});
  validation.hidden=!canManageUI(p)||!['review','completed'].includes(p.completion_status);
  validation.classList.add('project-validation-link');
  card.append(cover,title,description,owner);
  if(isProduction)card.append(teamInfo);
  card.append(tags,progress,validation,actions);container.append(card);
  handle.hidden=state.role==='guest';
  if(state.role!=='guest')enableProjectCardReorder(card,handle);
 }
 const add=document.createElement('button');add.type='button';add.className='project-card-add';add.hidden=!['admin','manager'].includes(state.role);add.disabled=add.hidden;
 add.textContent='+ Criar novo projeto';add.onclick=()=>modal('project');projectsContainer.append(add);
 const newProduction=document.createElement('button');newProduction.type='button';
 newProduction.className='project-card-add production-card-add';
 newProduction.hidden=!['admin','manager'].includes(state.role);
 newProduction.textContent='+ Criar nova produção';
 newProduction.onclick=()=>{$('new-production').click();$('production-create-form').scrollIntoView({behavior:'smooth',block:'center'});};
 productionsContainer.append(newProduction);
 if(!state.projects.some(p=>p.card_type==='production')){
  const empty=document.createElement('p');empty.className='muted';empty.textContent='Nenhuma produção cadastrada. Crie um card para definir meta, prazo e equipe.';productionsContainer.prepend(empty);
 }
 $('stat-projects').textContent=state.projects.length;
}
function memberName(subject){
 if(!subject)return 'Sem responsável';
 const member=state.members.find(m=>m.auth_subject===subject);
 const name=String(member?.display_name||'').trim();
 const email=String(member?.email||'').trim();
 if(name)return name;
 if(email)return email;
 if(subject===state.subject)return String(state.accountName||'').trim()||'Minha conta';
 return 'Identificação pendente';
}
async function loadMembers(){
 const data=await api('/api/members'+qs());state.members=data.members;
 const projectOwner=$('project-owner');projectOwner.replaceChildren();
 const managerSelect=$('project-manager');managerSelect.replaceChildren();
 const productionManager=$('production-create-manager');productionManager.replaceChildren();
 const ownOption=document.createElement('option');ownOption.value=state.subject;ownOption.textContent='Eu (responsável)';
 productionManager.append(ownOption);
 if(state.role==='admin')for(const m of state.members.filter(m=>m.active&&['admin','manager'].includes(m.role)&&m.auth_subject!==state.subject)){
  const opt=document.createElement('option');opt.value=m.auth_subject;opt.textContent=memberName(m.auth_subject);productionManager.append(opt);
 }
 const noManager=document.createElement('option');noManager.value='';noManager.textContent='Sem gestor designado';managerSelect.append(noManager);
 for(const manager of state.members.filter(m=>m.active&&m.role==='manager')){const option=document.createElement('option');option.value=manager.auth_subject;option.textContent=memberName(manager.auth_subject);managerSelect.append(option);}
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
  const identity=document.createElement('div');
  const name=document.createElement('strong');name.textContent=memberName(m.auth_subject);
  identity.append(name);
  if(m.email){const address=document.createElement('small');address.textContent=m.email;address.style.display='block';identity.append(address);}
  return [identity,roleNames[m.role]||m.role,m.active?'Ativo':'Desativado',action];
 });
 renderTable('members-list',['Integrante','Perfil','Situação','Gerenciar'],rows);
}
function showInvitationDelivery(data,email,role){
 $('invite-link').value=data.invite_url;
 $('invite-result').hidden=false;
 const statuses={
  sent:'O Resend aceitou o e-mail para envio. A entrega na caixa de entrada ainda não foi confirmada.',
  failed:'Convite criado, mas o serviço de e-mail recusou ou não concluiu o envio. Copie o link ou envie pelo seu aplicativo de e-mail.',
  not_configured:'Convite criado. O envio automático ainda não está habilitado neste ambiente; compartilhe o link manualmente.'
 };
 const status=data.email_status||'not_configured';
 $('invite-delivery-status').textContent=statuses[status]||'Convite criado. Utilize o link manual caso necessário.';
 $('invite-delivery-status').dataset.delivery=status;
 $('invite-mail').href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent('Convite para AnnA Nexus')+
  '&body='+encodeURIComponent('Você foi convidado para colaborar na AnnA Nexus. Entre com sua conta do Portal AnnA One usando o mesmo e-mail e acesse o convite válido por 7 dias:\n\n'+data.invite_url+'\n\nO acesso será liberado após aceitar o convite.');
}
async function loadInvitations(){
 const admin=state.role==='admin';
 $('invite-admin').hidden=!admin;$('invite-history-panel').hidden=!admin;
 if(!admin)return;
 $('invite-list').textContent='Carregando convites…';
 try{
  const [data,config]=await Promise.all([
   api('/api/invitations'+qs()),api('/api/invitations/config'+qs())
  ]);
  $('invite-provider-status').textContent=config.email_enabled
   ?'Envio automático pelo Resend habilitado. O resultado da tentativa aparecerá após gerar o convite.'
   :'Envio automático indisponível neste ambiente: o link manual continuará funcionando.';
  const rows=data.invitations.map(invite=>{
   const expired=invite.status==='pending'&&Date.parse(invite.expires_at)<=Date.now();
   const status=invite.status==='accepted'?'Aceito':invite.status==='cancelled'?'Cancelado':expired?'Expirado':'Pendente';
   const role=({admin:'Administrador',manager:'Gestor',member:'Membro',guest:'Convidado'})[invite.role]||invite.role;
   let action='—',controls=null;
   if(invite.status==='pending'&&!expired){
    controls=document.createElement('div');controls.className='invite-row-actions';
    const resend=makeAction('Reenviar e-mail',async()=>{
     if(!confirm('Reemitir este convite? O link anterior será invalidado e um novo link será criado.'))return;
     resend.disabled=true;
     try{
      const response=await api('/api/invitations/'+invite.id+'/resend'+qs(),{method:'POST',body:'{}'});
      showInvitationDelivery(response,invite.email,invite.role);
      message(response.email_status==='sent'?'Novo convite aceito pelo Resend. Link anterior invalidado.':'Novo link criado. O envio não foi confirmado; compartilhe o novo link manualmente.');
      await loadInvitations();
     }catch(e){message(e.message,true);resend.disabled=false}
    });
    resend.disabled=Number(invite.email_attempts||0)>=5;
    controls.append(resend);
    action=makeAction('Cancelar',async()=>{
     if(!confirm('Cancelar este convite?'))return;
     action.disabled=true;
     try{await api('/api/invitations/'+invite.id+'/cancel'+qs(),{method:'POST'});message('Convite cancelado.');await loadInvitations()}
     catch(e){message(e.message,true);action.disabled=false}
    });
   }
   const delivery=({sent:'Aceito pelo Resend',failed:'Falha no envio',not_configured:'Envio não configurado',manual:'Link manual'})[invite.email_status]||'Não informado';
   const result=invite.email_status==='failed'&&invite.email_error?delivery+' ('+invite.email_error+')':delivery;
   if(controls){controls.append(action);action=controls;}
   return [invite.email,role,status,result,new Date(invite.expires_at).toLocaleDateString('pt-BR'),action];
  });
  renderTable('invite-list',['E-mail','Perfil','Situação','E-mail enviado','Validade','Ação'],rows);
 }catch(e){$('invite-list').textContent='Erro ao consultar convites: '+e.message;}
}
async function redeemInvitation(){
 const token=invitationToken();
 if(!token)return null;
 // Preserve the invitation link on validation errors so the recipient can
 // authenticate with the correct verified account without asking for a new link.
 const result=await api('/api/invitations/accept',{method:'POST',body:JSON.stringify({token})});
 history.replaceState(null,'',location.pathname+location.search);
 state.inviteOrg=result.organization_id||null;
 if(result.project_id)state.pendingCard=result.project_id;
 return result;
}
function setInviteAuthMode(registration=false){
 $('signin-form').hidden=registration;
 $('signup-form').hidden=!registration;
 $('signin-switch-mode').textContent=registration?'Já tenho conta: entrar':'Primeiro acesso: criar senha';
 $('signin-title').textContent=registration?'Primeiro acesso — criar senha':'Entrar no AnnA Nexus';
 $('signin-feedback').textContent='';
 $('signin-recovery').hidden=registration;
 if(registration&&$('signin-email').value.trim())$('signup-email').value=$('signin-email').value.trim();
 if(!registration&&$('signup-email').value.trim())$('signin-email').value=$('signup-email').value.trim();
}
function showInviteSignin(messageText=''){
 const invite=!!invitationToken();
 $('invitation-intro').hidden=!invite;
 $('invitation-change-account').hidden=!invite||!state.subject;
 $('signin-description').textContent=invite
  ?'Seu link individual foi reconhecido. Crie uma senha para começar ou entre se já possui conta AnnA One.'
  :'Use sua conta do Portal AnnA One para acessar seus projetos.';
 // Invite links default to registration. Existing account holders may switch
 // to the normal sign-in form without ever losing the invitation fragment.
 if(invite&&!state.subject&&!messageText)setInviteAuthMode(true);
 $('signin').hidden=false;
 if(messageText)$('signin-feedback').textContent=messageText;
}
$('signin-switch-mode').addEventListener('click',()=>setInviteAuthMode($('signup-form').hidden));
$('invitation-change-account').addEventListener('click',async()=>{
 try{
  if(!state.auth)return;
  await state.auth.signOut();
  state.jwt=null;state.subject=null;state.org=null;
  $('signin-password').value='';
  $('invitation-change-account').hidden=true;
  setInviteAuthMode(false);
  showInviteSignin('Entre com a conta que utiliza o mesmo e-mail do convite.');
  message('Sessão anterior encerrada. Entre com a conta convidada.');
 }catch(error){message('Não foi possível trocar a conta. Atualize a página e tente novamente.',true)}
});
$('signup-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const button=$('signup-button'),name=$('signup-name').value.trim(),
  email=$('signup-email').value.trim().toLowerCase(),
  password=$('signup-password').value;
 if(!name){$('signin-feedback').textContent='Informe seu nome.';return;}
 if($('signup-email').readOnly&&!email){$('signin-feedback').textContent='Não foi possível identificar o destinatário do convite.';return;}
 if(password!==$('signup-confirm').value){$('signin-feedback').textContent='As senhas não coincidem.';return;}
 button.disabled=true;
 $('signin-feedback').textContent='Criando seu acesso AnnA One…';
 try{
  if(!state.auth)throw Error('Autenticação indisponível.');
  if(!invitationToken())throw Error('Este link de convite não está disponível. Abra o convite recebido por e-mail.');
  const result=await state.auth.signUp.email({name,email,password});
  if(result?.error)throw result.error;
  // A normal Neon Auth sign-up can immediately create a session. If it does
  // not, sign in with the newly chosen password without storing it anywhere.
  let session=await state.auth.getSession();
  let account=session?.data?.user||session?.data?.session?.user;
  if(!account){
   const signed=await state.auth.signIn.email({email,password});
   if(signed?.error)throw signed.error;
   session=await state.auth.getSession();
   account=session?.data?.user||session?.data?.session?.user;
  }
  $('signup-password').value='';$('signup-confirm').value='';
  if(!account){
   setInviteAuthMode(false);
   $('signin-email').value=email;
   $('signin-feedback').textContent='Sua conta foi criada. Entre com a senha que acabou de definir para concluir o convite.';
   return;
  }
  $('signin-feedback').textContent='Conta criada! Concluindo o aceite do convite…';
  await boot();
 }catch(error){
  const code=String(error?.code||'').toUpperCase(),reason=String(error?.message||'').toLowerCase();
  const existing=code.includes('EXIST')||reason.includes('already')||reason.includes('exist')||reason.includes('registered');
  $('signin-feedback').textContent=existing
   ?'Este e-mail já possui uma conta AnnA One. Escolha “Já tenho conta: entrar”. Se não possui senha, utilize “Recuperar senha”.'
   :'Não foi possível concluir o cadastro. Confira os dados e tente novamente. Se já possui conta AnnA One, selecione “Já tenho conta: entrar”.';
 }finally{button.disabled=false;}
});

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
 if($('brand-file').files.length)$('brand-default-logo').checked=false;
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
 $('dash-org-name').textContent=display||org?.name||'Organização';
 const dashboardLogo=$('dash-company-logo');
 dashboardLogo.hidden=!org?.logo_url;
 if(org?.logo_url){dashboardLogo.src=org.logo_url;dashboardLogo.onerror=()=>{dashboardLogo.hidden=true};}
 else dashboardLogo.removeAttribute('src');
 $('brand-name').value=display;
 $('brand-logo').value=org?.logo_url?.startsWith('https://')?org.logo_url:'';
 $('brand-default-logo').checked=!org?.logo_url;
 $('brand-admin').hidden=state.role!=='admin';
 const logo=$('client-logo'),defaultLogo=$('default-banner-symbol');
 logo.hidden=!org?.logo_url;defaultLogo.hidden=!!org?.logo_url;
 if(org?.logo_url){logo.src=org.logo_url;logo.onerror=()=>{logo.hidden=true;defaultLogo.hidden=false};}
 else logo.removeAttribute('src');
}
$('brand-default-logo').addEventListener('change',()=>{
 if($('brand-default-logo').checked){logoUploadData=null;$('brand-file').value='';$('brand-logo').value='';$('brand-file-info').textContent='Será usada a imagem padrão AnnA One.';}
});
$('brand-logo').addEventListener('input',()=>{if($('brand-logo').value.trim())$('brand-default-logo').checked=false;});
$('brand-reset').addEventListener('click',async()=>{
 if(!confirm('Redefinir a identidade do cliente? O nome personalizado e o logotipo serão removidos, mantendo a imagem padrão AnnA One.'))return;
 const button=$('brand-reset');
 button.disabled=true;
 try{
  const data=await api('/api/organization'+qs(),{
   method:'PATCH',
   body:JSON.stringify({display_name:'',logo_url:''})
  });
  const i=state.organizations.findIndex(o=>o.id===state.org);
  if(i!==-1)state.organizations[i]={...state.organizations[i],...data.organization};
  logoUploadData=null;
  $('brand-file').value='';
  $('brand-file-info').textContent='';
  renderBrand();
  message('Identidade redefinida para o padrão AnnA One.');
 }catch(error){message('Não foi possível redefinir a identidade: '+error.message,true);}
 finally{button.disabled=false;}
});
$('brand-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('brand-save');button.disabled=true;
 try{
  const org=state.organizations.find(o=>o.id===state.org);
  const urlInput=$('brand-logo').value.trim();
  const logo_url=$('brand-default-logo').checked?'':(logoUploadData||urlInput||(org?.logo_url?.startsWith('data:image/')?org.logo_url:''));
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
let notificationInbox=[];
function classifyNotification(n){
 const event=String(n.event_type||'');
 if(event.includes('mention'))return 'mentions';
 if(event.includes('overdue')||event.includes('due_soon'))return 'deadlines';
 if(event.includes('review')||event.includes('approval')||event.includes('completion')||event.includes('reopen'))return 'approvals';
 return 'assignments';
}
function renderNotificationInbox(){
 const filter=$('notification-filter').value;
 const visible=notificationInbox.filter(n=>filter==='all'||(filter==='unread'?!n.read_at:classifyNotification(n)===filter));
 $('notification-filter-count').textContent=visible.length+' aviso(s)';
 const rows=visible.map(n=>{
  const status=n.read_at?'Lida':'Nova';
  const actions=document.createElement('div');actions.className='notification-actions';
  if(!n.read_at)actions.append(makeAction('Marcar lida',async()=>{
   try{await api('/api/notifications/'+n.id+'/read'+qs(),{method:'POST'});await loadNotifications()}catch(e){message(e.message,true)}
  }));
  if(n.project_id&&(/^(task.reopen|project.review|project.completion)/.test(n.event_type))&&state.role!=='guest')actions.append(makeAction('Ver solicitação',async()=>{try{await loadCentral();show('approvals');await api('/api/notifications/'+n.id+'/read'+qs(),{method:'POST'});await loadNotifications();}catch(e){message(e.message,true)}}));
  if(n.project_id&&!/^(task.reopen|project.review|project.completion)/.test(n.event_type))actions.append(makeAction(n.task_id&&state.role!=='guest'?'Abrir tarefa':'Abrir projeto',async()=>{
   try{
    const p=state.projects.find(x=>x.id===n.project_id);
    if(!p)throw Error('Projeto indisponível.');
    if(n.task_id&&state.role!=='guest'){
     const task=await openTaskFromList({project_id:n.project_id,id:n.task_id});
     if(!task)throw Error('Tarefa indisponível.');
     modal('edit',task);
    }else await openProject(p);
    await api('/api/notifications/'+n.id+'/read'+qs(),{method:'POST'});
    await loadNotifications();
   }catch(e){message(e.message,true)}
  }));
  return [n.title,n.details||'—',new Date(n.created_at).toLocaleString('pt-BR'),status,actions];
 });
 renderTable('notifications-list',['Notificação','Detalhes','Quando','Situação','Ações'],rows);
}
async function loadNotifications(){
 const data=await api('/api/notifications'+qs());notificationInbox=data.notifications;
 const counter=$('notification-count');counter.hidden=!data.unread;counter.textContent=data.unread>99?'99+':String(data.unread);
 const headerCount=$('notify-header-count');headerCount.hidden=!data.unread;headerCount.textContent=data.unread>99?'99+':String(data.unread);
 renderNotificationInbox();
}
async function loadNotificationPreferences(){
 const data=await api('/api/notification-preferences'+qs());
 for(const key of ['assignments','mentions','deadlines','approvals'])$('pref-'+key).checked=!!data.preferences[key];
 const checkbox=$('pref-email');
 checkbox.checked=!!data.preferences.email_enabled;
 checkbox.disabled=!data.can_enable_email;
 $('pref-email-note').textContent=!data.email_available
  ?'E-mail externo ainda não está configurado. Os avisos internos continuam funcionando.'
  :data.can_enable_email?'Se ativado, avisos novos e não lidos poderão ser enviados ao e-mail verificado da conta.'
  :'Para habilitar e-mail, a conta precisa apresentar um endereço verificado no login.';
}
// Atualiza discretamente os contadores e a caixa aberta durante o uso do Nexus.
// Não dispara requisições quando a página está oculta ou sem sessão.
setInterval(()=>{
 if(!document.hidden&&state.jwt&&state.org&&!$('app').hidden)
  loadNotifications().catch(()=>{});
},90000);
$('notification-filter').addEventListener('change',renderNotificationInbox);
$('pref-save').addEventListener('click',async()=>{
 const button=$('pref-save');button.disabled=true;
 try{
  const body={};for(const key of ['assignments','mentions','deadlines','approvals'])body[key]=$('pref-'+key).checked;
  if(!$('pref-email').disabled)body.email_enabled=$('pref-email').checked;
  await api('/api/notification-preferences'+qs(),{method:'PATCH',body:JSON.stringify(body)});
  message('Preferências de notificações salvas para esta organização.');
 }catch(e){message(e.message,true)}finally{button.disabled=false;}
});
$('notify-header').addEventListener('click',async()=>{try{await loadNotifications();await loadNotificationPreferences();show('notifications')}catch(e){message(e.message,true)}});
$('notify-read-all').addEventListener('click',async()=>{
 try{await api('/api/notifications/read-all'+qs(),{method:'POST'});await loadNotifications();message('Notificações marcadas como lidas.')}
 catch(e){message(e.message,true)}
});
let calendarItems=[],calendarCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1),calendarSelectedDay=null,calendarEditorReturn=false,calendarFilter='all';
const calendarDay=item=>String(item.due_at||'').slice(0,10);
$('dialog').addEventListener('close',()=>{calendarEditorReturn=false;});
const calendarTodayKey=()=>todayInFortaleza();
const calendarStatus=item=>{
 if(item.status==='done')return 'Concluída';
 const day=calendarDay(item),today=calendarTodayKey();
 if(day<today)return 'Atrasada';
 const soon=new Date(today+'T12:00:00Z');soon.setUTCDate(soon.getUTCDate()+3);
 if(day<=soon.toISOString().slice(0,10))return 'Próxima do prazo';
 return item.status==='doing'?'Em andamento':'A fazer';
};
async function openCalendarItem(item){
 try{
  const project=state.projects.find(p=>p.id===item.project_id);
  if(!project)throw Error('Projeto não disponível.');
  if(state.role==='guest'){await openProject(project);return;}
  const taskId=item.kind==='subtask'?item.task_id:item.id;
  if(!taskId)throw Error('Tarefa principal não encontrada.');
  const task=await openTaskFromList({id:taskId,project_id:item.project_id});
  if(!task)throw Error('Tarefa não disponível.');
  calendarEditorReturn=true;
  show('calendar');
  modal('edit',task);
 }catch(e){message(e.message,true)}
}

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
 const monthItems=calendarItems.filter(x=>calendarDay(x).startsWith(monthPrefix));
 const monthly=monthItems.filter(item=>calendarFilter==='all'||(calendarFilter==='done'&&item.status==='done')||(calendarFilter==='pending'&&item.status!=='done')||(calendarFilter==='overdue'&&calendarStatus(item)==='Atrasada'));
 $('calendar-filter-count').textContent=monthly.length+' de '+monthItems.length+' entrega(s) no mês';
 const grouped=new Map();
 for(const item of monthly){const day=calendarDay(item);if(!grouped.has(day))grouped.set(day,[]);grouped.get(day).push(item);}
 const today=new Date(),todayKey=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
 for(let day=1;day<=days;day++){
  const key=monthPrefix+String(day).padStart(2,'0');
  const card=document.createElement('button');card.type='button';card.className='calendar-day';
  if(key===todayKey)card.classList.add('is-today');
  if(key===calendarSelectedDay)card.classList.add('is-selected');
  card.setAttribute('aria-label','Ver entregas do dia '+String(day).padStart(2,'0')+'/'+String(month+1).padStart(2,'0')+'/'+year);
  card.setAttribute('aria-pressed',String(key===calendarSelectedDay));
  card.addEventListener('click',()=>{calendarSelectedDay=calendarSelectedDay===key?null:key;drawCalendar();});
  const number=document.createElement('strong');number.textContent=String(day);card.append(number);
  const items=grouped.get(key)||[];
  if(items.length){
   const count=document.createElement('span');count.className='calendar-day-count';
   count.textContent=items.length+' entrega'+(items.length===1?'':'s');card.append(count);
   if(items.some(x=>calendarStatus(x)==='Atrasada'))card.classList.add('is-overdue');
   else if(items.some(x=>calendarStatus(x)==='Próxima do prazo'))card.classList.add('is-due-soon');
   const hints=document.createElement('div');hints.className='calendar-hints';
   for(const item of items.slice(0,2)){const hint=document.createElement('span');hint.className='calendar-hint';hint.title=item.title+' — '+calendarStatus(item);hint.textContent=item.title;
    if(item.status==='done')hint.classList.add('is-complete');
    if(calendarStatus(item)==='Atrasada')hint.classList.add('is-overdue');
    hints.append(hint);}
   card.append(hints);
  }
  grid.append(card);
 }
 const selection=$('calendar-selection');
 const shown=calendarSelectedDay?monthly.filter(x=>calendarDay(x)===calendarSelectedDay):monthly;
 selection.hidden=!calendarSelectedDay;
 if(calendarSelectedDay){
  $('calendar-selection-label').textContent=shown.length+' entrega(s) em '+calendarSelectedDay.split('-').reverse().join('/');
 }
 const rows=shown.sort((a,b)=>calendarDay(a).localeCompare(calendarDay(b))).map(item=>{
  const actions=document.createElement('div');actions.className='calendar-activity-action';
  const open=makeAction(state.role==='guest'?'Ver projeto':'Abrir / editar',()=>openCalendarItem(item));
  actions.append(open);
  const status=calendarStatus(item),date=document.createElement('span');
  date.textContent=calendarDay(item).split('-').reverse().join('/');
  if(status==='Atrasada')date.className='calendar-date-overdue';
  if(status==='Próxima do prazo')date.className='calendar-date-soon';
  return [date,item.title,item.project_name,item.kind==='subtask'?'Subtarefa':'Tarefa',status,actions];
 });
 renderTable('calendar-list',['Prazo','Atividade','Projeto','Tipo','Situação','Ação'],rows);
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
$('calendar-filter').addEventListener('change',event=>{calendarFilter=event.target.value;drawCalendar();});
$('calendar-prev').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);calendarSelectedDay=null;drawCalendar();});
$('calendar-next').addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);calendarSelectedDay=null;drawCalendar();});
$('calendar-today').addEventListener('click',()=>{const now=new Date();calendarCursor=new Date(now.getFullYear(),now.getMonth(),1);calendarSelectedDay=null;drawCalendar();});
$('calendar-clear-day').addEventListener('click',()=>{calendarSelectedDay=null;drawCalendar();});
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
  const project=state.projects.find(p=>p.id===task.project_id),planner=canManageUI(project);
  const actions=[['Abrir','open']];
  if(task.status==='done'&&!task.archived_at)actions.push(['Solicitar reabertura','reopen']);
  else if(!task.archived_at){
   actions.push([planner?'Editar':'Atualizar execução','edit']);
   actions.push([task.paused_at?'Retomar':'Pausar',task.paused_at?'resume':'pause']);
  }
  if(planner)actions.push([task.archived_at?'Restaurar':'Arquivar',task.archived_at?'restore':'archive']);
  if(state.role==='admin')actions.push(['Excluir','delete']);
  for(const [label,key] of actions){
   const btn=makeAction(label,async()=>{
    btn.disabled=true;try{if(key==='open')await openTaskFromList(task);else if(key==='reopen')await requestTaskReopen(task);else await taskAction(task,key);}catch(e){message(e.message,true)}finally{btn.disabled=false}
   });
   if(key==='delete'&&state.role!=='admin')btn.disabled=true;
   if(task.archived_at&&['edit','pause','resume','archive'].includes(key))btn.disabled=true;
   if(task.paused_at&&key==='archive')btn.title='Arquivar encerra a pausa atual';

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
async function loadAutomationMonitor(){
 const panel=$('automation-admin');panel.hidden=state.role!=='admin';
 if(panel.hidden)return;
 try{
  const [jobs,mail]=await Promise.all([
   api('/api/automation/runs'+qs()),
   api('/api/automation/email-deliveries'+qs())
  ]);
  const rows=jobs.runs.map(r=>[
   new Date(String(r.local_day).slice(0,10)+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'UTC'}),
   r.trigger_type==='scheduled'?'Agendada (serviço ativo)':'Manual',
   ({completed:'Concluída',failed:'Falhou',running:'Em andamento'})[r.status]||r.status,
   String(r.tasks_created),String(r.subtasks_created),
   r.error_message||'—'
  ]);
  renderTable('automation-runs',['Dia','Tipo','Situação','Tarefas','Subtarefas','Observação'],rows);
  $('email-delivery-status').textContent=mail.configured
   ?'Envio via Resend configurado. Registros abaixo representam aceite ou falha na API, não entrega confirmada na caixa de entrada.'
   :'Envio externo desativado. Não há integração Resend ativa neste serviço.';
  renderTable('email-deliveries',['Tentativa','Situação','Retorno do provedor'],
   mail.deliveries.map(x=>[
    new Date(x.attempted_at).toLocaleString('pt-BR'),
    x.status==='sent'?'Aceita pela API':'Falha',
    x.error_message||'—'
   ]));
 }catch(e){message('Não foi possível consultar o monitor: '+e.message,true)}
}
$('automation-refresh').addEventListener('click',()=>loadAutomationMonitor());
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
 const approvalRows=(data.approvals||[]).map(a=>[
  a.project_name,({requested:'Solicitada',approved:'Aprovada',rejected:'Devolvida',reopened:'Reaberta'})[a.action]||a.action,
  a.actor_subject===state.subject?'Você':memberName(a.actor_subject),a.note||'—',
  a.action==='requested'||a.action==='approved'?Object.values(a.checklist||{}).filter(Boolean).length+'/5 checks':'—',
  new Date(a.created_at).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})
 ]);
 renderTable('reports-approvals',['Projeto','Decisão','Responsável','Justificativa','Conferência','Data'],approvalRows);

 $('reports-summary').textContent='Relatório gerado em '+new Date(data.generated_at).toLocaleString('pt-BR')+'. O tempo total continua correndo durante as pausas.';
}
function exportReport(){
 if(!reportSnapshot)return;
 const data=reportSnapshot;
 const lines=[['Tipo','Projeto','Referência','Motivo ou situação','Início','Fim','Segundos em pendência','Pausas']];
 for(const p of data.projects)lines.push(['Projeto',p.project_name,p.project_id,p.project_paused_at?'Em pausa':'Ativo',p.project_created_at,'',p.project_pending_seconds,p.project_pauses]);
 for(const t of data.tasks)lines.push(['Tarefa',data.projects.find(p=>p.project_id===t.project_id)?.project_name||'',t.title,t.deleted_at?'Excluída':t.archived_at?'Arquivada':t.paused_at?'Pausada':t.status,t.created_at,'',t.pending_seconds,t.pauses]);
 for(const x of (data.subtasks||[]))lines.push(['Subtarefa',x.project_name,x.parent_title+' / '+x.title,x.status,x.created_at,'',0,0]);
 for(const a of (data.approvals||[]))lines.push(['Validação',a.project_name,a.action,a.note,a.created_at,'',Object.values(a.checklist||{}).filter(Boolean).length,'']);
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
 const formatDay=date=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part=name=>parts.find(p=>p.type===name)?.value||'';
  return part('year')+'-'+part('month')+'-'+part('day');
 };
 const daily=[];
 for(let i=period-1;i>=0;i--){
  const current=new Date(Date.now()-i*86400000),key=formatDay(current);
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
 $('dash-alerts').disabled=!['admin','manager'].includes(state.role);
}
$('dash-period').addEventListener('change',()=>loadDashboard().catch(e=>message(e.message,true)));
$('dash-project').addEventListener('change',()=>Promise.all([loadDashboard(),loadAttention()]).catch(e=>message(e.message,true)));
$('dash-refresh').addEventListener('click',()=>Promise.all([loadDashboard(),loadAttention()]).catch(e=>message(e.message,true)));
$('dash-export').addEventListener('click',dashboardCsv);
$('dash-wallboard').addEventListener('click',async()=>{
 const board=$('overview');
 try{
  if(document.fullscreenElement===board)await document.exitFullscreen();
  else if(board.requestFullscreen)await board.requestFullscreen();
  else{board.classList.toggle('dashboard-presentation');$('dash-wallboard').textContent=board.classList.contains('dashboard-presentation')?'Sair do telão':'Modo telão';}
 }catch(e){message('Seu navegador não permitiu o modo telão.',true)}
});
document.addEventListener('fullscreenchange',()=>{
 $('dash-wallboard').textContent=document.fullscreenElement===$('overview')?'Sair do telão':'Modo telão';
});

$('dash-alerts').addEventListener('click',async()=>{
 const button=$('dash-alerts');button.disabled=true;
 try{
  const result=await api('/api/automation/check-deadlines'+qs(),{method:'POST',body:'{}'});
  message(result.created?'Avisos criados: '+(result.tasks_created||0)+' de tarefas e '+(result.subtasks_created||0)+' de subtarefas.':'Nenhum novo aviso de prazo foi necessário.');
  await loadNotifications();
 }catch(e){message(e.message,true)}finally{button.disabled=!['admin','manager'].includes(state.role);}
});

async function refreshProjects(){
 const data=await api('/api/projects'+qs());state.projects=data.projects;state.role=data.role;applyRoleMenus();renderProjects();
 await refreshApprovalQueue();
 $('new-project').disabled=!['admin','manager'].includes(state.role);
 $('projects-invite').disabled=state.role!=='admin';
 try{await loadProductionDashboard()}catch(e){$('production-dashboard-panel').hidden=true;console.warn('Painel de produção indisponível:',e.message)}
 const selector=$('dash-project'),selected=selector.value;selector.replaceChildren();
 const any=document.createElement('option');any.value='';any.textContent='Todos os projetos';selector.append(any);
 for(const p of state.projects.filter(p=>state.role!=='manager'||canManageUI(p))){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;selector.append(option);}
 selector.value=state.projects.some(p=>p.id===selected)?selected:'';
 if(state.role!=='guest'){await loadDashboard();await loadAttention();}
 if(state.role==='member')await loadPersonalHome();
}
function readyForFinalReview(project,tasks){
 if(project.completion_status!=='active'||project.paused_at||!tasks.length)return false;
 return tasks.every(t=>t.status==='done'&&!t.paused_at
  &&!['blocked','waiting'].includes(t.treatment_status)
  &&Number(t.subtask_done||0)===Number(t.subtask_total||0));
}
async function manageBoardTask(task,act){
 if(!(canManageUI(state.project)&&['archive','restore'].includes(act)||state.role==='admin'&&act==='delete'))return;
 if(!confirm((act==='delete'?'Excluir logicamente':act==='archive'?'Arquivar':'Restaurar')+' a tarefa '+task.title+'?'))return;
 try{
  await api('/api/tasks/'+task.id+'/'+act+qs(),{method:'POST',body:'{}'});
  const project=state.project,wasOpen=!$('board-archived-panel').hidden;
  await openProject(project);
  await refreshProjects();
  if(wasOpen){$('board-archived-panel').hidden=false;await loadArchivedProjectTasks();}
  message(act==='delete'?'Tarefa excluída logicamente.':act==='archive'?'Tarefa arquivada.':'Tarefa restaurada.');
 }catch(e){message(e.message,true)}
}
async function loadArchivedProjectTasks(){
 if(!canManageUI(state.project))return;
 const result=await api('/api/projects/'+state.project.id+'/tasks/archived'+qs());
 const rows=result.tasks.map(t=>{
  const restore=makeAction('Restaurar',()=>manageBoardTask(t,'restore'));
  return [t.title,({todo:'A fazer',doing:'Em andamento',done:'Concluída'})[t.status]||t.status,
   t.archived_at?new Date(t.archived_at).toLocaleString('pt-BR'):'—',restore];
 });
 renderTable('board-archived-list',['Tarefa','Etapa','Arquivada em','Ação'],rows);
}
$('board-archived-toggle').addEventListener('click',async()=>{
 const panel=$('board-archived-panel');
 panel.hidden=!panel.hidden;
 if(!panel.hidden)try{await loadArchivedProjectTasks()}catch(e){message(e.message,true)}
});
$('board-archived-close').addEventListener('click',()=>{$('board-archived-panel').hidden=true});
async function openProject(p){
 state.project=p;
 $('board-archived-toggle').hidden=!canManageUI(p);
 $('board-archived-panel').hidden=true;
 $('board').classList.toggle('production-active',p.card_type==='production');
 $('production-panel').hidden=p.card_type!=='production';
 $('standard-card-team').hidden=p.card_type==='production'||!canManageUI(p);
 if(p.card_type==='production'){
  productionTab='operation';
  $('board-archived-toggle').hidden=true;$('new-task').hidden=true;
  $('project-validation').hidden=true;$('project-pause').hidden=true;
  $('board-description').textContent='Acompanhe a produção, metas e sua equipe.';
  show('board');await loadProduction();return;
 }
 const data=await api('/api/projects/'+encodeURIComponent(p.id)+'/tasks'+qs());
 state.tasks=data.tasks;$('board-description').textContent=p.description||'Quadro de tarefas do projeto.';
 $('project-pause').disabled=!canManageUI(p);
 $('project-pause').textContent=p.paused_at?'Retomar projeto':'Pausar projeto';
 $('project-pause-status').textContent=p.completion_status==='completed'?'Projeto concluído':p.completion_status==='review'?'Aguardando validação':p.paused_at?'Pausado por pendência':'Projeto ativo';
 const finalReview=readyForFinalReview(p,state.tasks);
 $('project-validation').hidden=!canManageUI(p)||!(finalReview||['review','completed'].includes(p.completion_status));
 $('project-validation').textContent=p.completion_status==='review'?'Ver validação':p.completion_status==='completed'?'Reabrir / histórico':'Conferir conclusão';
 $('project-validation').onclick=async()=>{try{await loadCentral();show('approvals')}catch(e){message(e.message,true)}};
 $('project-pause').disabled=p.completion_status!=='active'||!canManageUI(p);
 $('new-task').hidden=!canManageUI(p);
 $('new-task').disabled=p.completion_status!=='active'||!canManageUI(p);
 renderTasks();show('board');
 if(canManageUI(p))await loadStandardCardTeam();
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
let boardFiltersExpanded=false;
function setBoardFiltersExpanded(open){
 boardFiltersExpanded=!!open;
 $('board-filter-panel').hidden=!boardFiltersExpanded;
 $('toggle-board-filters').setAttribute('aria-expanded',String(boardFiltersExpanded));
 $('toggle-board-filters').textContent=boardFiltersExpanded?'Ocultar filtros':'Mostrar filtros';
}
$('toggle-board-filters').addEventListener('click',()=>setBoardFiltersExpanded(!boardFiltersExpanded));
setBoardFiltersExpanded(false);
function taskOrderFilterActive(){
 return ['filter-treatment','filter-priority','filter-label','filter-due'].some(id=>$(id).value!=='all')
  ||Boolean($('filter-search').value.trim());
}
function canReorderTasks(){
 return state.project?.completion_status==='active'&&!state.project.paused_at
  &&canManageUI(state.project)&&!taskOrderFilterActive();
}
async function persistTaskOrder(status,orderedIds){
 if(!canReorderTasks())throw Error('Retire os filtros ou reabra o projeto para ordenar as tarefas.');
 const source=state.tasks.filter(t=>t.status===status).map(t=>t.id);
 if(source.length!==orderedIds.length||new Set(orderedIds).size!==source.length
  ||orderedIds.some(id=>!source.includes(id)))throw Error('A lista foi alterada. Atualize o quadro.');
 const previous=state.tasks.slice(),queue=orderedIds.slice();
 const reordered=previous.map(t=>t.status===status?previous.find(x=>x.id===queue.shift()):t);
 state.tasks=reordered;
 try{
  await api('/api/projects/'+state.project.id+'/tasks/order'+qs(),{
   method:'PATCH',body:JSON.stringify({task_ids:reordered.map(t=>t.id)})
  });
  renderTasks();message('Ordem das tarefas salva.');
 }catch(error){state.tasks=previous;renderTasks();message(error.message,true);}
}
function enableTaskOrderHandle(card,handle,status){
 let drag=null;
 const board=$('board-columns'),list=card.parentElement;
 const order=()=>[...list.querySelectorAll(':scope > .task')].map(x=>x.dataset.taskId);
 const finish=(event,cancelled=false)=>{
  if(!drag||event.pointerId!==drag.id)return;
  const {original,started,targetStatus}=drag;
  drag=null;
  document.removeEventListener('pointermove',onMove,true);
  document.removeEventListener('pointerup',onUp,true);
  document.removeEventListener('pointercancel',onCancel,true);
  window.removeEventListener('blur',onBlur);
  card.classList.remove('is-reordering');
  board.querySelectorAll('.column').forEach(c=>c.classList.remove('is-drop-target'));
  card.draggable=!!card.dataset.canDrag;
  if(cancelled){renderTasks();return;}
  if(!started)return;
  if(targetStatus&&targetStatus!==status){
   moveTaskTo(card.dataset.taskId,targetStatus).catch(e=>{message(e.message,true);renderTasks();});
   return;
  }
  const ordered=order();
  if(ordered.join(',')!==original.join(',')){
   persistTaskOrder(status,ordered).catch(e=>{message(e.message,true);renderTasks();});
  }
 };
 const onMove=e=>{
  if(!drag||e.pointerId!==drag.id)return;
  if(!drag.started&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<7)return;
  drag.started=true;
  e.preventDefault();
  const target=document.elementFromPoint(e.clientX,e.clientY);
  const col=target?.closest('.column');
  board.querySelectorAll('.column').forEach(c=>c.classList.toggle('is-drop-target',c===col&&c.dataset.status!==status));
  drag.targetStatus=col?.dataset.status||null;
  if(!col||col.dataset.status!==status)return;
  const other=[...list.querySelectorAll(':scope > .task')].filter(x=>x!==card);
  const candidate=other.find(item=>{
   const r=item.getBoundingClientRect();
   return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
  });
  if(!candidate)return;
  const b=candidate.getBoundingClientRect();
  if(e.clientY<b.top+b.height/2)candidate.before(card);else candidate.after(card);
 };
 const onUp=e=>finish(e);
 const onCancel=e=>finish(e,true);
 const onBlur=()=>{if(drag)finish({pointerId:drag.id},true);};
 handle.addEventListener('pointerdown',e=>{
  if(e.button!==0||!canReorderTasks()||drag)return;
  e.preventDefault();
  e.stopPropagation();
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,started:false,original:order(),targetStatus:null};
  card.draggable=false;
  card.classList.add('is-reordering');
  document.addEventListener('pointermove',onMove,{capture:true,passive:false});
  document.addEventListener('pointerup',onUp,true);
  document.addEventListener('pointercancel',onCancel,true);
  window.addEventListener('blur',onBlur);
 });
 handle.addEventListener('dragstart',e=>e.preventDefault());
 handle.addEventListener('keydown',e=>{
  if(!['ArrowUp','ArrowDown'].includes(e.key)||!canReorderTasks())return;
  e.preventDefault();
  const cards=[...list.querySelectorAll(':scope > .task')],i=cards.indexOf(card);
  const next=i+(e.key==='ArrowUp'?-1:1);if(next<0||next>=cards.length)return;
  if(next<i)cards[next].before(card);else cards[next].after(card);
  persistTaskOrder(status,order()).catch(err=>message(err.message,true));
 });
}
let draggedTaskId=null;
async function moveTaskTo(taskId,status){
 const task=state.tasks.find(t=>t.id===taskId);
 if(!task||task.status===status||!canExecuteUI(task))return;
 if(task.status==='done')throw Error('Tarefa concluída. Solicite reabertura na Central.');
 if(state.project?.completion_status!=='active')throw Error('Projeto em validação ou concluído: reabra antes de editar.');
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
   card.dataset.paused=t.paused_at?'1':'';
   const controls=document.createElement('div');controls.className='task-order-controls';
   const handle=document.createElement('button');handle.type='button';handle.className='task-order-handle';
   handle.textContent='⠿';handle.title='Arrastar para reordenar dentro desta coluna';
   handle.setAttribute('aria-label','Reordenar tarefa '+t.title+'. Arraste ou use as setas do teclado.');
   const up=document.createElement('button');up.type='button';up.className='task-order-step';
   up.textContent='↑';up.setAttribute('aria-label','Subir tarefa '+t.title);
   const down=document.createElement('button');down.type='button';down.className='task-order-step';
   down.textContent='↓';down.setAttribute('aria-label','Descer tarefa '+t.title);
   for(const [button,delta] of [[up,-1],[down,1]]){
    button.disabled=!canReorderTasks();
    button.onclick=()=>{
     const cards=[...list.querySelectorAll(':scope > .task')],i=cards.indexOf(card),next=i+delta;
     if(next<0||next>=cards.length)return;
     if(delta<0)cards[next].before(card);else cards[next].after(card);
     persistTaskOrder(status,[...list.querySelectorAll(':scope > .task')].map(x=>x.dataset.taskId)).catch(e=>message(e.message,true));
    };
   }
   handle.disabled=!canReorderTasks();
   controls.append(handle,up,down);
   const editable=canExecuteUI(t)&&state.project?.completion_status==='active'&&!state.project?.paused_at&&t.status!=='done';
   card.dataset.canDrag=editable&&!t.paused_at?'1':'';
   card.draggable=card.dataset.canDrag==='1';
   if(card.draggable){
    card.title='Arraste para outra coluna ou use o seletor de etapa';
    card.addEventListener('dragstart',e=>{if(e.target.closest?.('.task-order-handle')){e.preventDefault();return;}draggedTaskId=t.id;card.classList.add('is-dragged');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id);});
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
   const edit=document.createElement('button');edit.type='button';edit.className='task-edit';edit.textContent=canManageUI(state.project)?'Editar tarefa':'Atualizar execução';edit.hidden=!editable;edit.disabled=!editable;edit.onclick=()=>modal('edit',t);
   const reopen=makeAction('Solicitar reabertura',()=>requestTaskReopen(t));
   reopen.hidden=t.status!=='done'||!canExecuteUI(t)||state.project?.completion_status!=='active';
   if(t.pending_reason){const p=document.createElement('span');p.className='pending-summary';p.textContent='Pendência: '+t.pending_reason;meta.append(p);}
   if(t.next_action){const p=document.createElement('span');p.textContent='Próxima ação: '+t.next_action;meta.append(p);}
   if(t.subtask_total){const p=document.createElement('span');p.textContent='Subtarefas: '+t.subtask_done+'/'+t.subtask_total+' concluídas';meta.append(p);}
   footer.append(priority,select);card.append(controls,title,labels,badge,meta,footer,edit,reopen);
   if(canManageUI(state.project)){
    const archive=makeAction('Arquivar',()=>manageBoardTask(t,'archive'));
    archive.classList.add('secondary');card.append(archive);
   }
   if(state.role==='admin'){
    const del=makeAction('Excluir',()=>manageBoardTask(t,'delete'));
    del.classList.add('secondary');card.append(del);
   }
   list.append(card);
   enableTaskOrderHandle(card,handle,status);
  }
 }
 const all=state.tasks,completed=all.filter(t=>t.status==='done').length;
 const today=todayInFortaleza();
 const open=all.filter(t=>t.status!=='done').length;
 const overdue=all.filter(t=>t.status!=='done'&&t.due_at&&String(t.due_at).slice(0,10)<today).length;
 const blocked=all.filter(t=>t.status!=='done'&&t.treatment_status==='blocked').length;
 const waiting=all.filter(t=>t.status!=='done'&&t.treatment_status==='waiting').length;
 $('quick-open').textContent=open+' aberta'+(open===1?'':'s');
 $('quick-overdue').textContent=overdue+' atrasada'+(overdue===1?'':'s');
 $('quick-blocked').textContent=blocked+' bloqueada'+(blocked===1?'':'s');
 $('quick-waiting').textContent=waiting+' aguardando';

 const subTotal=all.reduce((sum,t)=>sum+Number(t.subtask_total||0),0);
 const subDone=all.reduce((sum,t)=>sum+Number(t.subtask_done||0),0);
 $('board-progress-tasks').textContent=completed+' de '+all.length+' tarefas concluídas';
 $('board-progress-subtasks').textContent=subDone+' de '+subTotal+' subtarefas concluídas';
 const items=all.length+subTotal,achieved=completed+subDone;
 const progress=items?Math.round(achieved/items*100):0;
 $('board-progress-fill').style.width=progress+'%';
 $('board-progress').setAttribute('aria-label',progress+'% de atividades concluídas');
 $('filter-count').textContent=state.tasks.filter(taskFilterMatches).length+' de '+state.tasks.length+' tarefa(s)';
 $('task-order-hint').textContent=taskOrderFilterActive()
  ?'Para mudar a ordem das tarefas, limpe os filtros.'
  :state.project?.completion_status!=='active'
   ?'A ordenação fica bloqueada durante a validação ou após a conclusão do projeto.'
   :'Arraste pela alça ⠿ ou use ↑ ↓ para reorganizar tarefas na mesma coluna.';
 const anyFilter=['filter-treatment','filter-priority','filter-label','filter-due'].some(id=>$(id).value!=='all')||!!$('filter-search').value.trim();
 $('toggle-board-filters').classList.toggle('has-active-filters',anyFilter);
 $('toggle-board-filters').title=anyFilter?'Há filtros ativos no quadro.':'Filtros opcionais.';
 $('new-task').disabled=state.project?.completion_status!=='active'||!['admin','manager','member'].includes(state.role);
 if(state.project) $('project-validation').hidden=!(readyForFinalReview(state.project,state.tasks)||['review','completed'].includes(state.project.completion_status));
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
// Keep existing editor fields and API contracts; show one section at a time.
const taskTabIds={details:'task-fields',subtasks:'subtasks-panel',history:'task-history-wrap',files:'attachments-panel'};
let activeTaskTab='details';
// The history block originally lives inside the treatment section. Move it once so
// that comment actions remain intact and can become an independent detail tab.
$('editor').insertBefore($('task-history-wrap'),$('subtasks-panel'));
function showTaskDetailTab(tab){
 const value=Object.hasOwn(taskTabIds,tab)?tab:'details';
 activeTaskTab=value;
 $('editor').dataset.taskTab=value;
 for(const [key,id] of Object.entries(taskTabIds)){
  $(id).hidden=key!==value;
  const btn=$('tab-task-'+key);if(btn){
   const selected=key===value;
   btn.setAttribute('aria-selected',String(selected));
   btn.tabIndex=selected?0:-1;
  }
 }
 const details=value==='details';
 const executionOnly=$('editor').dataset.executionOnly==='true';
 for(const id of ['field-name','field-description'])$(id).hidden=!details||executionOnly;
 for(const selector of ['label[for="field-name"]','label[for="field-description"]']){
  const field=$('editor').querySelector(selector);if(field)field.hidden=!details||executionOnly;
 }
 $('task-detail-summary').hidden=details;
 $('save').hidden=!details||(executionOnly&&!canExecuteUI(editing));
 $('cancel').textContent=details?'Cancelar':'Fechar';
}
for(const button of $('task-detail-tabs').querySelectorAll('[data-task-tab]')){
 button.addEventListener('click',()=>showTaskDetailTab(button.dataset.taskTab));
 button.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const buttons=[...$('task-detail-tabs').querySelectorAll('[data-task-tab]')];
  const index=buttons.indexOf(button),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
  buttons[next].focus();showTaskDetailTab(buttons[next].dataset.taskTab);
 });
}
function modal(type,task=null){
 mode=type;editing=task;
 $('editor').dataset.executionOnly='false';
 $('field-name').disabled=false;$('field-description').disabled=false;
 $('task-detail-tabs').hidden=type!=='edit';
 $('editor').dataset.taskTab='';
 // Tabs do not change the existing project and new-task forms.
 if(type==='edit'){
  $('task-detail-summary').textContent=(task?.priority==='high'?'Prioridade alta':task?.priority==='low'?'Prioridade baixa':'Prioridade média')+
   (task?.due_at?' · Prazo: '+new Date(task.due_at).toLocaleDateString('pt-BR',{timeZone:'UTC'}):' · Sem prazo');
  showTaskDetailTab('details');
 }else{
  $('task-detail-summary').hidden=true;
  $('save').hidden=false;$('cancel').textContent='Cancelar';
  for(const id of ['field-name','field-description'])$(id).hidden=false;
  for(const selector of ['label[for="field-name"]','label[for="field-description"]']){
   const field=$('editor').querySelector(selector);if(field)field.hidden=false;
  }
 }
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
 $('project-manager-field').hidden=state.role!=='admin';
 $('project-manager').value=task?.manager_subject||(state.role==='manager'?state.subject:'');
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
 $('task-history-wrap').hidden=true;
 $('subtasks-panel').hidden=true;
 $('attachments-panel').hidden=true;
 $('attachment-file').value='';
 $('attachment-upload').disabled=!['admin','manager','member'].includes(state.role);
 if(type==='edit')loadAttachments(task.id);
 $('subtask-add').disabled=!['admin','manager','member'].includes(state.role);
 $('subtask-name').value='';$('subtask-due').value='';
 $('subtask-assignees').querySelectorAll('input:checked').forEach(x=>x.checked=false);
 $('subtask-due').min=todayInFortaleza();
 if(type==='edit')loadSubtasks(task.id);
 if(type==='edit')loadHistory(task.id);

 $('field-description').maxLength=type==='project'||type==='project-edit'?1000:2000;
 const executionOnly=type==='edit'&&!canManageUI(state.project);
 $('editor').dataset.executionOnly=String(executionOnly);
 $('member-execution').hidden=!executionOnly;
 $('execution-status').value=task?.status||'todo';
 $('execution-status').disabled=!canExecuteUI(task)||task?.status==='done'||!!task?.paused_at;
 $('execution-note').value='';
 $('field-name').disabled=executionOnly;
 $('field-description').disabled=executionOnly;
 for(const child of $('task-fields').children){
  if(child.id!=='member-execution')child.hidden=executionOnly;
 }
 $('save').textContent=executionOnly?'Salvar execução':'Salvar';
 $('save').hidden=type==='edit'&&executionOnly&&!canExecuteUI(task);
 $('history-add').disabled=type==='edit'&&(!canExecuteUI(task)||task?.status==='done');
 $('attachment-upload').disabled=type==='edit'&&(!canExecuteUI(task)||task?.status==='done');
 $('subtask-add').disabled=type==='edit'&&!canManageUI(state.project);
 if(type==='edit')showTaskDetailTab('details');
 $('dialog').showModal();
 if(type==='edit')$('tab-task-details').focus();else $('field-name').focus();
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
 $('tab-task-subtasks').textContent='Subtarefas ('+data.subtasks.length+')';
  host.replaceChildren();
  if(!data.subtasks.length){host.textContent='Nenhuma subtarefa. Adicione a primeira abaixo.';return;}
  for(const item of data.subtasks){
   const row=document.createElement('div');row.className='subtask-row';
   const name=document.createElement('strong');name.textContent=item.title;
   const status=document.createElement('select');status.setAttribute('aria-label','Situação da subtarefa '+item.title);
   for(const [v,label] of [['todo','A fazer'],['doing','Em andamento'],['done','Concluída']]){
    const option=document.createElement('option');option.value=v;option.textContent=label;status.append(option);
   }
   const subAssigned=item.owner_subject===state.subject||(Array.isArray(item.assignees)&&item.assignees.includes(state.subject));
   const subAllowed=canManageUI(state.project)||(state.role==='member'||state.role==='manager')&&subAssigned;
   status.value=item.status;status.disabled=!subAllowed||item.status==='done'||state.project?.completion_status!=='active'||!!state.project?.paused_at;
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
   edit.disabled=!canManageUI(state.project);
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
   assign.disabled=!canManageUI(state.project);
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
async function loadAttachments(taskId){
 const box=$('attachments-list');box.textContent='Carregando anexos…';
 try{
  const data=await api('/api/tasks/'+taskId+'/attachments'+qs());
  $('attachments-count').textContent=data.attachments.length+'/12 arquivos';
 $('tab-task-files').textContent='Anexos ('+data.attachments.length+')';
  box.replaceChildren();
  if(!data.attachments.length){box.textContent='Nenhum anexo nesta tarefa.';return;}
  for(const item of data.attachments){
   const row=document.createElement('div');row.className='attachment-row';
   const name=document.createElement('div');name.className='attachment-name';
   const title=document.createElement('strong');title.textContent=item.file_name;
   const detail=document.createElement('small');detail.textContent=(item.file_size/1024).toFixed(0)+' KB · '+new Date(item.created_at).toLocaleString('pt-BR');
   name.append(title,detail);
   const download=makeAction('Baixar',async()=>{
    download.disabled=true;
    try{
     const result=await api('/api/tasks/'+taskId+'/attachments/'+item.id+qs());
     const binary=atob(result.file.base64);
     const bytes=new Uint8Array(binary.length);
     for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
     const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
     const link=document.createElement('a');link.href=url;link.download=result.file.file_name;link.click();
     setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){message(e.message,true)}finally{download.disabled=false}
   });
   row.append(name,download);
   if(canExecuteUI(editing)){
    const remove=makeAction('Excluir',async()=>{
     if(!confirm('Excluir o anexo '+item.file_name+'? Esta operação não poderá ser desfeita.'))return;
     remove.disabled=true;
     try{await api('/api/tasks/'+taskId+'/attachments/'+item.id+qs(),{method:'DELETE'});await loadAttachments(taskId);message('Anexo excluído.');}
     catch(e){message(e.message,true);remove.disabled=false}
    });row.append(remove);
   }
   box.append(row);
  }
 }catch(e){box.textContent='Erro ao carregar anexos: '+e.message;}
}
$('attachment-upload').addEventListener('click',async()=>{
 if(mode!=='edit'||!editing)return;
 const file=$('attachment-file').files[0];if(!file){message('Selecione um arquivo.',true);return;}
 if(file.size<1||file.size>262144){message('Escolha um arquivo entre 1 byte e 256 KB.',true);return;}
 const mime=(file.type||'').toLowerCase();
 if(!['application/pdf','image/png','image/jpeg','image/webp','text/plain'].includes(mime)){message('Tipo não permitido. Use PDF, PNG, JPG, WebP ou TXT.',true);return;}
 const button=$('attachment-upload');button.disabled=true;
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  await api('/api/tasks/'+editing.id+'/attachments'+qs(),{method:'POST',body:JSON.stringify({file_name:file.name,media_type:mime,base64:btoa(raw)})});
  $('attachment-file').value='';
  await loadAttachments(editing.id);message('Anexo enviado com segurança.');
 }catch(e){message(e.message,true)}finally{button.disabled=false}
});
async function loadHistory(taskId){
 const list=$('task-history');list.textContent='Carregando histórico…';
 try{
  const result=await api('/api/tasks/'+taskId+'/history'+qs());list.replaceChildren();
  $('tab-task-history').textContent='Comentários ('+result.history.length+')';
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
  if(!state.auth){
   const {createAuthClient}=await import('https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle');
   state.auth=createAuthClient(AUTH);
  }
  const session=await state.auth.getSession();
  const account=session?.data?.user||session?.data?.session?.user;
  if(!account){
   state.subject=null;state.jwt=null;
   $('account').textContent='Não conectado';
   showInviteSignin();
   if(invitationToken()){
    try{await loadInvitationPreview();message('Convite válido. Crie sua senha para entrar e aceitar o convite.');}
    catch(error){
     $('signup-form').hidden=true;
     $('signin-form').hidden=true;
     $('signin-switch-mode').hidden=true;
     $('signin-feedback').textContent=error.message||'Convite indisponível.';
     message('Não foi possível validar o convite.',true);
    }
   }else message('Entre com sua conta existente do Portal AnnA One.');
   return;
  }
  $('signin').hidden=true;
  state.subject=String(account.id||'');state.accountName=String(account.name||'').trim();$('account').textContent=account.name||account.email||'Conta AnnA One';
  let token=session?.data?.session?.access_token;
  if(typeof token!=='string'||token.split('.').length!==3){
   const r=await fetch(AUTH+'/token',{credentials:'include',cache:'no-store'});
   if(r.ok){const j=await r.json();token=typeof j==='string'?j:j?.token||j?.data?.token||j?.access_token;}
  }
  if(typeof token!=='string'||token.split('.').length!==3)
   throw Error('Não foi possível obter token de acesso validável. Confira a configuração central de identidade.');
  state.jwt=token;
  try{
   await api('/api/profile/self',{method:'PUT',body:JSON.stringify({display_name:state.accountName})});
  }catch(e){console.warn('Não foi possível sincronizar o perfil da conta:',e.message);}
  let inviteAccepted=false;
  if(invitationToken()){
   try{await redeemInvitation();inviteAccepted=true}
   catch(error){
    $('app').hidden=true;
    showInviteSignin(error.message||'Não foi possível aceitar o convite.');
    message(error.message||'Convite indisponível. Confira sua conta e tente novamente.',true);
    return;
   }
  }
  const me=await api('/api/me');
  state.organizations=me.organizations;
  if(!me.organizations.length){
   $('app').hidden=true;
   showInviteSignin('Sua conta não possui uma organização ativa. Se recebeu um convite, abra o link individual fornecido pelo administrador.');
   message('Conta autenticada, mas sem acesso a uma organização do Nexus.',true);
   return;
  }
  const select=$('org');select.replaceChildren(...me.organizations.map(o=>{
   const opt=document.createElement('option');opt.value=o.id;opt.textContent=o.name;return opt;
  }));
  const requestedOrg=new URLSearchParams(location.search).get('org');
  const preferredOrg=state.inviteOrg||requestedOrg;
  const initialOrg=preferredOrg&&me.organizations.some(o=>o.id===preferredOrg)?preferredOrg:me.organizations[0].id;
  state.org=initialOrg;select.value=initialOrg;
  select.onchange=async()=>{
   try{
    state.org=select.value;state.tasks=[];state.project=null;
    await refreshProjects();
    if(state.role!=='guest'){await loadMembers();renderProjects();}else state.members=[];
    renderBrand();await loadNotifications();
    show(state.role==='guest'?'projects':'overview');
   }catch(e){message(e.message,true)}
  };
  await refreshProjects();
  if(state.role!=='guest'){await loadMembers();renderProjects();}else state.members=[];
  renderBrand();await loadNotifications();
  $('app').hidden=false;
  show(state.role==='guest'?'projects':'overview');
  const linkedCard=state.pendingCard||/^#card=([0-9a-f-]{36})$/i.exec(location.hash)?.[1];
  if(linkedCard){
   const card=state.projects.find(p=>p.id===linkedCard);
   if(card){state.pendingCard=null;history.replaceState(null,'',location.pathname+location.search);await openProject(card);}
  }
  message(inviteAccepted?'Convite aceito! Você já pode acessar os projetos autorizados.':'');
 }catch(e){
  message(e.message||'Não foi possível iniciar o Nexus.',true);
  $('app').hidden=true;
  showInviteSignin(e.message||'Falha ao carregar a conta.');
 }
}

 $('signin-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('signin-button');button.disabled=true;message('Autenticando com sua conta AnnA One…');
 try{
  const result=await state.auth.signIn.email({email:$('signin-email').value.trim(),password:$('signin-password').value});
  if(result?.error)throw Error('Credenciais inválidas ou acesso indisponível.');
  $('signin-password').value='';await boot();
 }catch(error){const feedback='Não foi possível entrar. Confira seu e-mail e senha ou utilize a recuperação de acesso.';message(feedback,true);$('signin-feedback').textContent=feedback;}finally{button.disabled=false}
});
document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',async()=>{if(!state.org)return;try{if(x.dataset.view==='projects'||x.dataset.view==='overview')await refreshProjects();if(x.dataset.view==='mytasks')await loadMyTasks();if(x.dataset.view==='team'){await loadMembers();await loadInvitations()}if(x.dataset.view==='reports'){await loadReports();await loadAutomationMonitor();}if(x.dataset.view==='notifications'){await loadNotifications();await loadNotificationPreferences();}if(x.dataset.view==='calendar')await loadCalendar();if(x.dataset.view==='approvals')await loadCentral();show(x.dataset.view)}catch(e){message(e.message,true)}}));
$('invite-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('invite-create');button.disabled=true;
 const email=$('invite-email').value.trim().toLowerCase(),role=$('invite-role').value;
 try{
  const data=await api('/api/invitations'+qs(),{method:'POST',body:JSON.stringify({email,role})});
  showInvitationDelivery(data,email,role);
  $('invite-email').value='';
  message(data.email_status==='sent'?'Convite criado. E-mail aceito pelo Resend.':'Convite criado, mas o envio automático não foi confirmado; utilize o link manual.');
  await loadInvitations();
 }catch(e){message(e.message,true)}finally{button.disabled=false}
});
$('invite-copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText($('invite-link').value);message('Link copiado. Compartilhe somente com o destinatário.')}
 catch{ $('invite-link').focus();$('invite-link').select();message('Selecione e copie o link apresentado.');}
});
$('guest-projects-refresh').addEventListener('click',async()=>{try{await refreshProjects();message(state.projects.length?'Projetos autorizados atualizados.':'Ainda não há projetos compartilhados.')}catch(e){message(e.message,true)}});
$('back-projects').onclick=async()=>{await refreshProjects();show('projects')};
$('new-project').onclick=()=>modal('project');
$('new-production').onclick=()=>{const form=$('production-create-form');form.hidden=!form.hidden;if(!form.hidden){$('production-create-due').min=todayInFortaleza();$('production-create-name').focus();}};
$('production-create-cancel').onclick=()=>{$('production-create-form').hidden=true};
$('production-create-shifts').addEventListener('change',()=>{$('production-create-shift-wrap').hidden=!$('production-create-shifts').checked});
$('production-create-form').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
 try{
  const q=$('production-create-quality').value;
  const shifts=$('production-create-shifts').checked?
   $('production-create-shift-lines').value.trim().split(/\r?\n/).filter(Boolean).map(line=>{
    const [name,start,end]=line.split(',').map(v=>v.trim());return{name,start,end};
   }):[];
  const result=await api('/api/production'+qs(),{method:'POST',body:JSON.stringify({
   name:$('production-create-name').value.trim(),description:$('production-create-description').value.trim(),
   manager_subject:$('production-create-manager').value||state.subject,target:Number($('production-create-target').value),
   due_date:$('production-create-due').value,unit:$('production-create-unit').value,
   goal_mode:$('production-create-goal').value,approval_required:$('production-create-approval').checked,
   quality_enabled:q!=='none',quality_actor:q==='inspector'?'inspector':'operator',shifts
  })});
  e.currentTarget.reset();e.currentTarget.hidden=true;await refreshProjects();
  const card=state.projects.find(x=>x.id===result.card.id);if(card)await openProject(card);
  message('Card de Produção criado. Agora atribua os funcionários.');
 }catch(err){message(err.message,true)}finally{btn.disabled=false}
});
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
   if(state.role==='admin')payload.manager_subject=$('project-manager').value||null;
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
   if(mode==='edit'&&$('editor').dataset.executionOnly==='true'){
    if(!canExecuteUI(editing))throw Error('Esta tarefa não está atribuída à sua conta.');
    await api('/api/tasks/'+editing.id+qs(),{method:'PATCH',body:JSON.stringify({status:$('execution-status').value,update_note:$('execution-note').value.trim()})});
   }else if(mode==='edit'){
    await api('/api/tasks/'+editing.id+qs(),{method:'PATCH',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,assignees,labels,...tracking,update_note})});
   }else{
    await api('/api/projects/'+state.project.id+'/tasks'+qs(),{method:'POST',body:JSON.stringify({title:name,description,priority,due_at,assignee_subject,assignees,labels,...tracking})});
   }
   await openProject(state.project);await refreshProjects();
  }
  const backToCalendar=calendarEditorReturn;
  calendarEditorReturn=false;
  $('dialog').close();message('Dados salvos com sucesso.');
  if(state.org&&(backToCalendar||state.view==='calendar')){
   await loadCalendar();
   if(backToCalendar)show('calendar');
  }
 }catch(e){message(e.message,true)}finally{$('save').disabled=false}
});


// Convites por card tradicional: equipe ativa é atribuída sem criar nova conta.
async function loadStandardCardTeam(){
 const card=state.project;if(!card||card.card_type==='production'||!canManageUI(card))return;
 const data=await api('/api/cards/'+card.id+'/members'+qs());
 const allowed=data.restricted===true;
 $('standard-card-team-form').hidden=!allowed;
 $('standard-card-team-status').textContent=allowed
  ?'Colaboradores ativos entram diretamente no card e recebem um e-mail de comunicação. Novos funcionários recebem convite.'
  :'Este projeto ainda está visível para toda a organização. Antes de convidar por card, use Personalizar projeto → Somente participantes autorizados.';
 const list=$('standard-card-team-list');list.replaceChildren();
 for(const user of data.members){
  const item=document.createElement('div');item.className='production-history-row';
  const name=document.createElement('span');name.textContent=(user.display_name||user.email||'Colaborador')+(user.email?' · '+user.email:'');
  item.append(name);
  if(user.auth_subject!==state.subject){
   const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Remover deste card';
   button.onclick=async()=>{
    if(!confirm('Remover o acesso ao card? As atividades anteriores serão preservadas.'))return;
    button.disabled=true;
    try{await api('/api/cards/'+card.id+'/remove'+qs(),{method:'POST',body:JSON.stringify({subject:user.auth_subject})});await loadStandardCardTeam();message('Acesso ao card removido.')}
    catch(e){message(e.message,true);button.disabled=false;}
   };
   item.append(button);
  }
  list.append(item);
 }
 if(!data.members.length)list.textContent='Nenhum participante específico.';
}
$('standard-card-team-form').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!state.project||state.project.card_type!=='project')return;
 const button=e.currentTarget.querySelector('button[type=submit]');button.disabled=true;
 try{
  const r=await api('/api/cards/'+state.project.id+'/assign'+qs(),{
   method:'POST',body:JSON.stringify({email:$('standard-card-team-email').value.trim().toLowerCase()})
  });
  $('standard-card-team-status').textContent=r.assignment==='existing'
   ?'Colaborador atribuído sem convite. Aviso por e-mail: '+r.email_status+'.'
   :'Novo colaborador convidado. Entrega do e-mail: '+r.email_status+'.';
  $('standard-card-team-link-wrap').hidden=r.assignment!=='invited';
  if(r.invite_url)$('standard-card-team-link').value=r.invite_url;
  $('standard-card-team-email').value='';
  const status=$('standard-card-team-status').textContent;
  await loadStandardCardTeam();$('standard-card-team-status').textContent=status;
 }catch(err){$('standard-card-team-status').textContent=err.message;message(err.message,true)}
 finally{button.disabled=false}
});
$('standard-card-team-copy').onclick=async()=>{
 try{await navigator.clipboard.writeText($('standard-card-team-link').value);message('Link copiado.')}
 catch{$('standard-card-team-link').focus();$('standard-card-team-link').select();}
};

// AnnA Nexus Produção v0.1.49 — operação mobile-first sem navegação adicional.
let productionData=null;
let productionTab='operation';
function setProductionTab(tab){
 const manager=!!productionData?.manager;
 if(tab!=='operation'&&!manager)tab='operation';
 productionTab=tab;
 for(const [id,value] of [['production-tab-operation','operation'],['production-tab-team','team'],['production-tab-indicators','indicators']]){
  const el=$(id);el.hidden=value!=='operation'&&!manager;el.setAttribute('aria-selected',String(value===tab));
  el.classList.toggle('active',value===tab);
 }
 const operationIds=['production-stats','production-progress','production-meta','production-entry-form',
  'production-inspector-panel','production-approvals-panel'];
 for(const id of operationIds)$(id).hidden=tab!=='operation'||($(id).dataset.productionHidden==='true');
 const history=$('production-history').parentElement;history.hidden=tab!=='operation';
 $('production-manager-panel').hidden=tab!=='team'||!manager;
 $('production-card-indicators').hidden=tab!=='indicators'||!manager;
 $('production-report-panel').hidden=tab!=='indicators'||!manager;
 $('production-audit-panel').hidden=tab!=='indicators'||!manager;
}
for(const [tab,id] of [['operation','production-tab-operation'],['team','production-tab-team'],['indicators','production-tab-indicators']]){
 $(id).addEventListener('click',()=>setProductionTab(tab));
}

const prodFmt=n=>Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
function productionLine(entry,actions=[]){
 const line=document.createElement('div');line.className='production-history-row';
 const desc=document.createElement('div');
 const title=document.createElement('strong');title.textContent=prodFmt(entry.quantity)+' '+productionData.card.unit+' · '+entry.operational_date;
 const status=document.createElement('small');status.textContent=({
  approved:'Contabilizado',pending:'Aguardando gestor',rejected:'Rejeitado',awaiting_quality:'Aguardando conferência'
 })[entry.status]||entry.status;
 if(entry.shift_name)status.textContent+=' · '+entry.shift_name;
 if(entry.decision_note)status.textContent+=' · '+entry.decision_note;
 desc.append(title,status);line.append(desc);
 for(const [text,fn] of actions){
  const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;b.onclick=fn;line.append(b);
 }
 return line;
}
async function productionCommand(path,payload){
 await api('/api/production/'+productionData.card.id+'/'+path+qs(),{method:'POST',body:JSON.stringify(payload)});
 await loadProduction();
}
const productionView={status:'all',order:'urgent'};
let productionDashboardCards=[];
function productionCardInfo(card){
 const target=Number(card.target),done=Number(card.completed);
 const due=String(card.due_date).slice(0,10);
 const daysToDeadline=Math.ceil((Date.parse(due+'T12:00:00Z')-Date.parse(todayInFortaleza()+'T12:00:00Z'))/86400000);
 const progress=target>0?Math.max(0,Math.min(100,done/target*100)):0;
 const status=done>=target?'complete':daysToDeadline<0?'overdue':daysToDeadline<=3?'due-soon':'on-track';
 return {due,progress,status,daysToDeadline};
}
function renderProductionDashboardCards(){
 const list=$('production-dashboard-list');list.replaceChildren();
 const all=productionDashboardCards.map((card,index)=>({card,index,info:productionCardInfo(card)}));
 const cards=all.filter(({info})=>productionView.status==='all'||info.status===productionView.status);
 if(productionView.order==='urgent'){
  const rank={overdue:0,'due-soon':1,'on-track':2,complete:3};
  cards.sort((a,b)=>rank[a.info.status]-rank[b.info.status]||a.info.daysToDeadline-b.info.daysToDeadline||a.index-b.index);
 }else if(productionView.order==='due'){
  cards.sort((a,b)=>a.info.due.localeCompare(b.info.due)||a.index-b.index);
 }else if(productionView.order==='progress'){
  cards.sort((a,b)=>b.info.progress-a.info.progress||a.index-b.index);
 }else if(productionView.order==='name'){
  cards.sort((a,b)=>a.card.name.localeCompare(b.card.name,'pt-BR')||a.index-b.index);
 }
 $('production-filter-count').textContent=cards.length+' de '+all.length+' produção(ões)';
 for(const {card} of cards){
  renderProductionDashboardCard(list,card);
 }
 if(!cards.length)list.textContent=all.length?'Nenhuma produção corresponde ao filtro.':'Ainda não existem cards de produção sob sua gestão.';
}
for(const [id,key] of [['production-status-filter','status'],['production-order','order']]){
 $(id).addEventListener('change',event=>{productionView[key]=event.target.value;renderProductionDashboardCards();});
}
async function loadProductionDashboard(){
 const host=$('production-dashboard-panel');
 host.hidden=!['admin','manager'].includes(state.role);
 if(host.hidden)return;
 const data=await api('/api/production/dashboard'+qs());
 productionDashboardCards=Array.isArray(data.cards)?data.cards:[];
 renderProductionDashboardCards();
}
function renderProductionDashboardCard(list,card){
  const target=Number(card.target),done=Number(card.completed),left=Math.max(0,target-done);
  const due=String(card.due_date).slice(0,10),today=todayInFortaleza();
  const daysToDeadline=Math.ceil((Date.parse(due+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000);
  const remainingDays=Math.max(1,daysToDeadline+1);
  const percent=target>0?Math.max(0,Math.min(100,done/target*100)):0;
  const progressText=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(percent)+'%';
  const progressState=done>=target?'complete':daysToDeadline<0?'overdue':daysToDeadline<=3?'due-soon':'on-track';
  const row=document.createElement('div');row.className='production-dashboard-card';
  row.classList.add('production-is-'+progressState);
  const button=document.createElement('button');button.className='secondary';button.type='button';button.textContent=card.name;
  button.onclick=async()=>{try{const current=state.projects.find(p=>p.id===card.id);if(current)await openProject(current)}catch(e){message(e.message,true)}};
  const status=document.createElement('span');status.className='production-dashboard-status';
  status.textContent=progressState==='complete'?'Meta atingida':progressState==='overdue'?'Prazo vencido':progressState==='due-soon'?'Prazo próximo':'Em andamento';
  const dueLabel=document.createElement('small');dueLabel.className='production-dashboard-deadline';
  dueLabel.textContent='Prazo: '+due.split('-').reverse().join('/');
  const summary=document.createElement('div');summary.className='production-dashboard-summary';
  const metrics=[
   ['Meta',prodFmt(target)+' '+card.unit],
   ['Realizado',prodFmt(done)+' '+card.unit],
   ['Falta',prodFmt(left)+' '+card.unit],
   ['Aguardando',prodFmt(card.pending)+' '+card.unit],
   ['Necessário/dia',prodFmt(left/remainingDays)+' '+card.unit]
  ];
  for(const [label,value] of metrics){
   const metric=document.createElement('div');metric.className='production-dashboard-metric';
   const caption=document.createElement('span');caption.textContent=label;
   const number=document.createElement('strong');number.textContent=value;
   if(label==='Realizado')metric.classList.add('metric-done');
   if(label==='Falta'&&progressState==='overdue')metric.classList.add('metric-alert');
   if(label==='Necessário/dia'&&progressState==='due-soon')metric.classList.add('metric-attention');
   metric.append(caption,number);summary.append(metric);
  }
  const progressHeading=document.createElement('div');progressHeading.className='production-dashboard-progress-heading';
  const progressTitle=document.createElement('span');progressTitle.textContent='Progresso';
  const progressValue=document.createElement('strong');progressValue.textContent=progressText;
  progressHeading.append(progressTitle,progressValue);
  const track=document.createElement('div');track.className='production-progress';
  track.setAttribute('role','progressbar');track.setAttribute('aria-label','Progresso de '+card.name);
  track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');track.setAttribute('aria-valuenow',String(Math.round(percent)));
  const fill=document.createElement('span');fill.style.width=percent+'%';track.append(fill);
  const header=document.createElement('div');header.className='production-dashboard-card-heading';header.append(button,status);
  row.append(header,dueLabel,summary,progressHeading,track);list.append(row);
}
$('production-dashboard-refresh').onclick=async()=>{try{await loadProductionDashboard()}catch(e){message(e.message,true)}};
async function loadProductionReport(){
 const panel=$('production-report-panel');
 panel.hidden=!productionData?.manager;
 if(panel.hidden)return;
 const data=await api('/api/production/'+productionData.card.id+'/report'+qs());
 const host=$('production-report-list');host.replaceChildren();
 for(const r of data.rows){
  const row=document.createElement('div');row.className='production-history-row';
  const desc=document.createElement('div');
  const title=document.createElement('strong');title.textContent=String(r.operational_date).slice(0,10)+
   ' · '+(r.shift_name||'Sem turno')+' · '+(r.display_name||r.email||'Integrante');
  const sum=document.createElement('small');sum.textContent='Bruta '+prodFmt(r.gross)+
   ' · Aprovada '+prodFmt(r.approved)+' · Rejeitada '+prodFmt(r.rejected)+
   ' · Retrabalho '+prodFmt(r.rework)+' · Pendente '+prodFmt(r.pending);
  desc.append(title,sum);row.append(desc);host.append(row);
 }
 if(!data.rows.length)host.textContent='Nenhum registro para o relatório.';
}
$('production-report-refresh').onclick=async()=>{try{await loadProductionReport()}catch(e){message(e.message,true)};
};

async function loadProduction(){
 if(!state.project||state.project.card_type!=='production')return;
 const data=await api('/api/production/'+state.project.id+qs());
 productionData=data;const cfg=data.card;
 $('production-title').textContent=cfg.name;
 $('production-description').textContent=cfg.description||'Descrição ainda não informada. O gestor pode preencher em Personalizar.';
 $('production-responsible').textContent='Responsável: '+memberName(cfg.manager_subject||state.project.manager_subject);

 const done=Number(data.summary?.approved||0),pending=Number(data.summary?.pending||0),target=Number(cfg.target);
 const values=[['Meta',prodFmt(target)+' '+cfg.unit],['Contabilizado',prodFmt(done)+' '+cfg.unit],
  ['Restante',prodFmt(Math.max(0,target-done))+' '+cfg.unit],['Em avaliação',prodFmt(pending)+' '+cfg.unit]];
 if(cfg.goal_mode==='individual'&&!data.manager){
  const mine=data.assignments.find(x=>x.auth_subject===state.subject);
  if(mine?.individual_target!=null){
   const myTotal=data.entries.filter(e=>e.author_subject===state.subject&&e.status==='approved')
    .reduce((sum,e)=>sum+Number(e.quality_approved??e.quantity)+Number(e.rework_approved||0),0);
   values.push(['Minha meta',prodFmt(mine.individual_target)+' '+cfg.unit],['Meu realizado',prodFmt(myTotal)+' '+cfg.unit]);
  }
 }
 const dashboardInfo=$('production-card-indicators');dashboardInfo.replaceChildren();
 if(data.manager){
  const today=todayInFortaleza(),due=String(cfg.due_date).slice(0,10);
  const days=Math.max(1,Math.ceil((Date.parse(due+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000)+1);
  const details=document.createElement('p');
  details.textContent='Meta '+prodFmt(target)+' '+cfg.unit+' · Realizado '+prodFmt(done)+' · Falta '+prodFmt(Math.max(0,target-done))+
   ' · Aguardando '+prodFmt(pending)+' · Necessário/dia '+prodFmt(Math.max(0,target-done)/days)+' '+cfg.unit;
  const info=document.createElement('p');
  info.textContent=done>=target?'Meta atingida':due<today?'Prazo ultrapassado':'Prazo: '+due;
  dashboardInfo.append(details,info);
 }
 const stats=$('production-stats');stats.replaceChildren();
 for(const [label,num] of values){
  const cell=document.createElement('div');cell.className='production-stat';
  const k=document.createElement('small');k.textContent=label;
  const v=document.createElement('strong');v.textContent=num;
  cell.append(k,v);stats.append(cell);
 }
 $('production-progress-fill').style.width=Math.min(100,done/target*100)+'%';
 $('production-status').textContent=done>=target?'Meta atingida':'Em andamento';
 $('production-meta').textContent='Prazo: '+String(cfg.due_date).slice(0,10)+
  ' · '+(cfg.goal_mode==='collective'?'Meta coletiva':'Metas individuais')+
  ' · '+(cfg.approval_required?'Aprovação do gestor':'Registro automático')+
  ' · '+(cfg.quality_enabled?('Qualidade: '+(cfg.quality_actor==='inspector'?'conferente':'operador')):'Sem qualidade');
 $('production-entry-form').dataset.productionHidden=String(cfg.completion_status!=='active'||!(data.manager||data.permission==='operator'));
 $('production-quality-fields').hidden=!(cfg.quality_enabled&&cfg.quality_actor==='operator');
 $('production-shift-wrap').hidden=!cfg.shifts?.length;
 const shift=$('production-entry-shift');shift.replaceChildren();
 for(const s of cfg.shifts||[]){
  const op=document.createElement('option');op.value=s.name;op.textContent=s.name+' ('+s.start+'–'+s.end+')';shift.append(op);
 }
 if(!$('production-entry-date').value)$('production-entry-date').value=todayInFortaleza();
 const history=$('production-history');history.replaceChildren();
 for(const e of data.entries.slice(0,100)){
  const actions=[];
  if(data.manager&&e.status!=='awaiting_quality')actions.push(['Corrigir',async()=>{
   const raw=prompt('Quantidade corrigida',String(e.quantity));if(raw===null)return;
   const qty=Number(raw),payload={quantity:qty};
   if(cfg.quality_enabled){
    const a=prompt('Quantidade aprovada na qualidade',String(e.quality_approved||0));if(a===null)return;
    const r=prompt('Quantidade rejeitada',String(e.quality_rejected||0));if(r===null)return;
    const w=prompt('Quantidade para retrabalho',String(e.quality_rework||0));if(w===null)return;
    payload.approved=Number(a);payload.rejected=Number(r);payload.rework=Number(w);
   }
   const reason=prompt('Justificativa da correção (obrigatória)');if(!reason)return;
   payload.reason=reason;
   try{await productionCommand('entries/'+e.id+'/correct',payload);message('Correção registrada com histórico.')}
   catch(err){message(err.message,true)}
  }]);
  const left=Number(e.quality_rework||0)-Number(e.rework_approved||0)-Number(e.rework_rejected||0);
  if(data.manager&&cfg.quality_enabled&&e.status==='approved'&&left>0){
   actions.push(['Retrabalho',async()=>{
    const a=Number(prompt('Quantidade aprovada após retrabalho (máximo '+prodFmt(left)+')','0'));
    if(!Number.isFinite(a))return;
    const r=Number(prompt('Quantidade rejeitada após retrabalho','0'));
    if(!Number.isFinite(r)||a+r<=0)return;
    try{await productionCommand('entries/'+e.id+'/rework',{approved:a,rejected:r});message('Retrabalho registrado.')}
    catch(err){message(err.message,true)}
   }]);
  }
  history.append(productionLine(e,actions));
 }
 if(!data.entries.length)history.textContent='Nenhuma produção registrada.';
 $('production-inspector-panel').dataset.productionHidden=String(!((data.manager||data.permission==='inspector')&&cfg.quality_enabled&&cfg.quality_actor==='inspector'));
 const inspection=$('production-inspector-list');inspection.replaceChildren();
 for(const e of data.entries.filter(e=>e.status==='awaiting_quality')){
  inspection.append(productionLine(e,[['Conferir',async()=>{
   const a=Number(prompt('Quantidade aprovada','0'));if(!Number.isFinite(a))return;
   const r=Number(prompt('Quantidade rejeitada','0'));if(!Number.isFinite(r))return;
   const w=Number(prompt('Quantidade para retrabalho','0'));if(!Number.isFinite(w))return;
   try{await productionCommand('entries/'+e.id+'/quality',{approved:a,rejected:r,rework:w});message('Conferência registrada.')}
   catch(err){message(err.message,true)}
  }]]));
 }
 $('production-approvals-panel').dataset.productionHidden=String(!(data.manager&&cfg.approval_required));
 const approvals=$('production-approvals-list');approvals.replaceChildren();
 if(data.manager)for(const e of data.entries.filter(e=>e.status==='pending')){
  approvals.append(productionLine(e,[
   ['Aprovar',async()=>{try{await productionCommand('entries/'+e.id+'/decide',{decision:'approved'});message('Produção aprovada.')}catch(err){message(err.message,true)}}],
   ['Rejeitar',async()=>{const note=prompt('Motivo da rejeição');if(!note)return;
    try{await productionCommand('entries/'+e.id+'/decide',{decision:'rejected',note});message('Registro rejeitado.')}catch(err){message(err.message,true)}}]
  ]));
 }
 $('production-manager-panel').hidden=!data.manager;
 $('production-audit-panel').hidden=!data.manager;
 const auditHost=$('production-audit-list');auditHost.replaceChildren();
 if(data.manager)for(const log of data.audit||[]){
  const line=document.createElement('div');line.className='production-history-row';
  const info=document.createElement('div');
  const title=document.createElement('strong');title.textContent=(log.action||'Alteração')+' · '+new Date(log.created_at).toLocaleString('pt-BR');
  const details=document.createElement('small');
  const d=log.details||{};
  details.textContent=log.action==='corrected'
   ?'Motivo: '+(d.reason||'—')+' · Antes: '+prodFmt(d.before?.quantity)+' · Depois: '+prodFmt(d.after?.quantity)
   :'Realizada por: '+(log.actor_subject===state.subject?'Você':memberName(log.actor_subject));
  info.append(title,details);line.append(info);auditHost.append(line);
 }
 try{await loadProductionReport()}catch(e){$('production-report-list').textContent='Relatório indisponível.';}
 $('production-individual-wrap').hidden=cfg.goal_mode!=='individual';
 const team=$('production-team');team.replaceChildren();
 if(data.manager)for(const a of data.assignments){
  const line=document.createElement('div');line.className='production-history-row';
  line.textContent=(a.display_name||a.email||'Integrante')+' · '+a.production_role+
   (a.individual_target!==null?' · Meta '+prodFmt(a.individual_target):'');
  if(a.auth_subject!==state.subject){
   const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Remover do card';
   remove.addEventListener('click',async()=>{
    if(!confirm('Remover este funcionário do card? O histórico da produção será preservado.'))return;
    remove.disabled=true;
    try{await productionCommand('remove',{subject:a.auth_subject});message('Acesso ao card removido.')}
    catch(err){message(err.message,true);remove.disabled=false}
   });
   line.append(remove);
  }
  team.append(line);
 }
 setProductionTab(productionTab);
}
$('production-entry-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=$('production-entry-submit');b.disabled=true;
 try{
  const cfg=productionData.card;
  const payload={quantity:Number($('production-entry-qty').value),operational_date:$('production-entry-date').value,
   shift_name:cfg.shifts?.length?$('production-entry-shift').value:null,request_id:crypto.randomUUID()};
  if(cfg.quality_enabled&&cfg.quality_actor==='operator'){
   payload.approved=Number($('production-entry-approved').value);
   payload.rejected=Number($('production-entry-rejected').value);
   payload.rework=Number($('production-entry-rework').value);
  }
  await productionCommand('entries',payload);
  e.currentTarget.reset();$('production-entry-date').value=todayInFortaleza();
  message('Produção registrada com sucesso.');
 }catch(err){message(err.message,true)}finally{b.disabled=false}
});
$('production-assign-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.currentTarget.querySelector('button[type=submit]');b.disabled=true;
 try{
  const cfg=productionData.card;
  const payload={email:$('production-assign-email').value.trim().toLowerCase(),
   production_role:$('production-assign-role').value};
  if(cfg.goal_mode==='individual'&&$('production-individual-target').value!=='')
   payload.individual_target=Number($('production-individual-target').value);
  const result=await api('/api/production/'+cfg.id+'/assign'+qs(),{method:'POST',body:JSON.stringify(payload)});
  $('production-assign-feedback').textContent=result.assignment==='existing'?
   'Funcionário atribuído sem convite. Notificação: '+result.email_status+'.':
   'Novo funcionário convidado. Envio: '+result.email_status+'.';
  $('production-invite-link-wrap').hidden=result.assignment!=='invited';
  if(result.invite_url)$('production-invite-link').value=result.invite_url;
  $('production-assign-email').value='';
  await loadProduction();
 }catch(err){$('production-assign-feedback').textContent=err.message;message(err.message,true)}
 finally{b.disabled=false}
});
$('production-invite-copy').onclick=async()=>{
 try{await navigator.clipboard.writeText($('production-invite-link').value);message('Link copiado.')}
 catch{$('production-invite-link').focus();$('production-invite-link').select();}
};

// O controle de tema fica isolado em theme.js: continua disponível mesmo
// se a autenticação ou qualquer outro módulo falhar durante a inicialização.
boot();
