-- ============ ENUM ============
DO $$ BEGIN
  CREATE TYPE public.status_privacy AS ENUM ('contacts','contacts_except','only_share_with');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.status_item_kind AS ENUM ('image','text','video');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ TABEL ============
CREATE TABLE IF NOT EXISTS public.statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caption text NOT NULL DEFAULT '',
  privacy public.status_privacy NOT NULL DEFAULT 'contacts',
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statuses_lifetime_valid CHECK (expires_at > created_at)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statuses TO authenticated;
GRANT ALL ON public.statuses TO service_role;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.status_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.status_item_kind NOT NULL DEFAULT 'image',
  media_path text,
  thumb_path text,
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  -- Durasi tayang per slide saat ditonton (berbeda dari masa aktif status).
  duration_ms integer NOT NULL DEFAULT 5000,
  sort_order integer NOT NULL DEFAULT 0,
  caption text NOT NULL DEFAULT '',
  text_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT status_items_duration_range CHECK (duration_ms BETWEEN 1000 AND 30000),
  CONSTRAINT status_items_media_present CHECK (kind = 'text' OR media_path IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_items TO authenticated;
GRANT ALL ON public.status_items TO service_role;
ALTER TABLE public.status_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.status_views (
  item_id uuid NOT NULL REFERENCES public.status_items(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, viewer_id)
);
GRANT SELECT, INSERT ON public.status_views TO authenticated;
GRANT ALL ON public.status_views TO service_role;
ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.status_reactions (
  item_id uuid NOT NULL REFERENCES public.status_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_reactions TO authenticated;
GRANT ALL ON public.status_reactions TO service_role;
ALTER TABLE public.status_reactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.status_mutes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, muted_user_id)
);
GRANT SELECT, INSERT, DELETE ON public.status_mutes TO authenticated;
GRANT ALL ON public.status_mutes TO service_role;
ALTER TABLE public.status_mutes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.status_audience (
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (status_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.status_audience TO authenticated;
GRANT ALL ON public.status_audience TO service_role;
ALTER TABLE public.status_audience ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.status_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_privacy public.status_privacy NOT NULL DEFAULT 'contacts',
  default_lifetime_minutes integer NOT NULL DEFAULT 1440,
  default_slide_ms integer NOT NULL DEFAULT 5000,
  share_view_receipts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT status_pref_lifetime CHECK (default_lifetime_minutes BETWEEN 15 AND 10080),
  CONSTRAINT status_pref_slide CHECK (default_slide_ms BETWEEN 1000 AND 30000)
);
GRANT SELECT, INSERT, UPDATE ON public.status_preferences TO authenticated;
GRANT ALL ON public.status_preferences TO service_role;
ALTER TABLE public.status_preferences ENABLE ROW LEVEL SECURITY;

-- ============ FUNGSI AKSES ============
-- Menentukan apakah `_uid` boleh melihat sebuah status. Dipakai oleh RLS pada
-- statuses/status_items dan oleh kebijakan storage, sehingga aturan privasi
-- hanya ditulis satu kali.
CREATE OR REPLACE FUNCTION public.can_view_status(_status uuid, _uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.statuses s
    WHERE s.id = _status
      AND s.deleted_at IS NULL
      AND (
        s.owner_id = _uid
        OR (
          _uid IS NOT NULL
          AND s.expires_at > now()
          -- penonton harus tersimpan sebagai kontak pemilik dan tidak diblokir
          AND EXISTS (
            SELECT 1 FROM public.contacts c
            WHERE c.owner_id = s.owner_id AND c.contact_id = _uid AND c.is_blocked = false
          )
          -- dan penonton tidak sedang memblokir pemilik
          AND NOT EXISTS (
            SELECT 1 FROM public.contacts b
            WHERE b.owner_id = _uid AND b.contact_id = s.owner_id AND b.is_blocked = true
          )
          AND CASE s.privacy
            WHEN 'contacts' THEN true
            WHEN 'contacts_except' THEN NOT EXISTS (
              SELECT 1 FROM public.status_audience a WHERE a.status_id = s.id AND a.user_id = _uid
            )
            WHEN 'only_share_with' THEN EXISTS (
              SELECT 1 FROM public.status_audience a WHERE a.status_id = s.id AND a.user_id = _uid
            )
          END
        )
      )
  )
$$;
REVOKE ALL ON FUNCTION public.can_view_status(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_view_status(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.status_owner_of(_status uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT owner_id FROM public.statuses WHERE id = _status $$;
REVOKE ALL ON FUNCTION public.status_owner_of(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.status_owner_of(uuid) TO authenticated;

-- ============ RLS ============
DROP POLICY IF EXISTS "statuses readable by audience" ON public.statuses;
CREATE POLICY "statuses readable by audience" ON public.statuses FOR SELECT TO authenticated
  USING (public.can_view_status(id, auth.uid()));
DROP POLICY IF EXISTS "statuses insert own" ON public.statuses;
CREATE POLICY "statuses insert own" ON public.statuses FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "statuses update own" ON public.statuses;
CREATE POLICY "statuses update own" ON public.statuses FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "statuses delete own" ON public.statuses;
CREATE POLICY "statuses delete own" ON public.statuses FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "status items readable by audience" ON public.status_items;
CREATE POLICY "status items readable by audience" ON public.status_items FOR SELECT TO authenticated
  USING (public.can_view_status(status_id, auth.uid()));
DROP POLICY IF EXISTS "status items write own" ON public.status_items;
CREATE POLICY "status items write own" ON public.status_items FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.status_owner_of(status_id) = auth.uid());
DROP POLICY IF EXISTS "status items update own" ON public.status_items;
CREATE POLICY "status items update own" ON public.status_items FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS "status items delete own" ON public.status_items;
CREATE POLICY "status items delete own" ON public.status_items FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "status views visible to viewer and owner" ON public.status_views;
CREATE POLICY "status views visible to viewer and owner" ON public.status_views FOR SELECT TO authenticated
  USING (viewer_id = auth.uid() OR public.status_owner_of(status_id) = auth.uid());
DROP POLICY IF EXISTS "status views insert self" ON public.status_views;
CREATE POLICY "status views insert self" ON public.status_views FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid() AND public.can_view_status(status_id, auth.uid()));

DROP POLICY IF EXISTS "status reactions visible to actor and owner" ON public.status_reactions;
CREATE POLICY "status reactions visible to actor and owner" ON public.status_reactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.status_owner_of(status_id) = auth.uid());
DROP POLICY IF EXISTS "status reactions insert self" ON public.status_reactions;
CREATE POLICY "status reactions insert self" ON public.status_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_view_status(status_id, auth.uid()));
DROP POLICY IF EXISTS "status reactions update self" ON public.status_reactions;
CREATE POLICY "status reactions update self" ON public.status_reactions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "status reactions delete self" ON public.status_reactions;
CREATE POLICY "status reactions delete self" ON public.status_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "status mutes own" ON public.status_mutes;
CREATE POLICY "status mutes own" ON public.status_mutes FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "status mutes insert own" ON public.status_mutes;
CREATE POLICY "status mutes insert own" ON public.status_mutes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "status mutes delete own" ON public.status_mutes;
CREATE POLICY "status mutes delete own" ON public.status_mutes FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "status audience visible to owner or member" ON public.status_audience;
CREATE POLICY "status audience visible to owner or member" ON public.status_audience FOR SELECT TO authenticated
  USING (public.status_owner_of(status_id) = auth.uid());
DROP POLICY IF EXISTS "status audience insert owner" ON public.status_audience;
CREATE POLICY "status audience insert owner" ON public.status_audience FOR INSERT TO authenticated
  WITH CHECK (public.status_owner_of(status_id) = auth.uid());
DROP POLICY IF EXISTS "status audience delete owner" ON public.status_audience;
CREATE POLICY "status audience delete owner" ON public.status_audience FOR DELETE TO authenticated
  USING (public.status_owner_of(status_id) = auth.uid());

DROP POLICY IF EXISTS "status preferences own" ON public.status_preferences;
CREATE POLICY "status preferences own" ON public.status_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "status preferences insert own" ON public.status_preferences;
CREATE POLICY "status preferences insert own" ON public.status_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "status preferences update own" ON public.status_preferences;
CREATE POLICY "status preferences update own" ON public.status_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ INDEX ============
CREATE INDEX IF NOT EXISTS statuses_active_idx ON public.statuses (owner_id, expires_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS statuses_expiry_idx ON public.statuses (expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS status_items_status_idx ON public.status_items (status_id, sort_order);
CREATE INDEX IF NOT EXISTS status_items_owner_idx ON public.status_items (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS status_views_status_idx ON public.status_views (status_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS status_views_viewer_idx ON public.status_views (viewer_id, item_id);
CREATE INDEX IF NOT EXISTS status_reactions_status_idx ON public.status_reactions (status_id, created_at DESC);

-- ============ TRIGGER updated_at ============
DROP TRIGGER IF EXISTS statuses_updated_at ON public.statuses;
CREATE TRIGGER statuses_updated_at BEFORE UPDATE ON public.statuses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS status_preferences_updated_at ON public.status_preferences;
CREATE TRIGGER status_preferences_updated_at BEFORE UPDATE ON public.status_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ REALTIME ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['statuses','status_items','status_views','status_reactions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;

-- ============ FEED RPC ============
-- Satu baris per status yang boleh saya lihat (RLS berlaku karena INVOKER),
-- lengkap dengan jumlah slide, slide yang belum saya lihat, dan status bisukan.
CREATE OR REPLACE FUNCTION public.status_feed()
RETURNS TABLE(
  status_id uuid,
  owner_id uuid,
  caption text,
  privacy public.status_privacy,
  created_at timestamptz,
  expires_at timestamptz,
  last_item_at timestamptz,
  item_count integer,
  unseen_count integer,
  muted boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    s.id,
    s.owner_id,
    s.caption,
    s.privacy,
    s.created_at,
    s.expires_at,
    COALESCE(max(i.created_at), s.created_at),
    count(i.id)::int,
    count(i.id) FILTER (
      WHERE s.owner_id <> auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.status_views v
          WHERE v.item_id = i.id AND v.viewer_id = auth.uid()
        )
    )::int,
    EXISTS (SELECT 1 FROM public.status_mutes m WHERE m.user_id = auth.uid() AND m.muted_user_id = s.owner_id)
  FROM public.statuses s
  JOIN public.status_items i ON i.status_id = s.id
  WHERE s.deleted_at IS NULL
    AND (s.expires_at > now() OR s.owner_id = auth.uid())
  GROUP BY s.id
  ORDER BY 7 DESC;
$$;
REVOKE ALL ON FUNCTION public.status_feed() FROM public;
GRANT EXECUTE ON FUNCTION public.status_feed() TO authenticated;

-- ============ STORAGE POLICIES (bucket status-media) ============
CREATE OR REPLACE FUNCTION public.can_read_status_object(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.status_items i
    WHERE (i.media_path = _name OR i.thumb_path = _name)
      AND public.can_view_status(i.status_id, auth.uid())
  )
$$;
REVOKE ALL ON FUNCTION public.can_read_status_object(text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_read_status_object(text) TO authenticated;

DROP POLICY IF EXISTS "status media insert" ON storage.objects;
CREATE POLICY "status media insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'status-media' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "status media read" ON storage.objects;
CREATE POLICY "status media read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'status-media' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.can_read_status_object(name)));
DROP POLICY IF EXISTS "status media delete" ON storage.objects;
CREATE POLICY "status media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'status-media' AND (storage.foldername(name))[1] = auth.uid()::text);