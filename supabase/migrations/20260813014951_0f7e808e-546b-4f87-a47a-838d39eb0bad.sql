ALTER TABLE public.business_members
  ADD COLUMN IF NOT EXISTS staff_pin text,
  ADD COLUMN IF NOT EXISTS staff_pin_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS staff_display_name text NOT NULL DEFAULT '';

REVOKE SELECT (staff_pin) ON public.business_members FROM authenticated;

ALTER TABLE public.preparation_jobs
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_pin text,
  ADD COLUMN IF NOT EXISTS delivered_message_id uuid;

CREATE OR REPLACE FUNCTION public.business_staff_directory(_business uuid)
RETURNS TABLE (user_id uuid, role public.business_role, display_name text, avatar_color text, staff_pin text, pin_confirmed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.user_id,
         m.role,
         COALESCE(NULLIF(m.staff_display_name, ''), p.display_name, 'Pegawai'),
         COALESCE(p.avatar_color, 'emerald'),
         CASE WHEN public.can_manage_business(_business, auth.uid()) THEN m.staff_pin ELSE NULL END,
         m.staff_pin_confirmed_at
  FROM public.business_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.business_id = _business
    AND public.is_business_member(_business, auth.uid())
  ORDER BY m.created_at
$$;
REVOKE ALL ON FUNCTION public.business_staff_directory(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.business_staff_directory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_staff_pin(_business uuid, _pin text, _role public.business_role DEFAULT 'agent', _label text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _norm text; _pid uuid; _pname text; _m public.business_members;
BEGIN
  IF NOT public.can_manage_business(_business, auth.uid()) THEN
    RAISE EXCEPTION 'Hanya pemilik atau admin yang bisa menyimpan PIN pegawai';
  END IF;
  _norm := upper(regexp_replace(coalesce(_pin, ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(_norm) < 4 THEN
    RAISE EXCEPTION 'Nomor MCM pegawai tidak valid';
  END IF;
  IF _role = 'owner' THEN
    RAISE EXCEPTION 'Peran pemilik tidak bisa diberikan lewat PIN';
  END IF;
  SELECT p.id, p.display_name INTO _pid, _pname
  FROM public.profiles p
  WHERE upper(regexp_replace(p.pin, '[^A-Za-z0-9]', '', 'g')) = _norm
  LIMIT 1;
  IF _pid IS NULL THEN
    RAISE EXCEPTION 'Nomor MCM tidak ditemukan';
  END IF;
  INSERT INTO public.business_members AS bm (business_id, user_id, role, staff_pin, staff_pin_confirmed_at, staff_display_name)
  VALUES (_business, _pid, _role, _norm, now(), COALESCE(NULLIF(_label, ''), _pname, 'Pegawai'))
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET staff_pin = EXCLUDED.staff_pin,
        staff_pin_confirmed_at = now(),
        staff_display_name = EXCLUDED.staff_display_name,
        role = CASE WHEN bm.role = 'owner' THEN bm.role ELSE EXCLUDED.role END
  RETURNING * INTO _m;
  RETURN jsonb_build_object('user_id', _m.user_id, 'role', _m.role, 'pin', _m.staff_pin, 'name', _m.staff_display_name, 'confirmed_at', _m.staff_pin_confirmed_at);
END $$;
REVOKE ALL ON FUNCTION public.confirm_staff_pin(uuid, text, public.business_role, text) FROM public;
GRANT EXECUTE ON FUNCTION public.confirm_staff_pin(uuid, text, public.business_role, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.deliver_preparation_job(_job uuid, _link text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.preparation_jobs; _uid uuid := auth.uid(); _conv uuid; _msg uuid; _pin text; _items text;
BEGIN
  SELECT * INTO j FROM public.preparation_jobs WHERE id = _job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Tugas tidak ditemukan'; END IF;
  IF NOT public.can_manage_business(j.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengirim tugas ini';
  END IF;
  IF _link !~ '^https?://' THEN RAISE EXCEPTION 'Tautan tugas tidak valid'; END IF;
  SELECT m.staff_pin INTO _pin FROM public.business_members m
   WHERE m.business_id = j.business_id AND m.user_id = j.assigned_user_id;
  IF _pin IS NULL OR _pin = '' THEN
    RAISE EXCEPTION 'PIN MCM pegawai belum dikonfirmasi';
  END IF;

  SELECT c.id INTO _conv FROM public.conversations c
   WHERE c.type = 'direct'
     AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = _uid)
     AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = j.assigned_user_id)
   LIMIT 1;
  IF _conv IS NULL THEN
    INSERT INTO public.conversations (type, created_by) VALUES ('direct', _uid) RETURNING id INTO _conv;
    INSERT INTO public.conversation_members (conversation_id, user_id) VALUES (_conv, _uid), (_conv, j.assigned_user_id);
  END IF;

  SELECT string_agg('• ' || i.product_name || ' — ' || i.variant_name || ': ' || trim(to_char(i.requested_qty, 'FM999999990.99')) || ' ' || i.requested_unit, E'\n' ORDER BY i.created_at)
    INTO _items FROM public.preparation_job_items i WHERE i.job_id = _job;

  INSERT INTO public.messages (conversation_id, sender_id, kind, body, payload)
  VALUES (_conv, _uid, 'text',
    'Perintah penyiapan ' || j.code || E'\nPelanggan: ' || COALESCE(NULLIF(j.customer_name, ''), '—') || E'\n' || COALESCE(_items, '') || E'\nBuka & isi perintah di sini: ' || _link,
    jsonb_build_object('type', 'preparation_job', 'job_id', j.id, 'code', j.code, 'link', _link))
  RETURNING id INTO _msg;

  UPDATE public.preparation_jobs
     SET delivered_at = now(), delivered_pin = _pin, delivered_message_id = _msg,
         status = CASE WHEN status = 'draft' THEN 'sent'::public.preparation_status ELSE status END
   WHERE id = _job;

  RETURN jsonb_build_object('conversation_id', _conv, 'message_id', _msg, 'pin', _pin);
END $$;
REVOKE ALL ON FUNCTION public.deliver_preparation_job(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.deliver_preparation_job(uuid, text) TO authenticated;