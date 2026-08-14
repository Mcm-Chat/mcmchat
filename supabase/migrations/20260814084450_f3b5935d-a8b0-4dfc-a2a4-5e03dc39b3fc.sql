
-- 1) Status hubungan percakapan direct (untuk banner read-only yang informatif)
CREATE OR REPLACE FUNCTION public.my_direct_relation_state(_conversation uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  _type conversation_type;
  _other uuid;
  _lo uuid; _hi uuid;
  _req public.contact_requests;
  _msgs boolean := false;
  _blocked_by_me boolean := false;
  _blocked_me boolean := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT c.type INTO _type FROM public.conversations c WHERE c.id = _conversation;
  IF _type IS NULL THEN RETURN jsonb_build_object('kind','not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_members m
                  WHERE m.conversation_id = _conversation AND m.user_id = uid) THEN
    RETURN jsonb_build_object('kind','not_member');
  END IF;
  IF _type <> 'direct' THEN RETURN jsonb_build_object('kind','other'); END IF;

  SELECT m.user_id INTO _other FROM public.conversation_members m
   WHERE m.conversation_id = _conversation AND m.user_id <> uid LIMIT 1;
  IF _other IS NULL THEN RETURN jsonb_build_object('kind','direct','other_id',NULL); END IF;

  _lo := least(uid, _other); _hi := greatest(uid, _other);

  SELECT EXISTS (SELECT 1 FROM public.contacts b
                  WHERE b.is_blocked AND b.owner_id = uid AND b.contact_id = _other)
    INTO _blocked_by_me;
  SELECT EXISTS (SELECT 1 FROM public.contacts b
                  WHERE b.is_blocked AND b.owner_id = _other AND b.contact_id = uid)
    INTO _blocked_me;

  SELECT EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.conversation_id = _conversation AND m.sender_id = _other)
    INTO _msgs;

  SELECT * INTO _req FROM public.contact_requests
   WHERE least(requester_id,target_id) = _lo AND greatest(requester_id,target_id) = _hi;

  RETURN jsonb_build_object(
    'kind','direct',
    'other_id', _other,
    'connected', public.are_connected(uid, _other),
    'blocked_by_me', _blocked_by_me,
    'blocked_me', _blocked_me,
    'has_incoming_messages', _msgs,
    'request_id', _req.id,
    'request_status', _req.status,
    'request_direction', CASE
      WHEN _req.id IS NULL THEN NULL
      WHEN _req.target_id = uid THEN 'incoming' ELSE 'outgoing' END
  );
END $function$;

REVOKE ALL ON FUNCTION public.my_direct_relation_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_direct_relation_state(uuid) TO authenticated, service_role;

-- 2) Klaim percakapan direct lama: buat/pakai ulang SATU pending request
--    dari pengirim pesan ke pengguna saat ini. Tidak pernah auto-accept.
CREATE OR REPLACE FUNCTION public.claim_legacy_direct_conversation(_conversation uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  _type conversation_type;
  _other uuid; _lo uuid; _hi uuid;
  _req public.contact_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT c.type INTO _type FROM public.conversations c WHERE c.id = _conversation;
  IF _type IS DISTINCT FROM 'direct' THEN RAISE EXCEPTION 'invalid_conversation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_members m
                  WHERE m.conversation_id = _conversation AND m.user_id = uid) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT m.user_id INTO _other FROM public.conversation_members m
   WHERE m.conversation_id = _conversation AND m.user_id <> uid LIMIT 1;
  IF _other IS NULL OR _other = uid THEN RAISE EXCEPTION 'invalid_conversation'; END IF;

  _lo := least(uid, _other); _hi := greatest(uid, _other);
  PERFORM public.lock_contact_pair(_lo, _hi);

  -- Re-validasi setelah lock.
  IF NOT EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.conversation_id = _conversation AND m.sender_id = _other) THEN
    RAISE EXCEPTION 'no_incoming_messages';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contacts b
              WHERE b.is_blocked
                AND ((b.owner_id = uid AND b.contact_id = _other)
                  OR (b.owner_id = _other AND b.contact_id = uid))) THEN
    RAISE EXCEPTION 'blocked';
  END IF;
  IF public.are_connected(uid, _other) THEN
    RETURN jsonb_build_object('status','connected','code','already_connected');
  END IF;

  SELECT * INTO _req FROM public.contact_requests
   WHERE least(requester_id,target_id) = _lo AND greatest(requester_id,target_id) = _hi
   FOR UPDATE;

  IF _req.id IS NOT NULL THEN
    IF _req.status = 'blocked' THEN RAISE EXCEPTION 'blocked'; END IF;
    IF _req.status = 'pending' THEN
      RETURN jsonb_build_object(
        'status','pending','code','already_pending','request_id',_req.id,
        'direction', CASE WHEN _req.target_id = uid THEN 'incoming' ELSE 'outgoing' END);
    END IF;
    UPDATE public.contact_requests
       SET requester_id = _other, target_id = uid, status = 'pending',
           message = '', updated_at = now()
     WHERE id = _req.id
     RETURNING * INTO _req;
    RETURN jsonb_build_object('status','pending','code','reused',
                              'request_id',_req.id,'direction','incoming');
  END IF;

  INSERT INTO public.contact_requests (requester_id, target_id, message, status)
  VALUES (_other, uid, '', 'pending')
  RETURNING * INTO _req;

  RETURN jsonb_build_object('status','pending','code','created',
                            'request_id',_req.id,'direction','incoming');
END $function$;

REVOKE ALL ON FUNCTION public.claim_legacy_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_legacy_direct_conversation(uuid) TO authenticated, service_role;

-- 3) Balasan langsung dari notifikasi WAJIB lolos capability SEND.
CREATE OR REPLACE FUNCTION public.bg_reply_message(_token text, _conv uuid, _body text, _idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _dev uuid; _uid uuid; _existing public.background_action_log; _msg public.messages;
        _sendable boolean;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'reply', 30) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  -- Otorisasi dievaluasi ULANG saat aksi diproses (bukan saat push dibuat):
  -- percakapan read-only/disconnected/blocked ditolak walau notifikasi lama ada.
  SELECT cap.sendable INTO _sendable
    FROM public.conversation_capability(_conv, _uid) cap;
  IF NOT coalesce(_sendable, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_sendable');
  END IF;

  IF _body IS NULL OR length(btrim(_body)) = 0 OR length(btrim(_body)) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_body');
  END IF;

  SELECT * INTO _existing FROM public.background_action_log
   WHERE user_id = _uid AND action = 'reply' AND idempotency_key = _idempotency_key;
  IF _existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || _existing.result;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, kind, body)
  VALUES (_conv, _uid, 'text', btrim(_body)) RETURNING * INTO _msg;

  PERFORM public.bg_mark_read(_token, _conv, _idempotency_key || ':read');

  INSERT INTO public.background_action_log (user_id, device_id, action, idempotency_key, result)
  VALUES (_uid, _dev, 'reply', _idempotency_key, jsonb_build_object('message_id', _msg.id));

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
  RETURN jsonb_build_object('ok', true, 'message_id', _msg.id);
END $function$;

REVOKE ALL ON FUNCTION public.bg_reply_message(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bg_reply_message(text, uuid, text, text) TO service_role;

-- 4) Target push kini membawa can_reply turunan server per penerima.
DROP FUNCTION IF EXISTS public.push_targets_for_conversation(uuid, uuid);
CREATE FUNCTION public.push_targets_for_conversation(_conv uuid, _sender uuid)
RETURNS TABLE(user_id uuid, device_id uuid, push_token text, platform text, muted boolean,
              allow_preview boolean, sound boolean, vibrate boolean, can_reply boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT cm.user_id, d.id, d.push_token, d.platform, cm.is_muted,
         COALESCE((s.notifications ->> 'preview')::boolean, true),
         COALESCE((s.notifications ->> 'sound')::boolean, true),
         COALESCE((s.notifications ->> 'vibrate')::boolean, true),
         COALESCE((SELECT cap.sendable FROM public.conversation_capability(_conv, cm.user_id) cap), false)
  FROM public.conversation_members cm
  JOIN public.conversations c ON c.id = cm.conversation_id
  JOIN public.devices d ON d.user_id = cm.user_id AND d.push_token IS NOT NULL AND d.revoked_at IS NULL
  LEFT JOIN public.user_settings s ON s.user_id = cm.user_id
  WHERE cm.conversation_id = _conv
    AND cm.user_id <> _sender
    AND cm.is_muted = false
    AND COALESCE((s.notifications ->> (CASE WHEN c.type = 'group' THEN 'group' ELSE 'chat' END))::boolean, true) = true
    AND COALESCE((s.notifications ->> 'push')::boolean, true) = true;
$function$;

REVOKE ALL ON FUNCTION public.push_targets_for_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_targets_for_conversation(uuid, uuid) TO service_role;
