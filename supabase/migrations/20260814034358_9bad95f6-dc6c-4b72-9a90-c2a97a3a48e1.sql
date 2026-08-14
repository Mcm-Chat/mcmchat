-- ---------- C. Grup: lock dahulu, otorisasi di-recheck setelah lock ----------
CREATE OR REPLACE FUNCTION public.create_group(_title text, _member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _conv uuid; _t text; _ids uuid[]; _m uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  _t := btrim(coalesce(_title,''));
  IF length(_t) < 1 OR length(_t) > 80 THEN
    RAISE EXCEPTION 'invalid_title: Nama grup 1-80 karakter';
  END IF;

  SELECT array_agg(DISTINCT x) INTO _ids
    FROM unnest(coalesce(_member_ids, '{}'::uuid[])) x WHERE x <> _uid AND x IS NOT NULL;
  _ids := coalesce(_ids, '{}'::uuid[]);
  IF coalesce(array_length(_ids,1),0) < 1 THEN
    RAISE EXCEPTION 'invalid_member: Grup minimal dua anggota';
  END IF;
  IF array_length(_ids,1) > 100 THEN RAISE EXCEPTION 'max_members: Maksimal 100 anggota'; END IF;

  FOREACH _m IN ARRAY _ids LOOP
    IF NOT public.are_connected(_uid, _m) THEN
      RAISE EXCEPTION 'not_connected: Salah satu anggota bukan kontak aktif';
    END IF;
    IF public.pair_blocked(_uid, _m) THEN
      RAISE EXCEPTION 'blocked: Salah satu anggota diblokir';
    END IF;
  END LOOP;

  INSERT INTO public.conversations (type, title, created_by) VALUES ('group', _t, _uid) RETURNING id INTO _conv;
  INSERT INTO public.conversation_members (conversation_id, user_id, role) VALUES (_conv, _uid, 'owner');
  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  SELECT _conv, x, 'member' FROM unnest(_ids) x;
  RETURN _conv;
END $fn$;

CREATE OR REPLACE FUNCTION public.add_group_members(_conversation uuid, _member_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _ids uuid[]; _m uuid; _n integer := 0; _total integer;
BEGIN
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  PERFORM public.assert_group_manager(_conversation, _uid, false);

  SELECT array_agg(DISTINCT x) INTO _ids
    FROM unnest(coalesce(_member_ids,'{}'::uuid[])) x
   WHERE x IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.conversation_members m
                      WHERE m.conversation_id = _conversation AND m.user_id = x);
  _ids := coalesce(_ids, '{}'::uuid[]);
  IF array_length(_ids,1) IS NULL THEN RETURN 0; END IF;

  SELECT count(*) INTO _total FROM public.conversation_members WHERE conversation_id = _conversation;
  IF _total + array_length(_ids,1) > 101 THEN RAISE EXCEPTION 'max_members: Maksimal 101 anggota'; END IF;

  FOREACH _m IN ARRAY _ids LOOP
    IF NOT public.are_connected(_uid, _m) THEN
      RAISE EXCEPTION 'not_connected: Target bukan kontak aktif';
    END IF;
    IF public.pair_blocked(_uid, _m) THEN RAISE EXCEPTION 'blocked: Target diblokir'; END IF;
  END LOOP;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  SELECT _conversation, x, 'member' FROM unnest(_ids) x
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $fn$;

CREATE OR REPLACE FUNCTION public.remove_group_member(_conversation uuid, _target uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _actor text; _trole text;
BEGIN
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  _actor := public.assert_group_manager(_conversation, _uid, false);
  IF _target = _uid THEN RAISE EXCEPTION 'forbidden: Gunakan keluar grup'; END IF;
  _trole := public.conv_role_of(_conversation, _target);
  IF _trole IS NULL THEN RETURN false; END IF;
  IF _trole = 'owner' THEN RAISE EXCEPTION 'forbidden: Pemilik grup tidak dapat dikeluarkan'; END IF;
  IF _actor = 'admin' AND _trole = 'admin' THEN
    RAISE EXCEPTION 'forbidden: Admin tidak dapat mengeluarkan admin lain';
  END IF;
  DELETE FROM public.conversation_members
   WHERE conversation_id = _conversation AND user_id = _target;
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.set_group_member_role(_conversation uuid, _target uuid, _role text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _trole text;
BEGIN
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  PERFORM public.assert_group_manager(_conversation, _uid, true);
  IF _role NOT IN ('admin','member') THEN RAISE EXCEPTION 'forbidden: Peran tidak valid'; END IF;
  IF _target = _uid THEN RAISE EXCEPTION 'forbidden: Tidak dapat mengubah peran sendiri'; END IF;
  _trole := public.conv_role_of(_conversation, _target);
  IF _trole IS NULL THEN RAISE EXCEPTION 'invalid_member: Target bukan anggota'; END IF;
  IF _trole = 'owner' THEN RAISE EXCEPTION 'forbidden: Peran pemilik lewat pemindahan kepemilikan'; END IF;
  UPDATE public.conversation_members SET role = _role, updated_at = now()
   WHERE conversation_id = _conversation AND user_id = _target;
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.transfer_group_ownership(_conversation uuid, _target uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  PERFORM public.assert_group_manager(_conversation, _uid, true);
  IF _target = _uid THEN RETURN true; END IF;
  IF public.conv_role_of(_conversation, _target) IS NULL THEN
    RAISE EXCEPTION 'invalid_member: Target bukan anggota';
  END IF;
  UPDATE public.conversation_members SET role = 'admin', updated_at = now()
   WHERE conversation_id = _conversation AND user_id = _uid;
  UPDATE public.conversation_members SET role = 'owner', updated_at = now()
   WHERE conversation_id = _conversation AND user_id = _target;
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.update_group_settings(
  _conversation uuid, _title text DEFAULT NULL,
  _avatar_color text DEFAULT NULL, _disappearing_hours integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _t text;
BEGIN
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  PERFORM public.assert_group_manager(_conversation, _uid, false);
  IF _title IS NOT NULL THEN
    _t := btrim(_title);
    IF length(_t) < 1 OR length(_t) > 80 THEN RAISE EXCEPTION 'invalid_title: Nama grup 1-80 karakter'; END IF;
  END IF;
  IF _avatar_color IS NOT NULL AND _avatar_color !~ '^[a-z0-9-]{1,32}$' THEN
    RAISE EXCEPTION 'forbidden: Warna tidak valid';
  END IF;
  IF _disappearing_hours IS NOT NULL AND (_disappearing_hours < 0 OR _disappearing_hours > 8760) THEN
    RAISE EXCEPTION 'forbidden: Durasi tidak valid';
  END IF;
  UPDATE public.conversations SET
    title = COALESCE(_t, title),
    avatar_color = COALESCE(_avatar_color, avatar_color),
    disappearing_hours = COALESCE(_disappearing_hours, disappearing_hours),
    updated_at = now()
  WHERE id = _conversation;
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.leave_conversation(_conversation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _type conversation_type; _role text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  SELECT c.type INTO _type FROM public.conversations c WHERE c.id = _conversation;
  IF _type IS NULL THEN RAISE EXCEPTION 'forbidden: Percakapan tidak ditemukan'; END IF;
  IF _type = 'direct' THEN RAISE EXCEPTION 'direct_invariant: Percakapan langsung tidak dapat ditinggalkan'; END IF;
  _role := public.conv_role_of(_conversation, _uid);
  IF _role IS NULL THEN RETURN false; END IF;
  IF _role = 'owner' THEN
    RAISE EXCEPTION 'last_owner: Pindahkan kepemilikan sebelum keluar';
  END IF;
  DELETE FROM public.conversation_members WHERE conversation_id = _conversation AND user_id = _uid;
  RETURN true;
END $fn$;

-- ---------- D. Preferensi & read state ----------
CREATE OR REPLACE FUNCTION public.update_my_conversation_preferences(
  _conversation uuid, _muted boolean DEFAULT NULL,
  _pinned boolean DEFAULT NULL, _archived boolean DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF NOT public.current_user_can_read_conversation(_conversation) THEN
    RAISE EXCEPTION 'forbidden: Anda bukan anggota percakapan ini';
  END IF;
  INSERT INTO public.conversation_members (conversation_id, user_id, role, is_muted, is_pinned, is_archived)
  VALUES (_conversation, _uid, 'member', coalesce(_muted,false), coalesce(_pinned,false), coalesce(_archived,false))
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET
    is_muted = COALESCE(_muted, public.conversation_members.is_muted),
    is_pinned = COALESCE(_pinned, public.conversation_members.is_pinned),
    is_archived = COALESCE(_archived, public.conversation_members.is_archived),
    updated_at = now();
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation uuid, _through_message_id uuid DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _uid uuid := auth.uid(); _cursor timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF NOT public.current_user_can_read_conversation(_conversation) THEN
    RAISE EXCEPTION 'forbidden: Anda bukan anggota percakapan ini';
  END IF;
  IF _through_message_id IS NOT NULL THEN
    SELECT m.created_at INTO _cursor FROM public.messages m
     WHERE m.id = _through_message_id AND m.conversation_id = _conversation;
    IF _cursor IS NULL THEN RAISE EXCEPTION 'invalid_member: Pesan tidak ada di percakapan ini'; END IF;
  END IF;
  _cursor := least(COALESCE(_cursor, now()), now());
  INSERT INTO public.conversation_members (conversation_id, user_id, role, last_read_at)
  VALUES (_conversation, _uid, 'member', _cursor)
  ON CONFLICT (conversation_id, user_id) DO UPDATE
    SET last_read_at = greatest(public.conversation_members.last_read_at, excluded.last_read_at),
        updated_at = now()
  RETURNING last_read_at INTO _cursor;
  RETURN _cursor;
END $fn$;