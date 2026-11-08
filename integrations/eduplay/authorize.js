/**
 * AnnA EduPlay — autorização do GameLab (módulo isolado, ainda não ligado ao roteador).
 *
 * Contrato: GET /v1/eduplay/authorize
 * Dependências injetadas: verifyBearer(request, env), sql tagged-template Neon,
 * json(data,status,headers). Não criar instâncias ou segredos aqui.
 *
 * IMPORTANTE: role docente precisa ser confirmado na base antes da ativação.
 * O perfil docente é 'teacher', conforme constraint do banco anna-one.
 * A integração com o roteador e a validação da identidade ainda são pendentes.
 */
export async function authorizeEduPlay(request, env, { verifyBearer, sql, json, cors = {} }) {
  let identity;
  try {
    identity = await verifyBearer(request, env);
  } catch {
    return json({ authorized: false }, 401, cors);
  }
  if (!env.DATABASE_URL) return json({ authorized: false }, 503, cors);
  try {
    const master = await sql`
      SELECT EXISTS (
        SELECT 1 FROM public.platform_admins p
        WHERE p.user_id=${identity.userId}::uuid
      ) AS authorized
    `;
    if (master[0]?.authorized === true) {
      return json({ authorized: true, role: "master", user_id: identity.userId }, 200, cors);
    }
    // Confirmado no schema public.memberships: role='teacher', active boolean.
    const teacher = await sql`
      SELECT EXISTS (
        SELECT 1 FROM public.memberships m
        JOIN public.institutions i ON i.id=m.institution_id
        WHERE m.user_id=${identity.userId}::uuid
          AND m.role='teacher'
          AND m.active=TRUE
          AND i.status='active'
      ) AS authorized
    `;
    if (teacher[0]?.authorized === true) {
      return json({ authorized: true, role: "teacher", user_id: identity.userId }, 200, cors);
    }
    return json({ authorized: false }, 403, cors);
  } catch {
    return json({ authorized: false }, 503, cors);
  }
}
