CREATE TABLE IF NOT EXISTS public.agenda_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES public.app_users(id),
 guide_id uuid NOT NULL REFERENCES public.agenda_study_guides(id) ON DELETE CASCADE,
 event_key text NOT NULL,
 title text NOT NULL,
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 UNIQUE(institution_id,recipient_id,event_key)
);
CREATE INDEX IF NOT EXISTS agenda_notifications_inbox_idx ON public.agenda_notifications(institution_id,recipient_id,created_at DESC);
ALTER TABLE public.agenda_notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agenda_notifications ADD COLUMN IF NOT EXISTS email_sent_at timestamptz, ADD COLUMN IF NOT EXISTS email_attempt_at timestamptz, ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS email_error text;
