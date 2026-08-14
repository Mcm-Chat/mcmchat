-- =====================================================================
-- TAHAP 2A KOREKSI: model hubungan diterima yang eksplisit
-- =====================================================================

-- A1. Tabel canonical
CREATE TABLE IF NOT EXISTS public.contact_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_request_id uuid REFERENCES public.contact_requests(id) ON DELETE SET NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_connections_not_self CHECK (user_low <> user_high),
  CONSTRAINT contact_connections_canonical CHECK (user_low < user_high),
  CONSTRAINT contact_connections_pair_uniq UNIQUE (user_low, user_high)
);

GRANT SELECT ON public.contact_connections TO authenticated;
GRANT ALL ON public.contact_connections TO service_role;
ALTER TABLE public.contact_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connections visible to parties" ON public.contact_connections;
CREATE POLICY "connections visible to parties"
  ON public.contact_connections FOR SELECT TO authenticated
  USING (auth.uid() = user_low OR auth.uid() = user_high);

DROP TRIGGER IF EXISTS trg_contact_connections_updated ON public.contact_connections;
CREATE TRIGGER trg_contact_connections_updated
  BEFORE UPDATE ON public.contact_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A2. Backfill HANYA dari request accepted
INSERT INTO public.contact_connections (user_low, user_high, accepted_request_id, accepted_at)
SELECT DISTINCT ON (least(r.requester_id, r.target_id), greatest(r.requester_id, r.target_id))
       least(r.requester_id, r.target_id),
       greatest(r.requester_id, r.target_id),
       r.id,
       r.updated_at
FROM public.contact_requests r
WHERE r.status = 'accepted'
ORDER BY least(r.requester_id, r.target_id), greatest(r.requester_id, r.target_id), r.updated_at DESC
ON CONFLICT (user_low, user_high) DO NOTHING;

-- A3/B8. Helper internal
CREATE OR REPLACE FUNCTION public.lock_contact_pair(_a uuid, _b uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended(least(_a,_b)::text || '|' || greatest(_a,_b)::text, 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.are_connected(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contact_connections c
    WHERE c.user_low = least(_a,_b) AND c.user_high = greatest(_a,_b)
      AND c.disconnected_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.i_am_connected_to(_other uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND _other IS NOT NULL
     AND public.are_connected(auth.uid(), _other);
$$;

REVOKE ALL ON FUNCTION public.lock_contact_pair(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.are_connected(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.i_am_connected_to(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.i_am_connected_to(uuid) TO authenticated, service_role;

-- B10. Satu pasangan = satu baris request (canonical unordered)
WITH ranked AS (
  SELECT id, row_number() OVER (
      PARTITION BY least(requester_id,target_id), greatest(requester_id,target_id)
      ORDER BY updated_at DESC, created_at DESC
    ) rn
  FROM public.contact_requests
)
DELETE FROM public.contact_requests r USING ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

DROP INDEX IF EXISTS public.contact_requests_pair_uniq;
CREATE UNIQUE INDEX contact_requests_pair_uniq
  ON public.contact_requests (least(requester_id,target_id), greatest(requester_id,target_id));

-- A4. Refactor keputusan hubungan ke connection aktif
CREATE OR REPLACE FUNCTION public.can_view_full_profile(_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _owner = auth.uid() THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.contacts b
      WHERE b.is_blocked
        AND ((b.owner_id = _owner AND b.contact_id = auth.uid())
          OR (b.owner_id = auth.uid() AND b.contact_id = _owner))
    ) THEN false
    WHEN public.are_connected(auth.uid(), _owner) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.conversation_members m
      JOIN public.conversation_members o ON o.conversation_id = m.conversation_id
      WHERE m.user_id = auth.uid() AND o.user_id = _owner
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.business_members m
      JOIN public.business_members o ON o.business_id = m.business_id
      WHERE m.user_id = auth.uid() AND o.user_id = _owner
    ) THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.pins_for_me(_ids uuid[])
RETURNS TABLE(id uuid, pin text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.pin
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id = ANY (
      SELECT DISTINCT x FROM unnest(coalesce(_ids, array[]::uuid[])) x LIMIT 100
    )
    AND (p.id = auth.uid() OR public.are_connected(auth.uid(), p.id));
$$;

CREATE OR REPLACE FUNCTION public.my_connected_contacts()
RETURNS TABLE(contact_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN c.user_low = auth.uid() THEN c.user_high ELSE c.user_low END
  FROM public.contact_connections c
  WHERE c.disconnected_at IS NULL
    AND auth.uid() IN (c.user_low, c.user_high);
$$;

CREATE OR REPLACE FUNCTION public.contact_relation(_other uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'self', _other = auth.uid(),
    'saved', EXISTS (SELECT 1 FROM public.contacts c WHERE c.owner_id = auth.uid() AND c.contact_id = _other),
    'connected', public.are_connected(auth.uid(), _other),
    'blocked_by_me', EXISTS (
      SELECT 1 FROM public.contacts c WHERE c.owner_id = auth.uid() AND c.contact_id = _other AND c.is_blocked),
    'blocked_me', EXISTS (
      SELECT 1 FROM public.contacts c WHERE c.owner_id = _other AND c.contact_id = auth.uid() AND c.is_blocked),
    'outgoing_pending', EXISTS (
      SELECT 1 FROM public.contact_requests r
      WHERE r.requester_id = auth.uid() AND r.target_id = _other AND r.status = 'pending'),
    'incoming_request_id', (
      SELECT r.id FROM public.contact_requests r
      WHERE r.requester_id = _other AND r.target_id = auth.uid() AND r.status = 'pending' LIMIT 1)
  )
  WHERE auth.uid() IS NOT NULL;
$$;

-- A4/C16. avatar "contacts" = hubungan aktif, bukan kartu tersimpan
CREATE OR REPLACE FUNCTION public.can_view_avatar(_owner uuid, _viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _viewer IS NULL THEN false
    WHEN _owner = _viewer THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.contacts b
      WHERE b.is_blocked = true
        AND ((b.owner_id = _owner AND b.contact_id = _viewer)
          OR (b.owner_id = _viewer AND b.contact_id = _owner))
    ) THEN false
    ELSE (
      SELECT CASE p.avatar_privacy
        WHEN 'nobody' THEN false
        WHEN 'only_share' THEN EXISTS (
          SELECT 1 FROM public.avatar_audience a
          WHERE a.owner_id = _owner AND a.target_id = _viewer AND a.mode = 'only')
        WHEN 'contacts_except' THEN
          public.are_connected(_owner, _viewer)
          AND NOT EXISTS (
            SELECT 1 FROM public.avatar_audience a
            WHERE a.owner_id = _owner AND a.target_id = _viewer AND a.mode = 'except')
        WHEN 'everyone' THEN true
        ELSE public.are_connected(_owner, _viewer)
      END
      FROM public.profiles p WHERE p.id = _owner
    )
  END
$$;

-- C14/C15. Kontrak profil: PIN & avatar_privacy hanya self/connection aktif
CREATE OR REPLACE FUNCTION public.profile_full(_id uuid)
RETURNS TABLE(id uuid, pin text, display_name text, bio text, avatar_url text,
              avatar_color text, avatar_version integer, avatar_privacy text,
              is_online boolean, last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id,
         CASE WHEN p.id = auth.uid() OR public.are_connected(auth.uid(), p.id) THEN p.pin ELSE NULL END,
         p.display_name,
         p.bio,
         CASE WHEN public.can_view_avatar(p.id, auth.uid()) THEN p.avatar_url ELSE NULL END,
         p.avatar_color, p.avatar_version,
         CASE WHEN p.id = auth.uid() THEN p.avatar_privacy ELSE NULL END,
         p.is_online, p.last_seen_at
  FROM public.profiles p
  WHERE p.id = _id AND public.can_view_full_profile(p.id);
$$;

-- B13. profile_cards: dedupe + batas 100
CREATE OR REPLACE FUNCTION public.profile_cards(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, avatar_color text, avatar_url text, avatar_version integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT array_agg(DISTINCT x) INTO ids FROM unnest(coalesce(_ids, array[]::uuid[])) x WHERE x IS NOT NULL;
  ids := coalesce(ids, array[]::uuid[]);
  IF array_length(ids, 1) > 100 THEN RAISE EXCEPTION 'too_many_ids'; END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_color,
           CASE WHEN public.can_view_avatar(p.id, auth.uid()) THEN p.avatar_url ELSE NULL END,
           p.avatar_version
    FROM public.profiles p WHERE p.id = ANY(ids);
END $$;

-- A5/B9/B11. respond_contact_request atomik + idempoten
CREATE OR REPLACE FUNCTION public.respond_contact_request(_request uuid, _action contact_request_status)
RETURNS contact_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); r public.contact_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _action NOT IN ('accepted','rejected','blocked') THEN RAISE EXCEPTION 'invalid_action'; END IF;

  SELECT * INTO r FROM public.contact_requests WHERE id = _request;
  IF r.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF r.target_id <> uid THEN RAISE EXCEPTION 'not_authorized'; END IF;

  PERFORM public.lock_contact_pair(r.requester_id, r.target_id);
  SELECT * INTO r FROM public.contact_requests WHERE id = _request FOR UPDATE;

  -- idempotensi: accept ulang atas request yang sudah accepted tetap sukses
  IF r.status = 'accepted' AND _action = 'accepted' THEN
    INSERT INTO public.contact_connections (user_low, user_high, accepted_request_id)
    VALUES (least(r.requester_id, r.target_id), greatest(r.requester_id, r.target_id), r.id)
    ON CONFLICT (user_low, user_high) DO UPDATE
      SET disconnected_at = NULL, accepted_request_id = EXCLUDED.accepted_request_id, updated_at = now();
    RETURN r;
  END IF;

  IF r.status <> 'pending' AND _action <> 'blocked' THEN RAISE EXCEPTION 'request_not_pending'; END IF;

  UPDATE public.contact_requests SET status = _action, updated_at = now()
   WHERE id = _request RETURNING * INTO r;

  IF _action = 'accepted' THEN
    INSERT INTO public.contact_connections (user_low, user_high, accepted_request_id, accepted_at)
    VALUES (least(r.requester_id, r.target_id), greatest(r.requester_id, r.target_id), r.id, now())
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
END $$;

-- A6/B9. block memutus hubungan; unblock tidak memulihkan
CREATE OR REPLACE FUNCTION public.set_contact_blocked(_target uuid, _blocked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
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

    UPDATE public.contact_requests
       SET status = CASE WHEN target_id = uid THEN 'blocked' ELSE 'cancelled' END,
           updated_at = now()
     WHERE status = 'pending'
       AND ((requester_id = uid AND target_id = _target)
         OR (requester_id = _target AND target_id = uid));
  ELSE
    UPDATE public.contacts SET is_blocked = false, updated_at = now()
     WHERE owner_id = uid AND contact_id = _target;
  END IF;
  RETURN jsonb_build_object('blocked', _blocked);
END $$;

-- A7. RPC eksplisit remove/disconnect
CREATE OR REPLACE FUNCTION public.remove_saved_contact(_target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target IS NULL OR _target = uid THEN RAISE EXCEPTION 'invalid_target'; END IF;
  PERFORM public.lock_contact_pair(uid, _target);
  IF public.are_connected(uid, _target) THEN RAISE EXCEPTION 'connected_requires_disconnect'; END IF;
  DELETE FROM public.contacts WHERE owner_id = uid AND contact_id = _target;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('removed', n);
END $$;

CREATE OR REPLACE FUNCTION public.disconnect_contact(_target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target IS NULL OR _target = uid THEN RAISE EXCEPTION 'invalid_target'; END IF;
  PERFORM public.lock_contact_pair(uid, _target);

  UPDATE public.contact_connections
     SET disconnected_at = now(), updated_at = now()
   WHERE user_low = least(uid,_target) AND user_high = greatest(uid,_target)
     AND disconnected_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.contact_requests
     SET status = 'cancelled', updated_at = now()
   WHERE status IN ('accepted','pending')
     AND ((requester_id = uid AND target_id = _target)
       OR (requester_id = _target AND target_id = uid));

  DELETE FROM public.contacts WHERE owner_id = uid AND contact_id = _target;
  RETURN jsonb_build_object('disconnected', n);
END $$;

-- A4. save_contact_card: connected dari SSOT + default argumen (tanpa cast klien)
CREATE OR REPLACE FUNCTION public.save_contact_card(_target uuid, _source text DEFAULT 'manual', _alias text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); src text; alias_clean text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target IS NULL OR _target = uid THEN RAISE EXCEPTION 'invalid_target'; END IF;
  src := coalesce(nullif(btrim(_source), ''), 'manual');
  IF src NOT IN ('qr','pin','manual') THEN RAISE EXCEPTION 'invalid_source'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN RAISE EXCEPTION 'invalid_target'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.contacts b
    WHERE b.is_blocked
      AND ((b.owner_id = _target AND b.contact_id = uid) OR (b.owner_id = uid AND b.contact_id = _target))
  ) THEN RAISE EXCEPTION 'blocked'; END IF;

  alias_clean := nullif(btrim(regexp_replace(coalesce(_alias,''), '[[:cntrl:]]', ' ', 'g')), '');
  IF length(coalesce(alias_clean,'')) > 40 THEN RAISE EXCEPTION 'invalid_alias'; END IF;

  INSERT INTO public.contacts (owner_id, contact_id, source, alias)
  VALUES (uid, _target, src, alias_clean)
  ON CONFLICT (owner_id, contact_id) DO NOTHING;
  RETURN jsonb_build_object('saved', true, 'connected', public.are_connected(uid, _target));
END $$;

CREATE OR REPLACE FUNCTION public.update_my_contact(
  _target uuid, _alias text DEFAULT NULL, _note text DEFAULT NULL,
  _starred boolean DEFAULT NULL, _is_favorite boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target IS NULL THEN RAISE EXCEPTION 'invalid_target'; END IF;
  UPDATE public.contacts
     SET alias = CASE WHEN _alias IS NULL THEN alias
                      ELSE nullif(btrim(regexp_replace(_alias, '[[:cntrl:]]', ' ', 'g')), '') END,
         note = CASE WHEN _note IS NULL THEN note
                     ELSE left(btrim(regexp_replace(_note, '[[:cntrl:]]', ' ', 'g')), 500) END,
         starred = coalesce(_starred, starred),
         is_favorite = coalesce(_is_favorite, is_favorite),
         updated_at = now()
   WHERE owner_id = uid AND contact_id = _target;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'contact_not_found'; END IF;
  RETURN jsonb_build_object('updated', n);
END $$;

-- B9/B12. send_contact_request + search_profile_by_pin dengan lock
CREATE OR REPLACE FUNCTION public.send_contact_request(_target uuid, _message text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); msg text; existing public.contact_requests; recent int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target IS NULL OR _target = uid THEN RAISE EXCEPTION 'invalid_target'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN RAISE EXCEPTION 'invalid_target'; END IF;

  PERFORM public.lock_contact_pair(uid, _target);

  IF EXISTS (
    SELECT 1 FROM public.contacts b
    WHERE b.is_blocked
      AND ((b.owner_id = _target AND b.contact_id = uid) OR (b.owner_id = uid AND b.contact_id = _target))
  ) THEN RAISE EXCEPTION 'blocked'; END IF;

  IF public.are_connected(uid, _target) THEN RAISE EXCEPTION 'already_connected'; END IF;

  SELECT count(*) INTO recent FROM public.contact_requests
   WHERE requester_id = uid AND created_at > now() - interval '1 minute';
  IF recent >= 5 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  msg := btrim(coalesce(_message, ''));
  msg := regexp_replace(msg, '[[:cntrl:]]', ' ', 'g');
  IF length(msg) > 200 THEN msg := substr(msg, 1, 200); END IF;

  SELECT * INTO existing FROM public.contact_requests
   WHERE least(requester_id,target_id) = least(uid,_target)
     AND greatest(requester_id,target_id) = greatest(uid,_target)
   FOR UPDATE;

  IF existing.id IS NOT NULL THEN
    IF existing.status = 'blocked' THEN RAISE EXCEPTION 'blocked'; END IF;
    IF existing.status = 'pending' THEN
      IF existing.requester_id = uid THEN
        RETURN jsonb_build_object('status','pending','code','already_pending');
      END IF;
      RETURN jsonb_build_object('status','pending','code','incoming_pending');
    END IF;
    IF existing.status = 'accepted' THEN RAISE EXCEPTION 'already_connected'; END IF;
    IF existing.updated_at > now() - interval '10 minutes' THEN RAISE EXCEPTION 'cooldown'; END IF;
    UPDATE public.contact_requests
       SET requester_id = uid, target_id = _target, status = 'pending',
           message = msg, updated_at = now()
     WHERE id = existing.id;
    RETURN jsonb_build_object('status','pending','code','resent');
  END IF;

  INSERT INTO public.contact_requests (requester_id, target_id, message, status)
  VALUES (uid, _target, msg, 'pending');
  RETURN jsonb_build_object('status','pending','code','sent');
END $$;

CREATE OR REPLACE FUNCTION public.cancel_contact_request(_target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _target IS NULL THEN RAISE EXCEPTION 'invalid_target'; END IF;
  PERFORM public.lock_contact_pair(uid, _target);
  UPDATE public.contact_requests
     SET status = 'cancelled', updated_at = now()
   WHERE requester_id = uid AND target_id = _target AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('cancelled', n);
END $$;

CREATE OR REPLACE FUNCTION public.search_profile_by_pin(_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); norm text; recent int; found public.profiles;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  norm := upper(regexp_replace(coalesce(_pin,''), '[^0-9A-Za-z]', '', 'g'));
  IF length(norm) = 8 THEN norm := substr(norm,1,4) || '-' || substr(norm,5,4); END IF;
  IF norm !~ '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$' THEN RAISE EXCEPTION 'invalid_pin_format'; END IF;

  -- serialisasi per pengguna: count + insert tidak bisa dilewati paralel
  PERFORM pg_advisory_xact_lock(hashtextextended('pin_search:' || uid::text, 0));

  SELECT count(*) INTO recent FROM public.pin_search_log
   WHERE user_id = uid AND created_at > now() - interval '1 minute';
  IF recent >= 5 THEN RAISE EXCEPTION 'rate_limited'; END IF;
  SELECT count(*) INTO recent FROM public.pin_search_log
   WHERE user_id = uid AND created_at > now() - interval '10 minutes';
  IF recent >= 30 THEN RAISE EXCEPTION 'rate_limited_cooldown'; END IF;

  INSERT INTO public.pin_search_log (user_id, pin) VALUES (uid, norm);

  SELECT * INTO found FROM public.profiles p WHERE p.pin = norm;
  IF found.id IS NULL OR found.id = uid THEN
    RETURN jsonb_build_object('found', false,
      'code', CASE WHEN found.id = uid THEN 'self_pin' ELSE 'not_found' END);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.contacts b
    WHERE b.is_blocked
      AND ((b.owner_id = found.id AND b.contact_id = uid) OR (b.owner_id = uid AND b.contact_id = found.id))
  ) THEN
    RETURN jsonb_build_object('found', false, 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object('found', true, 'code', 'ok', 'profile', jsonb_build_object(
    'id', found.id,
    'display_name', found.display_name,
    'avatar_color', found.avatar_color,
    'avatar_version', found.avatar_version,
    'avatar_url', CASE WHEN public.can_view_avatar(found.id, uid) THEN found.avatar_url ELSE NULL END
  ));
END $$;

-- D17/D18. Least privilege
DROP POLICY IF EXISTS "own contacts delete" ON public.contacts;
DROP POLICY IF EXISTS "own search log" ON public.pin_search_log;

REVOKE ALL ON TABLE public.profiles, public.contacts, public.contact_requests,
  public.pin_search_log, public.contact_connections FROM authenticated, anon, PUBLIC;

GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.contacts TO authenticated;
GRANT SELECT ON public.contact_requests TO authenticated;
GRANT SELECT ON public.contact_connections TO authenticated;
GRANT ALL ON public.profiles, public.contacts, public.contact_requests,
  public.pin_search_log, public.contact_connections TO service_role;

-- D20. ACL RPC client-facing
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.search_profile_by_pin(text)',
    'public.send_contact_request(uuid,text)',
    'public.respond_contact_request(uuid,contact_request_status)',
    'public.cancel_contact_request(uuid)',
    'public.set_contact_blocked(uuid,boolean)',
    'public.save_contact_card(uuid,text,text)',
    'public.update_my_contact(uuid,text,text,boolean,boolean)',
    'public.remove_saved_contact(uuid)',
    'public.disconnect_contact(uuid)',
    'public.contact_relation(uuid)',
    'public.my_connected_contacts()',
    'public.pins_for_me(uuid[])',
    'public.profile_cards(uuid[])',
    'public.profile_full(uuid)',
    'public.can_view_full_profile(uuid)',
    'public.can_view_avatar(uuid,uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.can_view_full_profile(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_full_profile(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.can_view_avatar(uuid,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_avatar(uuid,uuid) TO service_role;