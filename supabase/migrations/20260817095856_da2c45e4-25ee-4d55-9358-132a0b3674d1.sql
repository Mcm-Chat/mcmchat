-- 1) Pelanggan: cabut seluruh akses anon (termasuk kolom pin).
REVOKE ALL ON public.customers FROM anon;

-- Pastikan kolom pin tidak pernah terbaca langsung oleh klien.
REVOKE SELECT (pin) ON public.customers FROM authenticated, anon;
GRANT SELECT (id, business_id, user_id, name, address, note, created_at, updated_at)
  ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_pin(uuid) TO authenticated;

-- 2) conversation_members: tulis hanya lewat fungsi SECURITY DEFINER.
REVOKE INSERT, UPDATE, DELETE ON public.conversation_members FROM authenticated, anon;
DROP POLICY IF EXISTS "no direct member writes" ON public.conversation_members;
CREATE POLICY "no direct member writes"
  ON public.conversation_members AS RESTRICTIVE
  FOR ALL TO authenticated, anon
  USING (current_user_can_read_conversation(conversation_id))
  WITH CHECK (false);

-- 3) business_conversations: tulis hanya lewat fungsi SECURITY DEFINER.
REVOKE INSERT, UPDATE, DELETE ON public.business_conversations FROM authenticated, anon;
DROP POLICY IF EXISTS "no direct business conversation writes" ON public.business_conversations;
CREATE POLICY "no direct business conversation writes"
  ON public.business_conversations AS RESTRICTIVE
  FOR ALL TO authenticated, anon
  USING (current_user_can_read_conversation(conversation_id))
  WITH CHECK (false);