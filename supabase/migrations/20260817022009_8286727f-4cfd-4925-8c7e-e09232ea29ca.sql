-- 1) Explicit deny-by-default policies for locked internal tables (no grants exist; RPC-only access)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['background_action_log','device_action_rate','devices','notification_actions','pin_search_log','profiles'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "no_direct_client_access" ON public.%I', t);
    EXECUTE format('CREATE POLICY "no_direct_client_access" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;

-- 2) Revoke anonymous EXECUTE on SECURITY DEFINER functions that require an authenticated actor
REVOKE ALL ON FUNCTION public.adjust_warehouse(uuid, numeric, inventory_movement_type, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_warehouse(uuid, numeric, inventory_movement_type, text) TO authenticated;

REVOKE ALL ON FUNCTION public.catalog_product_indicators(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_product_indicators(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.record_purchase(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_purchase(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.rename_product_category(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_product_category(uuid, text, text) TO authenticated;

-- Trigger-only function: no client should ever call it directly
REVOKE ALL ON FUNCTION public.ensure_product_stock_balance() FROM PUBLIC, anon, authenticated;