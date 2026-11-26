// DP administrativo: somente dados autorizados, mantidos em memória.
const models={onsite:'Presencial',hybrid:'Híbrido',remote:'Remoto',other:'Outro'};
const items={benefit:'Benefício',equipment:'Equipamento'};
const leaves={vacation:'Férias',administrative_leave:'Afastamento administrativo'};
export function createDpPanel({host,status,refresh,request,authorized}){
 let rev=0,company='',selected='',busy=false;
 const n=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;};
 const input=(name,type='text',max=120)=>{const e=n('input');e.name=name;e.type=type;e.required=true;if(type==='text')e.maxLength=max;return e;};
 const select=(name,values)=>{const e=n('select');e.name=name;e.required=true;const p=n('option','Selecione');p.value='';e.append(p);for(const [v,l] of values){const o=n('option',l);o.value=v;e.append(o);}return e;};
 const field=(l,e)=>{const x=n('label',l);x.append(e);return x;};
 const alive=r=>r===rev&&authorized();
 function clear(){rev++;host.replaceChildren();host.hidden=true;refresh.disabled=false;status.textContent='Aguardando consulta.';}
 function reset(){company='';selected='';clear();}
 function form(parent,title,fields,path,transform=x=>x){
  const f=n('form',undefined,'corporate-box'),box=n('div',undefined,'filters'),button=n('button','Registrar','btn'),msg=n('p');msg.setAttribute('role','status');button.type='submit';
  for(const [label,el] of fields)box.append(field(label,el));f.append(n('h4',title),box,button,msg);parent.append(f);const r=rev;let op=null,key=null;
  f.addEventListener('submit',async e=>{e.preventDefault();if(busy||!alive(r))return;const p=transform(Object.fromEntries(new FormData(f))),k=JSON.stringify(p);if(k!==key){key=k;op=crypto.randomUUID();}busy=true;button.disabled=true;try{const d=await request(path,'POST',{...p,request_id:op});if(!d?.item)throw Error('Confirmação não recebida.');if(alive(r))await load();}catch(err){if(alive(r))msg.textContent=err.message;}finally{busy=false;button.disabled=false;}});
 }
 async function load(){
  if(!authorized())return;clear();const r=rev;refresh.disabled=true;status.textContent='Verificando concessões...';
  try{const scope=await request('/v1/hr');if(!alive(r))return;if(!Array.isArray(scope?.companies))throw Error('Resposta inválida.');const allowed=scope.companies.filter(x=>x.allowed===true);if(!allowed.some(x=>x.id===company)){company=allowed[0]?.id||'';selected='';}
   if(!company){host.append(n('p','Solicite uma concessão de RH para a empresa no módulo RH e vínculos.'));host.hidden=false;status.textContent='Sem concessão de RH.';return;}
   const chooser=select('company',allowed.map(x=>[x.id,x.name]));chooser.value=company;chooser.addEventListener('change',()=>{company=chooser.value;selected='';load();});host.append(field('Empresa',chooser));
   const d=await request('/v1/dp?'+new URLSearchParams({company}));if(!alive(r))return;if(d?.allowed!==true||![d.relationships,d.profiles,d.assignments,d.absences].every(Array.isArray))throw Error('Registros indisponíveis.');
   if(!d.relationships.length){host.append(n('p','Cadastre primeiro um vínculo no RH.'));host.hidden=false;status.textContent='Consulta concluída.';return;}
   if(!d.relationships.some(x=>x.id===selected))selected=d.relationships[0].id;
   const rel=select('relationship',d.relationships.map(x=>[x.id,x.reference+' · '+x.party_name+(x.active?'':' · Encerrado')]));rel.value=selected;rel.addEventListener('change',()=>{selected=rel.value;load();});host.append(field('Vínculo funcional',rel));
   const current=d.relationships.find(x=>x.id===selected);host.append(n('h3',current.reference+' · '+current.party_name),n('p',current.active?'Vínculo ativo':'Vínculo encerrado — somente histórico e regularização de itens existentes.'));
   const scoped=arr=>arr.filter(x=>x.relationship_id===current.id),forRel=p=>({...p,relationship_id:current.id});
   host.append(n('h3','Departamento pessoal · jornada e escala'));
   if(current.active){const minutes=input('weekly_minutes','number');minutes.required=false;minutes.min=0;minutes.max=10080;minutes.step=1;form(host,'Registrar revisão administrativa',[['Data efetiva',input('effective_on','date')],['Regime',select('work_model',Object.entries(models))],['Minutos semanais informados (opcional)',minutes],['Escala / horário informado',input('schedule_label')],['Referência administrativa',input('reference')]],'/v1/dp/profiles',p=>forRel({...p,weekly_minutes:p.weekly_minutes===''?null:Number(p.weekly_minutes)}));}
   for(const x of scoped(d.profiles)){host.append(n('article','Rev. '+x.revision+' · '+x.effective_on+' · '+models[x.work_model]+' · '+(x.weekly_minutes===null?'Sem jornada informada':x.weekly_minutes+' min/semana')+' · '+x.schedule_label+' · '+x.reference,'business-card'));}
   host.append(n('h3','Benefícios e equipamentos'));
   if(current.active)form(host,'Registrar entrega ou concessão',[['Tipo',select('kind',Object.entries(items))],['Descrição administrativa',input('label')],['Referência única em aberto',input('reference')],['Data de início/entrega',input('start_on','date')]],'/v1/dp/assignments',forRel);
   for(const x of scoped(d.assignments)){const card=n('article',undefined,'business-card');card.append(n('h4',items[x.kind]+' · '+x.label),n('p',x.reference+' · '+x.start_on+' · '+(x.closed_on?'Encerrado em '+x.closed_on+' · '+x.close_reason:'Em aberto')));if(!x.closed_on)form(card,x.kind==='equipment'?'Registrar devolução':'Encerrar concessão',[['Data',input('closed_on','date')],['Justificativa administrativa',input('reason','text',200)]],'/v1/dp/assignments/'+x.id+'/close');host.append(card);}
   host.append(n('h3','Férias e afastamentos'),n('p','Registro administrativo de períodos. Não informa diagnóstico, CID, atestado, saldo de férias ou cálculo de direitos. Utilize somente referências não sensíveis.','muted small'));
   if(current.active)form(host,'Registrar período',[['Tipo',select('kind',Object.entries(leaves))],['Início',input('start_on','date')],['Fim',input('end_on','date')],['Referência administrativa',input('reference')]],'/v1/dp/absences',forRel);
   for(const x of scoped(d.absences)){const card=n('article',undefined,'business-card');card.append(n('h4',leaves[x.kind]),n('p',x.start_on+' a '+x.end_on+' · '+x.reference+' · '+(x.resolution==='completed'?'Concluído':x.resolution==='cancelled'?'Cancelado':'Registrado')));if(!x.resolved_on){const confirm=input('confirm');confirm.type='checkbox';form(card,'Resolver período',[['Situação',select('resolution',[['completed','Concluído'],['cancelled','Cancelado']])],['Confirmo a resolução',confirm]],'/v1/dp/absences/'+x.id+'/resolve',p=>{delete p.confirm;return p;});}host.append(card);}
   host.hidden=false;status.textContent='Consulta concluída. Até 500 registros por categoria; dados mantidos apenas em memória.';
  }catch(err){if(alive(r)){host.replaceChildren();host.hidden=true;status.textContent=err.message;}}finally{if(alive(r))refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);return {load,reset};
}
