-- conversation_overview tidak perlu hak istimewa: seluruh tabel yang dibacanya
-- (conversation_members, messages, message_hides) sudah memiliki aturan akses
-- yang membatasi baris ke anggota percakapan. SECURITY INVOKER membuat aturan
-- itu tetap berlaku dan menghapus risiko fungsi ini dipakai untuk mengintip
-- percakapan orang lain bila ada bug logika di dalamnya.
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
SECURITY INVOKER
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

-- Indeks untuk hitung belum dibaca per percakapan (created_at menaik).
CREATE INDEX IF NOT EXISTS messages_conv_created_asc_idx
  ON public.messages (conversation_id, created_at);