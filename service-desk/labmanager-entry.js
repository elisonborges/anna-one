import { parseLabManagerContext } from './labmanager-integration.js';

const context = parseLabManagerContext(window.location.search);
if (context) {
  const form = document.getElementById('new-form');
  if (form) {
    const info = document.createElement('p');
    info.setAttribute('role', 'status');
    info.textContent = 'Origem: AnnA LabManager · Equipamento: ' +
      (context.equipmentLabel || context.equipmentId) +
      ' · Referência apenas demonstrativa; nenhum vínculo foi gravado.';
    form.prepend(info);
    const heading = document.createElement('p');
    heading.textContent = 'Chamado iniciado a partir do LabManager (demonstração).';
    form.parentElement.insertBefore(heading, form);
    const nav = document.querySelector('[data-view="novo"]');
    if (nav) nav.click();
  }
}
