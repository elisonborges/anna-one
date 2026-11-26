// Central Contábil: apenas publicações autorizadas pelo servidor.
export function accountingDocuments(grants, publications) {
  const allowed = new Set(grants.filter(g => g.portal_role === 'accountant').map(g => g.id));
  return publications.filter(p => allowed.has(p.grant_id) && ['fiscal','financial','contract','corporate'].includes(p.category));
}
const categories={fiscal:'Fiscal',financial:'Financeiro',contract:'Contratos',corporate:'Corporativo'};
const kinds={document:'Documento',statement:'Extrato',reconciliation:'Conciliação',pending:'Evidência de pendência'};
export function filterAccountingDocuments(docs,{grant='',month='',kind='',category=''}={}){
  return docs.filter(p=>(!grant||p.grant_id===grant)&&(!month||(month==='unassigned'?!p.accounting_competence:p.accounting_competence?.slice(0,7)===month))&&(!kind||p.accounting_kind===kind)&&(!category||p.category===category));
}
// JSON de metadados; não contém PDF ou credenciais.
export function accountingManifest(docs){
  return {format:'anna-accounting-manifest-v1',generated_at:new Date().toISOString(),documents:docs.map(p=>({publication_id:p.id,grant_id:p.grant_id,company:p.company_name,reference:p.reference,title:p.title,category:p.category,competence:p.accounting_competence||null,kind:p.accounting_kind||null,version:p.version_no,filename:p.filename,sha256:p.sha256_hex,size_bytes:p.size_bytes}))};
}
export function renderAccountingCenter(host, grants, publications, onDownload, onExport) {
  host.replaceChildren();
  const scope=grants.filter(g=>g.portal_role==='accountant');
  if(!scope.length){host.hidden=true;return;}
  host.hidden=false;
  const make=(tag,value)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=value;return el;};
  const docs=accountingDocuments(grants,publications);
  const heading=make('h2','Central Contábil');
  const note=make('p','Documentos publicados individualmente. Competência não é a data de publicação. Pendências são evidências compartilhadas, não solicitações de trabalho.');
  const filters=make('div');filters.className='filters';
  const select=(name,items)=>{const label=make('label',name),el=make('select');for(const [value,text] of items){const o=make('option',text);o.value=value;el.append(o);}label.append(el);filters.append(label);return el;};
  const grant=select('Concessão',[['','Todas as concessões'],...scope.map(g=>[g.id,(docs.find(p=>p.grant_id===g.id)?.company_name||g.company_id)+' / '+g.id])]);
  const month=select('Competência',[['','Todas'],['unassigned','Não informada'],...Array.from(new Set(docs.map(p=>p.accounting_competence?.slice(0,7)).filter(Boolean))).sort().reverse().map(m=>[m,m])]);
  const kind=select('Classificação',[['','Todas'],...Object.entries(kinds)]);
  const category=select('Categoria',[['','Todas'],...Object.entries(categories)]);
  const list=make('div');list.className='business-grid';
  const status=make('p');status.setAttribute('role','status');
  const exportButton=make('button','Exportar relação JSON');exportButton.type='button';exportButton.className='btn light';
  const exportStatus=make('p');exportStatus.setAttribute('role','status');
  const selected=()=>filterAccountingDocuments(docs,{grant:grant.value,month:month.value,kind:kind.value,category:category.value});
  function show(){
    list.replaceChildren();const visible=selected();
    status.textContent=visible.length+' documento(s) autorizado(s).';
    exportButton.disabled=!visible.length;
    for(const p of visible){
      const card=make('article');card.className='business-card';
      const button=make('button','Baixar PDF');button.type='button';button.className='btn light';
      const message=make('p');message.setAttribute('role','status');
      button.addEventListener('click',()=>onDownload(p,button,message));
      card.append(make('h3',p.title+' · v'+p.version_no),make('p',p.company_name+' · '+p.reference),make('p',(categories[p.category]||p.category)+' · '+(kinds[p.accounting_kind]||'Sem classificação')),make('p','Competência: '+(p.accounting_competence?.slice(0,7)||'Não informada')),make('p',p.filename),button,message);
      list.append(card);
    }
  }
  for(const f of [grant,month,kind,category])f.addEventListener('change',show);
  exportButton.addEventListener('click',()=>onExport(selected(),exportButton,exportStatus));
  host.append(heading,note,filters,status,exportButton,exportStatus,list);show();
}
