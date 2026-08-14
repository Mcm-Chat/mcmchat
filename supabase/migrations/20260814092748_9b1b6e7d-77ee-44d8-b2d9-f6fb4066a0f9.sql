-- =========================================================
-- 1. Token aksi per-notifikasi (TTL pendek, bound, replay-safe)
-- =========================================================
CREATE TABLE public.push_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  prefix text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('message','call')),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls(id) ON DELETE CASCADE,
  allowed_actions text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_action_tokens_expiry_idx ON public.push_action_tokens (expires_at);
CREATE INDEX push_action_tokens_device_idx ON public.push_action_tokens (device_id);

GRANT ALL ON public.push_action_tokens TO service_role;
ALTER TABLE public.push_action_tokens ENABLE ROW LEVEL SECURITY;
-- Sengaja tanpa policy: anon/authenticated tidak pernah bisa membaca token.

CREATE TRIGGER push_action_tokens_updated_at
BEFORE UPDATE ON public.push_action_tokens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.mint_push_action_token(
  _user uuid, _device uuid, _scope text, _actions text[],
  _conversation uuid DEFAULT NULL, _call uuid DEFAULT NULL,
  _ttl_seconds integer DEFAULT 3600
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE _secret text; _prefix text;
BEGIN
  IF _user IS NULL OR _device IS NULL THEN RAISE EXCEPTION 'invalid_target'; END IF;
  IF _scope NOT IN ('message','call') THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  IF _actions IS NULL OR array_length(_actions,1) IS NULL THEN RAISE EXCEPTION 'invalid_actions'; END IF;

  _secret := encode(extensions.gen_random_bytes(32), 'hex');
  _prefix := encode(extensions.gen_random_bytes(9), 'hex');

  INSERT INTO public.push_action_tokens
    (user_id, device_id, prefix, token_hash, scope, conversation_id, call_id, allowed_actions, expires_at)
  VALUES (_user, _device, _prefix, encode(extensions.digest(_secret, 'sha256'),'hex'),
          _scope, _conversation, _call, _actions,
          now() + make_interval(secs => greatest(30, least(86400, coalesce(_ttl_seconds, 3600)))));

  DELETE FROM public.push_action_tokens WHERE expires_at < now() - interval '1 day';

  RETURN _prefix || '.' || _secret;
END $$;

REVOKE ALL ON FUNCTION public.mint_push_action_token(uuid,uuid,text,text[],uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_push_action_token(uuid,uuid,text,text[],uuid,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_push_action_token(
  _token text, _action text, _conversation uuid DEFAULT NULL, _call uuid DEFAULT NULL
) RETURNS TABLE(token_id uuid, prefix text, user_id uuid, device_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
  SELECT t.id, t.prefix, t.user_id, t.device_id
  FROM public.push_action_tokens t
  WHERE t.prefix = split_part(_token, '.', 1)
    AND t.token_hash = encode(extensions.digest(split_part(_token, '.', 2), 'sha256'), 'hex')
    AND t.expires_at > now()
    AND _action = ANY (t.allowed_actions)
    AND (_conversation IS NULL OR t.conversation_id = _conversation)
    AND (_call IS NULL OR t.call_id = _call)
    AND EXISTS (SELECT 1 FROM public.devices d WHERE d.id = t.device_id AND d.revoked_at IS NULL)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_push_action_token(text,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_push_action_token(text,text,uuid,uuid) TO service_role;

-- =========================================================
-- 2. State machine panggilan bersama
-- =========================================================
CREATE OR REPLACE FUNCTION public.call_answer_tx(_call uuid, _uid uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.calls; _now timestamptz := now(); _left timestamptz; _exists boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: Panggilan tidak ditemukan'; END IF;
  SELECT true, cp.left_at INTO _exists, _left FROM public.call_participants cp
   WHERE cp.call_id = _call AND cp.user_id = _uid;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'forbidden: Anda bukan peserta panggilan ini'; END IF;
  IF _left IS NOT NULL THEN RAISE EXCEPTION 'forbidden: Anda sudah keluar dari panggilan ini'; END IF;
  IF _row.initiator_id = _uid THEN RAISE EXCEPTION 'forbidden: Pemanggil tidak bisa menjawab panggilannya sendiri'; END IF;

  IF _row.status = 'ongoing' THEN
    UPDATE public.call_participants SET joined_at = COALESCE(joined_at, _now)
     WHERE call_id = _call AND user_id = _uid;
    RETURN _row;
  END IF;
  IF _row.status <> 'ringing' THEN RAISE EXCEPTION 'not_ringing: Panggilan sudah berakhir'; END IF;
  IF _now > _row.created_at + interval '45 seconds' THEN
    RAISE EXCEPTION 'not_ringing: Panggilan sudah tidak berdering';
  END IF;

  UPDATE public.calls
     SET status = 'ongoing', answered_at = COALESCE(answered_at, _now), started_at = COALESCE(started_at, _now)
   WHERE id = _call AND status = 'ringing'
  RETURNING * INTO _row;

  UPDATE public.call_participants SET joined_at = COALESCE(joined_at, _now)
   WHERE call_id = _call AND user_id = _uid;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.call_decline_tx(_call uuid, _uid uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.calls; _now timestamptz := now(); _exists boolean; _total integer; _remaining integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: Panggilan tidak ditemukan'; END IF;
  SELECT true INTO _exists FROM public.call_participants WHERE call_id = _call AND user_id = _uid;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'forbidden: Anda bukan peserta panggilan ini'; END IF;
  IF _row.initiator_id = _uid THEN RAISE EXCEPTION 'forbidden: Pemanggil tidak bisa menolak panggilannya sendiri'; END IF;
  IF _row.status IN ('ended','declined','missed','failed') THEN RETURN _row; END IF;
  IF _row.status <> 'ringing' THEN RAISE EXCEPTION 'already_answered: Panggilan sudah dijawab'; END IF;

  UPDATE public.call_participants SET left_at = COALESCE(left_at, _now)
   WHERE call_id = _call AND user_id = _uid;

  SELECT count(*) INTO _total FROM public.call_participants WHERE call_id = _call;
  SELECT count(*) INTO _remaining FROM public.call_participants
   WHERE call_id = _call AND user_id <> _row.initiator_id AND left_at IS NULL;

  IF _total <= 2 OR _remaining = 0 THEN
    UPDATE public.calls
       SET status = 'declined', ended_at = COALESCE(ended_at, _now),
           duration_sec = 0, end_reason = COALESCE(end_reason, 'declined')
     WHERE id = _call AND status = 'ringing'
    RETURNING * INTO _row;
    UPDATE public.call_participants SET left_at = COALESCE(left_at, _now) WHERE call_id = _call;
  END IF;

  RETURN _row;
END $$;

REVOKE ALL ON FUNCTION public.call_answer_tx(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_decline_tx(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.answer_call(_call uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.call_answer_tx(_call, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.decline_call(_call uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.call_decline_tx(_call, auth.uid());
END $$;

-- =========================================================
-- 3. Aksi latar memakai token per-notifikasi
-- =========================================================
DROP FUNCTION IF EXISTS public.bg_reply_message(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.bg_mark_read(text, uuid, text);
DROP FUNCTION IF EXISTS public.bg_mark_delivered(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.bg_call_action(text, uuid, text);

CREATE OR REPLACE FUNCTION public.bg_mark_read(_token text, _conv uuid, _action_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _dev uuid; _uid uuid; _pfx text; _allow boolean := true; _n integer := 0; _key text;
BEGIN
  SELECT device_id, user_id, prefix INTO _dev, _uid, _pfx
    FROM public.resolve_push_action_token(_token, 'read', _conv, NULL);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'read', 120) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF NOT public.is_conv_member(_conv, _uid) THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

  _key := _pfx || ':read:' || coalesce(nullif(btrim(_action_id), ''), 'default');
  IF EXISTS (SELECT 1 FROM public.background_action_log
              WHERE user_id = _uid AND action = 'read' AND idempotency_key = _key) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  SELECT COALESCE((s.privacy ->> 'readReceipts')::boolean, true) INTO _allow
    FROM public.user_settings s WHERE s.user_id = _uid;
  _allow := COALESCE(_allow, true);

  WITH ins AS (
    INSERT INTO public.message_receipts (message_id, user_id, delivered_at, read_at)
    SELECT m.id, _uid, now(), CASE WHEN _allow THEN now() ELSE NULL END
    FROM public.messages m
    WHERE m.conversation_id = _conv AND m.sender_id <> _uid
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET delivered_at = COALESCE(public.message_receipts.delivered_at, now()),
          read_at = CASE WHEN _allow THEN COALESCE(public.message_receipts.read_at, now())
                         ELSE public.message_receipts.read_at END
    RETURNING 1
  ) SELECT count(*) INTO _n FROM ins;

  UPDATE public.conversation_members SET last_read_at = now()
   WHERE conversation_id = _conv AND user_id = _uid;

  INSERT INTO public.background_action_log (user_id, device_id, action, idempotency_key, result)
  VALUES (_uid, _dev, 'read', _key, jsonb_build_object('count', _n, 'read_receipts', _allow))
  ON CONFLICT DO NOTHING;

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
  RETURN jsonb_build_object('ok', true, 'count', _n, 'read_receipts', _allow);
END $$;

CREATE OR REPLACE FUNCTION public.bg_reply_message(_token text, _conv uuid, _body text, _action_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _dev uuid; _uid uuid; _pfx text; _existing public.background_action_log;
        _msg public.messages; _sendable boolean; _key text;
BEGIN
  SELECT device_id, user_id, prefix INTO _dev, _uid, _pfx
    FROM public.resolve_push_action_token(_token, 'reply', _conv, NULL);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'reply', 30) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  SELECT cap.sendable INTO _sendable FROM public.conversation_capability(_conv, _uid) cap;
  IF NOT coalesce(_sendable, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_sendable');
  END IF;

  IF _body IS NULL OR length(btrim(_body)) = 0 OR length(btrim(_body)) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_body');
  END IF;

  _key := _pfx || ':reply:' || coalesce(nullif(btrim(_action_id), ''), 'default');
  SELECT * INTO _existing FROM public.background_action_log
   WHERE user_id = _uid AND action = 'reply' AND idempotency_key = _key;
  IF _existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || _existing.result;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, kind, body)
  VALUES (_conv, _uid, 'text', btrim(_body)) RETURNING * INTO _msg;

  PERFORM public.bg_mark_read(_token, _conv, coalesce(nullif(btrim(_action_id), ''), 'default') || ':reply');

  INSERT INTO public.background_action_log (user_id, device_id, action, idempotency_key, result)
  VALUES (_uid, _dev, 'reply', _key, jsonb_build_object('message_id', _msg.id));

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
  RETURN jsonb_build_object('ok', true, 'message_id', _msg.id);
END $$;

CREATE OR REPLACE FUNCTION public.bg_mark_delivered(_token text, _conv uuid, _message uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _dev uuid; _uid uuid; _n integer := 0;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid
    FROM public.resolve_push_action_token(_token, 'delivered', _conv, NULL);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'delivered', 240) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF NOT public.is_conv_member(_conv, _uid) THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

  WITH ins AS (
    INSERT INTO public.message_receipts (message_id, user_id, delivered_at)
    SELECT m.id, _uid, now() FROM public.messages m
    WHERE m.conversation_id = _conv AND m.sender_id <> _uid AND (_message IS NULL OR m.id = _message)
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET delivered_at = COALESCE(public.message_receipts.delivered_at, now())
    RETURNING 1
  ) SELECT count(*) INTO _n FROM ins;

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
  RETURN jsonb_build_object('ok', true, 'count', _n);
END $$;

CREATE OR REPLACE FUNCTION public.bg_call_action(_token text, _call uuid, _action text, _action_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _dev uuid; _uid uuid; _pfx text; _row public.calls; _key text; _existing public.background_action_log;
BEGIN
  IF _action NOT IN ('answer','decline') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  SELECT device_id, user_id, prefix INTO _dev, _uid, _pfx
    FROM public.resolve_push_action_token(_token, _action, NULL, _call);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'call', 30) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  _key := _pfx || ':' || _action || ':' || coalesce(nullif(btrim(_action_id), ''), 'default');
  SELECT * INTO _existing FROM public.background_action_log
   WHERE user_id = _uid AND action = 'call' AND idempotency_key = _key;
  IF _existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || _existing.result;
  END IF;

  BEGIN
    IF _action = 'answer' THEN
      _row := public.call_answer_tx(_call, _uid);
    ELSE
      _row := public.call_decline_tx(_call, _uid);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', split_part(SQLERRM, ':', 1));
  END;

  INSERT INTO public.background_action_log (user_id, device_id, action, idempotency_key, result)
  VALUES (_uid, _dev, 'call', _key,
          jsonb_build_object('status', _row.status, 'call_id', _row.id, 'room', _row.room_name))
  ON CONFLICT DO NOTHING;

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
  RETURN jsonb_build_object('ok', true, 'status', _row.status, 'call_id', _row.id, 'room', _row.room_name);
END $$;

REVOKE ALL ON FUNCTION public.bg_reply_message(text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bg_mark_read(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bg_mark_delivered(text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bg_call_action(text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bg_reply_message(text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bg_mark_read(text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bg_mark_delivered(text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bg_call_action(text,uuid,text,text) TO service_role;

DROP FUNCTION IF EXISTS public.device_from_action_token(text);
UPDATE public.devices SET action_token_hash = NULL, action_token_prefix = NULL
 WHERE action_token_hash IS NOT NULL OR action_token_prefix IS NOT NULL;

-- =========================================================
-- 4. Target push panggilan
-- =========================================================
CREATE OR REPLACE FUNCTION public.push_targets_for_call(_call uuid)
RETURNS TABLE(user_id uuid, device_id uuid, push_token text, platform text,
              allow_preview boolean, sound boolean, vibrate boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT cp.user_id, d.id, d.push_token, d.platform,
         COALESCE((s.notifications ->> 'preview')::boolean, true),
         COALESCE((s.notifications ->> 'sound')::boolean, true),
         COALESCE((s.notifications ->> 'vibrate')::boolean, true)
  FROM public.call_participants cp
  JOIN public.calls c ON c.id = cp.call_id
  JOIN public.devices d ON d.user_id = cp.user_id AND d.push_token IS NOT NULL AND d.revoked_at IS NULL
  LEFT JOIN public.user_settings s ON s.user_id = cp.user_id
  WHERE cp.call_id = _call
    AND cp.user_id <> c.initiator_id
    AND cp.left_at IS NULL
    AND COALESCE((s.notifications ->> 'calls')::boolean, true) = true
    AND COALESCE((s.notifications ->> 'push')::boolean, true) = true;
$$;

REVOKE ALL ON FUNCTION public.push_targets_for_call(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_targets_for_call(uuid) TO service_role;

-- =========================================================
-- 5. Klaim chat lama
-- =========================================================
CREATE OR REPLACE FUNCTION public.claim_legacy_direct_conversation(_conversation uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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

    IF _req.status = 'rejected' AND _req.requester_id = uid THEN
      RETURN jsonb_build_object('status','rejected','code','rejected_by_other',
                                'request_id',_req.id,
                                'retry_at', _req.updated_at + interval '24 hours');
    END IF;

    IF _req.updated_at > now() - interval '1 hour' THEN
      RETURN jsonb_build_object('status', _req.status::text, 'code','cooldown',
                                'request_id',_req.id,
                                'retry_at', _req.updated_at + interval '1 hour');
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
END $$;