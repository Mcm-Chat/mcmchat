REVOKE ALL ON TABLE public.variant_stock_units FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.chat_orders FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.chat_order_items FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.chat_order_unit_slots FROM anon, authenticated, PUBLIC;

GRANT SELECT ON public.variant_stock_units TO authenticated;
GRANT SELECT ON public.chat_orders TO authenticated;
GRANT SELECT ON public.chat_order_items TO authenticated;
GRANT SELECT ON public.chat_order_unit_slots TO authenticated;

GRANT ALL ON public.variant_stock_units TO service_role;
GRANT ALL ON public.chat_orders TO service_role;
GRANT ALL ON public.chat_order_items TO service_role;
GRANT ALL ON public.chat_order_unit_slots TO service_role;

REVOKE ALL ON SEQUENCE public.pin_search_log_id_seq FROM anon, authenticated, PUBLIC;
GRANT ALL ON SEQUENCE public.pin_search_log_id_seq TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_business_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_can_read_chat_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_read_chat_order(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.current_user_is_business_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_business_member(uuid) TO authenticated, service_role;