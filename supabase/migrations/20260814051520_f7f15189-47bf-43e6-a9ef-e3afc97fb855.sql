DROP POLICY "stock units readable" ON public.variant_stock_units;
CREATE POLICY "stock units readable" ON public.variant_stock_units
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_business_member(business_id)
    OR (customer_user_id = auth.uid() AND status = 'delivered'::public.stock_unit_status)
  );

DROP POLICY "chat orders readable" ON public.chat_orders;
CREATE POLICY "chat orders readable" ON public.chat_orders
  FOR SELECT TO authenticated
  USING (
    buyer_user_id = auth.uid()
    OR created_by = auth.uid()
    OR public.current_user_is_business_member(business_id)
  );