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
  const attachmentsInfo = ticket.attachments && ticket.attachments.length ? '<div class="ticket-context"><h3>Anexos informados (somente simulação)</h3><ul>' + ticket.attachments.map(file => '<li>' + escapeHtml(file.name) + ' (' + Math.round(file.size / 1024) + ' KB)</li>').join('') + '</ul><p>Os arquivos não foram enviados nem armazenados; somente seus nomes aparecem nesta sessão.</p></div>' : '';
  const assetInfo = ticket.asset ? '<div class="ticket-context"><h3>Equipamento vinculado (simulação)</h3><div class="asset-facts">' + [['Identificação',ticket.asset.id],['Tipo',ticket.asset.type],['Patrimônio',ticket.asset.tag],['Série',ticket.asset.serial],['IP',ticket.asset.ip || 'Não informado'],['Fabricante',ticket.asset.brand],['Modelo',ticket.asset.model],['Sistema',ticket.asset.os],['Localização',ticket.asset.location],['Situação',ticket.asset.state]].map(([label,value]) => '<div><small>' + escapeHtml(label) + '</small><span>' + escapeHtml(value || 'Não informado') + '</span></div>').join('') + '</div></div>' : '';
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
  const followupForm = '<form id="followup-form" class="technical-form"><h2>Adicionar informação ao chamado <span class="pill open">Simulação</span></h2><label>Mensagem ou atualização<textarea name="message" rows="3" maxlength="1500" placeholder="Descreva novas informações ou responda ao atendimento"></textarea></label><label>Adicionar print ou arquivo (opcional)<input type="file" id="followup-attachments" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.doc,.docx,.xls,.xlsx"></label><p class="form-note">Até 5 arquivos de 5 MB. Somente nomes são registrados nesta sessão; não há upload.</p><div class="form-actions"><button type="submit" class="primary">Adicionar ao histórico</button></div><p id="followup-feedback" class="technical-feedback" role="status"></p></form>';
  $('detail-content').innerHTML = '<h2 class="detail-title">#' + String(ticket.id).padStart(4,'0') + ' · ' + escapeHtml(ticket.title) + '</h2><div class="detail-meta"><span class="pill ' + statusClass(ticket.status) + '">' + escapeHtml(ticket.status) + '</span><span>' + escapeHtml(ticket.category) + (ticket.subcategory ? ' · ' + escapeHtml(ticket.subcategory) : '') + (ticket.issueType ? ' · ' + escapeHtml(ticket.issueType) : '') + '</span><span>Prioridade: ' + escapeHtml(ticket.priority) + '</span><span>Responsável: ' + escapeHtml(assignee) + '</span></div><div class="detail-description">' + escapeHtml(ticket.description) + '</div>' + extra + assetInfo + attachmentsInfo + technicianForm + followupForm + '<p id="technical-feedback" class="technical-feedback" role="status"></p><h2>Histórico do chamado</h2><div class="timeline">' + timeline + '</div>';
  $('followup-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(new FormData(form).get('message') || '').trim();
    const files = Array.from($('followup-attachments').files);
    const error = validateAttachments(files);
    if (error) { $('followup-feedback').textContent = error; return; }
    if (!message && !files.length) { $('followup-feedback').textContent = 'Informe uma mensagem ou selecione um arquivo.'; return; }
    const fileInfo = files.map(file => ({name:file.name,size:file.size}));
    ticket.attachments = [...(ticket.attachments || []),...fileInfo];
    ticket.events.push({title:role === 'tecnico' ? 'Atualização do técnico (simulação)' : 'Informação do solicitante (simulação)',note:[message,fileInfo.length ? 'Arquivos informados: ' + fileInfo.map(file => file.name).join(', ') + ' (sem upload)' : ''].filter(Boolean).join(' — ')});
    showTicket(ticket.id);
  });
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
  {id:'LAB-04',type:'Desktop',location:'Laboratório de Informática · Bancada 04',tag:'PAT-004',serial:'SN-DEMO-004',ip:'192.0.2.14',brand:'Dell',model:'OptiPlex',os:'Windows 11',state:'Em uso'},
  {id:'ADM-02',type:'Notebook',location:'Secretaria',tag:'PAT-021',serial:'SN-DEMO-021',ip:'192.0.2.22',brand:'Lenovo',model:'ThinkPad',os:'Windows 11',state:'Em uso'},
  {id:'IMP-01',type:'Impressora',location:'Sala dos professores',tag:'PAT-031',serial:'SN-DEMO-031',ip:'192.0.2.31',brand:'HP',model:'LaserJet',os:'Não aplicável',state:'Em uso'},
  {id:'LAB-08',type:'Desktop',location:'Laboratório de Informática · Bancada 08',tag:'PAT-008',serial:'SN-DEMO-008',ip:'192.0.2.18',brand:'Acer',model:'Veriton',os:'Linux',state:'Em manutenção'}
];
function renderDemoAssets() {
  const query = $('asset-search').value.trim().toLocaleLowerCase('pt-BR');
  const selected = $('asset-select').value;
  const matches = demoAssets.filter(asset => [asset.id,asset.type,asset.location,asset.tag,asset.serial,asset.ip,asset.brand,asset.model].some(v => v.toLocaleLowerCase('pt-BR').includes(query)));
  $('asset-select').replaceChildren(new Option('Selecione um equipamento', ''));
  for (const asset of matches) $('asset-select').add(new Option(asset.id + ' · ' + asset.type + ' · ' + asset.location, asset.id));
  $('asset-select').value = matches.some(asset => asset.id === selected) ? selected : (!query && matches.length ? matches[0].id : '');
  showAssetSummary();
}
function showAssetSummary() {
  const asset = demoAssets.find(item => item.id === $('asset-select').value);
  $('asset-summary').innerHTML = asset ? '<strong>Dados do inventário fictício</strong><div class="asset-facts">' + [['Equipamento',asset.id],['Tipo',asset.type],['Patrimônio',asset.tag],['Série',asset.serial],['IP',asset.ip || 'Não informado'],['Fabricante',asset.brand],['Modelo',asset.model],['Sistema',asset.os],['Localização',asset.location],['Situação',asset.state]].map(([label,value]) => '<div><small>' + escapeHtml(label) + '</small><span>' + escapeHtml(value) + '</span></div>').join('') + '</div>' : 'Selecione um equipamento para consultar os dados fictícios.';
}
function updateAssetMode() {
  const mode = document.querySelector('input[name="assetMode"]:checked').value;
  const inventory = mode === 'inventory';
  const manual = mode === 'manual';
  $('asset-inventory').hidden = !inventory;
  $('asset-manual').hidden = !manual;
  $('asset-select').required = inventory;
  $('manual-type').required = manual;
}
const demoProfile = {requester:'Usuário de demonstração',contact:'usuario@exemplo.com',phone:'(86) 99999-0000',unit:'Escola Modelo',department:'Laboratório de Informática'};
let profileEditing = false;
function toggleProfileEditing(editing) {
  profileEditing = editing;
  for (const name of ['requester','contact','phone','unit']) $('new-form').elements[name].readOnly = !editing;
  $('new-form').elements.department.disabled = !editing;
  $('edit-profile').textContent = editing ? 'Concluir edição' : 'Editar dados';
  $('edit-profile').setAttribute('aria-pressed', String(editing));
}
function restoreDemoProfile() {
  for (const [name,value] of Object.entries(demoProfile)) $('new-form').elements[name].value = value;
  toggleProfileEditing(false);
}
$('edit-profile').addEventListener('click', () => toggleProfileEditing(!profileEditing));
document.querySelectorAll('input[name="assetMode"]').forEach(input => input.addEventListener('change', updateAssetMode));
$('asset-search').addEventListener('input', renderDemoAssets);
$('asset-select').addEventListener('change', showAssetSummary);
renderDemoAssets();
updateAssetMode();
restoreDemoProfile();
const ticketSubcategories = {
  'Computadores e hardware':['Desktop','Notebook','Monitor','Teclado e mouse','Memória RAM','Disco e SSD','Fonte de alimentação','Placa-mãe','Processador','Portas e conexões','Inicialização','Outro hardware'],
  'Rede e Internet':['Internet','Rede cabeada','Roteador','Switch','Firewall','Proxy','DNS','DHCP','VPN','Cabeamento','Ponto de rede','Rede local','Outro serviço de rede'],
  'Wi-Fi':['Conexão sem fio','Autenticação','Cobertura e sinal','Ponto de acesso','Rede de visitantes','Rede institucional','Outro problema Wi-Fi'],
  'Impressão e digitalização':['Impressora de rede','Impressora local','Scanner','Fila de impressão','Toner e suprimentos','Driver','Impressão frente e verso','Outro'],
  'Software e aplicativos':['Sistema operacional','Navegador','Pacote de escritório','Aplicativo institucional','Instalação','Atualização','Licença','Desempenho','Outro aplicativo'],
  'Sistemas institucionais':['Portal escolar','Sistema acadêmico','Sistema administrativo','ERP','Sistema financeiro','Sistema de biblioteca','Integração','Relatórios','Outro sistema'],
  'Contas e acessos':['Login','Senha','Permissões','Bloqueio de conta','Criação de usuário','Desativação de usuário','Autenticação multifator','Acesso remoto','Outro acesso'],
  'E-mail e comunicação':['Envio de e-mail','Recebimento de e-mail','Spam','Anexos','Caixa postal','Calendário','Videoconferência','Chat institucional','Outro'],
  'Telefonia':['Ramal','Telefone IP','Linha telefônica','Chamadas','Áudio','Central telefônica','Outro'],
  'Segurança da informação':['Antivírus','Malware','Phishing','Acesso indevido','Site bloqueado','Certificado digital','Vazamento de dados','Backup de segurança','Outro'],
  'Servidores e infraestrutura':['Servidor físico','Servidor virtual','Serviço indisponível','DNS interno','Diretório de usuários','Banco de dados','Virtualização','Energia e nobreak','Outro'],
  'Armazenamento e arquivos':['Pasta compartilhada','Permissão de arquivo','Disco de rede','Nuvem','Backup','Recuperação de arquivo','Espaço insuficiente','Outro'],
  'Equipamentos audiovisuais':['Projetor','TV e painel','Caixas de som','Microfone','Câmera','Cabo HDMI','Videoconferência','Outro'],
  'Dispositivos móveis':['Tablet','Celular','Aplicativo móvel','Conexão móvel','Carregamento','Gerenciamento de dispositivos','Outro'],
  'Robótica e tecnologia educacional':['mBot','micro:bit','Sphero','LittleBits','Kit de robótica','Arduino','Sensores','Plataforma educacional','Outro'],
  'Instalação e configuração':['Novo computador','Novo software','Impressora','Rede','Periférico','Mudança de equipamento','Outro'],
  'Manutenção preventiva':['Limpeza','Atualização programada','Verificação de hardware','Inspeção de rede','Troca preventiva','Outro'],
  'Solicitação de serviço':['Novo acesso','Novo equipamento','Mudança de local','Orientação técnica','Instalação','Configuração','Outro'],
  'Outros':['Dúvida','Orientação','Solicitação geral','Problema não listado']
};
const issueTypes = {
  'Internet':['Não funciona','Sem acesso à internet','Lentidão','Página bloqueada','Site não abre','Conexão intermitente','Erro de DNS','Erro de certificado','Erro de proxy','Acesso apenas a alguns sites','Queda frequente','Outro problema'],
  'Conexão sem fio':['Não conecta','Senha rejeitada','Sem sinal','Sinal fraco','Lentidão','Conexão cai','Rede não aparece','Autenticação falha','Outro problema'],
  'Login':['Não consigo entrar','Usuário não reconhecido','Conta bloqueada','Sessão expira','Erro de autenticação','Outro problema'],
  'Senha':['Esqueci a senha','Senha expirada','Redefinição não funciona','Alterar senha','Outro problema'],
  'Impressora de rede':['Não imprime','Impressora offline','Fila travada','Não encontrada','Impressão lenta','Erro no driver','Outro problema'],
  'Desktop':['Não liga','Não inicia o sistema','Tela preta','Travamento','Lentidão','Reinicia sozinho','Barulho anormal','Superaquecimento','Outro problema'],
  'Notebook':['Não liga','Não carrega','Bateria descarrega rápido','Tela preta','Travamento','Teclado não funciona','Wi-Fi não funciona','Outro problema'],
  'Site bloqueado':['Página bloqueada','Bloqueio indevido','Solicitar liberação','Conteúdo suspeito','Outro problema'],
  'Portal escolar':['Não abre','Erro ao acessar','Lentidão','Página em branco','Dados incorretos','Funcionalidade indisponível','Outro problema']
};
// Catálogo de classificação demonstrativo. A estrutura permite variações futuras por instituição.
const categoryIssueTypes = {
  'Computadores e hardware':['Não liga','Não inicia','Tela preta','Travamento','Lentidão','Reinicialização inesperada','Ruído ou superaquecimento','Componente não reconhecido','Mau contato','Dano físico','Substituição de peça','Configuração','Outro problema'],
  'Rede e Internet':['Sem conexão','Conexão intermitente','Lentidão','Site bloqueado','Site indisponível','Erro de DNS','Falha de autenticação','Erro de certificado','Falha de roteamento','Problema de IP','Porta de rede inativa','Configuração','Outro problema'],
  'Wi-Fi':['Rede não aparece','Sem sinal','Sinal fraco','Não conecta','Senha incorreta','Autenticação falha','Conexão cai','Lentidão','Dispositivo sem IP','Cobertura insuficiente','Outro problema'],
  'Impressão e digitalização':['Não imprime','Não digitaliza','Dispositivo offline','Papel atolado','Fila travada','Falha no driver','Qualidade ruim','Sem tinta ou toner','Falha de conexão','Configuração','Outro problema'],
  'Software e aplicativos':['Não abre','Fecha inesperadamente','Travamento','Lentidão','Erro na instalação','Erro na atualização','Licença inválida','Incompatibilidade','Funcionalidade ausente','Dados incorretos','Outro problema'],
  'Sistemas institucionais':['Sistema fora do ar','Erro no login','Página em branco','Lentidão','Erro ao salvar','Erro ao emitir relatório','Dados incorretos','Permissão insuficiente','Integração falhou','Funcionalidade indisponível','Outro problema'],
  'Contas e acessos':['Conta bloqueada','Esqueci a senha','Senha expirada','Falha no login','Acesso negado','Solicitar acesso','Alterar permissão','Criar conta','Desativar conta','Erro no segundo fator','Outro problema'],
  'E-mail e comunicação':['Não envia','Não recebe','Mensagem devolvida','Anexo bloqueado','Caixa cheia','Spam indevido','Conta bloqueada','Falha de sincronização','Áudio ou vídeo falha','Outro problema'],
  'Telefonia':['Sem linha','Não recebe chamadas','Não realiza chamadas','Sem áudio','Áudio ruim','Ramal indisponível','Falha no aparelho','Configuração','Outro problema'],
  'Segurança da informação':['Alerta de vírus','Suspeita de phishing','Site bloqueado','Acesso suspeito','Dispositivo comprometido','Certificado inválido','Vulnerabilidade','Solicitação de desbloqueio','Outro problema'],
  'Servidores e infraestrutura':['Serviço indisponível','Lentidão','Erro de inicialização','Falha de autenticação','Falha de armazenamento','Sem comunicação','Falha de backup','Falha de energia','Configuração','Outro problema'],
  'Armazenamento e arquivos':['Arquivo não abre','Arquivo desapareceu','Acesso negado','Sem espaço','Falha de sincronização','Backup falhou','Restaurar arquivo','Pasta não encontrada','Outro problema'],
  'Equipamentos audiovisuais':['Sem imagem','Sem som','Imagem distorcida','Áudio com ruído','Não liga','Não conecta','Controle não funciona','Configuração','Outro problema'],
  'Dispositivos móveis':['Não liga','Não carrega','Sem conexão','Aplicativo não abre','Tela danificada','Lentidão','Bloqueio de acesso','Configuração','Outro problema'],
  'Robótica e tecnologia educacional':['Não liga','Não conecta','Firmware ou atualização','Sensor não responde','Motor não funciona','Falha de programação','Erro de comunicação','Peça danificada','Calibração','Outro problema'],
  'Instalação e configuração':['Instalar novo dispositivo','Instalar aplicativo','Configurar rede','Configurar usuário','Migrar equipamento','Atualizar software','Reinstalar sistema','Outro pedido'],
  'Manutenção preventiva':['Limpeza programada','Inspeção','Atualização preventiva','Teste de desempenho','Verificação de segurança','Troca programada','Outro pedido'],
  'Solicitação de serviço':['Novo equipamento','Novo usuário','Nova permissão','Instalação','Mudança de local','Orientação','Configuração','Outro pedido'],
  'Outros':['Dúvida','Orientação','Solicitação não listada','Outro problema']
};
const specializedIssueTypes = {
  'Rede cabeada':['Cabo desconectado','Sem conexão','Porta inativa','IP não atribuído','Conflito de IP','Lentidão','Intermitência','Outro problema'],
  'DNS':['Nome não resolve','Site não abre pelo nome','Registro incorreto','Propagação pendente','Outro problema'],
  'DHCP':['Não recebe IP','IP duplicado','Reserva de IP','Escopo esgotado','Outro problema'],
  'VPN':['Não conecta','Autenticação falha','Conexão cai','Sem acesso à rede interna','Lentidão','Outro problema'],
  'Firewall':['Porta bloqueada','Regra incorreta','Serviço bloqueado','Solicitar liberação','Outro problema'],
  'Proxy':['Página bloqueada','Autenticação falha','Erro de proxy','Lentidão','Solicitar exceção','Outro problema'],
  'Roteador':['Sem internet','Reiniciando','Configuração incorreta','Porta inativa','Falha de energia','Outro problema'],
  'Switch':['Porta sem link','Porta bloqueada','VLAN incorreta','Falha de energia','Intermitência','Outro problema'],
  'Scanner':['Não digitaliza','Não encontrado','Imagem ilegível','Erro de driver','Falha de alimentação','Outro problema'],
  'Fila de impressão':['Documento preso','Fila não limpa','Trabalho duplicado','Falha de spooler','Outro problema'],
  'Sistema operacional':['Não inicia','Atualização falha','Tela azul','Travamento','Lentidão','Erro de usuário','Outro problema'],
  'Navegador':['Não abre','Página bloqueada','Certificado inválido','Extensão falha','Cache ou cookies','Lentidão','Outro problema'],
  'Videoconferência':['Sem áudio','Sem vídeo','Não entra na reunião','Conexão cai','Compartilhamento de tela falha','Outro problema'],
  'Pasta compartilhada':['Acesso negado','Pasta não encontrada','Conexão indisponível','Arquivo bloqueado','Outro problema'],
  'Backup':['Cópia falhou','Restauração falhou','Backup ausente','Agendamento não executou','Outro problema'],
  'mBot':['Não conecta','Motor não gira','Sensor não responde','Bateria','Firmware','Programação','Outro problema'],
  'micro:bit':['Não conecta','Programa não transfere','Sensor não responde','Alimentação','Firmware','Outro problema'],
  'Projetor':['Não liga','Sem imagem','Imagem fora de foco','Cabo não reconhecido','Superaquecimento','Outro problema']
};
Object.assign(issueTypes, specializedIssueTypes);
const genericIssueTypes = ['Não funciona','Não conecta','Não abre','Erro ou mensagem de falha','Lentidão','Intermitência','Bloqueio ou permissão','Configuração incorreta','Instalação ou atualização','Dano físico','Solicitação de alteração','Dúvida ou orientação','Outro problema'];
function updateTicketIssueTypes() {
  const select = $('ticket-issue-type');
  const subcategory = $('ticket-subcategory').value;
  const category = $('ticket-category').value;
  const options = subcategory ? (issueTypes[subcategory] || categoryIssueTypes[category] || genericIssueTypes) : [];
  select.replaceChildren(new Option(options.length ? 'Selecione o tipo de problema' : 'Selecione primeiro a subcategoria', ''));
  for (const option of options) select.add(new Option(option, option));
  select.disabled = !options.length;
}
function updateTicketSubcategories() {
  const select = $('ticket-subcategory');
  const options = ticketSubcategories[$('ticket-category').value] || [];
  select.replaceChildren(new Option(options.length ? 'Selecione a subcategoria' : 'Selecione primeiro a categoria', ''));
  for (const option of options) select.add(new Option(option, option));
  select.disabled = !options.length;
  updateTicketIssueTypes();
}
$('ticket-category').addEventListener('change', updateTicketSubcategories);
$('ticket-subcategory').addEventListener('change', updateTicketIssueTypes);
updateTicketSubcategories();
const allowedAttachmentExtensions = /\.(png|jpe?g|webp|pdf|txt|docx?|xlsx?)$/i;
function validateAttachments(files) {
  if (files.length > 5) return 'Selecione no máximo 5 arquivos.';
  for (const file of files) {
    if (!allowedAttachmentExtensions.test(file.name)) return 'Tipo de arquivo não permitido: ' + file.name;
    if (file.size > 5 * 1024 * 1024) return 'Arquivo acima de 5 MB: ' + file.name;
  }
  return '';
}
$('ticket-attachments').addEventListener('change', () => {
  const files = Array.from($('ticket-attachments').files);
  const error = validateAttachments(files);
  $('ticket-attachments').setCustomValidity(error);
  $('attachment-list').replaceChildren();
  if (error) { $('attachment-list').textContent = error; return; }
  const list = document.createElement('ul');
  for (const file of files) {
    const item = document.createElement('li');
    item.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';
    list.append(item);
  }
  $('attachment-list').append(list);
});
$('new-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const attachmentError = validateAttachments(Array.from($('ticket-attachments').files));
  $('ticket-attachments').setCustomValidity(attachmentError);
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const inventoryMode = data.get('assetMode') === 'inventory';
  const manualMode = data.get('assetMode') === 'manual';
  const asset = inventoryMode ? demoAssets.find(item => item.id === data.get('assetId')) : null;
  if (inventoryMode && !asset) { $('asset-select').setCustomValidity('Selecione um equipamento.'); $('asset-select').reportValidity(); $('asset-select').setCustomValidity(''); return; }
  const manualAsset = !manualMode ? null : {
    id:String(data.get('manualTag') || '').trim() || 'Sem patrimônio',
    type:String(data.get('manualType')),tag:String(data.get('manualTag') || ''),
    brand:String(data.get('manualBrand') || ''),model:String(data.get('manualModel') || ''),
    serial:String(data.get('manualSerial') || ''),ip:String(data.get('manualIp') || ''),location:String(data.get('manualLocation') || ''),
    os:'Não informado',state:'Não cadastrado'
  };
  const id = Math.max(0, ...tickets.map(t => t.id)) + 1;
  const urgency = String(data.get('urgency'));
  const attachmentNames = Array.from($('ticket-attachments').files, file => ({name:file.name,size:file.size}));
  tickets.unshift({
    id, title:String(data.get('title')).trim(), category:String(data.get('category') || 'Outros'),
    subcategory:String(data.get('subcategory') || ''), issueType:String(data.get('issueType') || ''), priority:urgency === 'Alta' ? 'Alta' : urgency === 'Baixa' ? 'Baixa' : 'Normal',
    urgency, impact:String(data.get('impact')), description:String(data.get('description')).trim(),
    requester:String(data.get('requester')).trim(),contact:String(data.get('contact') || '').trim(),phone:String(data.get('phone') || '').trim(),
    unit:String(data.get('unit')).trim(),department:String(form.elements.department.value),
    asset:asset ? {...asset} : manualAsset, attempts:String(data.get('attempts') || '').trim(),
    availability:String(data.get('availability')), attachments:attachmentNames, status:'Aberto',
    events:[{title:'Chamado registrado',note:'Registro demonstrativo criado nesta sessão, sem envio a servidor.'}]
  });
  form.reset();
  $('ticket-attachments').setCustomValidity('');
  $('attachment-list').replaceChildren();
  restoreDemoProfile();
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
