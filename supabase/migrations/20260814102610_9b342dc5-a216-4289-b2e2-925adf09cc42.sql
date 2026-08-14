CREATE OR REPLACE FUNCTION public.revoke_notification_actions(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n integer;
BEGIN
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.notification_actions
   WHERE id = ANY(_ids) AND used_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.revoke_notification_actions(uuid[]) FROM PUBLIC, anon, authenticated;