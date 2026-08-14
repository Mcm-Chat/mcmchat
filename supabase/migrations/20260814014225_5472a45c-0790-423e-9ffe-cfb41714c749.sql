-- 1) answer_call: peserta yang sudah keluar/menolak tidak boleh menjawab lagi.
CREATE OR REPLACE FUNCTION public.answer_call(_call uuid)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.calls; _now timestamptz := now(); _left timestamptz; _exists boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Panggilan tidak ditemukan'; END IF;
  SELECT true, cp.left_at INTO _exists, _left FROM public.call_participants cp
   WHERE cp.call_id = _call AND cp.user_id = _uid;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'Anda bukan peserta panggilan ini'; END IF;
  IF _left IS NOT NULL THEN RAISE EXCEPTION 'Anda sudah keluar dari panggilan ini'; END IF;
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

-- 2) join_call: tidak pernah menghidupkan kembali peserta yang sudah keluar.
CREATE OR REPLACE FUNCTION public.join_call(_call uuid)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _row public.calls; _now timestamptz := now(); _left timestamptz; _exists boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Panggilan tidak ditemukan'; END IF;
  SELECT true, cp.left_at INTO _exists, _left FROM public.call_participants cp
   WHERE cp.call_id = _call AND cp.user_id = _uid;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'Anda bukan peserta panggilan ini'; END IF;
  IF _left IS NOT NULL THEN RAISE EXCEPTION 'Anda sudah keluar dari panggilan ini'; END IF;
  IF _row.status = 'ringing' THEN RAISE EXCEPTION 'Panggilan belum dijawab'; END IF;
  IF _row.status <> 'ongoing' THEN RAISE EXCEPTION 'Panggilan sudah berakhir'; END IF;

  UPDATE public.call_participants
     SET joined_at = COALESCE(joined_at, _now)
   WHERE call_id = _call AND user_id = _uid;
  RETURN _row;
END $function$;

-- 3) decline_call: jalur penolakan eksplisit, aman untuk grup.
CREATE OR REPLACE FUNCTION public.decline_call(_call uuid)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.calls;
  _now timestamptz := now();
  _exists boolean;
  _total integer;
  _remaining integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Tidak diizinkan'; END IF;
  SELECT * INTO _row FROM public.calls WHERE id = _call FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Panggilan tidak ditemukan'; END IF;
  SELECT true INTO _exists FROM public.call_participants
   WHERE call_id = _call AND user_id = _uid;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'Anda bukan peserta panggilan ini'; END IF;
  IF _row.initiator_id = _uid THEN RAISE EXCEPTION 'Pemanggil tidak bisa menolak panggilannya sendiri'; END IF;
  IF _row.status IN ('ended','declined','missed','failed') THEN RETURN _row; END IF;
  IF _row.status <> 'ringing' THEN RAISE EXCEPTION 'Panggilan sudah dijawab'; END IF;

  UPDATE public.call_participants SET left_at = COALESCE(left_at, _now)
   WHERE call_id = _call AND user_id = _uid;

  SELECT count(*) INTO _total FROM public.call_participants WHERE call_id = _call;
  SELECT count(*) INTO _remaining FROM public.call_participants
   WHERE call_id = _call AND user_id <> _row.initiator_id AND left_at IS NULL;

  IF _total <= 2 OR _remaining = 0 THEN
    UPDATE public.calls
       SET status = 'declined',
           ended_at = COALESCE(ended_at, _now),
           duration_sec = 0,
           end_reason = COALESCE(end_reason, 'declined')
     WHERE id = _call AND status = 'ringing'
    RETURNING * INTO _row;
    UPDATE public.call_participants SET left_at = COALESCE(left_at, _now) WHERE call_id = _call;
  END IF;

  RETURN _row;
END $function$;

-- 4) end_call: host-only saat ongoing, timeout absolut 45 detik, durasi server.
CREATE OR REPLACE FUNCTION public.end_call(_call uuid, _status call_status, _duration integer DEFAULT 0, _reason text DEFAULT NULL::text)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.calls;
  _now timestamptz := now();
  _r text := _reason;
  _exists boolean;
  _dur integer;
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
  SELECT true INTO _exists FROM public.call_participants WHERE call_id = _call AND user_id = _uid;
  IF NOT COALESCE(_exists, false) THEN RAISE EXCEPTION 'Anda bukan peserta panggilan ini'; END IF;
  IF _row.status IN ('ended','declined','missed','failed') THEN RETURN _row; END IF;

  IF _row.status = 'ringing' THEN
    IF _status = 'missed' AND _r = 'timeout' THEN
      -- Timeout hanya sah setelah 45 detik nyata di server; timer klien tidak dipercaya.
      IF _now < _row.created_at + interval '45 seconds' THEN
        RAISE EXCEPTION 'Batas waktu dering belum tercapai';
      END IF;
      _status := 'missed'; _r := 'timeout';
    ELSIF _uid = _row.initiator_id THEN
      _status := 'ended'; _r := 'cancelled';
    ELSE
      RAISE EXCEPTION 'Gunakan decline_call untuk menolak panggilan';
    END IF;
    _dur := 0;
  ELSE
    -- Panggilan berlangsung: hanya pemanggil/host yang boleh mengakhiri untuk semua.
    IF _uid <> _row.initiator_id THEN
      RAISE EXCEPTION 'Peserta harus memakai leave_call untuk keluar';
    END IF;
    IF _status IN ('declined','missed') THEN _status := 'ended'; END IF;
    _r := COALESCE(_r, CASE WHEN _status = 'failed' THEN 'failed' ELSE 'hangup' END);
    IF _r IN ('declined','cancelled','timeout') THEN _r := 'hangup'; END IF;
    _dur := CASE
      WHEN COALESCE(_row.answered_at, _row.started_at) IS NOT NULL
        THEN greatest(0, extract(epoch FROM (_now - COALESCE(_row.answered_at, _row.started_at)))::int)
      ELSE greatest(0, COALESCE(_duration, 0))
    END;
  END IF;

  UPDATE public.calls
     SET status = _status,
         ended_at = _now,
         duration_sec = greatest(duration_sec, _dur),
         end_reason = COALESCE(_r, end_reason)
   WHERE id = _call AND status IN ('ringing','ongoing')
  RETURNING * INTO _row;

  UPDATE public.call_participants SET left_at = COALESCE(left_at, _now)
   WHERE call_id = _call;
  RETURN _row;
END $function$;

-- 5) leave_call: durasi dihitung server dari answered_at/started_at.
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
  _dur integer;
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
      _dur := 0;
    ELSE
      _status := 'ended'; _reason := 'hangup';
      _dur := CASE
        WHEN COALESCE(_row.answered_at, _row.started_at) IS NOT NULL
          THEN greatest(0, extract(epoch FROM (_now - COALESCE(_row.answered_at, _row.started_at)))::int)
        ELSE greatest(0, COALESCE(_duration, 0))
      END;
    END IF;

    UPDATE public.calls
       SET status = _status,
           ended_at = _now,
           duration_sec = greatest(_row.duration_sec, _dur),
           end_reason = COALESCE(_row.end_reason, _reason)
     WHERE id = _call
    RETURNING * INTO _row;
    UPDATE public.call_participants SET left_at = COALESCE(left_at, _now) WHERE call_id = _call;
  END IF;

  RETURN _row;
END $function$;

-- 6) ACL: tanpa anon/PUBLIC.
REVOKE EXECUTE ON FUNCTION public.decline_call(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_call(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.answer_call(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_call(uuid, call_status, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_call(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_call(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_call(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.answer_call(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_call(uuid, call_status, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_call(uuid, integer) TO authenticated, service_role;