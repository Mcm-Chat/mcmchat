-- 1) ACL: cabut akses anon/PUBLIC pada seluruh RPC panggilan.
REVOKE EXECUTE ON FUNCTION public.join_call(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_call(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.answer_call(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_call(uuid, call_status, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_call_tx(uuid, call_kind, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.expire_stale_calls() FROM PUBLIC, anon;

-- 2) join_call: hanya saat panggilan sudah dijawab (ongoing).
CREATE OR REPLACE FUNCTION public.join_call(_call uuid)
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
  IF _row.status = 'ringing' THEN
    RAISE EXCEPTION 'Panggilan belum dijawab';
  END IF;
  IF _row.status <> 'ongoing' THEN RAISE EXCEPTION 'Panggilan sudah berakhir'; END IF;

  UPDATE public.call_participants
     SET joined_at = COALESCE(joined_at, _now), left_at = NULL
   WHERE call_id = _call AND user_id = _uid;
  RETURN _row;
END $function$;

-- 3) end_call: alasan tervalidasi + pemisahan cancelled / declined / timeout.
CREATE OR REPLACE FUNCTION public.end_call(_call uuid, _status call_status, _duration integer DEFAULT 0, _reason text DEFAULT NULL::text)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.calls; _now timestamptz := now(); _r text := _reason;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  IF _status NOT IN ('ended','declined','missed','failed') THEN
    RAISE EXCEPTION 'Status akhir tidak valid';
  END IF;
  IF _r IS NOT NULL AND _r NOT IN ('timeout','declined','cancelled','hangup','failed','unconfigured') THEN
    RAISE EXCEPTION 'Alasan akhir tidak valid';
  END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Panggilan tidak ditemukan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_participants WHERE call_id = _call AND user_id = _uid) THEN
    RAISE EXCEPTION 'Anda bukan peserta panggilan ini';
  END IF;
  IF _row.status IN ('ended','declined','missed','failed') THEN RETURN _row; END IF;

  IF _row.status = 'ringing' THEN
    IF _uid = _row.initiator_id THEN
      -- Pemanggil menutup sebelum dijawab: dibatalkan, BUKAN tak terjawab...
      IF _status = 'missed' AND _r = 'timeout' THEN
        _status := 'missed'; _r := 'timeout';   -- ...kecuali memang batas 45 detik.
      ELSE
        _status := 'ended'; _r := 'cancelled';
      END IF;
    ELSE
      -- Penerima: menolak, atau batas waktu terlewat.
      IF _status = 'missed' AND _r = 'timeout' THEN
        _status := 'missed'; _r := 'timeout';
      ELSE
        _status := 'declined'; _r := 'declined';
      END IF;
    END IF;
  ELSE
    -- Panggilan sudah berlangsung: hanya bisa berakhir/gagal.
    IF _status IN ('declined','missed') THEN _status := 'ended'; END IF;
    _r := COALESCE(_r, CASE WHEN _status = 'failed' THEN 'failed' ELSE 'hangup' END);
    IF _r IN ('declined','cancelled','timeout') THEN _r := 'hangup'; END IF;
  END IF;

  UPDATE public.calls
     SET status = _status,
         ended_at = _now,
         duration_sec = greatest(0, coalesce(_duration, 0)),
         end_reason = COALESCE(_r, end_reason)
   WHERE id = _call AND status IN ('ringing','ongoing')
  RETURNING * INTO _row;

  UPDATE public.call_participants SET left_at = COALESCE(left_at, _now)
   WHERE call_id = _call AND user_id = _uid;
  RETURN _row;
END $function$;

-- 4) leave_call: pemanggil yang keluar saat masih berdering = dibatalkan.
CREATE OR REPLACE FUNCTION public.leave_call(_call uuid, _duration integer DEFAULT 0)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.calls;
  _now timestamptz := now();
  _total integer;
  _active integer;
  _status call_status;
  _reason text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Panggilan tidak ditemukan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.call_participants WHERE call_id = _call AND user_id = _uid) THEN
    RAISE EXCEPTION 'Anda bukan peserta panggilan ini';
  END IF;

  UPDATE public.call_participants SET left_at = COALESCE(left_at, _now)
   WHERE call_id = _call AND user_id = _uid;

  IF _row.status NOT IN ('ringing','ongoing') THEN RETURN _row; END IF;

  SELECT count(*) INTO _total FROM public.call_participants WHERE call_id = _call;
  SELECT count(*) INTO _active FROM public.call_participants
   WHERE call_id = _call AND left_at IS NULL;

  IF _total <= 2 OR _row.initiator_id = _uid OR _active = 0 THEN
    IF _row.status = 'ringing' THEN
      IF _uid = _row.initiator_id THEN
        _status := 'ended'; _reason := 'cancelled';
      ELSE
        _status := 'declined'; _reason := 'declined';
      END IF;
    ELSE
      _status := 'ended'; _reason := 'hangup';
    END IF;

    UPDATE public.calls
       SET status = _status,
           ended_at = _now,
           duration_sec = greatest(_row.duration_sec, coalesce(_duration, 0)),
           end_reason = COALESCE(_row.end_reason, _reason)
     WHERE id = _call
    RETURNING * INTO _row;
    UPDATE public.call_participants SET left_at = COALESCE(left_at, _now) WHERE call_id = _call;
  END IF;

  RETURN _row;
END $function$;

-- 5) GRANT hanya untuk peran yang memang memakainya.
REVOKE EXECUTE ON FUNCTION public.join_call(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_call(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_call(uuid, call_status, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_call(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_call(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.answer_call(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_call(uuid, call_status, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_call_tx(uuid, call_kind, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_calls() TO authenticated, service_role;