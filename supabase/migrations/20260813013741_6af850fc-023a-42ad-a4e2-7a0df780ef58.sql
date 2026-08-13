ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_privacy text NOT NULL DEFAULT 'contacts';

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_privacy_chk
    CHECK (avatar_privacy IN ('contacts','contacts_except','only_share','nobody'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.avatar_audience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('except','only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, target_id, mode)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.avatar_audience TO authenticated;
GRANT ALL ON public.avatar_audience TO service_role;

ALTER TABLE public.avatar_audience ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "avatar audience owner" ON public.avatar_audience;
CREATE POLICY "avatar audience owner" ON public.avatar_audience
FOR ALL TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

DROP TRIGGER IF EXISTS avatar_audience_updated_at ON public.avatar_audience;
CREATE TRIGGER avatar_audience_updated_at BEFORE UPDATE ON public.avatar_audience
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.can_view_avatar(_owner uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _viewer IS NULL THEN false
    WHEN _owner = _viewer THEN true
    -- pemblokiran dua arah selalu menutup akses
    WHEN EXISTS (
      SELECT 1 FROM public.contacts b
      WHERE b.is_blocked = true
        AND ((b.owner_id = _owner AND b.contact_id = _viewer)
          OR (b.owner_id = _viewer AND b.contact_id = _owner))
    ) THEN false
    ELSE (
      SELECT CASE p.avatar_privacy
        WHEN 'nobody' THEN false
        WHEN 'only_share' THEN EXISTS (
          SELECT 1 FROM public.avatar_audience a
          WHERE a.owner_id = _owner AND a.target_id = _viewer AND a.mode = 'only'
        )
        WHEN 'contacts_except' THEN
          EXISTS (
            SELECT 1 FROM public.contacts c
            WHERE c.owner_id = _owner AND c.contact_id = _viewer AND c.is_blocked = false
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.avatar_audience a
            WHERE a.owner_id = _owner AND a.target_id = _viewer AND a.mode = 'except'
          )
        ELSE EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.owner_id = _owner AND c.contact_id = _viewer AND c.is_blocked = false
        )
      END
      FROM public.profiles p WHERE p.id = _owner
    )
  END
$$;
REVOKE ALL ON FUNCTION public.can_view_avatar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_avatar(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_avatar_object(_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.can_view_avatar(public.safe_uuid((storage.foldername(_name))[1]), auth.uid())
$$;
REVOKE ALL ON FUNCTION public.can_read_avatar_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_avatar_object(text) TO authenticated;

DROP POLICY IF EXISTS "avatar read" ON storage.objects;
CREATE POLICY "avatar read" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'avatars' AND public.can_read_avatar_object(name));