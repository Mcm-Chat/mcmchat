DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'call_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_notes;
  END IF;
END $$;

ALTER TABLE public.call_notes REPLICA IDENTITY FULL;