-- 1) REALTIME PUBLICATION (idempotent) + replica identity untuk chat
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages','message_receipts','message_reactions','conversations','conversation_members']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;

-- 2) Indeks pendukung daftar percakapan
CREATE INDEX IF NOT EXISTS messages_conv_sender_created_idx
  ON public.messages (conversation_id, sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_hides_user_idx
  ON public.message_hides (user_id, message_id);

-- 3) Ringkasan percakapan: pesan terakhir + jumlah belum dibaca, tanpa menarik semua pesan
CREATE OR REPLACE FUNCTION public.conversation_overview()
RETURNS TABLE(
  conversation_id uuid,
  last_message_id uuid,
  last_message_kind public.message_kind,
  last_message_body text,
  last_message_sender uuid,
  last_message_at timestamptz,
  last_attachment_name text,
  last_location_lat double precision,
  unread_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  mine AS (
    SELECT cm.conversation_id, cm.last_read_at
    FROM public.conversation_members cm, me
    WHERE cm.user_id = me.uid
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.id, m.kind, m.body, m.sender_id, m.created_at, m.attachment_name, m.location_lat
    FROM public.messages m
    JOIN mine ON mine.conversation_id = m.conversation_id, me
    WHERE NOT EXISTS (
      SELECT 1 FROM public.message_hides h WHERE h.message_id = m.id AND h.user_id = me.uid
    )
    ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
  )
  SELECT
    mine.conversation_id,
    l.id, l.kind, l.body, l.sender_id, l.created_at, l.attachment_name, l.location_lat,
    (
      SELECT count(*)::int FROM public.messages um, me
      WHERE um.conversation_id = mine.conversation_id
        AND um.sender_id <> me.uid
        AND um.created_at > mine.last_read_at
        AND NOT EXISTS (
          SELECT 1 FROM public.message_hides h2 WHERE h2.message_id = um.id AND h2.user_id = me.uid
        )
    )
  FROM mine
  LEFT JOIN last_msg l ON l.conversation_id = mine.conversation_id;
$$;

REVOKE ALL ON FUNCTION public.conversation_overview() FROM public;
GRANT EXECUTE ON FUNCTION public.conversation_overview() TO authenticated;

-- 4) KEAMANAN: PIN tidak lagi terbaca oleh semua pengguna login.
--    Kolom profil non-sensitif tetap terbaca; kolom `pin` dicabut dari grant tabel.
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, display_name, bio, avatar_url, avatar_color, is_online, last_seen_at, created_at, updated_at)
  ON public.profiles TO authenticated;

-- PIN hanya untuk diri sendiri dan kontak yang sudah tersimpan.
CREATE OR REPLACE FUNCTION public.pins_for_me(_ids uuid[])
RETURNS TABLE(id uuid, pin text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.pin
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id = ANY(coalesce(_ids, ARRAY[]::uuid[]))
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.owner_id = auth.uid() AND c.contact_id = p.id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.pins_for_me(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.pins_for_me(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_pin()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.pin FROM public.profiles p WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_pin() FROM public;
GRANT EXECUTE ON FUNCTION public.my_pin() TO authenticated;