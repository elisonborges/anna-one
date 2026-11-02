# AnnA Flow — candidata v1.0 (homologação)

Domínio de homologação: https://flow.annaone.com.br

## Entradas
- Painel público demonstrativo: /
- Central de acessos: /access.html
- Administração central: /admin.html
- Atendimento autenticado: /operator.html
- Emissão autenticada: /issue.html
- Configuração de mídia local autenticada: /local-media.html
- Painel da unidade: /panel.html?key=<chave_da_TV>

## Arquitetura
- Servidor Node.js no Render (plano gratuito).
- PostgreSQL Neon para clientes, usuários, unidades, filas, sessões e perfis de TV.
- Mídia local guardada em IndexedDB no navegador da TV; o administrador deve importar nesse mesmo dispositivo.
- Painel público demonstrativo / e console legado são separados das filas multiunidade. A operação por cliente deve utilizar os painéis /panel.html?key=...
- Administração central ainda exige FLOW_ADMIN_TOKEN; usuários operacionais usam login individual e acesso por unidade.
- Vídeos hospedados podem ser configurados por URL HTTPS de MP4/WebM. Apresentações PowerPoint animadas precisam ser exportadas para vídeo; fotos e slides estáticos podem ser importados em sequência.

## Itens pendentes para aprovação de v1.0
1. Conferir login e negação de acesso entre perfis e unidades.
2. Emitir uma senha de teste, chamar, repetir/acompanhar na TV e concluir.
3. Conferir comunicação por TV e reprodução de vídeo/fotos no dispositivo real.
4. Confirmar visual em tela cheia e comportamento na retomada do Render gratuito.
5. Homologar correções encontradas sem alterar a main, e só promover mediante aprovação explícita.

**Esta é uma candidata de homologação, não uma certificação de que todos os fluxos foram testados.**
