// Central Contábil: visão derivada exclusivamente das publicações autorizadas.
export function accountingDocuments(grants, publications) {
  const allowed = new Set(grants.filter(g => g.portal_role === 'accountant').map(g => g.id));
  return publications.filter(p => allowed.has(p.grant_id) && ['fiscal','financial','contract','corporate'].includes(p.category));
}
export function renderAccountingCenter(host, grants, publications, onDownload) {
  host.replaceChildren();
  if (!grants.some(g => g.portal_role === 'accountant')) { host.hidden = true; return; }
  host.hidden = false;
  const make = (tag, value) => { const el = document.createElement(tag); if(value !== undefined) el.textContent = value; return el; };
  const docs = accountingDocuments(grants, publications);
  const heading = make('h2','Central Contábil');
  const note = make('p','Consulta de documentos publicados individualmente. A data de publicação não representa a competência contábil.');
  const filter = make('select'); filter.setAttribute('aria-label','Categoria de documento');
  for(const [value,label] of [['','Todas as categorias'],['fiscal','Fiscal'],['financial','Financeiro'],['contract','Contratos'],['corporate','Corporativo']]) {
    const option=make('option',label);option.value=value;filter.append(option);
  }
  const list = make('div'); list.className='business-grid';
  const status = make('p'); status.setAttribute('role','status');
  function show(){
    list.replaceChildren();
    const visible=docs.filter(p=>!filter.value||p.category===filter.value);
    status.textContent=visible.length+' documento(s) autorizado(s).';
    for(const p of visible){
      const card=make('article');card.className='business-card';
      const button=make('button','Baixar PDF');button.type='button';button.className='btn light';
      const message=make('p');message.setAttribute('role','status');
      button.addEventListener('click',()=>onDownload(p,button,message));
      card.append(make('h3',p.title+' · v'+p.version_no),make('p',p.company_name+' · '+p.reference),make('p',p.category+' · '+p.filename),button,message);
      list.append(card);
    }
  }
  filter.addEventListener('change',show);host.append(heading,note,filter,status,list);show();
}
