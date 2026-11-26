// RH administrativo. Nenhuma persistência local de dados de pessoas.
const kinds={clt:'CLT',intern:'Estágio',apprentice:'Aprendizagem',self_employed:'Autônomo',pj:'PJ',partner:'Sócio',outsourced:'Terceirizado',representative:'Representante',volunteer:'Voluntário'};
export function createHrPanel({host,status,refresh,request,authorized}){
 let rev=0,company='',busy=false;
 const n=(tag,value,cls)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(cls)el.className=cls;return el;};
 const input=(name,type='text',max=120)=>{const e=n('input');e.name=name;e.type=type;e.required=true;if(type==='text')e.maxLength=max;return e;};
 const select=(name,items)=>{const e=n('select');e.name=name;e.required=true;const p=n('option','Selecione');p.value='';e.append(p);for(const [id,label] of items){const o=n('option',label);o.value=id;e.append(o);}return e;};
 const field=(label,e)=>{const l=n('label',label);l.append(e);return l;};
 const alive=r=>r===rev&&authorized();
 const clear=()=>{rev++;host.replaceChildren();host.hidden=true;refresh.disabled=false;status.textContent='Aguardando consulta.';};
 const reset=()=>{company='';clear();};
 function form(parent,title,fields,action,transform=x=>x){
  const f=n('form',undefined,'corporate-box'),box=n('div',undefined,'filters'),button=n('button','Registrar','btn'),msg=n('p');msg.setAttribute('role','status');button.type='submit';
  for(const [label,el] of fields)box.append(field(label,el));f.append(n('h3',title),box,button,msg);parent.append(f);let operation=null,key=null;const r=rev;
  f.addEventListener('submit',async e=>{e.preventDefault();if(busy||!alive(r))return;let payload=transform(Object.fromEntries(new FormData(f)));if(!payload)return;const k=JSON.stringify(payload);if(k!==key){key=k;operation=crypto.randomUUID();}busy=true;button.disabled=true;try{const d=await request(action,'POST',{...payload,request_id:operation});if(!d?.item)throw Error('Confirmação não recebida.');if(alive(r))await load();}catch(err){if(alive(r))msg.textContent=err.message;}finally{busy=false;button.disabled=false;}});
  return f;
 }
 async function load(){
  if(!authorized())return;clear();const r=rev;refresh.disabled=true;status.textContent='Verificando concessões de RH...';
  try{const d=await request('/v1/hr');if(!alive(r))return;if(!Array.isArray(d?.companies)||!Array.isArray(d?.grants))throw Error('Resposta inválida.');
   if(d.admin){
    const admin=n('section',undefined,'corporate-box');admin.append(n('h3','Administração de concessões'),n('p','Concessão explícita por empresa. O destinatário precisa ter associação Business ativa e perfil elegível. Nenhuma concessão é automática.'),n('p','Seu identificador: '+d.actor_id,'muted small'));
    const confirmation=input('confirmation');confirmation.type='checkbox';
    form(admin,'Conceder acesso a RH',[['Empresa',select('company_id',d.companies.map(c=>[c.id,c.name]))],['UUID do usuário Business',input('user_id','text',36)],['Justificativa',input('reason','text',300)],['Confirmo o destinatário e a autorização',confirmation]],'/v1/hr/grants',p=>{delete p.confirmation;return p;});
    for(const g of d.grants){const card=n('article',undefined,'business-card');card.append(n('p',(d.companies.find(c=>c.id===g.company_id)?.name||g.company_id)+' · '+g.user_id),n('p',(g.revoked_at?'Revogada':'Vigente no cadastro')+' · '+g.reason));if(!g.revoked_at)form(card,'Revogar',[['Justificativa',input('reason','text',300)]],'/v1/hr/grants/'+g.id+'/revoke');admin.append(card);}host.append(admin);
   }
   const allowed=d.companies.filter(c=>c.allowed===true);if(!allowed.some(c=>c.id===company))company=allowed[0]?.id||'';
   if(!company){host.append(n('p','Nenhuma concessão específica de RH disponível.'));host.hidden=false;status.textContent='Consulta concluída.';return;}
   const chooser=select('company',allowed.map(c=>[c.id,c.name]));chooser.value=company;chooser.addEventListener('change',()=>{company=chooser.value;load();});host.append(field('Empresa de trabalho',chooser));
   const records=await request('/v1/hr/records?'+new URLSearchParams({company}));if(!alive(r))return;if(!records?.allowed||!Array.isArray(records.positions)||!Array.isArray(records.relationships))throw Error('Registros indisponíveis.');
   const positions=records.positions.map(p=>[p.id,p.code+' · '+p.title+' / '+p.department]);
   form(host,'Cadastrar cargo',[['Código',input('code','text',30)],['Cargo',input('title')],['Setor',input('department')]],'/v1/hr/positions',p=>({...p,company_id:company}));
   const catalog=n('div',undefined,'business-grid');for(const p of records.positions)catalog.append(n('article',p.code+' · '+p.title+' / '+p.department,'business-card'));host.append(n('h3','Cargos cadastrados'),catalog);
   if(positions.length){
    const search=n('form',undefined,'corporate-box'),query=input('q','text',80),searchButton=n('button','Buscar cadastro corporativo','btn light'),searchStatus=n('p'),party=select('party_id',[]);query.minLength=2;searchButton.type='submit';search.append(field('Nome da pessoa ou prestador',query),searchButton,searchStatus);host.append(search);
    let searchRev=0;search.addEventListener('submit',async e=>{e.preventDefault();const sr=++searchRev;party.replaceChildren();const placeholder=n('option','Selecione');placeholder.value='';party.append(placeholder);searchButton.disabled=true;try{const x=await request('/v1/hr/parties?'+new URLSearchParams({company,q:query.value.trim()}));if(!alive(r)||sr!==searchRev)return;for(const p of x.items){const o=n('option',p.legal_name+' · '+p.kind);o.value=p.id;party.append(o);}searchStatus.textContent=x.items.length+' registro(s).';}catch(err){if(alive(r))searchStatus.textContent=err.message;}finally{if(alive(r)&&sr===searchRev)searchButton.disabled=false;}});
    form(host,'Cadastrar vínculo',[['Pessoa/empresa localizada',party],['Referência funcional',input('reference','text',60)],['Tipo de vínculo',select('kind',Object.entries(kinds))],['Cargo',select('position_id',positions)],['Início efetivo',input('start_on','date')]],'/v1/hr/relationships',p=>({...p,company_id:company}));
   }
   host.append(n('h3','Vínculos e histórico'));
   for(const x of records.relationships){const card=n('article',undefined,'business-card'),last=x.movements.at(-1),ended=last?.kind==='end',current=last?.position_id||x.position_id;card.append(n('h4',x.reference+' · '+x.party_name),n('p',kinds[x.kind]+' · '+(ended?'Encerrado':'Ativo')+' · Início '+x.start_on),n('p','Cargo: '+(positions.find(p=>p[0]===current)?.[1]||'Consulte histórico')));const list=n('ol');for(const m of x.movements)list.append(n('li',m.effective_on+' · '+(m.kind==='end'?'Encerramento':positions.find(p=>p[0]===m.position_id)?.[1]||'Mudança de cargo')+' · '+m.reason));card.append(list);
    if(!ended){const next=positions.filter(p=>p[0]!==current);if(next.length)form(card,'Alterar cargo',[['Novo cargo',select('position_id',next)],['Data efetiva',input('effective_on','date')],['Justificativa',input('reason','text',300)]],'/v1/hr/relationships/'+x.id+'/movements',p=>({...p,kind:'position'}));const confirm=input('confirm');confirm.type='checkbox';form(card,'Encerrar vínculo',[['Data efetiva',input('effective_on','date')],['Justificativa',input('reason','text',300)],['Confirmo encerramento administrativo',confirm]],'/v1/hr/relationships/'+x.id+'/movements',p=>{delete p.confirm;return {...p,kind:'end'};});}host.append(card);}
   if(!records.relationships.length)host.append(n('p','Nenhum vínculo cadastrado.'));
   host.hidden=false;status.textContent='Consulta concluída. Até 500 cargos e vínculos por empresa.';
  }catch(err){if(alive(r)){host.replaceChildren();host.hidden=true;status.textContent=err.message;}}finally{if(alive(r))refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);return {load,reset};
}
