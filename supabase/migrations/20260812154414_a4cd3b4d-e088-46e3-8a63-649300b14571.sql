-- === 1. Rate limit per perangkat untuk aksi notifikasi latar ===
CREATE TABLE IF NOT EXISTS public.device_action_rate (
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  action text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, action)
);

GRANT ALL ON public.device_action_rate TO service_role;
ALTER TABLE public.device_action_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "device_action_rate owner read" ON public.device_action_rate
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.bg_rate_ok(_dev uuid, _action text, _limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.device_action_rate;
BEGIN
  IF _dev IS NULL THEN RETURN false; END IF;
  INSERT INTO public.device_action_rate (device_id, action, window_start, count)
  VALUES (_dev, _action, now(), 1)
  ON CONFLICT (device_id, action) DO UPDATE
    SET window_start = CASE WHEN public.device_action_rate.window_start < now() - interval '1 minute'
                            THEN now() ELSE public.device_action_rate.window_start END,
        count = CASE WHEN public.device_action_rate.window_start < now() - interval '1 minute'
                     THEN 1 ELSE public.device_action_rate.count + 1 END
  RETURNING * INTO _row;
  RETURN _row.count <= _limit;
END $$;

REVOKE ALL ON FUNCTION public.bg_rate_ok(uuid, text, integer) FROM public, anon, authenticated;

-- === 2. Terapkan rate limit di aksi latar ===
CREATE OR REPLACE FUNCTION public.bg_mark_delivered(_token text, _conv uuid, _message uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _dev uuid; _uid uuid; _n integer := 0;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential'); END IF;
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
END; $function$;

CREATE OR REPLACE FUNCTION public.bg_mark_read(_token text, _conv uuid, _idempotency_key text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _dev uuid; _uid uuid; _allow boolean := true; _n integer := 0;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'read', 120) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF NOT public.is_conv_member(_conv, _uid) THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

  IF _idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.background_action_log
     WHERE user_id = _uid AND action = 'read' AND idempotency_key = _idempotency_key
  ) THEN
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

  IF _idempotency_key IS NOT NULL THEN
    INSERT INTO public.background_action_log (user_id, device_id, action, idempotency_key, result)
    VALUES (_uid, _dev, 'read', _idempotency_key, jsonb_build_object('count', _n, 'read_receipts', _allow))
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
  RETURN jsonb_build_object('ok', true, 'count', _n, 'read_receipts', _allow);
END; $function$;

CREATE OR REPLACE FUNCTION public.bg_reply_message(_token text, _conv uuid, _body text, _idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _dev uuid; _uid uuid; _existing public.background_action_log; _msg public.messages;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'reply', 30) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF NOT public.is_conv_member(_conv, _uid) THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  IF _body IS NULL OR length(btrim(_body)) = 0 OR length(_body) > 4000 THEN
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
END; $function$;

-- === 3. Target push grup memakai preferensi 'group' ===
CREATE OR REPLACE FUNCTION public.push_targets_for_conversation(_conv uuid, _sender uuid)
RETURNS TABLE(user_id uuid, device_id uuid, push_token text, platform text, muted boolean, allow_preview boolean, sound boolean, vibrate boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT cm.user_id, d.id, d.push_token, d.platform, cm.is_muted,
         COALESCE((s.notifications ->> 'preview')::boolean, true),
         COALESCE((s.notifications ->> 'sound')::boolean, true),
         COALESCE((s.notifications ->> 'vibrate')::boolean, true)
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

-- === 4. Ringkasan percakapan menolak pemanggil anonim ===
CREATE OR REPLACE FUNCTION public.conversation_overview()
RETURNS TABLE(conversation_id uuid, last_message_id uuid, last_message_kind message_kind, last_message_body text, last_message_sender uuid, last_message_at timestamp with time zone, last_attachment_name text, last_location_lat double precision, unread_count integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  mine AS (
    SELECT cm.conversation_id, cm.last_read_at
    FROM public.conversation_members cm, me
    WHERE me.uid IS NOT NULL AND cm.user_id = me.uid
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
        AND NOT EXISTS (SELECT 1 FROM public.message_hides h2 WHERE h2.message_id = um.id AND h2.user_id = me.uid))
  FROM mine LEFT JOIN last_msg l ON l.conversation_id = mine.conversation_id;
$function$;

-- === 5. Panggilan atomik + guard transisi status ===
CREATE OR REPLACE FUNCTION public.create_call_tx(_conversation uuid, _kind call_kind, _max_participants integer DEFAULT 8)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _uid uuid := auth.uid(); _call public.calls; _n integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  IF NOT public.is_conv_member(_conversation, _uid) THEN
    RAISE EXCEPTION 'Anda bukan anggota percakapan ini';
  END IF;

  SELECT count(*) INTO _n FROM public.conversation_members WHERE conversation_id = _conversation;
  IF _n > greatest(2, coalesce(_max_participants, 8)) THEN
    RAISE EXCEPTION 'Jumlah peserta melebihi batas panggilan';
  END IF;

  -- Panggilan berdering yang masih aktif di percakapan ini dipakai ulang.
  SELECT * INTO _call FROM public.calls
   WHERE conversation_id = _conversation AND initiator_id = _uid AND status = 'ringing'
     AND created_at > now() - interval '45 seconds'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN _call; END IF;

  INSERT INTO public.calls (conversation_id, initiator_id, kind, status, provider, room_name, max_participants)
  VALUES (_conversation, _uid, _kind, 'ringing', 'livekit',
          'mcm-' || replace(gen_random_uuid()::text, '-', ''), greatest(2, coalesce(_max_participants, 8)))
  RETURNING * INTO _call;

  -- Peserta HANYA berasal dari anggota percakapan; klien tidak menentukan siapa pun.
  INSERT INTO public.call_participants (call_id, user_id)
  SELECT _call.id, cm.user_id FROM public.conversation_members cm
  WHERE cm.conversation_id = _conversation
  ON CONFLICT DO NOTHING;

  RETURN _call;
END $function$;

CREATE OR REPLACE FUNCTION public.answer_call(_call uuid)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.calls; _now timestamptz := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Panggilan tidak ditemukan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_participants WHERE call_id = _call AND user_id = _uid) THEN
    RAISE EXCEPTION 'Anda bukan peserta panggilan ini';
  END IF;
  IF _row.initiator_id = _uid THEN RAISE EXCEPTION 'Pemanggil tidak bisa menjawab panggilannya sendiri'; END IF;
  IF _row.status = 'ongoing' THEN
    UPDATE public.call_participants SET joined_at = COALESCE(joined_at, _now)
     WHERE call_id = _call AND user_id = _uid;
    RETURN _row;
  END IF;
  IF _row.status <> 'ringing' THEN RAISE EXCEPTION 'Panggilan sudah berakhir'; END IF;

  UPDATE public.calls
     SET status = 'ongoing', answered_at = COALESCE(answered_at, _now), started_at = COALESCE(started_at, _now)
   WHERE id = _call AND status = 'ringing'
  RETURNING * INTO _row;

  UPDATE public.call_participants SET joined_at = COALESCE(joined_at, _now)
   WHERE call_id = _call AND user_id = _uid;
  RETURN _row;
END $function$;

CREATE OR REPLACE FUNCTION public.end_call(_call uuid, _status call_status, _duration integer DEFAULT 0, _reason text DEFAULT NULL)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.calls; _now timestamptz := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  IF _status NOT IN ('ended','declined','missed','failed') THEN
    RAISE EXCEPTION 'Status akhir tidak valid';
  END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Panggilan tidak ditemukan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_participants WHERE call_id = _call AND user_id = _uid) THEN
    RAISE EXCEPTION 'Anda bukan peserta panggilan ini';
  END IF;
  -- Panggilan yang sudah selesai tidak pernah berubah lagi (compare-and-set).
  IF _row.status IN ('ended','declined','missed','failed') THEN RETURN _row; END IF;
  IF _status = 'declined' AND _row.status <> 'ringing' THEN _status := 'ended'; END IF;

  UPDATE public.calls
     SET status = _status,
         ended_at = _now,
         duration_sec = greatest(0, coalesce(_duration, 0)),
         end_reason = coalesce(_reason, end_reason)
   WHERE id = _call AND status IN ('ringing','ongoing')
  RETURNING * INTO _row;

  UPDATE public.call_participants SET left_at = COALESCE(left_at, _now)
   WHERE call_id = _call AND user_id = _uid;
  RETURN _row;
END $function$;

REVOKE ALL ON FUNCTION public.create_call_tx(uuid, call_kind, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.answer_call(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.end_call(uuid, call_status, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_call_tx(uuid, call_kind, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.answer_call(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_call(uuid, call_status, integer, text) TO authenticated;