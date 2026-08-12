ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_reason text,
  ADD COLUMN IF NOT EXISTS max_participants int NOT NULL DEFAULT 8;

CREATE INDEX IF NOT EXISTS calls_status_created_idx ON public.calls (status, created_at DESC);
CREATE INDEX IF NOT EXISTS call_participants_user_idx ON public.call_participants (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'call_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_participants;
  END IF;
END $$;

ALTER TABLE public.calls REPLICA IDENTITY FULL;
ALTER TABLE public.call_participants REPLICA IDENTITY FULL;

-- Panggilan yang berdering lebih dari 45 detik dan tidak pernah dijawab
-- ditandai tak terjawab. Aman dipanggil siapa pun peserta panggilan.
CREATE OR REPLACE FUNCTION public.expire_stale_calls()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE public.calls
       SET status = 'missed',
           ended_at = now(),
           end_reason = 'timeout'
     WHERE status = 'ringing'
       AND created_at < now() - interval '45 seconds'
       AND public.is_call_participant(id, auth.uid())
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_calls() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_stale_calls() TO authenticated;
GRANT ALL ON FUNCTION public.expire_stale_calls() TO service_role;