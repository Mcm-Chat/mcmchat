DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND p.proname IN (
        'chat_order_actor_can_manage','chat_order_actor_can_read','convert_to_base',
        'create_chat_order','current_user_can_call_conversation','current_user_can_manage_chat_order',
        'current_user_can_manage_conversation','current_user_is_conv_member','i_am_connected_to',
        'is_conv_admin','is_conv_member','revoke_push_device','variant_display_factor',
        'variant_unit_quantity','claim_legacy_direct_conversation'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;