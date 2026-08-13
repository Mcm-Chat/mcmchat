-- 1) message_receipts: actor harus anggota percakapan pesan tsb
DROP POLICY IF EXISTS "own receipt insert" ON public.message_receipts;
DROP POLICY IF EXISTS "own receipt update" ON public.message_receipts;

CREATE POLICY "own receipt insert" ON public.message_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_receipts.message_id
        AND public.is_conv_member(m.conversation_id, auth.uid())
    )
  );

CREATE POLICY "own receipt update" ON public.message_receipts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_receipts.message_id
        AND public.is_conv_member(m.conversation_id, auth.uid())
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_receipts.message_id
        AND public.is_conv_member(m.conversation_id, auth.uid())
    )
  );

-- 2) message_hides: milik sendiri + pesan dari percakapan yang masih diakses
DROP POLICY IF EXISTS "own hides" ON public.message_hides;
DROP POLICY IF EXISTS "own hides insert" ON public.message_hides;
DROP POLICY IF EXISTS "own hides delete" ON public.message_hides;

CREATE POLICY "own hides" ON public.message_hides
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_hides.message_id
        AND public.is_conv_member(m.conversation_id, auth.uid())
    )
  );

CREATE POLICY "own hides insert" ON public.message_hides
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_hides.message_id
        AND public.is_conv_member(m.conversation_id, auth.uid())
    )
  );

CREATE POLICY "own hides delete" ON public.message_hides
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 3) Audit izin fungsi: cabut dari PUBLIC & anon di seluruh schema public
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- Fungsi sensitif: hanya layanan internal (tidak dipanggil klien)
REVOKE ALL ON FUNCTION public.customer_pin(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.can_view_avatar(uuid, uuid) FROM authenticated;

-- Pastikan RPC yang dipakai aplikasi tetap bisa dijalankan pengguna login
GRANT EXECUTE ON FUNCTION public.conversation_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.status_feed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_staff_directory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_staff_pin(uuid, text, public.business_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_preparation_job(uuid, text) TO authenticated;