-- 1. Enum + tabel aksi notifikasi (internal, tanpa akses klien)
DO $$ BEGIN
  CREATE TYPE public.notification_action_kind AS ENUM ('reply','read','call_answer','call_decline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.notification_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action public.notification_action_kind NOT NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  call_id uuid REFERENCES public.calls(id) ON DELETE CASCADE,
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_actions_resource_ck CHECK (
    (action IN ('reply','read') AND conversation_id IS NOT NULL AND call_id IS NULL)
    OR (action IN ('call_answer','call_decline')
        AND call_id IS NOT NULL AND conversation_id IS NULL AND message_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_actions_prefix_idx
  ON public.notification_actions (token_prefix);
CREATE INDEX IF NOT EXISTS notification_actions_expires_idx
  ON public.notification_actions (expires_at);
CREATE INDEX IF NOT EXISTS notification_actions_device_idx
  ON public.notification_actions (device_id, created_at DESC);

REVOKE ALL ON TABLE public.notification_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.notification_actions TO service_role;
ALTER TABLE public.notification_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_actions FORCE ROW LEVEL SECURITY;

-- 2. Helper internal panggilan (dipakai wrapper klien DAN aksi notifikasi)
CREATE OR REPLACE FUNCTION public._answer_call_as(_call uuid, _actor uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.calls; _now timestamptz := now(); _left timestamptz; _exists boolean;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: Panggilan tidak ditemukan'; END IF;
  SELECT true, cp.left_at INTO _exists, _left FROM public.call_participants cp
   WHERE cp.call_id = _call AND cp.user_id = _actor;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'forbidden: Anda bukan peserta panggilan ini'; END IF;
  IF _left IS NOT NULL THEN RAISE EXCEPTION 'forbidden: Anda sudah keluar dari panggilan ini'; END IF;
  IF _row.initiator_id = _actor THEN RAISE EXCEPTION 'forbidden: Pemanggil tidak bisa menjawab panggilannya sendiri'; END IF;

  IF _row.status = 'ongoing' THEN
    UPDATE public.call_participants SET joined_at = COALESCE(joined_at, _now)
     WHERE call_id = _call AND user_id = _actor;
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
   WHERE call_id = _call AND user_id = _actor;
  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public._decline_call_as(_call uuid, _actor uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.calls; _now timestamptz := now(); _exists boolean; _total integer; _remaining integer;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: Panggilan tidak ditemukan'; END IF;
  SELECT true INTO _exists FROM public.call_participants WHERE call_id = _call AND user_id = _actor;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'forbidden: Anda bukan peserta panggilan ini'; END IF;
  IF _row.initiator_id = _actor THEN RAISE EXCEPTION 'forbidden: Pemanggil tidak bisa menolak panggilannya sendiri'; END IF;
  IF _row.status IN ('ended','declined','missed','failed') THEN RETURN _row; END IF;
  IF _row.status <> 'ringing' THEN RAISE EXCEPTION 'already_answered: Panggilan sudah dijawab'; END IF;

  UPDATE public.call_participants SET left_at = COALESCE(left_at, _now)
   WHERE call_id = _call AND user_id = _actor;

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

REVOKE ALL ON FUNCTION public._answer_call_as(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._decline_call_as(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- Wrapper klien memakai helper internal yang sama
CREATE OR REPLACE FUNCTION public.answer_call(_call uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN RETURN public._answer_call_as(_call, auth.uid()); END $$;

CREATE OR REPLACE FUNCTION public.decline_call(_call uuid)
RETURNS public.calls
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN RETURN public._decline_call_as(_call, auth.uid()); END $$;

-- Jalur aksi panggilan lama yang cacat dihapus
DROP FUNCTION IF EXISTS public.bg_call_action(text,uuid,text,text);
DROP FUNCTION IF EXISTS public.call_answer_tx(uuid,uuid);
DROP FUNCTION IF EXISTS public.call_decline_tx(uuid,uuid);

-- 3. Mint: satu aksi per tombol per perangkat per notifikasi
CREATE OR REPLACE FUNCTION public.mint_notification_action(
  _user uuid,
  _device uuid,
  _action public.notification_action_kind,
  _conversation uuid DEFAULT NULL,
  _message uuid DEFAULT NULL,
  _call uuid DEFAULT NULL,
  _ttl_seconds integer DEFAULT 600
)
RETURNS TABLE (action_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE _secret text; _prefix text; _ttl integer; _id uuid;
BEGIN
  IF _user IS NULL OR _device IS NULL THEN RAISE EXCEPTION 'invalid_target'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.devices d
                  WHERE d.id = _device AND d.user_id = _user AND d.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_device';
  END IF;

  IF _action IN ('reply','read') THEN
    IF _conversation IS NULL THEN RAISE EXCEPTION 'invalid_resource'; END IF;
    _call := NULL;
    IF _action = 'read' THEN
      IF _message IS NULL THEN RAISE EXCEPTION 'invalid_resource'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.messages m
                      WHERE m.id = _message AND m.conversation_id = _conversation) THEN
        RAISE EXCEPTION 'invalid_resource';
      END IF;
    ELSE
      _message := NULL;
    END IF;
    _ttl := greatest(30, least(600, coalesce(_ttl_seconds, 600)));
  ELSE
    IF _call IS NULL THEN RAISE EXCEPTION 'invalid_resource'; END IF;
    _conversation := NULL; _message := NULL;
    _ttl := greatest(10, least(45, coalesce(_ttl_seconds, 45)));
  END IF;

  _secret := encode(extensions.gen_random_bytes(32), 'hex');
  _prefix := encode(extensions.gen_random_bytes(9), 'hex');

  INSERT INTO public.notification_actions
    (device_id, user_id, action, conversation_id, message_id, call_id,
     token_prefix, token_hash, expires_at)
  VALUES (_device, _user, _action, _conversation, _message, _call,
          _prefix, encode(extensions.digest(_secret, 'sha256'), 'hex'),
          now() + make_interval(secs => _ttl))
  RETURNING id INTO _id;

  action_id := _id;
  token := _prefix || '.' || _secret;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.mint_notification_action(uuid,uuid,public.notification_action_kind,uuid,uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated;

-- 4. Consume: atomik, sekali-pakai, hasil tersimpan untuk retry
CREATE OR REPLACE FUNCTION public.consume_notification_action(
  _action_id uuid,
  _token text,
  _resource uuid,
  _body text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  _row public.notification_actions;
  _hash text; _secret text; _prefix text;
  _res jsonb; _call public.calls; _msg public.messages;
  _sendable boolean; _readable boolean; _allow boolean := true;
  _clean text; _cutoff timestamptz; _n integer := 0;
BEGIN
  IF _action_id IS NULL OR _token IS NULL OR position('.' in _token) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;
  _prefix := split_part(_token, '.', 1);
  _secret := split_part(_token, '.', 2);

  SELECT * INTO _row FROM public.notification_actions WHERE id = _action_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_token'); END IF;

  _hash := encode(extensions.digest(_secret, 'sha256'), 'hex');
  IF _row.token_prefix <> _prefix OR _row.token_hash <> _hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  -- Token hanya sah untuk sumber daya yang diikat saat dibuat
  IF _row.action IN ('reply','read') THEN
    IF _resource IS DISTINCT FROM _row.conversation_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'resource_mismatch');
    END IF;
  ELSE
    IF _resource IS DISTINCT FROM _row.call_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'resource_mismatch');
    END IF;
  END IF;

  -- Retry: kembalikan hasil tersimpan tanpa mengulang efek samping
  IF _row.used_at IS NOT NULL THEN
    RETURN COALESCE(_row.result, jsonb_build_object('ok', true)) || jsonb_build_object('replayed', true);
  END IF;

  IF _row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.devices d
                  WHERE d.id = _row.device_id AND d.user_id = _row.user_id AND d.revoked_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_revoked');
  END IF;

  IF NOT public.bg_rate_ok(_row.device_id, _row.action::text, 60) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  IF _row.action = 'reply' THEN
    SELECT cap.sendable INTO _sendable
      FROM public.conversation_capability(_row.conversation_id, _row.user_id) cap;
    IF NOT COALESCE(_sendable, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_sendable');
    END IF;
    _clean := btrim(COALESCE(_body, ''));
    IF length(_clean) = 0 OR length(_clean) > 4000 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_body');
    END IF;

    INSERT INTO public.messages (conversation_id, sender_id, kind, body)
    VALUES (_row.conversation_id, _row.user_id, 'text', _clean)
    RETURNING * INTO _msg;

    SELECT COALESCE((s.privacy ->> 'readReceipts')::boolean, true) INTO _allow
      FROM public.user_settings s WHERE s.user_id = _row.user_id;
    _allow := COALESCE(_allow, true);

    INSERT INTO public.message_receipts (message_id, user_id, delivered_at, read_at)
    SELECT m.id, _row.user_id, now(), CASE WHEN _allow THEN now() ELSE NULL END
      FROM public.messages m
     WHERE m.conversation_id = _row.conversation_id AND m.sender_id <> _row.user_id
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET delivered_at = COALESCE(public.message_receipts.delivered_at, now()),
          read_at = CASE WHEN _allow THEN COALESCE(public.message_receipts.read_at, now())
                         ELSE public.message_receipts.read_at END;

    UPDATE public.conversation_members SET last_read_at = now()
     WHERE conversation_id = _row.conversation_id AND user_id = _row.user_id;

    _res := jsonb_build_object('ok', true, 'message_id', _msg.id,
                               'conversation_id', _row.conversation_id);

  ELSIF _row.action = 'read' THEN
    SELECT cap.readable INTO _readable
      FROM public.conversation_capability(_row.conversation_id, _row.user_id) cap;
    IF NOT COALESCE(_readable, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    SELECT m.created_at INTO _cutoff FROM public.messages m
     WHERE m.id = _row.message_id AND m.conversation_id = _row.conversation_id;
    IF _cutoff IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'resource_mismatch');
    END IF;

    SELECT COALESCE((s.privacy ->> 'readReceipts')::boolean, true) INTO _allow
      FROM public.user_settings s WHERE s.user_id = _row.user_id;
    _allow := COALESCE(_allow, true);

    WITH ins AS (
      INSERT INTO public.message_receipts (message_id, user_id, delivered_at, read_at)
      SELECT m.id, _row.user_id, now(), CASE WHEN _allow THEN now() ELSE NULL END
        FROM public.messages m
       WHERE m.conversation_id = _row.conversation_id
         AND m.sender_id <> _row.user_id
         AND m.created_at <= _cutoff
      ON CONFLICT (message_id, user_id) DO UPDATE
        SET delivered_at = COALESCE(public.message_receipts.delivered_at, now()),
            read_at = CASE WHEN _allow THEN COALESCE(public.message_receipts.read_at, now())
                           ELSE public.message_receipts.read_at END
      RETURNING 1
    ) SELECT count(*) INTO _n FROM ins;

    UPDATE public.conversation_members SET last_read_at = greatest(COALESCE(last_read_at, _cutoff), _cutoff)
     WHERE conversation_id = _row.conversation_id AND user_id = _row.user_id;

    _res := jsonb_build_object('ok', true, 'count', _n, 'read_receipts', _allow);

  ELSE
    BEGIN
      IF _row.action = 'call_answer' THEN
        _call := public._answer_call_as(_row.call_id, _row.user_id);
      ELSE
        _call := public._decline_call_as(_row.call_id, _row.user_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', split_part(SQLERRM, ':', 1));
    END;
    _res := jsonb_build_object('ok', true, 'status', _call.status,
                               'call_id', _call.id, 'room', _call.room_name);
  END IF;

  UPDATE public.notification_actions
     SET used_at = now(), result = _res
   WHERE id = _row.id;
  UPDATE public.devices SET last_active_at = now() WHERE id = _row.device_id;

  RETURN _res;
END $$;

REVOKE ALL ON FUNCTION public.consume_notification_action(uuid,text,uuid,text)
  FROM PUBLIC, anon, authenticated;

-- 5. Target perangkat untuk push "panggilan berakhir"
CREATE OR REPLACE FUNCTION public.push_targets_for_call_terminal(_call uuid)
RETURNS TABLE (user_id uuid, device_id uuid, push_token text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT d.user_id, d.id, d.push_token
    FROM public.call_participants cp
    JOIN public.devices d ON d.user_id = cp.user_id
   WHERE cp.call_id = _call
     AND d.revoked_at IS NULL
     AND d.push_token IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.push_targets_for_call_terminal(uuid) FROM PUBLIC, anon, authenticated;

-- 6. Pembersih aksi kedaluwarsa
CREATE OR REPLACE FUNCTION public.cleanup_notification_actions()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH del AS (
    DELETE FROM public.notification_actions
     WHERE expires_at < now() - interval '1 day'
        OR (used_at IS NOT NULL AND used_at < now() - interval '1 day')
    RETURNING 1
  ) SELECT count(*)::int FROM del;
$$;

REVOKE ALL ON FUNCTION public.cleanup_notification_actions() FROM PUBLIC, anon, authenticated;