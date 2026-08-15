CREATE TABLE IF NOT EXISTS public.call_log_hides (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, call_id)
);

GRANT SELECT, INSERT, DELETE ON public.call_log_hides TO authenticated;
GRANT ALL ON public.call_log_hides TO service_role;

ALTER TABLE public.call_log_hides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own call log hides" ON public.call_log_hides;
CREATE POLICY "own call log hides" ON public.call_log_hides
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS call_log_hides_user_idx ON public.call_log_hides (user_id);