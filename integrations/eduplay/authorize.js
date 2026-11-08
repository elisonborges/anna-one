/**
 * AnnA EduPlay — autorização do GameLab (módulo isolado, ainda não ligado ao roteador).
 *
 * Contrato: GET /v1/eduplay/authorize
 * Dependências injetadas: verifyBearer(request, env), sql tagged-template Neon,
 * json(data,status,headers). Não criar instâncias ou segredos aqui.
 *
 * IMPORTANTE: role docente precisa ser confirmado na base antes da ativação.
 * Este módulo libera somente Master; docentes permanecem bloqueados até
 * confirmação da nomenclatura e política institucional.
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
        JOIN neon_auth."user" au ON au.id=p.user_id
        WHERE p.user_id=${identity.userId}::uuid
          AND au."emailVerified"=true AND au.banned IS NOT TRUE
      ) AS authorized
    `;
    if (master[0]?.authorized === true) {
      return json({ authorized: true, role: "master", user_id: identity.userId }, 200, cors);
    }
    // NÃO presumir que 'teacher' ou 'professor' seja o papel efetivo no schema.
    // Após confirmar o papel e a autorização do módulo EduPlay no banco,
    // consultar memberships ativos e instituição ativa, usando o JWT verificado.
    return json({ authorized: false }, 403, cors);
  } catch {
    return json({ authorized: false }, 503, cors);
  }
}
