-- 1) profiles: hapus dari publikasi realtime (tidak punya jalur SELECT; fail-closed
--    dan mencegah siaran PIN bila kelak ada policy SELECT yang ceroboh)
ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;

-- 2) calls / call_participants: pakai helper self-scoped (auth.uid() internal)
CREATE OR REPLACE FUNCTION public.current_user_is_call_participant(_call uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.call_participants cp
    WHERE cp.call_id = _call AND cp.user_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_is_call_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_call_participant(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "participant reads call" ON public.calls;
CREATE POLICY "participant reads call"
  ON public.calls FOR SELECT TO authenticated
  USING (public.current_user_is_call_participant(id));

DROP POLICY IF EXISTS "participant reads roster" ON public.call_participants;
CREATE POLICY "participant reads roster"
  ON public.call_participants FOR SELECT TO authenticated
  USING (public.current_user_is_call_participant(call_id));

-- 3) helper arbitrary-user tidak boleh dipanggil langsung oleh klien
REVOKE ALL ON FUNCTION public.is_call_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_call_participant(uuid, uuid) TO service_role;