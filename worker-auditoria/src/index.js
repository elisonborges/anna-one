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
    if(/^\/v1\/admin\/institution-admin-invitations\/[0-9a-f-]{36}\/cancel$/i.test(url.pathname)&&request.method==="POST"){
      let identity;try{identity=await verifyBearer(request,env);}catch{return json({error:"Autenticação necessária"},401,cors);}
      if(!env.DATABASE_URL)return json({error:"Banco indisponível"},503,cors);
      const id=url.pathname.split("/")[4];
      try{
        const sql=neon(env.DATABASE_URL);
        const rows=await sql`
          WITH changed AS (
            UPDATE public.institution_admin_invitations SET status='cancelled',updated_at=now()
            WHERE id=${id}::uuid AND status='pending'
              AND EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid)
            RETURNING id,institution_id,email
          ), logged AS (
            INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details)
            SELECT ${identity.userId}::uuid,institution_id,'institution.admin.invitation.cancelled','institution_admin_invitation',id::text,jsonb_build_object('email',email,'status','cancelled') FROM changed RETURNING entity_id
          ) SELECT changed.id FROM changed JOIN logged ON logged.entity_id=changed.id::text`;
        if(rows.length)return json({cancelled:true},200,cors);
        const allowed=await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid) AS ok`;
        if(!allowed[0]?.ok)return json({error:"Acesso Master negado"},403,cors);
        return json({error:"Convite não encontrado ou não está pendente"},409,cors);
      }catch(error){console.error("invitation cancel failed",error?.code||"db_error");return json({error:"Não foi possível cancelar o convite"},503,cors);}
    }
    if(url.pathname==="/v1/admin/invitation-email-readiness"&&request.method==="GET"){
      let identity;try{identity=await verifyBearer(request,env);}catch{return json({error:"Autenticação necessária"},401,cors);}
      if(!env.DATABASE_URL)return json({error:"Banco indisponível"},503,cors);
      try{
        const sql=neon(env.DATABASE_URL);
        const rows=await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid) AS ok`;
        if(!rows[0]?.ok)return json({error:"Acesso Master negado"},403,cors);
        const apiKeyReady=typeof env.RESEND_API_KEY==="string"&&env.RESEND_API_KEY.trim().length>0;
        const fromReady=typeof env.RESEND_FROM_EMAIL==="string"&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.RESEND_FROM_EMAIL.trim());
        return json({provider:"resend",api_key_configured:apiKeyReady,sender_configured:fromReady,domain_verified:"not_checked",sending_enabled:false,reason:"Envio ainda não habilitado. É necessário validar domínio, entrega e fluxo de aceite."},200,cors);
      }catch{return json({error:"Não foi possível verificar a configuração"},503,cors);}
    }
    if(url.pathname==="/v1/admin/institution-admin-invitations"&&["GET","POST"].includes(request.method)){
      let identity;try{identity=await verifyBearer(request,env);}catch{return json({error:"Autenticação necessária"},401,cors);}
      if(!env.DATABASE_URL)return json({error:"Banco indisponível"},503,cors);
      try{
        const sql=neon(env.DATABASE_URL);
        const allowed=await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid) AS ok`;
        if(!allowed[0]?.ok)return json({error:"Acesso Master negado"},403,cors);
        if(request.method==="GET"){
          const rows=await sql`SELECT inv.id,inv.institution_id,i.name AS institution_name,inv.email,inv.status,inv.created_at FROM public.institution_admin_invitations inv JOIN public.institutions i ON i.id=inv.institution_id ORDER BY inv.created_at DESC LIMIT 200`;
          return json({items:rows},200,cors);
        }
        if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return json({error:"Envie JSON"},415,cors);
        const raw=await request.text();if(raw.length>2048)return json({error:"Dados excedem o limite"},413,cors);
        let data;try{data=JSON.parse(raw);}catch{return json({error:"JSON inválido"},400,cors);}
        const institutionId=typeof data?.institution_id==="string"?data.institution_id:"",email=typeof data?.email==="string"?data.email.trim().toLowerCase():"";
        if(!/^[0-9a-f-]{36}$/i.test(institutionId)||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Instituição ou e-mail inválido"},422,cors);
        const rows=await sql`
          WITH created AS (
            INSERT INTO public.institution_admin_invitations(institution_id,email,invited_by)
            SELECT i.id,${email},${identity.userId}::uuid FROM public.institutions i
            WHERE i.id=${institutionId}::uuid AND i.status='active'
              AND NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.app_users u ON u.id=m.user_id WHERE m.institution_id=i.id AND lower(u.email)=${email} AND m.role='institution_admin' AND m.active)
            ON CONFLICT DO NOTHING RETURNING id,institution_id,email,status
          ), logged AS (
            INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details)
            SELECT ${identity.userId}::uuid,institution_id,'institution.admin.invitation.pending','institution_admin_invitation',id::text,jsonb_build_object('email',email,'status',status) FROM created RETURNING entity_id
          ) SELECT created.id,created.institution_id,created.email,created.status FROM created JOIN logged ON logged.entity_id=created.id::text`;
        if(!rows.length)return json({error:"Instituição inativa, administrador já vinculado ou convite pendente existente"},409,cors);
        return json({item:rows[0],email_sent:false,access_granted:false},201,cors);
      }catch(error){console.error("admin invitation failed",error?.code||"db_error");return json({error:"Operação de convite indisponível"},503,cors);}
    }
    if(url.pathname==="/v1/admin/institution-admins"&&request.method==="POST"){
      let identity;try{identity=await verifyBearer(request,env);}catch{return json({error:"Autenticação necessária"},401,cors);}
      if(!env.DATABASE_URL)return json({error:"Banco indisponível"},503,cors);
      if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))return json({error:"Envie JSON"},415,cors);
      const raw=await request.text();if(raw.length>2048)return json({error:"Dados excedem o limite"},413,cors);
      let data;try{data=JSON.parse(raw);}catch{return json({error:"JSON inválido"},400,cors);}
      const institutionId=typeof data?.institution_id==="string"?data.institution_id:"";
      const email=typeof data?.email==="string"?data.email.trim().toLowerCase():"";
      if(!/^[0-9a-f-]{36}$/i.test(institutionId)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return json({error:"Instituição ou e-mail inválido"},422,cors);
      try{
        const sql=neon(env.DATABASE_URL);
        const allowed=await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid) AS ok`;
        if(!allowed[0]?.ok)return json({error:"Acesso Master negado"},403,cors);
        const institution=await sql`SELECT id,status FROM public.institutions WHERE id=${institutionId}::uuid`;
        if(!institution.length)return json({error:"Instituição não encontrada"},404,cors);
        if(institution[0].status!=="active")return json({error:"Instituição não está ativa"},409,cors);
        const users=await sql`SELECT id FROM public.app_users WHERE lower(email)=${email} LIMIT 2`;
        if(users.length!==1)return json({error:"Usuário não encontrado. Cadastre e autentique o usuário antes de vinculá-lo."},404,cors);
        const userId=users[0].id;
        const existing=await sql`SELECT role,active FROM public.memberships WHERE institution_id=${institutionId}::uuid AND user_id=${userId}::uuid`;
        if(existing.length)return json({error:"Usuário já possui vínculo com esta instituição. Nenhuma permissão foi alterada."},409,cors);
        const rows=await sql`
          WITH inserted AS (
            INSERT INTO public.memberships(institution_id,user_id,role,active)
            VALUES(${institutionId}::uuid,${userId}::uuid,'institution_admin',true)
            ON CONFLICT (institution_id,user_id) DO NOTHING
            RETURNING institution_id,user_id,role,active
          ), logged AS (
            INSERT INTO anna_audit.audit_logs(actor_user_id,institution_id,action,entity_type,entity_id,details)
            SELECT ${identity.userId}::uuid,institution_id,'membership.admin.created','membership',user_id::text,
              jsonb_build_object('role',role,'active',active) FROM inserted RETURNING institution_id,user_id
          ) SELECT inserted.institution_id,inserted.user_id,inserted.role,inserted.active FROM inserted JOIN logged USING(institution_id,user_id)`;
        if(!rows.length)return json({error:"Vínculo já existente ou não foi possível concluir"},409,cors);
        return json({item:rows[0]},201,cors);
      }catch(error){console.error("admin link failed",error?.code||"db_error");return json({error:"Não foi possível vincular o administrador"},503,cors);}
    }
    if(url.pathname==="/v1/admin/institution-admins"&&request.method==="GET"){
      let identity;try{identity=await verifyBearer(request,env);}catch{return json({error:"Autenticação necessária"},401,cors);}
      if(!env.DATABASE_URL)return json({error:"Banco indisponível"},503,cors);
      try{
        const sql=neon(env.DATABASE_URL);
        const allowed=await sql`SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=${identity.userId}::uuid) AS ok`;
        if(!allowed[0]?.ok)return json({error:"Acesso Master negado"},403,cors);
        const rows=await sql`SELECT m.institution_id,i.name AS institution_name,i.parent_institution_id,m.user_id,u.email,u.display_name,m.role,m.active,m.created_at FROM public.memberships m JOIN public.institutions i ON i.id=m.institution_id JOIN public.app_users u ON u.id=m.user_id WHERE m.role='institution_admin' ORDER BY i.name,u.email LIMIT 1000`;
        return json({items:rows},200,cors);
      }catch(error){console.error("admin list failed",error?.code||"db_error");return json({error:"Consulta de administradores indisponível"},503,cors);}
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
        const validCnpj=value=>{
          const d=value.replace(/\D/g,"");
          if(!/^\d{14}$/.test(d)||/^(\d)\1{13}$/.test(d))return false;
          const digit=length=>{
            let sum=0,weight=length-7;
            for(let i=0;i<length;i++){sum+=Number(d[i])*weight;weight=weight===2?9:weight-1;}
            const mod=sum%11;return mod<2?0:11-mod;
          };
          return Number(d[12])===digit(12)&&Number(d[13])===digit(13);
        };
        if(v.tax_id&&!validCnpj(v.tax_id))return json({error:"CNPJ inválido: confira os dígitos verificadores"},422,cors);
        if(v.address_state&&!/^[A-Za-z]{2}$/.test(v.address_state))return json({error:"UF inválida"},422,cors);
        if(v.phone&&![10,11].includes(v.phone.replace(/\D/g,"").length))return json({error:"Telefone deve ter DDD e 8 ou 9 dígitos"},422,cors);
        if(v.address_postal_code&&v.address_postal_code.replace(/\D/g,"").length!==8)return json({error:"CEP deve conter 8 dígitos"},422,cors);
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
