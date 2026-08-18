CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.call_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, call_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_notes TO authenticated;
GRANT ALL ON public.call_notes TO service_role;

ALTER TABLE public.call_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_notes_own" ON public.call_notes;
CREATE POLICY "call_notes_own" ON public.call_notes FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND public.is_call_participant(call_id, auth.uid()));

CREATE INDEX IF NOT EXISTS call_notes_user_idx ON public.call_notes (user_id, call_id);

DROP TRIGGER IF EXISTS call_notes_updated_at ON public.call_notes;
CREATE TRIGGER call_notes_updated_at BEFORE UPDATE ON public.call_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();