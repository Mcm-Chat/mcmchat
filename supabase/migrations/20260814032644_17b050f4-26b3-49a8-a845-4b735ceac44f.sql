
-- ============================================================
-- TAHAP 2B — Otorisasi percakapan direct, grup, dan business
-- ============================================================

-- ---------- B. SSOT direct conversation ----------
CREATE TABLE IF NOT EXISTS public.direct_conversations (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_low uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_conversations_pair_order CHECK (user_low < user_high),
  CONSTRAINT direct_conversations_pair_unique UNIQUE (user_low, user_high)
);

GRANT SELECT ON public.direct_conversations TO authenticated;
GRANT ALL ON public.direct_conversations TO service_role;
ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "direct pair reads canonical" ON public.direct_conversations;
CREATE POLICY "direct pair reads canonical" ON public.direct_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_low OR auth.uid() = user_high);

DROP TRIGGER IF EXISTS direct_conversations_touch ON public.direct_conversations;
CREATE TRIGGER direct_conversations_touch BEFORE UPDATE ON public.direct_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill deterministik: percakapan direct tertua per pasangan menjadi kanonik.
INSERT INTO public.direct_conversations (conversation_id, user_low, user_high, created_at)
SELECT DISTINCT ON (least(a.user_id,b.user_id), greatest(a.user_id,b.user_id))
       c.id, least(a.user_id,b.user_id), greatest(a.user_id,b.user_id), c.created_at
  FROM public.conversations c
  JOIN public.conversation_members a ON a.conversation_id = c.id
  JOIN public.conversation_members b ON b.conversation_id = c.id AND a.user_id < b.user_id
 WHERE c.type = 'direct'
   AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id = c.id) = 2
 ORDER BY least(a.user_id,b.user_id), greatest(a.user_id,b.user_id), c.created_at ASC, c.id ASC
ON CONFLICT DO NOTHING;

-- ---------- C. Role grup ----------
UPDATE public.conversation_members SET role = 'member'
 WHERE role IS NULL OR role NOT IN ('owner','admin','member');

-- Creator grup menjadi owner bila grup belum punya owner.
UPDATE public.conversation_members m SET role = 'owner'
  FROM public.conversations c
 WHERE c.id = m.conversation_id AND c.type = 'group' AND c.created_by = m.user_id
   AND NOT EXISTS (SELECT 1 FROM public.conversation_members o
                    WHERE o.conversation_id = c.id AND o.role = 'owner');

-- Direct selalu 'member'.
UPDATE public.conversation_members m SET role = 'member'
  FROM public.conversations c
 WHERE c.id = m.conversation_id AND c.type = 'direct' AND m.role <> 'member';

ALTER TABLE public.conversation_members DROP CONSTRAINT IF EXISTS conversation_members_role_valid;
ALTER TABLE public.conversation_members
  ADD CONSTRAINT conversation_members_role_valid CHECK (role IN ('owner','admin','member'));

CREATE UNIQUE INDEX IF NOT EXISTS conversation_members_unique_pair
  ON public.conversation_members (conversation_id, user_id);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx
  ON public.conversation_members (user_id);

-- ---------- Helper internal ----------
CREATE OR REPLACE FUNCTION public.lock_conversation_pair(_a uuid, _b uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended('conv|' || least(_a,_b)::text || '|' || greatest(_a,_b)::text, 0)
  );
$$;
REVOKE ALL ON FUNCTION public.lock_conversation_pair(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pair_blocked(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contacts c
     WHERE c.is_blocked
       AND ((c.owner_id = _a AND c.contact_id = _b) OR (c.owner_id = _b AND c.contact_id = _a))
  );
$$;
REVOKE ALL ON FUNCTION public.pair_blocked(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- Kapabilitas pemakaian percakapan saat ini (bukan sekadar keanggotaan).
CREATE OR REPLACE FUNCTION public.can_use_conversation(_conversation uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((
    SELECT CASE c.type
      WHEN 'direct' THEN EXISTS (
        SELECT 1 FROM public.direct_conversations d
         WHERE d.conversation_id = c.id
           AND _user IN (d.user_low, d.user_high)
           AND public.are_connected(d.user_low, d.user_high)
           AND NOT public.pair_blocked(d.user_low, d.user_high)
      )
      WHEN 'business' THEN (
        EXISTS (SELECT 1 FROM public.conversation_members m
                 WHERE m.conversation_id = c.id AND m.user_id = _user)
        OR (c.business_id IS NOT NULL AND public.is_business_member(c.business_id, _user))
      )
      ELSE TRUE
    END
    FROM public.conversations c
    WHERE c.id = _conversation
      AND (EXISTS (SELECT 1 FROM public.conversation_members m
                    WHERE m.conversation_id = c.id AND m.user_id = _user)
           OR (c.type = 'business' AND c.business_id IS NOT NULL
               AND public.is_business_member(c.business_id, _user)))
  ), false)
  AND _user IS NOT NULL AND _conversation IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.can_use_conversation(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conv_role_of(_conversation uuid, _user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.role FROM public.conversation_members m
   WHERE m.conversation_id = _conversation AND m.user_id = _user;
$$;
REVOKE ALL ON FUNCTION public.conv_role_of(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ---------- RPC: direct ----------
CREATE OR REPLACE FUNCTION public.get_or_create_direct(_other uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _conv uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF _other IS NULL OR _other = _uid THEN RAISE EXCEPTION 'invalid_member: Tujuan tidak valid'; END IF;

  PERFORM public.lock_conversation_pair(_uid, _other);

  IF NOT public.are_connected(_uid, _other) THEN
    RAISE EXCEPTION 'not_connected: Hubungan kontak tidak aktif';
  END IF;
  IF public.pair_blocked(_uid, _other) THEN
    RAISE EXCEPTION 'blocked: Kontak diblokir';
  END IF;

  SELECT d.conversation_id INTO _conv FROM public.direct_conversations d
   WHERE d.user_low = least(_uid,_other) AND d.user_high = greatest(_uid,_other);
  IF _conv IS NOT NULL THEN RETURN _conv; END IF;

  INSERT INTO public.conversations (type, created_by) VALUES ('direct', _uid) RETURNING id INTO _conv;
  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (_conv, _uid, 'member'), (_conv, _other, 'member');
  INSERT INTO public.direct_conversations (conversation_id, user_low, user_high)
  VALUES (_conv, least(_uid,_other), greatest(_uid,_other));

  RETURN _conv;
END $$;
REVOKE ALL ON FUNCTION public.get_or_create_direct(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct(uuid) TO authenticated, service_role;

-- ---------- RPC: grup ----------
CREATE OR REPLACE FUNCTION public.create_group(_title text, _member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  IF array_length(_ids,1) > 0 THEN
    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    SELECT _conv, x, 'member' FROM unnest(_ids) x;
  END IF;
  RETURN _conv;
END $$;
REVOKE ALL ON FUNCTION public.create_group(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_group_manager(_conversation uuid, _uid uuid, _owner_only boolean)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _role text; _type conversation_type;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT c.type INTO _type FROM public.conversations c WHERE c.id = _conversation;
  IF _type IS NULL THEN RAISE EXCEPTION 'forbidden: Percakapan tidak ditemukan'; END IF;
  IF _type <> 'group' THEN RAISE EXCEPTION 'direct_invariant: Bukan percakapan grup'; END IF;
  _role := public.conv_role_of(_conversation, _uid);
  IF _role IS NULL THEN RAISE EXCEPTION 'forbidden: Anda bukan anggota grup'; END IF;
  IF _owner_only AND _role <> 'owner' THEN RAISE EXCEPTION 'forbidden: Hanya pemilik grup'; END IF;
  IF NOT _owner_only AND _role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'forbidden: Hanya pemilik atau admin grup';
  END IF;
  RETURN _role;
END $$;
REVOKE ALL ON FUNCTION public.assert_group_manager(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_group_members(_conversation uuid, _member_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _ids uuid[]; _m uuid; _n integer := 0; _total integer;
BEGIN
  PERFORM public.assert_group_manager(_conversation, _uid, false);
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;

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
END $$;
REVOKE ALL ON FUNCTION public.add_group_members(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_group_member(_conversation uuid, _target uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _actor text; _trole text;
BEGIN
  _actor := public.assert_group_manager(_conversation, _uid, false);
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
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
END $$;
REVOKE ALL ON FUNCTION public.remove_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_group_member_role(_conversation uuid, _target uuid, _role text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _trole text;
BEGIN
  PERFORM public.assert_group_manager(_conversation, _uid, true);
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  IF _role NOT IN ('admin','member') THEN RAISE EXCEPTION 'forbidden: Peran tidak valid'; END IF;
  IF _target = _uid THEN RAISE EXCEPTION 'forbidden: Tidak dapat mengubah peran sendiri'; END IF;
  _trole := public.conv_role_of(_conversation, _target);
  IF _trole IS NULL THEN RAISE EXCEPTION 'invalid_member: Target bukan anggota'; END IF;
  IF _trole = 'owner' THEN RAISE EXCEPTION 'forbidden: Peran pemilik lewat pemindahan kepemilikan'; END IF;
  UPDATE public.conversation_members SET role = _role, updated_at = now()
   WHERE conversation_id = _conversation AND user_id = _target;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_group_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_member_role(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transfer_group_ownership(_conversation uuid, _target uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  PERFORM public.assert_group_manager(_conversation, _uid, true);
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  IF _target = _uid THEN RETURN true; END IF;
  IF public.conv_role_of(_conversation, _target) IS NULL THEN
    RAISE EXCEPTION 'invalid_member: Target bukan anggota';
  END IF;
  UPDATE public.conversation_members SET role = 'admin', updated_at = now()
   WHERE conversation_id = _conversation AND user_id = _uid;
  UPDATE public.conversation_members SET role = 'owner', updated_at = now()
   WHERE conversation_id = _conversation AND user_id = _target;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.transfer_group_ownership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_group_ownership(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.leave_conversation(_conversation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _type conversation_type; _role text; _others integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT c.type INTO _type FROM public.conversations c WHERE c.id = _conversation;
  IF _type IS NULL THEN RAISE EXCEPTION 'forbidden: Percakapan tidak ditemukan'; END IF;
  IF _type = 'direct' THEN RAISE EXCEPTION 'direct_invariant: Percakapan langsung tidak dapat ditinggalkan'; END IF;
  PERFORM 1 FROM public.conversations WHERE id = _conversation FOR UPDATE;
  _role := public.conv_role_of(_conversation, _uid);
  IF _role IS NULL THEN RETURN false; END IF;
  SELECT count(*) INTO _others FROM public.conversation_members
   WHERE conversation_id = _conversation AND user_id <> _uid;
  IF _role = 'owner' AND _others > 0 THEN
    RAISE EXCEPTION 'last_owner: Pindahkan kepemilikan sebelum keluar';
  END IF;
  DELETE FROM public.conversation_members WHERE conversation_id = _conversation AND user_id = _uid;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.leave_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_group_settings(
  _conversation uuid, _title text DEFAULT NULL,
  _avatar_color text DEFAULT NULL, _disappearing_hours integer DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _t text;
BEGIN
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
END $$;
REVOKE ALL ON FUNCTION public.update_group_settings(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_group_settings(uuid, text, text, integer) TO authenticated, service_role;

-- ---------- D. Preferensi & read state ----------
CREATE OR REPLACE FUNCTION public.update_my_conversation_preferences(
  _conversation uuid, _muted boolean DEFAULT NULL,
  _pinned boolean DEFAULT NULL, _archived boolean DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  UPDATE public.conversation_members SET
    is_muted = COALESCE(_muted, is_muted),
    is_pinned = COALESCE(_pinned, is_pinned),
    is_archived = COALESCE(_archived, is_archived),
    updated_at = now()
  WHERE conversation_id = _conversation AND user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden: Anda bukan anggota percakapan ini'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.update_my_conversation_preferences(uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_conversation_preferences(uuid, boolean, boolean, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation uuid, _through_message_id uuid DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _cursor timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF NOT public.is_conv_member(_conversation, _uid) THEN
    RAISE EXCEPTION 'forbidden: Anda bukan anggota percakapan ini';
  END IF;
  IF _through_message_id IS NOT NULL THEN
    SELECT m.created_at INTO _cursor FROM public.messages m
     WHERE m.id = _through_message_id AND m.conversation_id = _conversation;
    IF _cursor IS NULL THEN RAISE EXCEPTION 'invalid_member: Pesan tidak ada di percakapan ini'; END IF;
  END IF;
  _cursor := least(COALESCE(_cursor, now()), now());
  UPDATE public.conversation_members
     SET last_read_at = greatest(last_read_at, _cursor), updated_at = now()
   WHERE conversation_id = _conversation AND user_id = _uid
  RETURNING last_read_at INTO _cursor;
  RETURN _cursor;
END $$;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, uuid) TO authenticated, service_role;

-- ---------- E. Business conversation ----------
CREATE OR REPLACE FUNCTION public.get_or_create_business_conversation(_business uuid, _customer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _conv uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF NOT public.can_manage_business(_business, _uid) THEN
    RAISE EXCEPTION 'forbidden: Hanya pemilik atau admin bisnis';
  END IF;
  IF _customer IS NULL THEN RAISE EXCEPTION 'invalid_member: Pelanggan tidak valid'; END IF;

  PERFORM public.lock_conversation_pair(_business, _customer);
  SELECT c.id INTO _conv FROM public.conversations c
    JOIN public.conversation_members m ON m.conversation_id = c.id AND m.user_id = _customer
   WHERE c.type = 'business' AND c.business_id = _business
   ORDER BY c.created_at ASC LIMIT 1;
  IF _conv IS NOT NULL THEN RETURN _conv; END IF;

  INSERT INTO public.conversations (type, business_id, created_by, inbox_status)
  VALUES ('business', _business, _uid, 'open') RETURNING id INTO _conv;
  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (_conv, _uid, 'owner'), (_conv, _customer, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  RETURN _conv;
END $$;
REVOKE ALL ON FUNCTION public.get_or_create_business_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_business_conversation(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_conversation_assignee(_conversation uuid, _assignee uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _biz uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT business_id INTO _biz FROM public.conversations WHERE id = _conversation AND type = 'business';
  IF _biz IS NULL THEN RAISE EXCEPTION 'forbidden: Bukan percakapan bisnis'; END IF;
  IF NOT public.can_manage_business(_biz, _uid) THEN
    RAISE EXCEPTION 'forbidden: Hanya pemilik atau admin bisnis';
  END IF;
  IF _assignee IS NOT NULL AND NOT public.is_business_member(_biz, _assignee) THEN
    RAISE EXCEPTION 'invalid_member: Penanggung jawab harus anggota bisnis';
  END IF;
  UPDATE public.conversations SET assignee_id = _assignee, updated_at = now() WHERE id = _conversation;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_conversation_assignee(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_assignee(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_conversation_inbox_status(_conversation uuid, _status inbox_status)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _biz uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  SELECT business_id INTO _biz FROM public.conversations WHERE id = _conversation AND type = 'business';
  IF _biz IS NULL THEN RAISE EXCEPTION 'forbidden: Bukan percakapan bisnis'; END IF;
  IF NOT public.can_sell_business(_biz, _uid) THEN
    RAISE EXCEPTION 'forbidden: Tidak berwenang atas kotak masuk bisnis';
  END IF;
  UPDATE public.conversations SET inbox_status = _status, updated_at = now() WHERE id = _conversation;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_conversation_inbox_status(uuid, inbox_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_inbox_status(uuid, inbox_status) TO authenticated, service_role;

-- ---------- Panggilan memakai kapabilitas ----------
CREATE OR REPLACE FUNCTION public.create_call_tx(_conversation uuid, _kind call_kind, _max_participants integer DEFAULT 8)
RETURNS calls LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
DECLARE _uid uuid := auth.uid(); _call public.calls; _n integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'forbidden: Tidak diizinkan'; END IF;
  IF NOT public.is_conv_member(_conversation, _uid) THEN
    RAISE EXCEPTION 'forbidden: Anda bukan anggota percakapan ini';
  END IF;
  IF NOT public.can_use_conversation(_conversation, _uid) THEN
    RAISE EXCEPTION 'not_connected: Hubungan kontak tidak aktif';
  END IF;

  SELECT count(*) INTO _n FROM public.conversation_members WHERE conversation_id = _conversation;
  IF _n > greatest(2, coalesce(_max_participants, 8)) THEN
    RAISE EXCEPTION 'forbidden: Jumlah peserta melebihi batas panggilan';
  END IF;

  SELECT * INTO _call FROM public.calls
   WHERE conversation_id = _conversation AND initiator_id = _uid AND status = 'ringing'
     AND created_at > now() - interval '45 seconds'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN _call; END IF;

  INSERT INTO public.calls (conversation_id, initiator_id, kind, status, provider, room_name, max_participants)
  VALUES (_conversation, _uid, _kind, 'ringing', 'livekit',
          'mcm-' || replace(gen_random_uuid()::text, '-', ''), greatest(2, coalesce(_max_participants, 8)))
  RETURNING * INTO _call;

  INSERT INTO public.call_participants (call_id, user_id)
  SELECT _call.id, cm.user_id FROM public.conversation_members cm
  WHERE cm.conversation_id = _conversation
  ON CONFLICT DO NOTHING;

  RETURN _call;
END $$;
REVOKE ALL ON FUNCTION public.create_call_tx(uuid, call_kind, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_call_tx(uuid, call_kind, integer) TO authenticated, service_role;

-- ---------- conversation_overview + kapabilitas ----------
DROP FUNCTION IF EXISTS public.conversation_overview();
CREATE OR REPLACE FUNCTION public.conversation_overview()
RETURNS TABLE(conversation_id uuid, last_message_id uuid, last_message_kind message_kind,
  last_message_body text, last_message_sender uuid, last_message_at timestamptz,
  last_attachment_name text, last_location_lat double precision, unread_count integer, usable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  mine AS (
    SELECT cm.conversation_id, cm.last_read_at,
           public.can_use_conversation(cm.conversation_id, me.uid) AS usable
    FROM public.conversation_members cm, me
    WHERE me.uid IS NOT NULL AND cm.user_id = me.uid
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.id, m.kind, m.body, m.sender_id, m.created_at, m.attachment_name, m.location_lat
    FROM public.messages m
    JOIN mine ON mine.conversation_id = m.conversation_id, me
    WHERE NOT EXISTS (SELECT 1 FROM public.message_hides h WHERE h.message_id = m.id AND h.user_id = me.uid)
    ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
  )
  SELECT mine.conversation_id, l.id, l.kind, l.body, l.sender_id, l.created_at, l.attachment_name, l.location_lat,
    CASE WHEN mine.usable THEN
      (SELECT count(*)::int FROM public.messages um, me
        WHERE um.conversation_id = mine.conversation_id
          AND um.sender_id <> me.uid
          AND um.created_at > mine.last_read_at
          AND NOT EXISTS (SELECT 1 FROM public.message_hides h2 WHERE h2.message_id = um.id AND h2.user_id = me.uid))
      ELSE 0 END,
    mine.usable
  FROM mine LEFT JOIN last_msg l ON l.conversation_id = mine.conversation_id;
$$;
REVOKE ALL ON FUNCTION public.conversation_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_overview() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_conversation_capability(_conversation uuid)
RETURNS TABLE(usable boolean, role text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.can_use_conversation(_conversation, auth.uid()),
         public.conv_role_of(_conversation, auth.uid()),
         CASE WHEN public.can_use_conversation(_conversation, auth.uid()) THEN ''
              ELSE 'Hubungan kontak tidak aktif' END;
$$;
REVOKE ALL ON FUNCTION public.my_conversation_capability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_conversation_capability(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_conv_member(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_conv_admin(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ---------- G. RLS / GRANT / ACL ----------
DROP POLICY IF EXISTS "creator inserts conversation" ON public.conversations;
DROP POLICY IF EXISTS "creator deletes conversation" ON public.conversations;
DROP POLICY IF EXISTS "member updates conversation" ON public.conversations;
DROP POLICY IF EXISTS "member adds members" ON public.conversation_members;
DROP POLICY IF EXISTS "admin removes members" ON public.conversation_members;
DROP POLICY IF EXISTS "own membership delete" ON public.conversation_members;
DROP POLICY IF EXISTS "own membership update" ON public.conversation_members;

REVOKE ALL ON TABLE public.conversations FROM authenticated, anon, PUBLIC;
REVOKE ALL ON TABLE public.conversation_members FROM authenticated, anon, PUBLIC;
GRANT SELECT ON TABLE public.conversations TO authenticated;
GRANT SELECT ON TABLE public.conversation_members TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;
GRANT ALL ON TABLE public.conversation_members TO service_role;
REVOKE ALL ON TABLE public.direct_conversations FROM anon, PUBLIC;

-- ---------- Perbaikan keamanan: eskalasi peran business_members ----------
DROP POLICY IF EXISTS "add business member" ON public.business_members;
DROP POLICY IF EXISTS "update business member" ON public.business_members;
CREATE POLICY "add business member" ON public.business_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_business(business_id, auth.uid())
    AND (role <> 'owner' OR public.business_role_of(business_id, auth.uid()) = 'owner')
  );
CREATE POLICY "update business member" ON public.business_members
  FOR UPDATE TO authenticated
  USING (public.can_manage_business(business_id, auth.uid()))
  WITH CHECK (
    public.can_manage_business(business_id, auth.uid())
    AND (role <> 'owner' OR public.business_role_of(business_id, auth.uid()) = 'owner')
  );
