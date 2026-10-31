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
          "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS", "vary": "Origin" }
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
    if (/^\/v1\/admin\/institutions\/[0-9a-f-]{36}\/profile$/i.test(url.pathname) && ["GET","PUT"].includes(request.method)) {
      let identity;try{identity=await verifyBearer(request,env);}catch{return json({error:"Autenticação necessária"},401,cors);}
      if(!env.DATABASE_URL)return json({error:"Banco indisponível"},503,cors);
      const id=url.pathname.split("/")[4];
      try {
        const sql=neon(env.DATABASE_URL);
        const allowed=await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid) AS ok`;
        if(!allowed[0]?.ok)return json({error:"Acesso Master negado"},403,cors);
        const exists=await sql`SELECT EXISTS(SELECT 1 FROM public.institutions WHERE id=${id}::uuid) AS ok`;
        if(!exists[0]?.ok)return json({error:"Instituição não encontrada"},404,cors);
        if(request.method==="GET"){
          const rows=await sql`SELECT legal_name,tax_id,email,phone,website,address_street,address_number,address_complement,address_district,address_city,address_state,address_postal_code FROM public.institution_profiles WHERE institution_id=${id}::uuid`;
          return json({item:rows[0]||{}},200,cors);
        }
        if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return json({error:"Envie JSON"},415,cors);
        const raw=await request.text();if(raw.length>8192)return json({error:"Dados excedem o limite"},413,cors);
        let data;try{data=JSON.parse(raw);}catch{return json({error:"JSON inválido"},400,cors);}
        const fields=["legal_name","tax_id","email","phone","website","address_street","address_number","address_complement","address_district","address_city","address_state","address_postal_code"];
        if(!data||typeof data!=="object"||Array.isArray(data)||Object.keys(data).some(k=>!fields.includes(k)))return json({error:"Campos inválidos"},422,cors);
        const v={};for(const key of fields){if(data[key]!=null&&typeof data[key]!=="string")return json({error:"Formato inválido: "+key},422,cors);v[key]=(data[key]||"").trim();if(v[key].length>200)return json({error:"Campo muito longo: "+key},422,cors);}
        if(v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))return json({error:"E-mail inválido"},422,cors);
        if(v.tax_id&&v.tax_id.replace(/\D/g,"").length!==14)return json({error:"CNPJ deve conter 14 dígitos"},422,cors);
        if(v.address_state&&!/^[A-Za-z]{2}$/.test(v.address_state))return json({error:"UF inválida"},422,cors);
        const rows=await sql`
          WITH saved AS (
            INSERT INTO public.institution_profiles(institution_id,legal_name,tax_id,email,phone,website,address_street,address_number,address_complement,address_district,address_city,address_state,address_postal_code,updated_at)
            VALUES (${id}::uuid,${v.legal_name},${v.tax_id},${v.email},${v.phone},${v.website},${v.address_street},${v.address_number},${v.address_complement},${v.address_district},${v.address_city},${v.address_state.toUpperCase()},${v.address_postal_code},now())
            ON CONFLICT (institution_id) DO UPDATE SET legal_name=EXCLUDED.legal_name,tax_id=EXCLUDED.tax_id,email=EXCLUDED.email,phone=EXCLUDED.phone,website=EXCLUDED.website,address_street=EXCLUDED.address_street,address_number=EXCLUDED.address_number,address_complement=EXCLUDED.address_complement,address_district=EXCLUDED.address_district,address_city=EXCLUDED.address_city,address_state=EXCLUDED.address_state,address_postal_code=EXCLUDED.address_postal_code,updated_at=now()
            RETURNING institution_id
          ), logged AS (
            INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details)
            SELECT ${identity.userId}::uuid,institution_id,'institution.profile.updated','institution',institution_id::text,jsonb_build_object('fields',${fields.join(",")}) FROM saved RETURNING institution_id
          ) SELECT institution_id FROM logged`;
        return json({saved:rows.length===1},200,cors);
      }catch(error){console.error("institution profile failed",error?.code||"db_error");return json({error:"Operação de cadastro indisponível"},503,cors);}
    }
    if (/^\/v1\/admin\/institutions\/[0-9a-f-]{36}$/i.test(url.pathname) && request.method === "PATCH") {
      let identity;
      try { identity=await verifyBearer(request,env); } catch {return json({error:"Autenticação necessária"},401,cors);}
      if(!env.DATABASE_URL)return json({error:"Banco indisponível"},503,cors);
      if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return json({error:"Envie JSON"},415,cors);
      const raw=await request.text();
      if(raw.length>2048)return json({error:"Dados excedem o limite"},413,cors);
      let data;try{data=JSON.parse(raw);}catch{return json({error:"JSON inválido"},400,cors);}
      const name=typeof data?.name==="string"?data.name.trim():"";
      const status=data?.status;
      if(name.length<2||name.length>160||!["active","suspended"].includes(status))return json({error:"Nome ou situação inválidos"},422,cors);
      const id=url.pathname.split("/").pop();
      try{
        const sql=neon(env.DATABASE_URL);
        const rows=await sql`
          WITH updated AS (
            UPDATE public.institutions SET name=${name},status=${status}
            WHERE id=${id}::uuid AND EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid)
            RETURNING id,name,slug,status
          ), logged AS (
            INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details)
            SELECT ${identity.userId}::uuid,id,'institution.updated','institution',id::text,
              jsonb_build_object('name',name,'status',status) FROM updated RETURNING institution_id
          )
          SELECT updated.id,updated.name,updated.slug,updated.status FROM updated JOIN logged ON logged.institution_id=updated.id`;
        if(!rows.length)return json({error:"Instituição não encontrada ou acesso negado"},403,cors);
        return json({item:rows[0]},200,cors);
      }catch(error){console.error("institution update failed",error?.code||"db_error");return json({error:"Não foi possível atualizar a instituição"},503,cors);}
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
      const baseSlug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 65).replace(/-+$/g, "");
      let slug = baseSlug;
      const parentId = typeof data?.parent_institution_id === "string" && /^[0-9a-f-]{36}$/i.test(data.parent_institution_id) ? data.parent_institution_id : null;
      if (data?.parent_institution_id && !parentId) return json({error:"Instituição principal inválida"},422,cors);
      if (name.length < 2 || name.length > 160 || !baseSlug ||
          !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
        return json({ error: "Nome ou código inválido" }, 422, cors);
      if (!env.DATABASE_URL) return json({ error: "Banco indisponível" }, 503, cors);
      for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) slug = baseSlug + "-" + crypto.randomUUID().slice(0, 8);
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
        if (error?.code === "23505") continue;
        console.error("master institution create failed", error?.code || "db_error");
        return json({ error: "Não foi possível cadastrar a instituição" }, 503, cors);
      }
      }
      return json({ error: "Não foi possível gerar um código exclusivo. Tente novamente." }, 409, cors);
    }
    if (url.pathname.startsWith("/v1/audit") || url.pathname.startsWith("/v1/admin")) {
      return json({ error: "Integração indisponível até validação de autorização e banco no servidor" }, 503, cors);
    }
    return json({ error: "Rota não encontrada" }, 404, cors);
  }
};
