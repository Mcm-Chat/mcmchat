ALTER TYPE public.message_kind ADD VALUE IF NOT EXISTS 'sticker';

CREATE TABLE IF NOT EXISTS public.stickers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path text NOT NULL,
  emoji text NOT NULL DEFAULT '😀',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stickers_owner_created_idx ON public.stickers(owner_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stickers TO authenticated;
GRANT ALL ON public.stickers TO service_role;

ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stickers owner all" ON public.stickers;
CREATE POLICY "stickers owner all" ON public.stickers
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "sticker read" ON storage.objects;
CREATE POLICY "sticker read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'stickers' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "sticker write" ON storage.objects;
CREATE POLICY "sticker write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'stickers' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "sticker delete" ON storage.objects;
CREATE POLICY "sticker delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'stickers' AND (storage.foldername(name))[1] = (auth.uid())::text);