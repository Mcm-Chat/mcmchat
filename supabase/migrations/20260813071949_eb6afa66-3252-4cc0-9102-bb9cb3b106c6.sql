CREATE OR REPLACE FUNCTION public.respond_contact_request(_request uuid, _action contact_request_status)
RETURNS public.contact_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.contact_requests;
BEGIN
  IF _action NOT IN ('accepted','rejected','blocked') THEN
    RAISE EXCEPTION 'Aksi permintaan kontak tidak valid';
  END IF;

  SELECT * INTO r FROM public.contact_requests WHERE id = _request;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan';
  END IF;
  IF r.target_id <> auth.uid() THEN
    RAISE EXCEPTION 'Tidak berwenang menjawab permintaan ini';
  END IF;

  UPDATE public.contact_requests
     SET status = _action, updated_at = now()
   WHERE id = _request
  RETURNING * INTO r;

  IF _action = 'accepted' THEN
    INSERT INTO public.contacts (owner_id, contact_id)
    VALUES (r.target_id, r.requester_id), (r.requester_id, r.target_id)
    ON CONFLICT (owner_id, contact_id) DO NOTHING;
  ELSIF _action = 'blocked' THEN
    INSERT INTO public.contacts (owner_id, contact_id, is_blocked)
    VALUES (r.target_id, r.requester_id, true)
    ON CONFLICT (owner_id, contact_id) DO UPDATE SET is_blocked = true;
  END IF;

  RETURN r;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.respond_contact_request(uuid, contact_request_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_contact_request(uuid, contact_request_status) TO authenticated;