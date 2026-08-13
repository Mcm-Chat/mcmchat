-- 1) Buku kontak sepenuhnya milik pemilik akun
DROP POLICY IF EXISTS "own contacts read" ON public.contacts;
CREATE POLICY "own contacts read" ON public.contacts
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- Status saling blokir tetap bisa dicek tanpa membaca buku kontak orang lain.
CREATE OR REPLACE FUNCTION public.blocked_between(_other uuid)
RETURNS TABLE(i_blocked boolean, blocked_me boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.contacts c
             WHERE c.owner_id = auth.uid() AND c.contact_id = _other AND c.is_blocked),
    EXISTS (SELECT 1 FROM public.contacts c
             WHERE c.owner_id = _other AND c.contact_id = auth.uid() AND c.is_blocked)
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.blocked_between(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.blocked_between(uuid) TO authenticated;

-- 2) Tidak ada lagi self-join ke percakapan mana pun
DROP POLICY IF EXISTS "member adds members" ON public.conversation_members;
CREATE POLICY "member adds members" ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_conv_member(conversation_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id AND c.created_by = auth.uid()
    )
  );

-- 3) Peserta panggilan hanya ditambahkan pemanggil, dan wajib anggota percakapan
DROP POLICY IF EXISTS "add participant" ON public.call_participants;
CREATE POLICY "add participant" ON public.call_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.id = call_participants.call_id
        AND c.initiator_id = auth.uid()
        AND (
          c.conversation_id IS NULL
          OR public.is_conv_member(c.conversation_id, call_participants.user_id)
        )
    )
  );

-- 4) Indeks kepemilikan
CREATE INDEX IF NOT EXISTS contacts_owner_idx ON public.contacts (owner_id);
CREATE INDEX IF NOT EXISTS contact_requests_requester_idx ON public.contact_requests (requester_id);
CREATE INDEX IF NOT EXISTS contact_requests_target_idx ON public.contact_requests (target_id);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON public.conversation_members (user_id);