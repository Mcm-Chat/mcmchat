-- =========================================================
-- 1. Kolom installation_id (non-secret) + keunikan per pengguna
-- =========================================================
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS installation_id text;

CREATE UNIQUE INDEX IF NOT EXISTS devices_user_installation_key
  ON public.devices (user_id, installation_id)
  WHERE installation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS devices_push_token_idx
  ON public.devices (push_token)
  WHERE push_token IS NOT NULL;

-- =========================================================
-- 2. register_push_device: upsert by (user, installation)
-- =========================================================
DROP FUNCTION IF EXISTS public.register_push_device(text, text, text, text);

CREATE OR REPLACE FUNCTION public.register_push_device(
  _installation_id text,
  _name text,
  _platform text,
  _push_token text,
  _app_version text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
         action_token_hash = NULL,
         action_token_prefix = NULL,
         revoked_at = now(),
         updated_at = now()
   WHERE push_token = _push_token
     AND NOT (user_id = _uid AND installation_id IS NOT DISTINCT FROM _installation_id);

  INSERT INTO public.devices AS d
    (user_id, installation_id, name, platform, push_token, push_provider, app_version,
     action_token_hash, action_token_prefix, revoked_at, last_active_at, updated_at)
  VALUES
    (_uid, _installation_id, _name, _platform, _push_token, 'fcm', COALESCE(_app_version, ''),
     NULL, NULL, NULL, now(), now())
  ON CONFLICT (user_id, installation_id) WHERE installation_id IS NOT NULL
  DO UPDATE SET
     name = EXCLUDED.name,
     platform = EXCLUDED.platform,
     push_token = EXCLUDED.push_token,
     push_provider = 'fcm',
     app_version = EXCLUDED.app_version,
     action_token_hash = NULL,
     action_token_prefix = NULL,
     revoked_at = NULL,
     last_active_at = now(),
     updated_at = now()
  RETURNING * INTO _device;

  -- Tidak pernah menerbitkan bearer action credential persisten lagi.
  RETURN jsonb_build_object(
    'device_id', _device.id,
    'installation_id', _device.installation_id
  );
END $$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text, text)
  TO authenticated, service_role;

-- =========================================================
-- 3. Pencabutan: instalasi saat ini vs seluruh akun
-- =========================================================
DROP FUNCTION IF EXISTS public.revoke_my_push_devices(text);

CREATE OR REPLACE FUNCTION public.revoke_my_push_installation(_installation_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); _n integer := 0;
BEGIN
  IF uid IS NULL THEN RETURN 0; END IF;
  IF _installation_id IS NULL OR length(btrim(_installation_id)) < 8 THEN RETURN 0; END IF;

  DELETE FROM public.push_action_tokens
   WHERE user_id = uid
     AND device_id IN (
       SELECT id FROM public.devices
        WHERE user_id = uid AND installation_id = btrim(_installation_id)
     );

  UPDATE public.devices
     SET push_token = NULL, action_token_hash = NULL, action_token_prefix = NULL,
         revoked_at = now(), updated_at = now()
   WHERE user_id = uid AND installation_id = btrim(_installation_id);

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.revoke_my_push_installation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_push_installation(text) TO authenticated, service_role;

-- my_push_devices ikut memuat installation_id (non-secret) untuk menandai
-- perangkat ini; token/hash/prefix tetap tidak pernah dikembalikan.
DROP FUNCTION IF EXISTS public.my_push_devices();

CREATE OR REPLACE FUNCTION public.my_push_devices()
RETURNS TABLE(
  id uuid, installation_id text, name text, platform text, app_version text,
  push_enabled boolean, revoked boolean,
  last_active_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT d.id, d.installation_id, d.name, d.platform, d.app_version,
         (d.push_token IS NOT NULL) AS push_enabled,
         (d.revoked_at IS NOT NULL) AS revoked,
         d.last_active_at, d.created_at
  FROM public.devices d
  WHERE d.user_id = auth.uid()
  ORDER BY d.last_active_at DESC NULLS LAST, d.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.my_push_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_push_devices() TO authenticated, service_role;