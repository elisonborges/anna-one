import { neon } from "@neondatabase/serverless";
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
          "access-control-allow-methods": "GET, POST, OPTIONS", "vary": "Origin" }
      : {};
    if (request.method === "OPTIONS") {
      return origin === allowed
        ? new Response(null, { status: 204, headers: cors })
        : json({ error: "Origem não permitida" }, 403);
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ service: "anna-one-auditoria", status: "preparacao", audit_enabled: false }, 200, cors);
    }
    if (url.pathname === "/health/db" && request.method === "GET") {
      // Diagnóstico somente leitura, sem retornar detalhes da conexão.
      if (!env.DATABASE_URL) return json({ database: "not_configured" }, 503, cors);
      try {
        const sql = neon(env.DATABASE_URL);
        const rows = await sql`SELECT 1 AS ok`;
        return json({ database: rows[0]?.ok === 1 ? "connected" : "unavailable" },
          rows[0]?.ok === 1 ? 200 : 503, cors);
      } catch {
        return json({ database: "unavailable" }, 503, cors);
      }
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
    if (url.pathname === "/v1/admin/institutions" && request.method === "POST") {
      let identity;
      try { identity = await verifyBearer(request, env); }
      catch { return json({ error: "Autenticação necessária" }, 401, cors); }
      if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json"))
        return json({ error: "Envie JSON" }, 415, cors);
      const body = await request.text();
      if (body.length > 4096) return json({ error: "Dados excedem o limite" }, 413, cors);
      let data;
      try { data = JSON.parse(body); }
      catch { return json({ error: "JSON inválido" }, 400, cors); }
      const name = typeof data?.name === "string" ? data.name.trim() : "";
      const slug = typeof data?.slug === "string" ? data.slug.trim() : "";
      if (name.length < 2 || name.length > 160 || slug.length > 80 ||
          !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
        return json({ error: "Nome ou código inválido" }, 422, cors);
      // Identidade verificada NÃO equivale a autorização Master.
      // Falha fechada até existir conexão segura com o Neon e checagem de platform_admins.
      return json({ error: "Cadastro aguardando autorização Master e auditoria transacional no banco" }, 503, cors);
    }
    if (url.pathname.startsWith("/v1/audit") || url.pathname.startsWith("/v1/admin")) {
      return json({ error: "Integração indisponível até validação de autorização e banco no servidor" }, 503, cors);
    }
    return json({ error: "Rota não encontrada" }, 404, cors);
  }
};
