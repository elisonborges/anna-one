# Arquitetura AnnA Flow — online primeiro

## Camadas previstas
- Interface pública: painel TV, chamada em destaque, destino, relógio, mensagens e mídia.
- Operação: emissão de senhas, filas específicas, atendentes e guichês.
- Administração: organizações, unidades, serviços, temas, permissões e configuração de comunicação.
- API Node.js: autenticação, validação, limites de requisição e trilha de auditoria.
- Banco: **Neon PostgreSQL isolado**, usado somente no backend. Nunca expor string de conexão ao browser.
- Distribuição: hospedagem HTTPS com suporte a Node.js para API; GitHub Pages somente hospeda estáticos, não o processo servidor.

## Fluxo
Visitante pede senha -> API valida e registra -> fila de serviço -> operador chama -> painel mostra senha e destino -> operador conclui -> histórico marca CONCLUÍDO. O estado CHAMADO não implica atendimento concluído.

## Confiabilidade e privacidade
- Senhas em sequência transacional por organização/unidade/serviço/data.
- Preferência configurável e não sujeita a dedução indiscriminada.
- Acesso separado: público leitura limitada; operador por autenticação segura; administrador por função.
- Sem nome pessoal no painel por padrão.
- Áudio e avisos devem ter alternativa visual, com respeitar preferências de movimento reduzido.
- Mídia deve usar arquivos autorizados, evitando links inseguros, uploads anônimos e publicidade não autorizada.

## Futuro offline
Instalador Windows com seleção Painel / Console / Gestão / Servidor local, descoberta ou configuração de endereço IP, sincronização em rede local; definir posteriormente estratégia de conflitos e atualização.
