
CREATE OR REPLACE FUNCTION public.bg_call_action(_token text, _call uuid, _action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _dev uuid; _uid uuid; _status call_status;
BEGIN
  IF _action NOT IN ('answer','decline') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  SELECT device_id, user_id INTO _dev, _uid FROM public.device_from_action_token(_token);
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_credential'); END IF;
  IF NOT public.bg_rate_ok(_dev, 'call', 30) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF NOT public.is_call_participant(_call, _uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT c.status INTO _status FROM public.calls c WHERE c.id = _call FOR UPDATE;
  IF _status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  -- Idempotent: status terminal / sudah berubah tidak pernah error keras.
  IF _action = 'answer' THEN
    IF _status = 'ongoing' THEN RETURN jsonb_build_object('ok', true, 'status', 'ongoing', 'duplicate', true); END IF;
    IF _status <> 'ringing' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_ringing', 'status', _status); END IF;
    UPDATE public.calls SET status = 'ongoing', answered_at = coalesce(answered_at, now())
     WHERE id = _call AND status = 'ringing';
    UPDATE public.call_participants SET joined_at = coalesce(joined_at, now())
     WHERE call_id = _call AND user_id = _uid;
    UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
    RETURN jsonb_build_object('ok', true, 'status', 'ongoing');
  END IF;

  IF _status IN ('declined','ended','missed','cancelled','failed') THEN
    RETURN jsonb_build_object('ok', true, 'status', _status, 'duplicate', true);
  END IF;
  UPDATE public.calls SET status = 'declined', ended_at = coalesce(ended_at, now())
   WHERE id = _call AND status = 'ringing';
  UPDATE public.devices SET last_active_at = now() WHERE id = _dev;
  RETURN jsonb_build_object('ok', true, 'status', 'declined');
END $function$;

REVOKE ALL ON FUNCTION public.bg_call_action(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bg_call_action(text, uuid, text) TO service_role;
