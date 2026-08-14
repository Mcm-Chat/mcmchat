CREATE OR REPLACE FUNCTION public.claim_legacy_direct_conversation(_conversation uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  _type conversation_type;
  _other uuid; _lo uuid; _hi uuid;
  _req public.contact_requests;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT c.type INTO _type FROM public.conversations c WHERE c.id = _conversation;
  IF _type IS DISTINCT FROM 'direct' THEN RAISE EXCEPTION 'invalid_conversation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_members m
                  WHERE m.conversation_id = _conversation AND m.user_id = uid) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT m.user_id INTO _other FROM public.conversation_members m
   WHERE m.conversation_id = _conversation AND m.user_id <> uid LIMIT 1;
  IF _other IS NULL OR _other = uid THEN RAISE EXCEPTION 'invalid_conversation'; END IF;

  _lo := least(uid, _other); _hi := greatest(uid, _other);
  PERFORM public.lock_contact_pair(_lo, _hi);

  IF EXISTS (SELECT 1 FROM public.contacts b
              WHERE b.is_blocked
                AND ((b.owner_id = uid AND b.contact_id = _other)
                  OR (b.owner_id = _other AND b.contact_id = uid))) THEN
    RAISE EXCEPTION 'blocked';
  END IF;
  IF public.are_connected(uid, _other) THEN
    RETURN jsonb_build_object('status','connected','code','already_connected');
  END IF;

  SELECT * INTO _req FROM public.contact_requests
   WHERE least(requester_id,target_id) = _lo AND greatest(requester_id,target_id) = _hi
   FOR UPDATE;

  -- Permintaan yang masih menunggu dilaporkan APA ADANYA. Arah tidak pernah
  -- dibalik: pemohon yang menunggu jawaban tidak boleh berubah menjadi
  -- penerima permintaan hanya karena membuka layar percakapan.
  IF _req.id IS NOT NULL AND _req.status = 'pending' THEN
    RETURN jsonb_build_object(
      'status','pending','code','already_pending','request_id',_req.id,
      'direction', CASE WHEN _req.target_id = uid THEN 'incoming' ELSE 'outgoing' END);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.conversation_id = _conversation AND m.sender_id = _other) THEN
    RAISE EXCEPTION 'no_incoming_messages';
  END IF;

  IF _req.id IS NOT NULL THEN
    IF _req.status = 'blocked' THEN RAISE EXCEPTION 'blocked'; END IF;

    IF _req.status = 'rejected' AND _req.requester_id = uid THEN
      RETURN jsonb_build_object('status','rejected','code','rejected_by_other',
                                'request_id',_req.id,
                                'retry_at', _req.updated_at + interval '24 hours');
    END IF;

    IF _req.updated_at > now() - interval '1 hour' THEN
      RETURN jsonb_build_object('status', _req.status::text, 'code','cooldown',
                                'request_id',_req.id,
                                'retry_at', _req.updated_at + interval '1 hour');
    END IF;

    UPDATE public.contact_requests
       SET requester_id = _other, target_id = uid, status = 'pending',
           message = '', updated_at = now()
     WHERE id = _req.id
     RETURNING * INTO _req;
    RETURN jsonb_build_object('status','pending','code','reused',
                              'request_id',_req.id,'direction','incoming');
  END IF;

  INSERT INTO public.contact_requests (requester_id, target_id, message, status)
  VALUES (_other, uid, '', 'pending')
  RETURNING * INTO _req;

  RETURN jsonb_build_object('status','pending','code','created',
                            'request_id',_req.id,'direction','incoming');
END
$$;