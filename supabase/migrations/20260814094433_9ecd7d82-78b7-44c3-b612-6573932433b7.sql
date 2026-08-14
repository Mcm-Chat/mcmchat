-- =========================================================
-- 1. Cabut seluruh privilege tabel dari klien
-- =========================================================
REVOKE ALL ON public.devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.background_action_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.device_action_rate FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.devices TO service_role;
GRANT ALL ON public.background_action_log TO service_role;
GRANT ALL ON public.device_action_rate TO service_role;

-- Policy FOR ALL pada devices membatalkan keamanan kredensial aksi.
DROP POLICY IF EXISTS "own devices" ON public.devices;
DROP POLICY IF EXISTS "own background actions" ON public.background_action_log;
DROP POLICY IF EXISTS "device_action_rate owner read" ON public.device_action_rate;

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.background_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_action_rate ENABLE ROW LEVEL SECURITY;
-- Sengaja tanpa policy: seluruh akses klien melalui RPC di bawah.

-- =========================================================
-- 2. RPC aman untuk pengguna
-- =========================================================
CREATE OR REPLACE FUNCTION public.my_push_devices()
RETURNS TABLE(
  id uuid, name text, platform text, app_version text,
  push_enabled boolean, revoked boolean,
  last_active_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT d.id, d.name, d.platform, d.app_version,
         (d.push_token IS NOT NULL) AS push_enabled,
         (d.revoked_at IS NOT NULL) AS revoked,
         d.last_active_at, d.created_at
  FROM public.devices d
  WHERE d.user_id = auth.uid()
  ORDER BY d.last_active_at DESC NULLS LAST, d.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.revoke_my_push_device(_device uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); _n integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  DELETE FROM public.push_action_tokens WHERE device_id = _device AND user_id = uid;
  UPDATE public.devices
     SET push_token = NULL, action_token_hash = NULL, action_token_prefix = NULL,
         revoked_at = now(), updated_at = now()
   WHERE id = _device AND user_id = uid;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_my_push_devices()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE uid uuid := auth.uid(); _n integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  DELETE FROM public.push_action_tokens WHERE user_id = uid;
  UPDATE public.devices
     SET push_token = NULL, action_token_hash = NULL, action_token_prefix = NULL,
         revoked_at = now(), updated_at = now()
   WHERE user_id = uid AND revoked_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.my_push_devices() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_my_push_device(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_my_push_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_push_devices() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_my_push_device(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_my_push_devices() TO authenticated, service_role;

-- =========================================================
-- 3. Helper internal tetap service_role-only
-- =========================================================
REVOKE ALL ON FUNCTION public.bg_rate_ok(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bg_rate_ok(uuid, text, integer) TO service_role;