
-- 1) customers.pin no longer readable by all business members
REVOKE SELECT (pin) ON public.customers FROM authenticated;
REVOKE SELECT (pin) ON public.customers FROM anon;

CREATE OR REPLACE FUNCTION public.customer_pin(_customer uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.pin FROM public.customers c
  WHERE c.id = _customer
    AND auth.uid() IS NOT NULL
    AND public.can_manage_business(c.business_id, auth.uid())
$$;
REVOKE ALL ON FUNCTION public.customer_pin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_pin(uuid) TO authenticated;

-- 2) conversation admin/creator can remove other members
CREATE OR REPLACE FUNCTION public.is_conv_admin(_conv uuid, _uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = _conv AND c.created_by = _uid
  ) OR EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = _conv AND m.user_id = _uid AND m.role IN ('admin','owner')
  )
$$;
REVOKE ALL ON FUNCTION public.is_conv_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conv_admin(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "admin removes members" ON public.conversation_members;
CREATE POLICY "admin removes members" ON public.conversation_members
FOR DELETE TO authenticated
USING (public.is_conv_admin(conversation_id, auth.uid()));

-- 3) avatars scoped to self, contacts, and conversation partners
CREATE OR REPLACE FUNCTION public.can_read_avatar_object(_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    (storage.foldername(_name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE (c.owner_id = auth.uid() AND c.contact_id::text = (storage.foldername(_name))[1])
         OR (c.contact_id = auth.uid() AND c.owner_id::text = (storage.foldername(_name))[1])
    )
    OR EXISTS (
      SELECT 1 FROM public.conversation_members me
      JOIN public.conversation_members other ON other.conversation_id = me.conversation_id
      WHERE me.user_id = auth.uid()
        AND other.user_id::text = (storage.foldername(_name))[1]
    )
  )
$$;
REVOKE ALL ON FUNCTION public.can_read_avatar_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_avatar_object(text) TO authenticated;

DROP POLICY IF EXISTS "avatar read" ON storage.objects;
CREATE POLICY "avatar read" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'avatars' AND public.can_read_avatar_object(name));

-- 4) internal SECURITY DEFINER helpers not callable by clients
REVOKE ALL ON FUNCTION public.business_role_of(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.convert_to_base(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.status_owner_of(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_view_status(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_read_status_object(text) FROM anon;
REVOKE ALL ON FUNCTION public.can_see_ledger(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_see_prep_job(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_call_participant(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_conv_member(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_business_member(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_manage_business(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_sell_business(uuid, uuid) FROM anon;
