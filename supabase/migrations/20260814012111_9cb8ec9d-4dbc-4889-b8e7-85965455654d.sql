-- 1. Hapus jalur tulis langsung: seluruh perubahan state lewat RPC SECURITY DEFINER.
DROP POLICY IF EXISTS "participant updates call" ON public.calls;
DROP POLICY IF EXISTS "initiator creates call" ON public.calls;
DROP POLICY IF EXISTS "add participant" ON public.call_participants;
DROP POLICY IF EXISTS "own participant update" ON public.call_participants;

REVOKE INSERT, UPDATE, DELETE ON public.calls FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.call_participants FROM authenticated;
GRANT SELECT ON public.calls TO authenticated;
GRANT SELECT ON public.call_participants TO authenticated;
GRANT ALL ON public.calls TO service_role;
GRANT ALL ON public.call_participants TO service_role;

-- 2. Bergabung ke panggilan (idempotent, mengizinkan bergabung kembali).
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
  IF _row.status NOT IN ('ringing','ongoing') THEN RAISE EXCEPTION 'Panggilan sudah berakhir'; END IF;

  UPDATE public.call_participants
     SET joined_at = COALESCE(joined_at, _now), left_at = NULL
   WHERE call_id = _call AND user_id = _uid;
  RETURN _row;
END $function$;

-- 3. Keluar panggilan: 1:1 mengakhiri, grup hanya keluar (kecuali pemanggil/kosong).
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

  -- Panggilan berdua, pemanggil keluar, atau tidak ada peserta aktif -> berakhir.
  IF _total <= 2 OR _row.initiator_id = _uid OR _active = 0 THEN
    UPDATE public.calls
       SET status = CASE WHEN _row.status = 'ringing' THEN 'missed'::call_status ELSE 'ended'::call_status END,
           ended_at = _now,
           duration_sec = greatest(_row.duration_sec, coalesce(_duration, 0)),
           end_reason = coalesce(_row.end_reason, CASE WHEN _row.status = 'ringing' THEN 'timeout' ELSE 'hangup' END)
     WHERE id = _call
    RETURNING * INTO _row;
    UPDATE public.call_participants SET left_at = COALESCE(left_at, _now) WHERE call_id = _call;
  END IF;

  RETURN _row;
END $function$;

REVOKE ALL ON FUNCTION public.join_call(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_call(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_call(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_call(uuid, integer) TO authenticated;