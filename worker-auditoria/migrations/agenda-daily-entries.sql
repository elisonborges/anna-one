CREATE TABLE IF NOT EXISTS public.agenda_daily_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 assignment_id uuid NOT NULL REFERENCES public.agenda_teaching_assignments(id),
 author_id uuid NOT NULL REFERENCES public.app_users(id),
 agenda_date date NOT NULL,
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','needs_clarification','approved')),
 review_content jsonb,
 reviewer_id uuid REFERENCES public.app_users(id),
 review_note text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(assignment_id,agenda_date)
);
ALTER TABLE public.agenda_daily_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS agenda_daily_entries_status_idx ON public.agenda_daily_entries(status,agenda_date);
CREATE TABLE IF NOT EXISTS public.agenda_daily_entry_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entry_id uuid NOT NULL REFERENCES public.agenda_daily_entries(id),
 actor_id uuid NOT NULL REFERENCES public.app_users(id),
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agenda_daily_entry_history ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.agenda_daily_entry_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.agenda_daily_entry_history(entry_id,actor_id,snapshot)
 VALUES(NEW.id,CASE WHEN NEW.status IN ('approved','needs_clarification') THEN NEW.reviewer_id ELSE NEW.author_id END,to_jsonb(NEW));
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS agenda_daily_entry_audit ON public.agenda_daily_entries;
CREATE TRIGGER agenda_daily_entry_audit AFTER INSERT OR UPDATE ON public.agenda_daily_entries FOR EACH ROW EXECUTE FUNCTION public.agenda_daily_entry_audit();