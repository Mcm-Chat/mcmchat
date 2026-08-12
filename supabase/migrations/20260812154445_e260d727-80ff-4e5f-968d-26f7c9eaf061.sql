REVOKE EXECUTE ON FUNCTION public.can_read_status_object(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_view_status(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.status_owner_of(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.expire_stale_calls() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_entitlement(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.my_pin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pins_for_me(uuid[]) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.can_read_status_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_status(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.status_owner_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_calls() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_entitlement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_pin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pins_for_me(uuid[]) TO authenticated;