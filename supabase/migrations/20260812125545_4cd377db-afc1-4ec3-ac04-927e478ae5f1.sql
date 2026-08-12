CREATE OR REPLACE FUNCTION public.rotate_preparation_token(_job uuid, _expires_hours integer DEFAULT 168)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE j public.preparation_jobs; _token text; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO j FROM public.preparation_jobs WHERE id = _job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tugas tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(j.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang menerbitkan ulang tautan';
  END IF;
  _token := encode(extensions.gen_random_bytes(24), 'hex');
  UPDATE public.preparation_jobs
    SET token_hash = encode(extensions.digest(_token,'sha256'),'hex'),
        token_prefix = left(_token, 6),
        revoked_at = NULL,
        expires_at = now() + make_interval(hours => greatest(1, coalesce(_expires_hours,168)))
    WHERE id = _job;
  RETURN jsonb_build_object('id', _job, 'token', _token);
END $$;
REVOKE ALL ON FUNCTION public.rotate_preparation_token(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rotate_preparation_token(uuid, integer) TO authenticated, service_role;