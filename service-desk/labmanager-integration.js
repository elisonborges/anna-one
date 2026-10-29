// Contrato de navegacao LabManager -> Service Desk, sem replicar inventario.
// O contexto e apenas uma referencia; nunca concede acesso nem cria chamados.
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safeText = value => typeof value === 'string' &&
  value.length > 0 && value.length <= 120 && !/[\u0000-\u001f<>]/.test(value);

export function parseLabManagerContext(search) {
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  const allowed = new Set(['source', 'institutionId', 'equipmentId', 'equipmentLabel']);
  if (keys.some(key => !allowed.has(key) || params.getAll(key).length !== 1)) return null;
  if (params.get('source') !== 'labmanager' ||
      !uuid(params.get('institutionId')) || !uuid(params.get('equipmentId'))) return null;
  const label = params.get('equipmentLabel');
  if (label !== null && !safeText(label)) return null;
  return Object.freeze({
    source: 'labmanager',
    institutionId: params.get('institutionId'),
    equipmentId: params.get('equipmentId'),
    equipmentLabel: label ?? null
  });
}

export function createLabManagerHandoffUrl({ serviceDeskUrl, institutionId, equipmentId, equipmentLabel }) {
  const url = new URL(serviceDeskUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) throw new Error('invalid_service_desk_url');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('https_required');
  if (!uuid(institutionId) || !uuid(equipmentId) ||
      (equipmentLabel != null && !safeText(equipmentLabel))) throw new Error('invalid_equipment_context');
  url.searchParams.set('source', 'labmanager');
  url.searchParams.set('institutionId', institutionId);
  url.searchParams.set('equipmentId', equipmentId);
  if (equipmentLabel) url.searchParams.set('equipmentLabel', equipmentLabel);
  return url.toString();
}
