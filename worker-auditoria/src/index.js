import { verifyBearer } from "./auth.js";

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
      ? { "access-control-allow-origin": allowed, "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, OPTIONS", "vary": "Origin" }
      : {};
    if (request.method === "OPTIONS") {
      return origin === allowed
        ? new Response(null, { status: 204, headers: cors })
        : json({ error: "Origem não permitida" }, 403);
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ service: "anna-one-auditoria", status: "preparacao", audit_enabled: false }, 200, cors);
    }
    // Apenas teste de identidade; NÃO confirma permissão administrativa.
    if (url.pathname === "/v1/auth/verify" && request.method === "GET") {
      try {
        const identity = await verifyBearer(request, env);
        return json({ authenticated: true, user_id: identity.userId, admin_authorized: false }, 200, cors);
      } catch {
        return json({ authenticated: false, error: "Credencial inválida ou autenticação não configurada" }, 401, cors);
      }
    }
    if (url.pathname.startsWith("/v1/audit") || url.pathname.startsWith("/v1/admin")) {
      return json({ error: "Integração indisponível até validação de autorização e banco no servidor" }, 503, cors);
    }
    return json({ error: "Rota não encontrada" }, 404, cors);
  }
};
