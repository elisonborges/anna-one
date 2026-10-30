const examples = [
  { id: 1, title: 'Computador não inicia', category: 'Computadores', priority: 'Alta', status: 'Em andamento', description: 'O computador da secretaria não inicia após ligar.', events: [{ title: 'Chamado registrado', note: 'Solicitação aberta pelo usuário.' }, { title: 'Atendimento iniciado', note: 'Equipe de suporte iniciou a análise.' }] },
  { id: 2, title: 'Impressora sem conexão', category: 'Impressoras', priority: 'Normal', status: 'Pendente', description: 'A impressora de rede está indisponível.', events: [{ title: 'Chamado registrado', note: 'Solicitação aberta pelo usuário.' }, { title: 'Aguardando informações', note: 'Pendente de detalhes do equipamento.' }] },
  { id: 3, title: 'Acesso ao sistema', category: 'Sistemas', priority: 'Normal', status: 'Resolvido', description: 'Dificuldade de acesso ao sistema de testes.', events: [{ title: 'Chamado registrado', note: 'Solicitação aberta pelo usuário.' }, { title: 'Chamado resolvido', note: 'Acesso restabelecido (simulação).' }] },
  { id: 4, title: 'Rede instável na sala', category: 'Rede e internet', priority: 'Baixa', status: 'Aberto', description: 'A conexão oscila durante as atividades.', events: [{ title: 'Chamado registrado', note: 'Solicitação aberta pelo usuário.' }] }
];
let tickets = structuredClone(examples);
let selectedId = null;
let role = 'solicitante';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const statusClass = status => status === 'Pendente' ? 'pending' : status === 'Resolvido' ? 'done' : status === 'Aberto' ? 'open' : '';
// Prazos ilustrativos, não representam SLA contratual ou medição real.
const simulatedSla = ticket => {
  if (ticket.status === 'Resolvido') return {key:'concluido',label:'Concluído'};
  if (ticket.priority === 'Alta') return {key:'atencao',label:'Atenção · 4h'};
  if (ticket.priority === 'Normal') return {key:'dentro',label:'Referência · 24h'};
  return {key:'dentro',label:'Referência · 72h'};
};
function show(view) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  for (const button of document.querySelectorAll('.nav-item')) button.classList.toggle('active', button.dataset.view === view);
  $('page-title').textContent = ({ inicio:'Visão geral', chamados:'Chamados', novo:'Abrir chamado', detalhe:'Detalhes do chamado', dashboards:'Dashboards', catalogo:'Contratos e prestadores' })[view];
  if (view === 'inicio' || view === 'chamados') renderLists();
  if (view === 'dashboards') renderDashboards();
  window.scrollTo({ top:0, behavior:'instant' });
}
function ticketHtml(ticket) {
  return `<button class="ticket" data-ticket="${ticket.id}"><span><span class="ticket-title">#${ticket.id.toString().padStart(4,'0')} · ${escapeHtml(ticket.title)}</span><span class="ticket-meta">${escapeHtml(ticket.category)} · Prioridade ${escapeHtml(ticket.priority)}</span></span><span class="ticket-right"><span class="pill ${statusClass(ticket.status)}">${escapeHtml(ticket.status)}</span><span aria-hidden="true">›</span></span></button>`;
}
function renderLists() {
  $('total').textContent = tickets.length;
  $('andamento').textContent = tickets.filter(t => t.status === 'Em andamento').length;
  $('pendentes').textContent = tickets.filter(t => t.status === 'Pendente').length;
  $('resolvidos').textContent = tickets.filter(t => t.status === 'Resolvido').length;
  const categories = new Map();
  for (const ticket of tickets) {
    const category = ticket.category === 'Computadores' || ticket.category === 'Impressoras' ? 'Hardware' : ticket.category === 'Rede e internet' ? 'Rede e Internet' : ticket.category;
    categories.set(category, (categories.get(category) || 0) + 1);
  }
  const categoryMax = Math.max(1, ...categories.values());
  $('overview-categories').innerHTML = categories.size
    ? [...categories.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) =>
        '<div class="category-row"><div class="category-row-label"><span>' + escapeHtml(category) + '</span><strong>' + count + '</strong></div><div class="category-track"><span style="width:' + (count / categoryMax * 100) + '%"></span></div></div>'
      ).join('')
    : '<p class="empty">Nenhum chamado para exibir.</p>';
  $('recent-list').innerHTML = tickets.length
    ? tickets.slice(0, 5).map(ticket =>
        '<tr><td><button class="ticket-link" data-ticket="' + ticket.id + '">#' + String(ticket.id).padStart(4, '0') + '</button></td><td>' + escapeHtml(ticket.title) + '</td><td>' + escapeHtml(ticket.category) + '</td><td>' + escapeHtml(ticket.priority) + '</td><td><span class="pill ' + statusClass(ticket.status) + '">' + escapeHtml(ticket.status) + '</span></td></tr>'
      ).join('')
    : '<tr><td colspan="5" class="empty">Nenhum chamado recente.</td></tr>';
  const categorySelect = $('category-filter');
  const selectedCategory = categorySelect.value;
  const categoriesAvailable = [...new Set(tickets.map(t => t.category))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  categorySelect.replaceChildren(new Option('Todas', 'todos'));
  for (const category of categoriesAvailable) categorySelect.add(new Option(category, category));
  categorySelect.value = categoriesAvailable.includes(selectedCategory) ? selectedCategory : 'todos';
  const assigneeSelect = $('assignee-filter');
  const selectedAssignee = assigneeSelect.value;
  const assignees = [...new Set(tickets.map(t => t.assignee).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  assigneeSelect.replaceChildren(new Option('Todos', 'todos'), new Option('Não atribuído', 'unassigned'));
  for (const assignee of assignees) assigneeSelect.add(new Option(assignee, assignee));
  assigneeSelect.value = selectedAssignee === 'unassigned' || assignees.includes(selectedAssignee) ? selectedAssignee : 'todos';
  const query = $('ticket-search').value.trim().toLocaleLowerCase('pt-BR');
  const status = $('status-filter').value;
  const priority = $('priority-filter').value;
  const slaFilter = $('sla-filter').value;
  const filtered = tickets.filter(t =>
    (status === 'todos' || t.status === status) &&
    (priority === 'todos' || t.priority === priority) &&
    (slaFilter === 'todos' || simulatedSla(t).key === slaFilter) &&
    (categorySelect.value === 'todos' || t.category === categorySelect.value) &&
    (assigneeSelect.value === 'todos' || (assigneeSelect.value === 'unassigned' ? !t.assignee : t.assignee === assigneeSelect.value)) &&
    (!query || String(t.id).includes(query.replace(/^#/, '')) || t.title.toLocaleLowerCase('pt-BR').includes(query))
  );
  $('ticket-result-count').textContent = filtered.length + (filtered.length === 1 ? ' chamado encontrado' : ' chamados encontrados');
  $('ticket-list').innerHTML = filtered.length ? filtered.map(t =>
    '<tr><td>#' + String(t.id).padStart(4, '0') + '</td><td>' + escapeHtml(t.title) + '</td><td>' + escapeHtml(t.category) + '</td><td>' + escapeHtml(t.subcategory || '—') + '</td><td>' + escapeHtml(t.priority) + '</td><td><span class="pill ' + statusClass(t.status) + '">' + escapeHtml(t.status) + '</span></td><td>' + escapeHtml(t.assignee || 'Não atribuído') + '</td><td><span class="sla-chip sla-' + simulatedSla(t).key + '">' + escapeHtml(simulatedSla(t).label) + '</span></td><td><button class="ticket-link" data-ticket="' + t.id + '">Visualizar</button></td></tr>'
  ).join('') : '<tr><td colspan="9" class="empty">Nenhum chamado encontrado.</td></tr>';
}
const demoTechnicians = ['Equipe de TI', 'Suporte de infraestrutura', 'Suporte de sistemas', 'Prestador externo'];
function showTicket(id) {
  selectedId = id;
  const ticket = tickets.find(t => t.id === id);
  if (!ticket) return;
  const timeline = ticket.events.map(event => '<div class="event"><strong>' + escapeHtml(event.title) + '</strong><p>' + escapeHtml(event.note) + '</p><small>Evento demonstrativo</small></div>').join('');
  const assignee = ticket.assignee || 'Não atribuído';
  const extra = ticket.requester ? '<div class="ticket-context"><h3>Solicitante e localização</h3><p><strong>Solicitante:</strong> ' + escapeHtml(ticket.requester) + ' · <strong>Contato:</strong> ' + escapeHtml(ticket.contact || 'Não informado') + '</p><p><strong>Unidade:</strong> ' + escapeHtml(ticket.unit) + ' · <strong>Setor:</strong> ' + escapeHtml(ticket.department) + '</p><p><strong>Impacto:</strong> ' + escapeHtml(ticket.impact) + ' · <strong>Urgência:</strong> ' + escapeHtml(ticket.urgency) + ' · <strong>Disponibilidade:</strong> ' + escapeHtml(ticket.availability) + '</p>' + (ticket.attempts ? '<p><strong>Verificações realizadas:</strong> ' + escapeHtml(ticket.attempts) + '</p>' : '') + '</div>' : '';
  const assetInfo = ticket.asset ? '<div class="ticket-context"><h3>Equipamento vinculado (simulação)</h3><div class="asset-facts">' + [['Identificação',ticket.asset.id],['Tipo',ticket.asset.type],['Patrimônio',ticket.asset.tag],['Série',ticket.asset.serial],['Fabricante',ticket.asset.brand],['Modelo',ticket.asset.model],['Sistema',ticket.asset.os],['Localização',ticket.asset.location],['Situação',ticket.asset.state]].map(([label,value]) => '<div><small>' + escapeHtml(label) + '</small><span>' + escapeHtml(value || 'Não informado') + '</span></div>').join('') + '</div></div>' : '';
  const technicianForm = role === 'tecnico' ? `
    <form id="technical-form" class="technical-form">
      <h2>Atendimento técnico <span class="pill open">Simulação</span></h2>
      <div class="technical-fields">
        <label>Responsável<select name="assignee"><option value="">Não atribuído</option>${demoTechnicians.map(name => '<option value="' + escapeHtml(name) + '"' + (ticket.assignee === name ? ' selected' : '') + '>' + escapeHtml(name) + '</option>').join('')}</select></label>
        <label>Situação<select name="status">${['Aberto','Em andamento','Pendente','Resolvido'].map(value => '<option' + (ticket.status === value ? ' selected' : '') + '>' + value + '</option>').join('')}</select></label>
        <label>Prioridade<select name="priority">${['Baixa','Normal','Alta'].map(value => '<option' + (ticket.priority === value ? ' selected' : '') + '>' + value + '</option>').join('')}</select></label>
      </div>
      <label>Observação do atendimento<textarea name="note" rows="3" maxlength="1000" placeholder="Descreva a ação realizada (opcional)"></textarea></label>
      <div class="form-actions"><button class="primary" type="submit">Salvar atendimento de teste</button></div>
    </form>` : '';
  $('detail-content').innerHTML = '<h2 class="detail-title">#' + String(ticket.id).padStart(4,'0') + ' · ' + escapeHtml(ticket.title) + '</h2><div class="detail-meta"><span class="pill ' + statusClass(ticket.status) + '">' + escapeHtml(ticket.status) + '</span><span>' + escapeHtml(ticket.category) + (ticket.subcategory ? ' · ' + escapeHtml(ticket.subcategory) : '') + '</span><span>Prioridade: ' + escapeHtml(ticket.priority) + '</span><span>Responsável: ' + escapeHtml(assignee) + '</span></div><div class="detail-description">' + escapeHtml(ticket.description) + '</div>' + extra + assetInfo + technicianForm + '<p id="technical-feedback" class="technical-feedback" role="status"></p><h2>Histórico do chamado</h2><div class="timeline">' + timeline + '</div>';
  if (role === 'tecnico') {
    $('technical-form').addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const nextStatus = String(data.get('status'));
      const nextPriority = String(data.get('priority'));
      const nextAssignee = String(data.get('assignee'));
      const note = String(data.get('note')).trim();
      const changes = [];
      if (nextStatus !== ticket.status) changes.push('Situação: ' + ticket.status + ' → ' + nextStatus);
      if (nextPriority !== ticket.priority) changes.push('Prioridade: ' + ticket.priority + ' → ' + nextPriority);
      if (nextAssignee !== (ticket.assignee || '')) changes.push('Responsável: ' + (ticket.assignee || 'Não atribuído') + ' → ' + (nextAssignee || 'Não atribuído'));
      if (!changes.length && !note) { $('technical-feedback').textContent = 'Nenhuma alteração para salvar.'; return; }
      ticket.status = nextStatus;
      ticket.priority = nextPriority;
      ticket.assignee = nextAssignee;
      ticket.events.push({title:'Atendimento atualizado (simulação)',note: [changes.join(' | '),note].filter(Boolean).join(' — ')});
      showTicket(ticket.id);
      $('technical-feedback').textContent = 'Atendimento registrado apenas nesta sessão.';
    });
  }
  show('detalhe');
}

document.addEventListener('click', event => {
  const ticketButton = event.target.closest('[data-ticket]');
  if (ticketButton) return showTicket(Number(ticketButton.dataset.ticket));
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) show(viewButton.dataset.view);
});
$('new-top').addEventListener('click', () => show('novo'));
$('back').addEventListener('click', () => show('chamados'));
for (const id of ['status-filter', 'priority-filter', 'category-filter', 'assignee-filter', 'sla-filter']) $(id).addEventListener('change', renderLists);
$('ticket-search').addEventListener('input', renderLists);
$('clear-ticket-filters').addEventListener('click', () => { $('ticket-search').value = ''; for (const id of ['status-filter','priority-filter','category-filter','assignee-filter','sla-filter']) $(id).value = 'todos'; renderLists(); });
$('role').addEventListener('change', event => { role = event.target.value; if (!$('detalhe').hidden && selectedId !== null) showTicket(selectedId); });
// Inventário estritamente fictício: sem chamadas de rede ou vínculo com LabManager.
const demoAssets = [
  {id:'LAB-04',type:'Desktop',location:'Laboratório de Informática · Bancada 04',tag:'PAT-004',serial:'SN-DEMO-004',brand:'Dell',model:'OptiPlex',os:'Windows 11',state:'Em uso'},
  {id:'ADM-02',type:'Notebook',location:'Secretaria',tag:'PAT-021',serial:'SN-DEMO-021',brand:'Lenovo',model:'ThinkPad',os:'Windows 11',state:'Em uso'},
  {id:'IMP-01',type:'Impressora',location:'Sala dos professores',tag:'PAT-031',serial:'SN-DEMO-031',brand:'HP',model:'LaserJet',os:'Não aplicável',state:'Em uso'},
  {id:'LAB-08',type:'Desktop',location:'Laboratório de Informática · Bancada 08',tag:'PAT-008',serial:'SN-DEMO-008',brand:'Acer',model:'Veriton',os:'Linux',state:'Em manutenção'}
];
function renderDemoAssets() {
  const query = $('asset-search').value.trim().toLocaleLowerCase('pt-BR');
  const selected = $('asset-select').value;
  const matches = demoAssets.filter(asset => [asset.id,asset.type,asset.location,asset.tag,asset.serial,asset.brand,asset.model].some(v => v.toLocaleLowerCase('pt-BR').includes(query)));
  $('asset-select').replaceChildren(new Option('Selecione um equipamento', ''));
  for (const asset of matches) $('asset-select').add(new Option(asset.id + ' · ' + asset.type + ' · ' + asset.location, asset.id));
  $('asset-select').value = matches.some(asset => asset.id === selected) ? selected : '';
  showAssetSummary();
}
function showAssetSummary() {
  const asset = demoAssets.find(item => item.id === $('asset-select').value);
  $('asset-summary').innerHTML = asset ? '<strong>Dados do inventário fictício</strong><div class="asset-facts">' + [['Equipamento',asset.id],['Tipo',asset.type],['Patrimônio',asset.tag],['Série',asset.serial],['Fabricante',asset.brand],['Modelo',asset.model],['Sistema',asset.os],['Localização',asset.location],['Situação',asset.state]].map(([label,value]) => '<div><small>' + escapeHtml(label) + '</small><span>' + escapeHtml(value) + '</span></div>').join('') + '</div>' : 'Selecione um equipamento para consultar os dados fictícios.';
}
function updateAssetMode() {
  const inventory = document.querySelector('input[name="assetMode"]:checked').value === 'inventory';
  $('asset-inventory').hidden = !inventory;
  $('asset-manual').hidden = inventory;
  $('asset-select').required = inventory;
  $('manual-type').required = !inventory;
}
document.querySelectorAll('input[name="assetMode"]').forEach(input => input.addEventListener('change', updateAssetMode));
$('asset-search').addEventListener('input', renderDemoAssets);
$('asset-select').addEventListener('change', showAssetSummary);
renderDemoAssets();
updateAssetMode();
const ticketSubcategories = {
  'Hardware': ['Computador', 'Notebook', 'Monitor', 'Teclado', 'Mouse', 'Impressora', 'Projetor'],
  'Software': ['Sistema operacional', 'Aplicativos', 'Instalação', 'Atualização', 'Licenciamento'],
  'Rede e Internet': ['Wi-Fi', 'Cabeamento', 'Internet', 'Roteador', 'Switch'],
  'Sistemas': ['Acesso', 'Login e senha', 'Erro no sistema', 'Permissões'],
  'Periféricos': ['Scanner', 'Webcam', 'Áudio', 'Outros dispositivos'],
  'Outros': ['Manutenção', 'Solicitação geral', 'Outros']
};
function updateTicketSubcategories() {
  const select = $('ticket-subcategory');
  const options = ticketSubcategories[$('ticket-category').value] || [];
  select.replaceChildren(new Option(options.length ? 'Selecione a subcategoria' : 'Selecione primeiro a categoria', ''));
  for (const option of options) select.add(new Option(option, option));
  select.disabled = options.length === 0;
}
$('ticket-category').addEventListener('change', updateTicketSubcategories);
updateTicketSubcategories();
$('new-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const inventoryMode = data.get('assetMode') === 'inventory';
  const asset = inventoryMode ? demoAssets.find(item => item.id === data.get('assetId')) : null;
  if (inventoryMode && !asset) { $('asset-select').setCustomValidity('Selecione um equipamento.'); $('asset-select').reportValidity(); $('asset-select').setCustomValidity(''); return; }
  const manualAsset = inventoryMode ? null : {
    id:String(data.get('manualTag') || '').trim() || 'Sem patrimônio',
    type:String(data.get('manualType')),tag:String(data.get('manualTag') || ''),
    brand:String(data.get('manualBrand') || ''),model:String(data.get('manualModel') || ''),
    serial:String(data.get('manualSerial') || ''),location:String(data.get('manualLocation') || ''),
    os:'Não informado',state:'Não cadastrado'
  };
  const id = Math.max(0, ...tickets.map(t => t.id)) + 1;
  const urgency = String(data.get('urgency'));
  tickets.unshift({
    id, title:String(data.get('title')).trim(), category:String(data.get('category')),
    subcategory:String(data.get('subcategory')), priority:urgency === 'Alta' ? 'Alta' : urgency === 'Baixa' ? 'Baixa' : 'Normal',
    urgency, impact:String(data.get('impact')), description:String(data.get('description')).trim(),
    requester:String(data.get('requester')).trim(),contact:String(data.get('contact') || '').trim(),
    unit:String(data.get('unit')).trim(),department:String(data.get('department')),
    asset:asset ? {...asset} : manualAsset, attempts:String(data.get('attempts') || '').trim(),
    availability:String(data.get('availability')), status:'Aberto',
    events:[{title:'Chamado registrado',note:'Registro demonstrativo criado nesta sessão, sem envio a servidor.'}]
  });
  form.reset();
  $('asset-search').value = '';
  renderDemoAssets();
  updateAssetMode();
  updateTicketSubcategories();
  showTicket(id);
});
// Fictional aggregates are deliberately isolated from live tickets and API credentials.
const dashboardFixtures = {
  contratos: { description: 'Contratos ativos e cumprimento dos prazos por contrato.', stats: [['Contratos ativos', '3'], ['Chamados vinculados', '42'], ['Dentro do SLA', '91%'], ['Vencidos', '4']], breakdown: [['Contrato de suporte regional', 24], ['Contrato de redes', 12], ['Contrato de impressão', 6]] },
  escolas: { description: 'Chamados e pendências de uma unidade escolar fictícia.', stats: [['Chamados da escola', '18'], ['Em andamento', '7'], ['Pendentes', '3'], ['Resolvidos', '8']], breakdown: [['Computadores', 9], ['Rede e internet', 6], ['Impressoras', 3]] },
  parceiros: { description: 'Fila de atendimento atribuída a um prestador fictício.', stats: [['Atribuídos', '16'], ['Em execução', '6'], ['Aguardando', '4'], ['Concluídos', '6']], breakdown: [['Suporte presencial', 8], ['Rede', 5], ['Impressoras', 3]] },
  plataforma: { description: 'Métricas operacionais agregadas da plataforma, sem conteúdo de chamados.', stats: [['Clientes fictícios', '5'], ['Chamados', '128'], ['Armazenamento', '2,4 GB'], ['Ambientes', '5']], breakdown: [['Educação', 3], ['Empresas', 2]] }
};
function renderDashboards() {
  const fixture = dashboardFixtures[$('dashboard-profile').value];
  $('dashboard-description').textContent = fixture.description;
  $('dashboard-stats').innerHTML = fixture.stats.map(([label, value]) =>
    '<article class="stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><small>Valor demonstrativo</small></article>'
  ).join('');
  const max = Math.max(1, ...fixture.breakdown.map(([, value]) => value));
  $('dashboard-breakdown').innerHTML = '<h3>Distribuição</h3>' + fixture.breakdown.map(([label, value]) =>
    '<div class="dashboard-bar-row"><div><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong></div><div class="dashboard-track"><span style="width:' + (value / max * 100) + '%"></span></div></div>'
  ).join('');
}
$('dashboard-profile').addEventListener('change', renderDashboards);
show(location.hash === '#catalogo' ? 'catalogo' : 'inicio');
