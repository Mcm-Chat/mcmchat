-- 1) Tabel token aksi perangkat lama: hapus total (privilege luas + multi-action).
DROP TABLE IF EXISTS public.push_action_tokens CASCADE;

-- 2) Fungsi aksi latar lama (check-then-insert, bukan single-use atomik).
DROP FUNCTION IF EXISTS public.bg_reply_message(uuid, uuid, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.bg_reply_message(uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.bg_mark_read(uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.bg_mark_read(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.bg_mark_delivered(uuid, uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.bg_mark_delivered(uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.device_from_action_token(text, text) CASCADE;

-- 3) Kredensial aksi persisten pada perangkat: dihapus permanen.
ALTER TABLE public.devices
  DROP COLUMN IF EXISTS action_token_hash,
  DROP COLUMN IF EXISTS action_token_prefix;

DROP FUNCTION IF EXISTS public.register_push_device(text, text, text, text, text);

CREATE FUNCTION public.register_push_device(
  _installation_id text,
  _name text DEFAULT NULL,
  _platform text DEFAULT 'android',
  _push_token text DEFAULT NULL,
  _app_version text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _device public.devices;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _installation_id IS NULL OR length(btrim(_installation_id)) < 8 THEN
    RAISE EXCEPTION 'invalid_installation_id';
  END IF;
  IF _push_token IS NULL OR length(btrim(_push_token)) < 8 THEN
    RAISE EXCEPTION 'invalid_push_token';
  END IF;

  _installation_id := btrim(_installation_id);

  -- Satu token FCM hanya boleh aktif pada satu baris perangkat.
  UPDATE public.devices
     SET push_token = NULL,
         revoked_at = now(),
         updated_at = now()
   WHERE push_token = _push_token
     AND NOT (user_id = _uid AND installation_id IS NOT DISTINCT FROM _installation_id);

  INSERT INTO public.devices AS d
    (user_id, installation_id, name, platform, push_token, push_provider, app_version,
     revoked_at, last_active_at, updated_at)
  VALUES
    (_uid, _installation_id, _name, _platform, _push_token, 'fcm', COALESCE(_app_version, ''),
     NULL, now(), now())
  ON CONFLICT (user_id, installation_id) WHERE installation_id IS NOT NULL
  DO UPDATE SET
     name = EXCLUDED.name,
     platform = EXCLUDED.platform,
     push_token = EXCLUDED.push_token,
     push_provider = 'fcm',
     app_version = EXCLUDED.app_version,
     revoked_at = NULL,
     last_active_at = now(),
     updated_at = now()
  RETURNING * INTO _device;

  -- Tidak pernah menerbitkan bearer action credential persisten.
  RETURN jsonb_build_object(
    'device_id', _device.id,
    'installation_id', _device.installation_id
  );
END $$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text, text) TO authenticated;

-- 4) Deadline aksi panggilan = created_at + 45 detik, tanpa lantai minimum.
CREATE OR REPLACE FUNCTION public.mint_notification_action(
  _user uuid,
  _device uuid,
  _action text,
  _conversation uuid DEFAULT NULL,
  _message uuid DEFAULT NULL,
  _call uuid DEFAULT NULL,
  _ttl_seconds integer DEFAULT NULL
) RETURNS TABLE(action_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _secret text; _prefix text; _ttl integer; _id uuid; _expires timestamptz;
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
    _expires := now() + make_interval(secs => _ttl);
  ELSIF _action IN ('call_answer','call_decline') THEN
    IF _call IS NULL THEN RAISE EXCEPTION 'invalid_resource'; END IF;
    _conversation := NULL; _message := NULL;
    -- Batas absolut dering: token tidak pernah hidup melewati deadline panggilan,
    -- dan sisa waktu boleh kurang dari 30 detik.
    SELECT c.created_at + interval '45 seconds' INTO _expires
      FROM public.calls c WHERE c.id = _call;
    IF _expires IS NULL THEN RAISE EXCEPTION 'invalid_resource'; END IF;
    IF _expires <= now() THEN RAISE EXCEPTION 'ring_deadline_passed'; END IF;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;

  _secret := encode(extensions.gen_random_bytes(32), 'hex');
  _prefix := encode(extensions.gen_random_bytes(9), 'hex');

  INSERT INTO public.notification_actions
    (device_id, user_id, action, conversation_id, message_id, call_id,
     token_prefix, token_hash, expires_at)
  VALUES (_device, _user, _action, _conversation, _message, _call,
          _prefix, encode(extensions.digest(_secret, 'sha256'), 'hex'), _expires)
  RETURNING id INTO _id;

  action_id := _id;
  token := _prefix || '.' || _secret;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.mint_notification_action(uuid, uuid, text, uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

-- 5) Pembersihan aksi kedaluwarsa (dipanggil internal/service_role saja).
CREATE INDEX IF NOT EXISTS notification_actions_cleanup_idx
  ON public.notification_actions (expires_at) WHERE used_at IS NULL;

CREATE OR REPLACE FUNCTION public.cleanup_expired_notification_actions(_older_than interval DEFAULT interval '1 day')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  DELETE FROM public.notification_actions
   WHERE expires_at < now() - _older_than;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.cleanup_expired_notification_actions(interval) FROM PUBLIC, anon, authenticated;