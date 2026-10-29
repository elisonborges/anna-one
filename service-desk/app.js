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
  $('recent-list').innerHTML = tickets.slice(0, 4).map(ticketHtml).join('');
  const filter = $('status-filter').value;
  const filtered = tickets.filter(t => filter === 'todos' || t.status === filter);
  $('ticket-list').innerHTML = filtered.length ? filtered.map(ticketHtml).join('') : '<div class="empty">Nenhum chamado encontrado.</div>';
}
function showTicket(id) {
  selectedId = id;
  const ticket = tickets.find(t => t.id === id);
  if (!ticket) return;
  const timeline = ticket.events.map(event => `<div class="event"><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.note)}</p><small>Evento demonstrativo</small></div>`).join('');
  $('detail-content').innerHTML = `<h2 class="detail-title">#${ticket.id.toString().padStart(4,'0')} · ${escapeHtml(ticket.title)}</h2><div class="detail-meta"><span class="pill ${statusClass(ticket.status)}">${escapeHtml(ticket.status)}</span><span>${escapeHtml(ticket.category)}${ticket.subcategory ? ' · ' + escapeHtml(ticket.subcategory) : ''}</span><span>Prioridade: ${escapeHtml(ticket.priority)}</span></div><div class="detail-description">${escapeHtml(ticket.description)}</div><h2>Histórico do chamado</h2><div class="timeline">${timeline}</div>${role === 'tecnico' ? `<div class="technician"><label for="next-status">Atualizar status (somente simulação)</label><select id="next-status"><option>Aberto</option><option>Em andamento</option><option>Pendente</option><option>Resolvido</option></select><button id="save-status" class="primary">Salvar status</button></div>` : ''}`;
  if (role === 'tecnico') {
    $('next-status').value = ticket.status;
    $('save-status').addEventListener('click', () => {
      const next = $('next-status').value;
      if (next !== ticket.status) { ticket.status = next; ticket.events.push({ title: 'Status alterado para ' + next, note: 'Alteração fictícia realizada na demonstração.' }); }
      showTicket(ticket.id);
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
$('status-filter').addEventListener('change', renderLists);
$('role').addEventListener('change', event => { role = event.target.value; if (!$('detalhe').hidden && selectedId !== null) showTicket(selectedId); });
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
  const id = Math.max(0, ...tickets.map(t => t.id)) + 1;
  tickets.unshift({ id, title: String(data.get('title')).trim(), category: String(data.get('category')), subcategory: String(data.get('subcategory')), priority: String(data.get('priority')), description: String(data.get('description')).trim(), status: 'Aberto', events: [{ title: 'Chamado registrado', note: 'Criado neste protótipo offline, sem envio ao servidor.' }] });
  form.reset();
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
