-- =====================================================================
-- Tahap 2B — koreksi wajib
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.business_conversations (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_conversations_pair_unique UNIQUE (business_id, customer_id)
);

INSERT INTO public.business_conversations (conversation_id, business_id, customer_id)
SELECT c.id, c.business_id, m.user_id
  FROM public.conversations c
  JOIN public.conversation_members m ON m.conversation_id = c.id
 WHERE c.type = 'business' AND c.business_id IS NOT NULL
   AND public.business_role_of(c.business_id, m.user_id) IS NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.business_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_conversations FROM authenticated, anon, PUBLIC;
GRANT SELECT ON TABLE public.business_conversations TO authenticated;
GRANT ALL ON TABLE public.business_conversations TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_members_single_owner
  ON public.conversation_members (conversation_id) WHERE role = 'owner';

-- ---------- A. Kapabilitas terpecah (internal) ----------
CREATE OR REPLACE FUNCTION public.conversation_capability(_conversation uuid, _user uuid)
RETURNS TABLE(readable boolean, sendable boolean, callable boolean, manageable boolean, role text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  _type conversation_type; _biz uuid; _assignee uuid; _mrole text; _brole business_role;
  _low uuid; _high uuid;
BEGIN
  readable := false; sendable := false; callable := false; manageable := false;
  role := NULL; reason := 'not_member';
  IF _conversation IS NULL OR _user IS NULL THEN RETURN NEXT; RETURN; END IF;

  SELECT c.type, c.business_id, c.assignee_id INTO _type, _biz, _assignee
    FROM public.conversations c WHERE c.id = _conversation;
  IF _type IS NULL THEN reason := 'not_found'; RETURN NEXT; RETURN; END IF;

  SELECT m.role INTO _mrole FROM public.conversation_members m
   WHERE m.conversation_id = _conversation AND m.user_id = _user;
  role := _mrole;

  IF _type = 'direct' THEN
    IF _mrole IS NULL THEN RETURN NEXT; RETURN; END IF;
    readable := true;
    SELECT d.user_low, d.user_high INTO _low, _high
      FROM public.direct_conversations d WHERE d.conversation_id = _conversation;
    IF _low IS NULL THEN reason := 'disconnected'; RETURN NEXT; RETURN; END IF;
    IF public.pair_blocked(_low, _high) THEN
      reason := 'blocked';
    ELSIF NOT public.are_connected(_low, _high) THEN
      reason := 'disconnected';
    ELSE
      sendable := true; callable := true; reason := 'ok';
    END IF;
    RETURN NEXT; RETURN;
  END IF;

  IF _type = 'group' THEN
    IF _mrole IS NULL THEN RETURN NEXT; RETURN; END IF;
    readable := true; sendable := true; callable := true;
    manageable := _mrole IN ('owner','admin'); reason := 'ok';
    RETURN NEXT; RETURN;
  END IF;

  IF _biz IS NOT NULL THEN _brole := public.business_role_of(_biz, _user); END IF;
  IF _brole IN ('owner','admin') THEN
    readable := true; sendable := true; callable := true; manageable := true; reason := 'ok';
  ELSIF _brole IN ('agent','cashier') THEN
    readable := coalesce(_assignee = _user, false) OR _mrole IS NOT NULL;
    sendable := coalesce(_assignee = _user, false);
    callable := sendable;
    reason := CASE WHEN sendable THEN 'ok' WHEN readable THEN 'unassigned' ELSE 'not_member' END;
  ELSIF _brole = 'viewer' THEN
    readable := true; reason := 'read_only';
  ELSIF _mrole IS NOT NULL THEN
    readable := true; sendable := true; callable := true; reason := 'ok';
  END IF;
  RETURN NEXT; RETURN;
END $fn$;
REVOKE ALL ON FUNCTION public.conversation_capability(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_capability(uuid,uuid) TO service_role;

-- ---------- Helper SELF-SCOPED ----------
CREATE OR REPLACE FUNCTION public.current_user_is_conv_member(_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.conversation_members m
                  WHERE m.conversation_id = _conversation AND m.user_id = auth.uid());
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_can_read_conversation(_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce((SELECT cap.readable FROM public.conversation_capability(_conversation, auth.uid()) cap), false);
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_can_send_conversation(_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce((SELECT cap.sendable FROM public.conversation_capability(_conversation, auth.uid()) cap), false);
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_can_call_conversation(_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce((SELECT cap.callable FROM public.conversation_capability(_conversation, auth.uid()) cap), false);
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_conversation(_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT coalesce((SELECT cap.manageable FROM public.conversation_capability(_conversation, auth.uid()) cap), false);
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_business_role(_business uuid)
RETURNS business_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT public.business_role_of(_business, auth.uid());
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_is_business_member(_business uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT public.business_role_of(_business, auth.uid()) IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_business(_business uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT public.business_role_of(_business, auth.uid()) IN ('owner','admin');
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_can_sell_business(_business uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT public.business_role_of(_business, auth.uid()) IN ('owner','admin','agent','cashier');
$fn$;

DO $do$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'current_user_is_conv_member(uuid)',
    'current_user_can_read_conversation(uuid)',
    'current_user_can_send_conversation(uuid)',
    'current_user_can_call_conversation(uuid)',
    'current_user_can_manage_conversation(uuid)',
    'current_user_business_role(uuid)',
    'current_user_is_business_member(uuid)',
    'current_user_can_manage_business(uuid)',
    'current_user_can_sell_business(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $do$;

-- ---------- B. Policy: helper arbitrary-user -> self-scoped ----------
DROP POLICY IF EXISTS "add business member" ON public.business_members;
CREATE POLICY "add business member" ON public.business_members FOR INSERT TO authenticated
  WITH CHECK ((current_user_can_manage_business(business_id) AND ((role <> 'owner'::business_role) OR (current_user_business_role(business_id) = 'owner'::business_role))));

DROP POLICY IF EXISTS "read business members" ON public.business_members;
CREATE POLICY "read business members" ON public.business_members FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR current_user_is_business_member(business_id)));

DROP POLICY IF EXISTS "remove business member" ON public.business_members;
CREATE POLICY "remove business member" ON public.business_members FOR DELETE TO authenticated
  USING (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "update business member" ON public.business_members;
CREATE POLICY "update business member" ON public.business_members FOR UPDATE TO authenticated
  USING (current_user_can_manage_business(business_id))
  WITH CHECK ((current_user_can_manage_business(business_id) AND ((role <> 'owner'::business_role) OR (current_user_business_role(business_id) = 'owner'::business_role))));

DROP POLICY IF EXISTS "manage business" ON public.businesses;
CREATE POLICY "manage business" ON public.businesses FOR UPDATE TO authenticated
  USING (current_user_can_manage_business(id))
  WITH CHECK (current_user_can_manage_business(id));

DROP POLICY IF EXISTS "read business" ON public.businesses;
CREATE POLICY "read business" ON public.businesses FOR SELECT TO authenticated
  USING ((is_public OR current_user_is_business_member(id)));

DROP POLICY IF EXISTS "delete customers" ON public.customers;
CREATE POLICY "delete customers" ON public.customers FOR DELETE TO authenticated
  USING (current_user_can_manage_business(business_id));