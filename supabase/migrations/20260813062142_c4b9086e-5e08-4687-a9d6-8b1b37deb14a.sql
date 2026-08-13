CREATE OR REPLACE FUNCTION public.set_avatar_privacy_audience(
  _privacy text,
  _targets uuid[] DEFAULT '{}'::uuid[],
  _confirm_empty_only_share boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _mode text;
  _clean uuid[];
  _bad int;
  _count int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi' USING ERRCODE = '28000';
  END IF;

  IF _privacy = 'contacts_except' THEN
    _mode := 'except';
  ELSIF _privacy = 'only_share' THEN
    _mode := 'only';
  ELSE
    RAISE EXCEPTION 'Mode privasi tidak didukung' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT t), '{}'::uuid[])
    INTO _clean
    FROM unnest(COALESCE(_targets, '{}'::uuid[])) AS t
   WHERE t IS NOT NULL AND t <> _uid;

  SELECT count(*) INTO _bad
    FROM unnest(_clean) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.contacts c
      WHERE c.owner_id = _uid AND c.contact_id = t AND c.is_blocked = false
   );
  IF _bad > 0 THEN
    RAISE EXCEPTION 'Sebagian kontak tidak valid atau diblokir' USING ERRCODE = '22023';
  END IF;

  _count := coalesce(array_length(_clean, 1), 0);

  IF _privacy = 'only_share' AND _count = 0 AND _confirm_empty_only_share IS NOT TRUE THEN
    RAISE EXCEPTION 'Konfirmasi diperlukan untuk berbagi tanpa penerima' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.avatar_audience WHERE owner_id = _uid AND mode = _mode;

  IF _count > 0 THEN
    INSERT INTO public.avatar_audience (owner_id, target_id, mode)
    SELECT _uid, t, _mode FROM unnest(_clean) AS t;
  END IF;

  UPDATE public.profiles SET avatar_privacy = _privacy, updated_at = now() WHERE id = _uid;

  RETURN jsonb_build_object('privacy', _privacy, 'count', _count);
END;
$$;

REVOKE ALL ON FUNCTION public.set_avatar_privacy_audience(text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_avatar_privacy_audience(text, uuid[], boolean) TO authenticated;