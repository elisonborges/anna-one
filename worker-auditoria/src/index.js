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
    // Não expor diagnóstico do banco a sites não autorizados.
    // Respostas de saúde podem ser consultadas pela origem aprovada.
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
      } catch (error) {
        const stages = ["config","bearer","format","header","claims","claims_issuer","claims_audience","claims_subject","claims_expiration","claims_issued_at","claims_lifetime","claims_not_before","jwks","jwks_network","jwks_json","key","key_import","signature","signature_runtime","invalid"];
        const stage = stages.includes(error?.stage) ? error.stage : "unexpected";
        return json({ authenticated: false, error: "Credencial inválida ou autenticação não configurada", diagnostic_stage: stage }, 401, cors);
      }
    }
    // Consulta de autorização Master: somente leitura, com identidade validada pelo JWT.
    if (url.pathname === "/v1/admin/authorize" && request.method === "GET") {
      let identity;
      try { identity = await verifyBearer(request, env); }
      catch { return json({ authenticated: false, admin_authorized: false, error: "Autenticação necessária" }, 401, cors); }
      if (!env.DATABASE_URL) return json({ authenticated: true, admin_authorized: false, error: "Banco indisponível" }, 503, cors);
      try {
        const sql = neon(env.DATABASE_URL);
        const rows = await sql`SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = ${identity.userId}::uuid) AS authorized`;
        return json({ authenticated: true, admin_authorized: rows[0]?.authorized === true }, 200, cors);
      } catch {
        return json({ authenticated: true, admin_authorized: false, error: "Consulta de autorização indisponível" }, 503, cors);
      }
    }
    if ((url.pathname === "/v1/admin/institutions" || url.pathname === "/v1/admin/modules") && request.method === "GET") {
      let identity;
      try { identity = await verifyBearer(request, env); }
      catch { return json({ error: "Autenticação necessária" }, 401, cors); }
      if (!env.DATABASE_URL) return json({ error: "Banco indisponível" }, 503, cors);
      try {
        const sql = neon(env.DATABASE_URL);
        const authorized = await sql`SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = ${identity.userId}::uuid) AS ok`;
        if (authorized[0]?.ok !== true) return json({ error: "Acesso Master negado" }, 403, cors);
        if (url.pathname === "/v1/admin/institutions") {
          const rows = await sql`SELECT id, name, slug, status, parent_institution_id FROM public.institutions ORDER BY name LIMIT 1000`;
          return json({ items: rows }, 200, cors);
        }
        const rows = await sql`SELECT id, code, name, status FROM public.modules ORDER BY name LIMIT 1000`;
        return json({ items: rows }, 200, cors);
      } catch { return json({ error: "Consulta administrativa indisponível" }, 503, cors); }
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
      const parentId = typeof data?.parent_institution_id === "string" && /^[0-9a-f-]{36}$/i.test(data.parent_institution_id) ? data.parent_institution_id : null;
      if (data?.parent_institution_id && !parentId) return json({error:"Instituição principal inválida"},422,cors);
      if (name.length < 2 || name.length > 160 || slug.length > 80 ||
          !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
        return json({ error: "Nome ou código inválido" }, 422, cors);
      if (!env.DATABASE_URL) return json({ error: "Banco indisponível" }, 503, cors);
      try {
        const sql = neon(env.DATABASE_URL);
        // INSERT + auditoria são atômicos na mesma instrução SQL.
        // O actor vem exclusivamente do JWT validado, nunca do corpo enviado.
        const result = await sql`
          WITH created AS (
            INSERT INTO public.institutions (name, slug, status, parent_institution_id)
            SELECT ${name}, ${slug}, 'active', ${parentId}::uuid
            WHERE EXISTS (
              SELECT 1 FROM public.platform_admins WHERE user_id = ${identity.userId}::uuid
            ) AND (${parentId}::uuid IS NULL OR EXISTS (SELECT 1 FROM public.institutions WHERE id = ${parentId}::uuid AND parent_institution_id IS NULL))
            RETURNING id
          ), logged AS (
            INSERT INTO anna_audit.audit_logs
              (actor_user_id, institution_id, action, entity_type, entity_id, details)
            SELECT ${identity.userId}::uuid, id, 'institution.created', 'institution',
                   id::text, jsonb_build_object('name', ${name}, 'slug', ${slug}, 'status', 'active')
            FROM created
            RETURNING institution_id
          )
          SELECT institution_id AS id FROM logged
        `;
        if (!result.length) return json({ error: "Acesso Master negado" }, 403, cors);
        return json({ id: result[0].id, name, slug, status: "active" }, 201, cors);
      } catch (error) {
        if (error?.code === "23505") return json({ error: "Código já cadastrado" }, 409, cors);
        console.error("master institution create failed", error?.code || "db_error");
        return json({ error: "Não foi possível cadastrar a instituição" }, 503, cors);
      }
    }
    if (url.pathname.startsWith("/v1/audit") || url.pathname.startsWith("/v1/admin")) {
      return json({ error: "Integração indisponível até validação de autorização e banco no servidor" }, 503, cors);
    }
    return json({ error: "Rota não encontrada" }, 404, cors);
  }
};
