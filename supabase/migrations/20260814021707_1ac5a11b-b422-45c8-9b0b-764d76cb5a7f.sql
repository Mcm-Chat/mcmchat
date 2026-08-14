-- ============================================================
-- TAHAP 2A — HARDENING FINAL
-- ============================================================

-- 1) PROFILES: tidak ada akses tabel langsung untuk klien. Semua baca lewat RPC.
DROP POLICY IF EXISTS "profiles readable when related" ON public.profiles;
REVOKE ALL ON TABLE public.profiles FROM authenticated, anon, PUBLIC;
GRANT ALL ON TABLE public.profiles TO service_role;

-- 2) respond_contact_request: otorisasi DIVALIDASI ULANG setelah pair lock.
CREATE OR REPLACE FUNCTION public.respond_contact_request(_request uuid, _action contact_request_status)
RETURNS public.contact_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  uid uuid := auth.uid();
  r public.contact_requests;
  pre public.contact_requests;
  lo uuid; hi uuid;
  blocked_pair boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _action NOT IN ('accepted','rejected','blocked') THEN RAISE EXCEPTION 'invalid_action'; END IF;

  -- Pre-read HANYA untuk memperoleh canonical pair (bukan keputusan otorisasi).
  SELECT * INTO pre FROM public.contact_requests WHERE id = _request;
  IF pre.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  lo := least(pre.requester_id, pre.target_id);
  hi := greatest(pre.requester_id, pre.target_id);

  PERFORM public.lock_contact_pair(lo, hi);

  -- Re-read otoritatif setelah lock.
  SELECT * INTO r FROM public.contact_requests WHERE id = _request FOR UPDATE;

  -- Re-check WAJIB (post-lock):
  IF r.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF least(r.requester_id, r.target_id) <> lo OR greatest(r.requester_id, r.target_id) <> hi THEN
    RAISE EXCEPTION 'request_changed';
  END IF;
  IF r.target_id <> uid THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.contacts b
    WHERE b.is_blocked
      AND ((b.owner_id = r.requester_id AND b.contact_id = r.target_id)
        OR (b.owner_id = r.target_id AND b.contact_id = r.requester_id))
  ) INTO blocked_pair;

  -- Idempotensi accept: hanya bila hubungan MASIH aktif dan tidak ada block dua arah.
  IF r.status = 'accepted' AND _action = 'accepted' THEN
    IF blocked_pair THEN RAISE EXCEPTION 'blocked'; END IF;
    IF NOT public.are_connected(r.requester_id, r.target_id) THEN
      RAISE EXCEPTION 'connection_revoked';
    END IF;
    RETURN r;
  END IF;

  IF r.status <> 'pending' THEN RAISE EXCEPTION 'request_not_pending'; END IF;

  IF _action = 'accepted' AND blocked_pair THEN RAISE EXCEPTION 'blocked'; END IF;

  UPDATE public.contact_requests SET status = _action, updated_at = now()
   WHERE id = _request RETURNING * INTO r;

  IF _action = 'accepted' THEN
    INSERT INTO public.contact_connections (user_low, user_high, accepted_request_id, accepted_at)
    VALUES (lo, hi, r.id, now())
    ON CONFLICT (user_low, user_high) DO UPDATE
      SET disconnected_at = NULL, accepted_at = now(),
          accepted_request_id = EXCLUDED.accepted_request_id, updated_at = now();

    INSERT INTO public.contacts (owner_id, contact_id, source)
    VALUES (r.target_id, r.requester_id, 'request'), (r.requester_id, r.target_id, 'request')
    ON CONFLICT (owner_id, contact_id) DO UPDATE SET source = 'request', updated_at = now();
  ELSIF _action = 'blocked' THEN
    PERFORM public.set_contact_blocked(r.requester_id, true);
  END IF;

  RETURN r;
END $function$;

-- 3) set_contact_blocked: block = state terminal; unblock TIDAK menyambung ulang.
CREATE OR REPLACE FUNCTION public.set_contact_blocked(_target uuid, _blocked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE uid uuid := auth.uid(); still_blocked boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target IS NULL OR _target = uid THEN RAISE EXCEPTION 'invalid_target'; END IF;
  PERFORM public.lock_contact_pair(uid, _target);

  IF _blocked THEN
    INSERT INTO public.contacts (owner_id, contact_id, is_blocked, source)
    VALUES (uid, _target, true, 'manual')
    ON CONFLICT (owner_id, contact_id) DO UPDATE SET is_blocked = true, updated_at = now();

    UPDATE public.contact_connections
       SET disconnected_at = now(), updated_at = now()
     WHERE user_low = least(uid,_target) AND user_high = greatest(uid,_target)
       AND disconnected_at IS NULL;

    -- pending MAUPUN accepted menjadi terminal 'blocked'
    UPDATE public.contact_requests
       SET status = 'blocked', updated_at = now()
     WHERE status IN ('pending','accepted')
       AND least(requester_id,target_id) = least(uid,_target)
       AND greatest(requester_id,target_id) = greatest(uid,_target);
  ELSE
    UPDATE public.contacts SET is_blocked = false, updated_at = now()
     WHERE owner_id = uid AND contact_id = _target;

    SELECT EXISTS (
      SELECT 1 FROM public.contacts b
      WHERE b.is_blocked
        AND ((b.owner_id = uid AND b.contact_id = _target)
          OR (b.owner_id = _target AND b.contact_id = uid))
    ) INTO still_blocked;

    -- Tidak ada block tersisa: request blocked menjadi cancelled (cooldown baru).
    -- Hubungan TETAP disconnected; tidak ada auto-accept / reactivation.
    IF NOT still_blocked THEN
      UPDATE public.contact_requests
         SET status = 'cancelled', updated_at = now()
       WHERE status = 'blocked'
         AND least(requester_id,target_id) = least(uid,_target)
         AND greatest(requester_id,target_id) = greatest(uid,_target);
    END IF;
  END IF;
  RETURN jsonb_build_object('blocked', _blocked);
END $function$;

REVOKE ALL ON FUNCTION public.respond_contact_request(uuid, contact_request_status) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_contact_blocked(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_contact_request(uuid, contact_request_status) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_contact_blocked(uuid, boolean) TO authenticated, service_role;