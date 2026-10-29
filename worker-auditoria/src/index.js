/**
 * AnnA One — Auditoria v0.9.0
 * Estrutura inicial, não implantada.
 * Fail-closed: não expõe registros nem aceita mutações sem validação de sessão.
 */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = env.APP_ORIGIN || "https://annaone.com.br";
    const cors = origin === allowed
      ? { "access-control-allow-origin": allowed, "vary": "Origin" }
      : {};
    if (request.method === "OPTIONS") {
      return json({ error: "Endpoint não habilitado" }, 403, cors);
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ service: "anna-one-auditoria", status: "preparacao", audit_enabled: false }, 200, cors);
    }
    if (url.pathname.startsWith("/v1/audit") || url.pathname.startsWith("/v1/admin")) {
      return json({ error: "Integração indisponível até validação de autenticação e autorização no servidor" }, 503, cors);
    }
    return json({ error: "Rota não encontrada" }, 404, cors);
  }
};
