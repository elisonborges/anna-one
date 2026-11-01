
export const invitationTestPage = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AnnA One — Convite de homologação</title>
<style>
body{font:16px system-ui;background:#f2f6fb;color:#173553}
main{max-width:560px;margin:8vh auto;background:white;padding:28px;border-radius:14px}
button{background:#135a96;color:white;border:0;border-radius:8px;padding:12px;cursor:pointer}
button:disabled{opacity:.5}
#status{white-space:pre-wrap;line-height:1.5}
</style>
</head>
<body>
<main>
<h1>AnnA One</h1>
<h2>Convite institucional — Homologação</h2>
<p><strong>Instituição:</strong> INSTITUTO DOM BARRETO — CENTRO</p>
<p><strong>Destinatário:</strong> francisco.borges@dombarreto.g12.br</p>
<button id="verify">Verificar acesso Master</button>\n<button id="send" disabled>Criar e enviar convite</button>
<p id="status" role="status">Clique em Verificar acesso Master quando estiver pronto.</p>
</main>
<script type="module">
const status = document.getElementById('status');
const button = document.getElementById('send');
const verifyButton = document.getElementById('verify');
let verifiedJwt = null;
let checking = false;

const authUrl = 'https://ep-spring-snow-b6mci3yx.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const sdk = await import('https://esm.sh/@neondatabase/auth@0.5.0-beta?bundle');
const auth = sdk.createAuthClient(authUrl);

async function getJwt() {
  const session = await auth.getSession();
  const direct = session?.data?.session?.access_token;
  if (typeof direct === 'string' && direct.split('.').length === 3)
    return direct;

  for (const method of ['getJWTToken','getJwtToken','token']) {
    if (typeof auth[method] !== 'function') continue;
    const result = await auth[method]();
    const jwt = typeof result === 'string'
      ? result
      : result?.token || result?.data?.token || result?.data?.jwt;

    if (typeof jwt === 'string' && jwt.split('.').length === 3)
      return jwt;
  }
  throw Error('JWT indisponível. Entre no Portal Master.');
}

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: 'Bearer ' + verifiedJwt,
      ...(method !== 'GET' ? {'Content-Type':'application/json'} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();
  if (!response.ok)
    throw Error('HTTP ' + response.status + ' em ' + path + ': ' + (data.error || 'Falha na requisição'));
  return data;
}

verifyButton.onclick = async () => {
  if (checking) return;
  checking = true;
  verifyButton.disabled = true;
  button.disabled = true;
  verifiedJwt = null;
  status.textContent = 'Verificando acesso Master…';
  try {
    const jwt = await getJwt();
    verifiedJwt = jwt;
    const result = await api('/v1/admin/authorize');
    if (!result.admin_authorized) throw Error('Acesso Master não autorizado.');
    status.textContent = 'Master autorizado. Pronto para enviar.';
    button.disabled = false;
  } catch (error) {
    verifiedJwt = null;
    status.textContent = 'Falha na verificação: ' + error.message + '. Se houver limite de requisições, aguarde antes de tentar novamente.';
  } finally {
    checking = false;
    verifyButton.disabled = false;
  }
};

button.onclick = async () => {
  button.disabled = true;
  if (!verifiedJwt) { status.textContent = 'Verifique o acesso Master primeiro.'; return; }
  try {
    status.textContent = 'Criando convite…';

    const created = await api(
      '/v1/admin/institution-admin-invitations',
      'POST',
      {
        institution_id: '2766ba9f-d6c0-473d-98f3-e46eef50159d',
        email: 'francisco.borges@dombarreto.g12.br'
      }
    );

    if (!created?.item?.id)
      throw Error('Convite não foi criado.');

    status.textContent = 'Enviando pelo Resend…';

    const sent = await api(
      '/v1/admin/institution-admin-invitations/'
        + created.item.id + '/send',
      'POST'
    );

    status.textContent = sent.accepted_by_provider
      ? 'Resend aceitou o envio. Confira a caixa de entrada.'
      : 'Envio não confirmado.';
  } catch (error) {
    status.textContent =
      error.message +
      ' Não repita o envio antes de verificar o convite.';
  }
};
<\/script>
</body>
</html>`;
