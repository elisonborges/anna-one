// Projetos empresariais: escopo operacional por empresa.
const kinds={phase:'Etapa',task:'Tarefa',deliverable:'Entregável',milestone:'Marco'},states={draft:'Rascunho',active:'Em execução',pending:'Pendente',in_progress:'Em execução',completed:'Concluído',cancelled:'Cancelado'};
export function createProjectsPanel({host,status,refresh,request,authorized}){
 let rev=0,company='',selected='',busy=false;
 const n=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;};
 const input=(name,type='text',max=120)=>{const e=n('input');e.name=name;e.type=type;e.required=true;if(type==='text')e.maxLength=max;return e;};
 const select=(name,items)=>{const e=n('select');e.name=name;e.required=true;const p=n('option','Selecione');p.value='';e.append(p);for(const [id,label] of items){const o=n('option',label);o.value=id;e.append(o);}return e;};
 const field=(label,e)=>{const l=n('label',label);l.append(e);return l;},check=()=>input('confirmed','checkbox'),alive=r=>r===rev&&authorized();
 function clear(){rev++;host.replaceChildren();host.hidden=true;refresh.disabled=false;status.textContent='Aguardando consulta.';}
 function reset(){company='';selected='';clear();}
 function form(parent,title,fields,path,transform=x=>x){
  const f=n('form',undefined,'corporate-box'),box=n('div',undefined,'filters'),button=n('button','Registrar','btn'),msg=n('p');msg.setAttribute('role','status');button.type='submit';
  for(const [label,el] of fields)box.append(field(label,el));f.append(n('h4',title),box,button,msg);parent.append(f);let op=null,key=null;const r=rev;
  f.addEventListener('submit',async e=>{e.preventDefault();if(busy||!alive(r))return;busy=true;button.disabled=true;try{const p=transform(Object.fromEntries(new FormData(f))),k=JSON.stringify(p);if(k!==key){key=k;op=crypto.randomUUID();}const d=await request(path,'POST',{...p,request_id:op});if(!d?.item)throw Error('Confirmação não recebida.');if(alive(r)){if(path==='/v1/projects')selected=d.item.id;await load();}}catch(err){if(alive(r))msg.textContent=err.message;}finally{busy=false;button.disabled=false;}});
 }
 function eventForm(parent,path,choices){if(choices.length)form(parent,'Atualizar situação',[['Situação',select('status',choices.map(x=>[x,states[x]]))],['Justificativa',input('reason','text',300)],['Confirmo alteração',check()]],path,p=>({...p,confirmed:true}));}
 function history(parent,events){if(!events.length)return;const d=n('details'),list=n('ol');d.append(n('summary','Histórico'));for(const e of events)list.append(n('li',states[e.status]+' · '+new Date(e.created_at).toLocaleString('pt-BR')+' · '+e.reason));d.append(list);parent.append(d);}
 async function load(){
  if(!authorized())return;clear();const r=rev;refresh.disabled=true;status.textContent='Verificando acesso operacional...';
  try{const scope=await request('/v1/operations');if(!alive(r))return;if(!Array.isArray(scope?.companies))throw Error('Resposta inválida.');const allowed=scope.companies.filter(c=>c.allowed===true);if(!allowed.some(c=>c.id===company)){company=allowed[0]?.id||'';selected='';}
   if(!company){host.append(n('p','Conceda acesso por empresa na Gestão operacional.'));host.hidden=false;status.textContent='Sem concessão operacional.';return;}
   const chooser=select('company',allowed.map(c=>[c.id,c.name]));chooser.value=company;chooser.addEventListener('change',()=>{company=chooser.value;selected='';load();});host.append(field('Empresa',chooser));
   const d=await request('/v1/projects?'+new URLSearchParams({company}));if(!alive(r))return;if(d?.allowed!==true||!Array.isArray(d.items))throw Error('Projetos indisponíveis.');
   form(host,'Cadastrar projeto',[['Código',input('code','text',30)],['Título',input('title')],['Descrição',input('description','text',1000)],['Início previsto',input('planned_on','date')],['Prazo',input('due_on','date')],['Confirmo cadastro',check()]],'/v1/projects',p=>({...p,company_id:company,confirmed:true}));
   if(!d.items.length){host.append(n('p','Nenhum projeto cadastrado.'));host.hidden=false;status.textContent='Consulta concluída.';return;}
   if(!d.items.some(x=>x.id===selected))selected=d.items[0].id;const picker=select('project',d.items.map(x=>[x.id,x.code+' · '+x.title+' · '+states[x.status]]));picker.value=selected;picker.addEventListener('change',()=>{selected=picker.value;load();});host.append(field('Projeto',picker));
   const p=d.items.find(x=>x.id===selected),v=await request('/v1/projects/'+p.id);if(!alive(r))return;if(v?.id!==p.id||![v.items,v.dependencies,v.events].every(Array.isArray))throw Error('Detalhe indisponível.');
   host.append(n('h3',p.code+' · '+p.title),n('p',p.description),n('p',p.planned_on+' a '+p.due_on+' · '+states[v.status]),n('p','Itens concluídos (exceto etapas): '+p.completed_count+' / '+p.item_count));
   history(host,v.events);const complete=Number(v.item_count)===v.items.length&&Number(v.dependency_count)===v.dependencies.length;if(!complete)host.append(n('p','Detalhe parcial: ações de planejamento e execução desabilitadas nesta consulta.','muted'));
   const items=v.items,phases=items.filter(x=>x.kind==='phase'),work=items.filter(x=>x.kind!=='phase'),terminal=x=>['completed','cancelled'].includes(x.status),find=id=>items.find(x=>x.id===id);
   const projectChoices=[];if(complete){if(v.status==='draft'&&work.some(x=>x.status==='pending')&&phases.filter(x=>x.status==='pending').every(x=>work.some(y=>y.phase_id===x.id&&y.status==='pending')))projectChoices.push('active');if(v.status==='active'&&items.every(terminal)&&work.some(x=>x.status==='completed'))projectChoices.push('completed');if(['draft','active'].includes(v.status)&&items.every(terminal))projectChoices.push('cancelled');}eventForm(host,'/v1/projects/'+p.id+'/events',projectChoices);
   if(complete&&v.status==='draft'){
    form(host,'Adicionar etapa',[['Título',input('title')],['Início previsto',input('planned_on','date')],['Prazo',input('due_on','date')]],'/v1/projects/'+p.id+'/items',x=>({...x,kind:'phase'}));
    const openPhases=phases.filter(x=>x.status==='pending');if(openPhases.length)form(host,'Adicionar tarefa, entregável ou marco',[['Etapa',select('phase_id',openPhases.map(x=>[x.id,x.title]))],['Tipo',select('kind',Object.entries(kinds).filter(([k])=>k!=='phase'))],['Título',input('title')],['Início previsto',input('planned_on','date')],['Prazo (igual ao início para marco)',input('due_on','date')]],'/v1/projects/'+p.id+'/items');
    const pending=work.filter(x=>x.status==='pending');if(pending.length>1){const before=select('predecessor_id',pending.map(x=>[x.id,x.title+' · '+x.due_on])),after=select('successor_id',[]);before.addEventListener('change',()=>{after.replaceChildren();const b=n('option','Selecione');b.value='';after.append(b);const a=find(before.value);if(a)for(const x of pending.filter(x=>a.due_on<x.planned_on&&!v.dependencies.some(d=>d.predecessor_id===a.id&&d.successor_id===x.id))){const o=n('option',x.title+' · '+x.planned_on);o.value=x.id;after.append(o);}});form(host,'Adicionar dependência',[['Predecessora',before],['Sucessora (início após o prazo anterior)',after],['Confirmo dependência',check()]],'/v1/projects/'+p.id+'/dependencies',x=>({...x,confirmed:true}));}
   }
   host.append(n('h3','Cronograma e entregas'),n('p','Ordenação por datas previstas. Dependências fim–início entre dias distintos; não há replanejamento automático.'));
   for(const x of items){const card=n('article',undefined,'business-card');card.append(n('h4',kinds[x.kind]+' · '+x.title),n('p',x.planned_on+' a '+x.due_on+' · '+states[x.status]));if(x.phase_id)card.append(n('p','Etapa: '+(find(x.phase_id)?.title||'Etapa anterior')));const predecessors=v.dependencies.filter(d=>d.successor_id===x.id).map(d=>find(d.predecessor_id));for(const a of predecessors)card.append(n('p','Depende de: '+(a?a.title+' · '+states[a.status]:'Item anterior')));history(card,x.events);
    const next=[],children=items.filter(i=>i.phase_id===x.id),successors=v.dependencies.filter(d=>d.predecessor_id===x.id).map(d=>find(d.successor_id));
    if(complete&&v.status==='active'&&x.status==='pending'&&(x.kind==='phase'||find(x.phase_id)?.status==='in_progress')&&predecessors.every(i=>i?.status==='completed'))next.push('in_progress');
    if(complete&&v.status==='active'&&x.status==='in_progress'&&(x.kind!=='phase'||(children.every(terminal)&&children.some(i=>i.status==='completed'))))next.push('completed');
    if(complete&&['draft','active'].includes(v.status)&&!terminal(x)&&children.every(terminal)&&successors.every(i=>i&&terminal(i)))next.push('cancelled');
    eventForm(card,'/v1/project-items/'+x.id+'/events',next);host.append(card);}
   host.hidden=false;status.textContent='Consulta concluída. Até 100 projetos recentes, 500 itens e 2000 dependências por projeto.';
  }catch(err){if(alive(r)){host.replaceChildren();host.hidden=true;status.textContent=err.message;}}finally{if(alive(r))refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);return {load,reset};
}
