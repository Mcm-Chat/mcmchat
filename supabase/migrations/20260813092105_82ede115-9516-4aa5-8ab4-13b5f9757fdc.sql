-- 1. Cabut SELECT kolom `pin` pada customers dari authenticated.
--    Pola sama seperti profiles.pin / business_members.staff_pin:
--    akses hanya lewat RPC SECURITY DEFINER public.customer_pin().
REVOKE SELECT ON public.customers FROM authenticated;
GRANT SELECT (id, business_id, user_id, name, address, note, created_at, updated_at)
  ON public.customers TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;

-- 2. Hapus catatan sembunyikan pesan tetap butuh keanggotaan percakapan.
DROP POLICY IF EXISTS "own hides delete" ON public.message_hides;
CREATE POLICY "own hides delete" ON public.message_hides
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_hides.message_id
        AND public.is_conv_member(m.conversation_id, auth.uid())
    )
  );