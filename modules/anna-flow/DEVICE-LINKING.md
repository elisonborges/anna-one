# AnnA Flow — vínculo de dispositivos online

**Status:** implementação na branch `feature/anna-flow-online`; não publicada. A validação funcional integrada ainda é pendente.

## Rotas
- `/admin.html#devices`: cadastro, aprovação, última comunicação e revogação, dentro da administração existente.
- `/device.html`: solicitação de código temporário de 8 dígitos e ativação no próprio dispositivo.
- `/api/device/request` (POST): emite código de uso único com validade de 10 minutos; 6 pedidos por origem/10 min.
- `/api/device/status?id=...` (GET com X-Flow-Device): consulta o vínculo com a credencial privada do dispositivo.
- `/api/device/options` (GET): unidades, TVs e guichês acessíveis ao administrador.
- `/api/device/list`, `/api/device/approve`, `/api/device/revoke`: operações administrativas com autorização por cliente e unidade.
- `/api/device/me` e `/api/device/catalog`: consulta autenticada para os equipamentos.

## Perfis
- TV: somente painel autorizado; `public_key` permanece identificador de consulta, não credencial; após o primeiro vínculo a leitura desse painel exige dispositivo autorizado, inclusive após revogação.
- Totem e recepção: somente emissão de senhas na unidade vinculada.
- Terminal: chamada e conclusão no guichê vinculado, exigindo também login pessoal do operador.
- Administração: pode usar token central existente ou login próprio do administrador da instituição dentro da seção Dispositivos.

## Segurança e armazenamento
- Credencial de equipamento gerada pelo navegador usando `crypto.getRandomValues` e mantida no `localStorage` daquele dispositivo. Banco guarda somente hash SHA-256.
- Código temporário é armazenado somente como hash, expira em 10 minutos e só pode ser aprovado uma vez.
- Operações administrativas registradas em `flow_admin_audit`; última comunicação persistida em `flow_devices.last_seen`.
- As tabelas novas são `flow_devices` e `flow_device_requests`; as demais tabelas e o layout aprovado foram preservados.
- Acesso à TV sem vínculo anterior permanece compatível com os links existentes; ao registrar uma TV, a consulta passa a exigir credencial individual.

## Validação de fechamento necessária
1. Dispositivo solicita código e administrador da instituição aprova dentro de 10 minutos.
2. TV aprovada acompanha somente sua unidade e bloqueia acesso após revogação.
3. Totem emite senha sem credenciais administrativas; tentativa de chamar/concluir retorna 403.
4. Terminal exige sessão de atendente, guichê correto e bloqueia operação em outras unidades.
5. Revogação bloqueia acesso imediatamente. Reconexão usa código novo.
6. Confirmar resposta dos endpoints e comportamento do navegador em Render.
7. Publicar somente com autorização explícita.

Nenhuma alteração na branch `main` e nenhuma publicação Render foram autorizadas para esta implementação.
