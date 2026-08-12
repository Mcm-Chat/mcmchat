-- ============================================================
-- Android push: device action credentials + background actions
-- ============================================================

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS push_provider text NOT NULL DEFAULT 'fcm',
  ADD COLUMN IF NOT EXISTS action_token_hash text,
  ADD COLUMN IF NOT EXISTS action_token_prefix text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS app_version text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS devices_action_token_prefix_key
  ON public.devices (action_token_prefix) WHERE action_token_prefix IS NOT NULL;
CREATE INDEX IF NOT EXISTS devices_push_token_idx ON public.devices (push_token) WHERE push_token IS NOT NULL;

-- Idempotency + audit for notification-originated background actions.
CREATE TABLE IF NOT EXISTS public.background_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  action text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS background_action_log_idem_key
  ON public.background_action_log (user_id, action, idempotency_key);

GRANT SELECT ON public.background_action_log TO authenticated;
GRANT ALL ON public.background_action_log TO service_role;

ALTER TABLE public.background_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own background actions" ON public.background_action_log;
CREATE POLICY "own background actions" ON public.background_action_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- Device registration: returns the action credential exactly once.
-- Only the SHA-256 fingerprint is persisted.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_device(
  _name text,
  _platform text,
  _push_token text,
  _app_version text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _uid uuid := auth.uid();
  _secret text;
  _prefix text;
  _device public.devices;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  _secret := encode(extensions.gen_random_bytes(32), 'hex');
  _prefix := substr(_secret, 1, 12);

  SELECT * INTO _device
  FROM public.devices
  WHERE user_id = _uid AND push_token IS NOT NULL AND push_token = _push_token
  LIMIT 1;

  IF _device.id IS NULL THEN
    INSERT INTO public.devices (user_id, name, platform, push_token, push_provider, app_version,
                                action_token_hash, action_token_prefix, last_active_at)
    VALUES (_uid, _name, _platform, _push_token, 'fcm', COALESCE(_app_version, ''),
            encode(sha256(_secret::bytea), 'hex'), _prefix, now())
    RETURNING * INTO _device;
  ELSE
    UPDATE public.devices
       SET name = _name,
           platform = _platform,
           app_version = COALESCE(_app_version, ''),
           action_token_hash = encode(sha256(_secret::bytea), 'hex'),
           action_token_prefix = _prefix,
           revoked_at = NULL,
           last_active_at = now()
     WHERE id = _device.id
     RETURNING * INTO _device;
  END IF;

  RETURN jsonb_build_object('device_id', _device.id, 'action_token', _prefix || '.' || _secret);
END;
$$;

-- Revoke one device (logout / remove from settings).
CREATE OR REPLACE FUNCTION public.revoke_push_device(_device uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  UPDATE public.devices
     SET push_token = NULL, action_token_hash = NULL, action_token_prefix = NULL, revoked_at = now()
   WHERE id = _device AND user_id = _uid;
  RETURN FOUND;
END;
$$;

-- Revoke every credential for the signed-in user (used on sign-out).
CREATE OR REPLACE FUNCTION public.revoke_my_push_devices(_push_token text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _n integer := 0;
BEGIN
  IF _uid IS NULL THEN RETURN 0; END IF;
  WITH upd AS (
    UPDATE public.devices
       SET push_token = NULL, action_token_hash = NULL, action_token_prefix = NULL, revoked_at = now()
     WHERE user_id = _uid
       AND (_push_token IS NULL OR push_token = _push_token)
    RETURNING 1
  ) SELECT count(*) INTO _n FROM upd;
  RETURN _n;
END;
$$;

-- Resolve `<prefix>.<secret>` into a device without exposing the secret.
CREATE OR REPLACE FUNCTION public.device_from_action_token(_token text)
RETURNS TABLE(device_id uuid, user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT d.id, d.user_id
  FROM public.devices d
  WHERE d.revoked_at IS NULL
    AND d.action_token_prefix IS NOT NULL
    AND d.action_token_prefix = split_part(_token, '.', 1)
    AND d.action_token_hash = encode(sha256(split_part(_token, '.', 2)::bytea), 'hex')
  LIMIT 1;
$$;

-- ------------------------------------------------------------
-- Background action: inline reply from the notification shade.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bg_reply_message(
  _token text,
  _conv uuid,
  _body text,
  _idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _dev uuid;
  _uid uuid;
  _existing public.background_action_log;
  _msg public.messages;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential');
  END IF;
  IF NOT public.is_conv_member(_conv, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF _body IS NULL OR length(btrim(_body)) = 0 OR length(_body) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_body');
  END IF;

  SELECT * INTO _existing FROM public.background_action_log
   WHERE user_id = _uid AND action = 'reply' AND idempotency_key = _idempotency_key;
  IF _existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true) || _existing.result;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, kind, body)
  VALUES (_conv, _uid, 'text', btrim(_body))
  RETURNING * INTO _msg;

  -- Replying implies reading everything received so far on this device.
  PERFORM public.bg_mark_read(_token, _conv, _idempotency_key || ':read');

  INSERT INTO public.background_action_log (user_id, device_id, action, idempotency_key, result)
  VALUES (_uid, _dev, 'reply', _idempotency_key, jsonb_build_object('message_id', _msg.id));

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;

  RETURN jsonb_build_object('ok', true, 'message_id', _msg.id);
END;
$$;

-- ------------------------------------------------------------
-- Background action: mark read from the notification shade.
-- Honours the read-receipt privacy setting (delivery always recorded).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bg_mark_read(
  _token text,
  _conv uuid,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _dev uuid;
  _uid uuid;
  _allow boolean := true;
  _n integer := 0;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential');
  END IF;
  IF NOT public.is_conv_member(_conv, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

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
    VALUES (_uid, _dev, 'read', _idempotency_key,
            jsonb_build_object('count', _n, 'read_receipts', _allow))
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;

  RETURN jsonb_build_object('ok', true, 'count', _n, 'read_receipts', _allow);
END;
$$;

-- ------------------------------------------------------------
-- Background action: the device physically received the push.
-- This is the only trustworthy delivery signal while the app is killed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bg_mark_delivered(_token text, _conv uuid, _message uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _dev uuid;
  _uid uuid;
  _n integer := 0;
BEGIN
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential');
  END IF;
  IF NOT public.is_conv_member(_conv, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH ins AS (
    INSERT INTO public.message_receipts (message_id, user_id, delivered_at)
    SELECT m.id, _uid, now()
    FROM public.messages m
    WHERE m.conversation_id = _conv
      AND m.sender_id <> _uid
      AND (_message IS NULL OR m.id = _message)
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET delivered_at = COALESCE(public.message_receipts.delivered_at, now())
    RETURNING 1
  ) SELECT count(*) INTO _n FROM ins;

  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;

  RETURN jsonb_build_object('ok', true, 'count', _n);
END;
$$;

-- ------------------------------------------------------------
-- Push fan-out targets for a conversation: honours per-conversation mute
-- and per-user notification preferences.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_targets_for_conversation(_conv uuid, _sender uuid)
RETURNS TABLE(
  user_id uuid,
  device_id uuid,
  push_token text,
  platform text,
  muted boolean,
  allow_preview boolean,
  sound boolean,
  vibrate boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cm.user_id,
         d.id,
         d.push_token,
         d.platform,
         cm.is_muted,
         COALESCE((s.notifications ->> 'preview')::boolean, true),
         COALESCE((s.notifications ->> 'sound')::boolean, true),
         COALESCE((s.notifications ->> 'vibrate')::boolean, true)
  FROM public.conversation_members cm
  JOIN public.devices d ON d.user_id = cm.user_id AND d.push_token IS NOT NULL AND d.revoked_at IS NULL
  LEFT JOIN public.user_settings s ON s.user_id = cm.user_id
  WHERE cm.conversation_id = _conv
    AND cm.user_id <> _sender
    AND cm.is_muted = false
    AND COALESCE((s.notifications ->> 'chat')::boolean, true) = true
    AND COALESCE((s.notifications ->> 'push')::boolean, true) = true;
$$;

-- Generic per-user push targets for tasks / sales / ledger notifications.
CREATE OR REPLACE FUNCTION public.push_targets_for_user(_user uuid, _category text)
RETURNS TABLE(device_id uuid, push_token text, platform text, allow_preview boolean, sound boolean, vibrate boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.push_token, d.platform,
         COALESCE((s.notifications ->> 'preview')::boolean, true),
         COALESCE((s.notifications ->> 'sound')::boolean, true),
         COALESCE((s.notifications ->> 'vibrate')::boolean, true)
  FROM public.devices d
  LEFT JOIN public.user_settings s ON s.user_id = d.user_id
  WHERE d.user_id = _user
    AND d.push_token IS NOT NULL
    AND d.revoked_at IS NULL
    AND COALESCE((s.notifications ->> _category)::boolean, true) = true
    AND COALESCE((s.notifications ->> 'push')::boolean, true) = true;
$$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_push_device(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_my_push_devices(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.device_from_action_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bg_reply_message(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bg_mark_read(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bg_mark_delivered(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_targets_for_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_targets_for_user(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_push_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_push_devices(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.device_from_action_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bg_reply_message(text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bg_mark_read(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bg_mark_delivered(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_targets_for_conversation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_targets_for_user(uuid, text) TO service_role;