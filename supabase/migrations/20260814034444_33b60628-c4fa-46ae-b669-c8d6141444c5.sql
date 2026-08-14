-- ---------- E. Bisnis: registry kanonik + akses baca persisten ----------
CREATE OR REPLACE FUNCTION public.get_or_create_business_conversation(_business uuid, _customer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _conv uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF NOT public.can_manage_business(_business, _uid) THEN
    RAISE EXCEPTION 'forbidden: Hanya pemilik atau admin bisnis';
  END IF;
  IF _customer IS NULL THEN RAISE EXCEPTION 'invalid_member: Pelanggan tidak valid'; END IF;
  IF public.business_role_of(_business, _customer) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_member: Pelanggan tidak boleh staf bisnis';
  END IF;

  PERFORM public.lock_conversation_pair(_business, _customer);
  SELECT bc.conversation_id INTO _conv FROM public.business_conversations bc
   WHERE bc.business_id = _business AND bc.customer_id = _customer;
  IF _conv IS NOT NULL THEN RETURN _conv; END IF;

  INSERT INTO public.conversations (type, business_id, created_by, inbox_status)
  VALUES ('business', _business, _uid, 'open') RETURNING id INTO _conv;
  INSERT INTO public.business_conversations (conversation_id, business_id, customer_id)
  VALUES (_conv, _business, _customer);
  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (_conv, _uid, 'owner'), (_conv, _customer, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  RETURN _conv;
END $fn$;

CREATE OR REPLACE FUNCTION public.set_conversation_assignee(_conversation uuid, _assignee uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _biz uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  SELECT business_id INTO _biz FROM public.conversations WHERE id = _conversation AND type = 'business';
  IF _biz IS NULL THEN RAISE EXCEPTION 'forbidden: Bukan percakapan bisnis'; END IF;
  IF NOT public.can_manage_business(_biz, _uid) THEN
    RAISE EXCEPTION 'forbidden: Hanya pemilik atau admin bisnis';
  END IF;
  IF _assignee IS NOT NULL AND NOT public.is_business_member(_biz, _assignee) THEN
    RAISE EXCEPTION 'invalid_member: Penanggung jawab harus anggota bisnis';
  END IF;
  UPDATE public.conversations SET assignee_id = _assignee, updated_at = now() WHERE id = _conversation;
  IF _assignee IS NOT NULL THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (_conversation, _assignee, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.set_conversation_inbox_status(_conversation uuid, _status inbox_status)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _biz uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT business_id INTO _biz FROM public.conversations WHERE id = _conversation AND type = 'business';
  IF _biz IS NULL THEN RAISE EXCEPTION 'forbidden: Bukan percakapan bisnis'; END IF;
  IF NOT public.current_user_can_send_conversation(_conversation) THEN
    RAISE EXCEPTION 'forbidden: Anda tidak menangani percakapan ini';
  END IF;
  UPDATE public.conversations SET inbox_status = _status, updated_at = now() WHERE id = _conversation;
  RETURN true;
END $fn$;

-- ---------- F. Panggilan memakai kapabilitas callable ----------
CREATE OR REPLACE FUNCTION public.create_call_tx(_conversation uuid, _kind call_kind, _max_participants integer DEFAULT 8)
RETURNS calls LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $fn$
DECLARE _uid uuid := auth.uid(); _call public.calls; _n integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF NOT public.current_user_can_call_conversation(_conversation) THEN
    RAISE EXCEPTION 'not_connected: Panggilan tidak diizinkan untuk percakapan ini';
  END IF;

  SELECT count(*) INTO _n FROM public.conversation_members WHERE conversation_id = _conversation;
  IF _n > greatest(2, coalesce(_max_participants, 8)) THEN
    RAISE EXCEPTION 'forbidden: Jumlah peserta melebihi batas panggilan';
  END IF;

  SELECT * INTO _call FROM public.calls
   WHERE conversation_id = _conversation AND initiator_id = _uid AND status = 'ringing'
     AND created_at > now() - interval '45 seconds'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN _call; END IF;

  INSERT INTO public.calls (conversation_id, initiator_id, kind, status, provider, room_name, max_participants)
  VALUES (_conversation, _uid, _kind, 'ringing', 'livekit',
          'mcm-' || replace(gen_random_uuid()::text, '-', ''), greatest(2, coalesce(_max_participants, 8)))
  RETURNING * INTO _call;

  INSERT INTO public.call_participants (call_id, user_id)
  SELECT _call.id, cm.user_id FROM public.conversation_members cm
  WHERE cm.conversation_id = _conversation
  ON CONFLICT DO NOTHING;

  RETURN _call;
END $fn$;

-- ---------- G. Kapabilitas untuk klien ----------
DROP FUNCTION IF EXISTS public.my_conversation_capability(uuid);
CREATE FUNCTION public.my_conversation_capability(_conversation uuid)
RETURNS TABLE(readable boolean, sendable boolean, callable boolean, manageable boolean, role text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT cap.readable, cap.sendable, cap.callable, cap.manageable, cap.role, cap.reason
    FROM public.conversation_capability(_conversation, auth.uid()) cap;
$fn$;
REVOKE ALL ON FUNCTION public.my_conversation_capability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_conversation_capability(uuid) TO authenticated, service_role;

-- ---------- H. Overview: keanggotaan + percakapan bisnis berotorisasi ----------
DROP FUNCTION IF EXISTS public.conversation_overview();
CREATE FUNCTION public.conversation_overview()
RETURNS TABLE(
  conversation_id uuid, last_message_id uuid, last_message_kind message_kind,
  last_message_body text, last_message_sender uuid, last_message_at timestamptz,
  last_attachment_name text, last_location_lat double precision, unread_count integer,
  readable boolean, sendable boolean, callable boolean, manageable boolean,
  role text, reason text, last_read_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  WITH me AS (SELECT auth.uid() AS uid),
  scope AS (
    SELECT cm.conversation_id AS cid, cm.last_read_at AS lra
      FROM public.conversation_members cm, me
     WHERE me.uid IS NOT NULL AND cm.user_id = me.uid
    UNION
    SELECT c.id, '-infinity'::timestamptz
      FROM public.conversations c, me
     WHERE me.uid IS NOT NULL AND c.type = 'business'
       AND c.business_id IS NOT NULL
       AND public.business_role_of(c.business_id, me.uid) IS NOT NULL
  ),
  mine AS (
    SELECT s.cid AS conversation_id, max(s.lra) AS last_read_at,
           cap.readable, cap.sendable, cap.callable, cap.manageable, cap.role, cap.reason
      FROM scope s, me
      CROSS JOIN LATERAL public.conversation_capability(s.cid, me.uid) cap
     WHERE cap.readable
     GROUP BY s.cid, cap.readable, cap.sendable, cap.callable, cap.manageable, cap.role, cap.reason
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.id, m.kind, m.body, m.sender_id, m.created_at, m.attachment_name, m.location_lat
    FROM public.messages m
    JOIN mine ON mine.conversation_id = m.conversation_id, me
    WHERE NOT EXISTS (SELECT 1 FROM public.message_hides h WHERE h.message_id = m.id AND h.user_id = me.uid)
    ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
  )
  SELECT mine.conversation_id, l.id, l.kind, l.body, l.sender_id, l.created_at, l.attachment_name, l.location_lat,
    (SELECT count(*)::int FROM public.messages um, me
      WHERE um.conversation_id = mine.conversation_id
        AND um.sender_id <> me.uid
        AND um.created_at > mine.last_read_at
        AND NOT EXISTS (SELECT 1 FROM public.message_hides h2 WHERE h2.message_id = um.id AND h2.user_id = me.uid)),
    mine.readable, mine.sendable, mine.callable, mine.manageable, mine.role, mine.reason,
    nullif(mine.last_read_at, '-infinity'::timestamptz)
  FROM mine LEFT JOIN last_msg l ON l.conversation_id = mine.conversation_id;
$fn$;
REVOKE ALL ON FUNCTION public.conversation_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_overview() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_use_conversation(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_conversation(uuid,uuid) TO service_role;