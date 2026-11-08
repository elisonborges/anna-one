// AnnA Classroom: proteção inicial enquanto o SSO entre subdomínios não é validado.
// Sem sessão verificada, nenhum conteúdo pedagógico é exibido.
const gate=document.getElementById('auth-gate');
const message=document.getElementById('auth-message');
const link=document.getElementById('auth-portal-link');
const app=document.getElementById('classroom-app');
if(gate) gate.hidden=false;
if(app) app.hidden=true;
if(message) message.textContent='Acesso pelo portal AnnA One. Integração institucional em validação.';
if(link) link.hidden=false;
// Nota: não há login alternativo nem dados escolares persistidos no navegador.
