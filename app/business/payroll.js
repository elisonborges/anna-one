// Folha externa agregada: sem holerites, CPF, salários individuais ou persistência local.
const labels={net_pay:'Líquido agregado',tax:'Tributos',social_charge:'Encargos',benefit:'Benefícios',other:'Outras obrigações'};
const states={imported:'Importado',cancelled:'Cancelado',approved:'Aprovado',integrated:'Integrado'};
export function parsePayrollFile(text){
 if(typeof text!=='string'||text.length>50000)throw Error('Arquivo excede 50 mil caracteres.');
 const data=JSON.parse(text.replace(/^\uFEFF/,''));
 if(!Array.isArray(data)||data.length<1||data.length>100||!data.every(x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===5&&Object.hasOwn(labels,x.kind)&&typeof x.payee_id==='string'&&typeof x.amount==='string'&&typeof x.issued_on==='string'&&typeof x.due_on==='string'))throw Error('Use o modelo JSON agregado, com 1 a 100 linhas e cinco campos.');
 return data;
}
export function createPayrollPanel({host,status,refresh,request,authorized}){
 let rev=0,company='',busy=false;
 const n=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;};
 const input=(name,type='text',max=120)=>{const e=n('input');e.name=name;e.type=type;e.required=true;if(type==='text')e.maxLength=max;return e;};
 const select=(name,values)=>{const e=n('select');e.name=name;e.required=true;const p=n('option','Selecione');p.value='';e.append(p);for(const [v,l] of values){const o=n('option',l);o.value=v;e.append(o);}return e;};
 const field=(l,e)=>{const x=n('label',l);x.append(e);return x;};
 const alive=r=>r===rev&&authorized();
 function clear(){rev++;host.replaceChildren();host.hidden=true;refresh.disabled=false;status.textContent='Aguardando consulta.';}
 function reset(){company='';clear();}
 function form(parent,title,fields,path,transform=x=>x){
  const f=n('form',undefined,'corporate-box'),box=n('div',undefined,'filters'),button=n('button','Confirmar registro','btn'),msg=n('p');msg.setAttribute('role','status');button.type='submit';
  for(const [label,el] of fields)box.append(field(label,el));f.append(n('h4',title),box,button,msg);parent.append(f);const r=rev;let op=null,key=null;
  f.addEventListener('submit',async e=>{e.preventDefault();if(busy||!alive(r))return;busy=true;button.disabled=true;try{const p=await transform(Object.fromEntries(new FormData(f)));if(!alive(r))return;const k=JSON.stringify(p);if(k!==key){key=k;op=crypto.randomUUID();}const d=await request(path,'POST',{...p,request_id:op});if(!d?.item)throw Error('Confirmação não recebida.');if(alive(r))await load();}catch(err){if(alive(r))msg.textContent=err.message;}finally{busy=false;button.disabled=false;}});
 }
 const confirm=()=>{const e=input('confirmed');e.type='checkbox';return e;};
 const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v));
 async function load(){
  if(!authorized())return;clear();const r=rev;refresh.disabled=true;status.textContent='Verificando autorização de folha...';
  try{const scope=await request('/v1/payroll');if(!alive(r))return;if(!scope?.admin||!Array.isArray(scope.companies)||!Array.isArray(scope.grants))throw Error('Acesso indisponível.');
   const admin=n('section',undefined,'corporate-box');admin.append(n('h3','Concessões específicas de folha'),n('p','Somente proprietários Business com concessão específica por empresa operam folha. A concessão de RH não habilita folha. Seu UUID: '+scope.actor_id));
   form(admin,'Conceder acesso',[['Empresa',select('company_id',scope.companies.map(x=>[x.id,x.name]))],['UUID do proprietário autorizado',input('user_id','text',36)],['Justificativa',input('reason','text',300)],['Confirmo a autorização',confirm()]],'/v1/payroll/grants',p=>({company_id:p.company_id,user_id:p.user_id,reason:p.reason}));
   for(const g of scope.grants){const card=n('article',undefined,'business-card');card.append(n('p',(scope.companies.find(c=>c.id===g.company_id)?.name||g.company_id)+' · '+g.user_id+' · '+(g.revoked_at?'Revogada':'Não revogada')+' · '+g.reason));if(!g.revoked_at)form(card,'Revogar',[['Justificativa',input('reason','text',300)]],'/v1/payroll/grants/'+g.id+'/revoke');admin.append(card);}host.append(admin);
   const allowed=scope.companies.filter(x=>x.allowed===true);if(!allowed.some(x=>x.id===company))company=allowed[0]?.id||'';
   if(!company){host.append(n('p','Nenhuma concessão específica de folha disponível.'));host.hidden=false;status.textContent='Consulta concluída.';return;}
   const chooser=select('company',allowed.map(x=>[x.id,x.name]));chooser.value=company;chooser.addEventListener('change',()=>{company=chooser.value;load();});host.append(field('Empresa',chooser));
   const d=await request('/v1/payroll/records?'+new URLSearchParams({company}));if(!alive(r))return;if(d?.allowed!==true||![d.periods,d.batches,d.payees,d.accountants].every(Array.isArray))throw Error('Registros indisponíveis.');
   form(host,'Abrir competência',[['Mês de referência',input('competence','month')]],'/v1/payroll/periods',p=>({...p,company_id:company}));
   host.append(n('h3','Importar folha processada externamente'),n('p','Importe exclusivamente totais por categoria e beneficiário PJ real. Não utilize conta intermediária como beneficiário se ela não for credora. Não inclua nomes de empregados, CPF, salários individuais ou dados de saúde. O formato é JSON, não um arquivo oficial de folha.'));
   const sample=n('pre',JSON.stringify([{kind:'tax',payee_id:'UUID-DO-BENEFICIARIO-PJ',amount:'100.00',issued_on:'2026-11-25',due_on:'2026-12-20'}],null,2));host.append(sample,n('p','Categorias: '+Object.entries(labels).map(([k,v])=>k+' = '+v).join('; ')));
   const details=n('details');details.append(n('summary','Beneficiários PJ cadastrados e seus UUIDs'));for(const p of d.payees)details.append(n('p',p.name+' · '+p.id));host.append(details);
   const open=d.periods.filter(p=>!d.batches.some(b=>b.period_id===p.id&&b.status!=='cancelled'));
   if(open.length){const file=input('file','file');file.accept='.json,application/json';form(host,'Importar arquivo agregado',[['Competência',select('period_id',open.map(p=>[p.id,p.competence.slice(0,7)]))],['Referência da origem',input('source_reference')],['Arquivo JSON',file]],'/v1/payroll/batches',async p=>{if(!p.file||p.file.size>50000)throw Error('Arquivo excede o limite.');return {period_id:p.period_id,source_reference:p.source_reference,lines:parsePayrollFile(await p.file.text())};});}
   host.append(n('h3','Lotes e integrações'));
   for(const b of d.batches){const card=n('article',undefined,'business-card'),month=d.periods.find(p=>p.id===b.period_id)?.competence.slice(0,7)||'Competência anterior';card.append(n('h4',month+' · '+states[b.status]),n('p',b.source_reference+' · '+money(b.total)),n('p','SHA-256 dos dados normalizados: '+b.source_hash,'muted small'));for(const [i,x] of b.lines.entries()){const link=b.obligations.find(l=>l.line_no===i+1);card.append(n('p',labels[x.kind]+' · '+(d.payees.find(p=>p.id===x.payee_id)?.name||x.payee_id)+' · '+money(x.amount)+' · Emissão '+x.issued_on+' · Vencimento '+x.due_on+(link?' · Obrigação #'+link.code:'')));}if(b.decision_reason)card.append(n('p','Decisão: '+b.decision_reason));
    if(b.status==='imported')form(card,'Aprovar ou cancelar após conferência',[['Decisão',select('status',[['approved','Aprovar'],['cancelled','Cancelar']])],['Justificativa',input('reason','text',300)],['Conferi os valores e beneficiários',confirm()]],'/v1/payroll/batches/'+b.id+'/decision',p=>({...p,confirmed:true}));
    if(b.status==='approved')form(card,'Gerar obrigações financeiras',[['Confirmo lançamento a pagar para todos os beneficiários e valores',confirm()]],'/v1/payroll/batches/'+b.id+'/integrate',()=>({confirmed:true}));
    if(b.status==='integrated'){for(const l of b.handoffs)card.append(n('p','Pendência contábil registrada: '+l.pendency_id));const grants=d.accountants.filter(g=>!b.handoffs.some(l=>l.grant_id===g.id));if(grants.length)form(card,'Encaminhar conferência à Central Contábil',[['Concessão de contador',select('grant_id',grants.map(g=>[g.id,g.name+' · '+g.user_id]))],['Confirmo o envio de pendência sem valores individuais',confirm()]],'/v1/payroll/batches/'+b.id+'/handoff',p=>({...p,confirmed:true}));}
    host.append(card);
   }
   if(!d.batches.length)host.append(n('p','Nenhum lote importado.'));
   host.hidden=false;status.textContent='Consulta concluída. Até 120 competências e 100 lotes.';
  }catch(err){if(alive(r)){host.replaceChildren();host.hidden=true;status.textContent=err.message;}}finally{if(alive(r))refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);return {load,reset};
}
