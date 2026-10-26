-- Automatic token refresh must not create a device or undo an explicit revocation.
-- devices is intentionally closed to clients; this narrow definer RPC derives ownership
-- from auth.uid(), never accepts a user id, and returns no device credentials.
CREATE OR REPLACE FUNCTION public.refresh_my_push_device(
  _installation_id text,
  _push_token text,
  _name text DEFAULT NULL,
  _platform text DEFAULT 'android',
  _app_version text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _installation_id IS NULL OR length(btrim(_installation_id)) < 8 THEN
    RAISE EXCEPTION 'invalid_installation_id';
  END IF;
  IF _push_token IS NULL OR length(btrim(_push_token)) < 8 THEN
    RAISE EXCEPTION 'invalid_push_token';
  END IF;
  IF _platform IS NULL OR _platform NOT IN ('android', 'web') THEN
    RAISE EXCEPTION 'invalid_platform';
  END IF;

  UPDATE public.devices AS d
     SET push_token = btrim(_push_token),
         name = COALESCE(_name, d.name),
         platform = _platform,
         push_provider = 'fcm',
         app_version = COALESCE(_app_version, d.app_version),
         last_active_at = now(),
         updated_at = now()
   WHERE d.user_id = _uid
     AND d.installation_id = btrim(_installation_id)
     AND d.revoked_at IS NULL
     -- Refresh cannot transfer a token from a different device/account.
     AND NOT EXISTS (
       SELECT 1 FROM public.devices AS other
        WHERE other.push_token = btrim(_push_token) AND other.id <> d.id
     );
  RETURN FOUND;
EXCEPTION WHEN unique_violation THEN
  -- A competing token registration won; do not steal it or revive this row.
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_my_push_device(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_my_push_device(text, text, text, text, text) TO authenticated;
