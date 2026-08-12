-- Mark all incoming messages in a conversation as delivered for the current user.
CREATE OR REPLACE FUNCTION public.mark_messages_delivered(_conv uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _n integer := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_conv_member(_conv, _uid) THEN
    RETURN 0;
  END IF;

  WITH ins AS (
    INSERT INTO public.message_receipts (message_id, user_id, delivered_at)
    SELECT m.id, _uid, now()
    FROM public.messages m
    WHERE m.conversation_id = _conv
      AND m.sender_id <> _uid
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET delivered_at = COALESCE(public.message_receipts.delivered_at, now())
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  RETURN _n;
END;
$$;

-- Mark all incoming messages in a conversation as read (and delivered) for the
-- current user. Honours the privacy setting: when read receipts are disabled we
-- still record delivery, but never expose read_at to the sender.
CREATE OR REPLACE FUNCTION public.mark_messages_read(_conv uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _allow boolean := true;
  _n integer := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_conv_member(_conv, _uid) THEN
    RETURN 0;
  END IF;

  SELECT COALESCE((s.privacy ->> 'readReceipts')::boolean, true)
    INTO _allow
  FROM public.user_settings s
  WHERE s.user_id = _uid;
  _allow := COALESCE(_allow, true);

  WITH ins AS (
    INSERT INTO public.message_receipts (message_id, user_id, delivered_at, read_at)
    SELECT m.id, _uid, now(), CASE WHEN _allow THEN now() ELSE NULL END
    FROM public.messages m
    WHERE m.conversation_id = _conv
      AND m.sender_id <> _uid
    ON CONFLICT (message_id, user_id) DO UPDATE
      SET delivered_at = COALESCE(public.message_receipts.delivered_at, now()),
          read_at = CASE WHEN _allow THEN COALESCE(public.message_receipts.read_at, now())
                         ELSE public.message_receipts.read_at END
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM ins;

  UPDATE public.conversation_members
     SET last_read_at = now()
   WHERE conversation_id = _conv AND user_id = _uid;

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_delivered(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_messages_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_delivered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO authenticated;

-- Realtime for membership + presence-ish profile updates.
ALTER TABLE public.conversation_members REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;