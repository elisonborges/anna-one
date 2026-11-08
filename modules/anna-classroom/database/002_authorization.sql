-- Authorization function installed on Neon anna-one in November 2026.
-- Run as database owner. Execute rights only for the scoped classroom API role.
REVOKE SELECT ON public.memberships, public.institutions, public.institution_modules, public.modules FROM classroom_api_service;
CREATE OR REPLACE FUNCTION anna_classroom.can_manage_institution(p_user uuid,p_institution uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
SELECT EXISTS (
SELECT 1 FROM public.memberships mem
JOIN public.institutions i ON i.id=mem.institution_id
JOIN public.institution_modules im ON im.institution_id=i.id AND im.enabled=true
JOIN public.modules m ON m.id=im.module_id AND m.code='turmas-e-alunos'
WHERE mem.institution_id=p_institution AND mem.user_id=p_user AND mem.active=true
AND mem.role='institution_admin' AND i.status='active'
);
$$;
REVOKE ALL ON FUNCTION anna_classroom.can_manage_institution(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anna_classroom.can_manage_institution(uuid,uuid) TO classroom_api_service;
