DROP POLICY IF EXISTS "read customers" ON public.customers;
CREATE POLICY "read customers" ON public.customers FOR SELECT TO authenticated
  USING (current_user_is_business_member(business_id));

DROP POLICY IF EXISTS "update customers" ON public.customers;
CREATE POLICY "update customers" ON public.customers FOR UPDATE TO authenticated
  USING (current_user_can_sell_business(business_id))
  WITH CHECK (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "write customers" ON public.customers;
CREATE POLICY "write customers" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "balances managed by business admins" ON public.inventory_balances;
CREATE POLICY "balances managed by business admins" ON public.inventory_balances FOR ALL TO authenticated
  USING (current_user_can_manage_business(business_id))
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "balances readable by business members" ON public.inventory_balances;
CREATE POLICY "balances readable by business members" ON public.inventory_balances FOR SELECT TO authenticated
  USING (current_user_is_business_member(business_id));

DROP POLICY IF EXISTS "movements readable by business members" ON public.inventory_movements;
CREATE POLICY "movements readable by business members" ON public.inventory_movements FOR SELECT TO authenticated
  USING (current_user_is_business_member(business_id));

DROP POLICY IF EXISTS "delete order items" ON public.order_items;
CREATE POLICY "delete order items" ON public.order_items FOR DELETE TO authenticated
  USING (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "read order items" ON public.order_items;
CREATE POLICY "read order items" ON public.order_items FOR SELECT TO authenticated
  USING ((current_user_is_business_member(business_id) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.buyer_user_id = auth.uid()))))));

DROP POLICY IF EXISTS "update order items" ON public.order_items;
CREATE POLICY "update order items" ON public.order_items FOR UPDATE TO authenticated
  USING (current_user_can_sell_business(business_id))
  WITH CHECK (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "write order items" ON public.order_items;
CREATE POLICY "write order items" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "delete orders" ON public.orders;
CREATE POLICY "delete orders" ON public.orders FOR DELETE TO authenticated
  USING (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "read orders" ON public.orders;
CREATE POLICY "read orders" ON public.orders FOR SELECT TO authenticated
  USING ((current_user_is_business_member(business_id) OR (buyer_user_id = auth.uid())));

DROP POLICY IF EXISTS "update orders" ON public.orders;
CREATE POLICY "update orders" ON public.orders FOR UPDATE TO authenticated
  USING (current_user_can_sell_business(business_id))
  WITH CHECK (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "write orders" ON public.orders;
CREATE POLICY "write orders" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "prep items managed by job admins" ON public.preparation_job_items;
CREATE POLICY "prep items managed by job admins" ON public.preparation_job_items FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM preparation_jobs j
  WHERE ((j.id = preparation_job_items.job_id) AND current_user_can_manage_business(j.business_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM preparation_jobs j
  WHERE ((j.id = preparation_job_items.job_id) AND current_user_can_manage_business(j.business_id)))));

DROP POLICY IF EXISTS "jobs inserted by business admins" ON public.preparation_jobs;
CREATE POLICY "jobs inserted by business admins" ON public.preparation_jobs FOR INSERT TO authenticated
  WITH CHECK ((current_user_can_manage_business(business_id) AND (created_by = auth.uid())));

DROP POLICY IF EXISTS "jobs readable by admins and assignee" ON public.preparation_jobs;
CREATE POLICY "jobs readable by admins and assignee" ON public.preparation_jobs FOR SELECT TO authenticated
  USING ((current_user_can_manage_business(business_id) OR (assigned_user_id = auth.uid())));

DROP POLICY IF EXISTS "jobs updated by business admins" ON public.preparation_jobs;
CREATE POLICY "jobs updated by business admins" ON public.preparation_jobs FOR UPDATE TO authenticated
  USING (current_user_can_manage_business(business_id))
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "delete product photos" ON public.product_photos;
CREATE POLICY "delete product photos" ON public.product_photos FOR DELETE TO authenticated
  USING (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "insert product photos" ON public.product_photos;
CREATE POLICY "insert product photos" ON public.product_photos FOR INSERT TO authenticated
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "read product photos" ON public.product_photos;
CREATE POLICY "read product photos" ON public.product_photos FOR SELECT TO authenticated
  USING ((current_user_is_business_member(business_id) OR (EXISTS ( SELECT 1
   FROM (products p
     JOIN businesses b ON ((b.id = p.business_id)))
  WHERE ((p.id = product_photos.product_id) AND p.is_active AND b.is_public)))));

DROP POLICY IF EXISTS "update product photos" ON public.product_photos;
CREATE POLICY "update product photos" ON public.product_photos FOR UPDATE TO authenticated
  USING (current_user_can_manage_business(business_id))
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "variants managed by business admins" ON public.product_variants;
CREATE POLICY "variants managed by business admins" ON public.product_variants FOR ALL TO authenticated
  USING (current_user_can_manage_business(business_id))
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "variants readable by business members" ON public.product_variants;
CREATE POLICY "variants readable by business members" ON public.product_variants FOR SELECT TO authenticated
  USING (current_user_is_business_member(business_id));

DROP POLICY IF EXISTS "delete products" ON public.products;
CREATE POLICY "delete products" ON public.products FOR DELETE TO authenticated
  USING (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "manage products" ON public.products;
CREATE POLICY "manage products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "read products" ON public.products;
CREATE POLICY "read products" ON public.products FOR SELECT TO authenticated
  USING ((current_user_is_business_member(business_id) OR (is_active AND (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = products.business_id) AND b.is_public))))));

DROP POLICY IF EXISTS "update products" ON public.products;
CREATE POLICY "update products" ON public.products FOR UPDATE TO authenticated
  USING (current_user_can_manage_business(business_id))
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "delete quick replies" ON public.quick_replies;
CREATE POLICY "delete quick replies" ON public.quick_replies FOR DELETE TO authenticated
  USING (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "read quick replies" ON public.quick_replies;
CREATE POLICY "read quick replies" ON public.quick_replies FOR SELECT TO authenticated
  USING (current_user_is_business_member(business_id));

DROP POLICY IF EXISTS "update quick replies" ON public.quick_replies;
CREATE POLICY "update quick replies" ON public.quick_replies FOR UPDATE TO authenticated
  USING (current_user_can_manage_business(business_id))
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "write quick replies" ON public.quick_replies;
CREATE POLICY "write quick replies" ON public.quick_replies FOR INSERT TO authenticated
  WITH CHECK (current_user_can_manage_business(business_id));

DROP POLICY IF EXISTS "read sales" ON public.sales_records;
CREATE POLICY "read sales" ON public.sales_records FOR SELECT TO authenticated
  USING ((current_user_is_business_member(business_id) OR (customer_user_id = auth.uid())));

DROP POLICY IF EXISTS "update sales" ON public.sales_records;
CREATE POLICY "update sales" ON public.sales_records FOR UPDATE TO authenticated
  USING (current_user_can_sell_business(business_id))
  WITH CHECK (current_user_can_sell_business(business_id));

DROP POLICY IF EXISTS "write sales" ON public.sales_records;
CREATE POLICY "write sales" ON public.sales_records FOR INSERT TO authenticated
  WITH CHECK (((seller_id = auth.uid()) AND current_user_can_sell_business(business_id)));

-- ---------- Policy percakapan & pesan: pakai kapabilitas ----------
DROP POLICY IF EXISTS "member reads conversation" ON public.conversations;
CREATE POLICY "member reads conversation" ON public.conversations FOR SELECT TO authenticated
  USING (public.current_user_can_read_conversation(id));

DROP POLICY IF EXISTS "member reads members" ON public.conversation_members;
CREATE POLICY "member reads members" ON public.conversation_members FOR SELECT TO authenticated
  USING (public.current_user_can_read_conversation(conversation_id));

DROP POLICY IF EXISTS "member reads messages" ON public.messages;
CREATE POLICY "member reads messages" ON public.messages FOR SELECT TO authenticated
  USING (public.current_user_can_read_conversation(conversation_id));

DROP POLICY IF EXISTS "member sends messages" ON public.messages;
CREATE POLICY "member sends messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.current_user_can_send_conversation(conversation_id));

DROP POLICY IF EXISTS "sender edits messages" ON public.messages;
CREATE POLICY "sender edits messages" ON public.messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() AND public.current_user_can_send_conversation(conversation_id))
  WITH CHECK (sender_id = auth.uid() AND public.current_user_can_send_conversation(conversation_id));

DROP POLICY IF EXISTS "own hides" ON public.message_hides;
CREATE POLICY "own hides" ON public.message_hides FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own hides delete" ON public.message_hides;
CREATE POLICY "own hides delete" ON public.message_hides FOR DELETE TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own hides insert" ON public.message_hides;
CREATE POLICY "own hides insert" ON public.message_hides FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = message_hides.message_id
       AND public.current_user_can_read_conversation(m.conversation_id)));

DROP POLICY IF EXISTS "member reads reactions" ON public.message_reactions;
CREATE POLICY "member reads reactions" ON public.message_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.id = message_reactions.message_id
                    AND public.current_user_can_read_conversation(m.conversation_id)));
DROP POLICY IF EXISTS "own reaction insert" ON public.message_reactions;
CREATE POLICY "own reaction insert" ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = message_reactions.message_id
       AND public.current_user_can_send_conversation(m.conversation_id)));

DROP POLICY IF EXISTS "member reads receipts" ON public.message_receipts;
CREATE POLICY "member reads receipts" ON public.message_receipts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m
                  WHERE m.id = message_receipts.message_id
                    AND public.current_user_can_read_conversation(m.conversation_id)));
DROP POLICY IF EXISTS "own receipt insert" ON public.message_receipts;
CREATE POLICY "own receipt insert" ON public.message_receipts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = message_receipts.message_id
       AND public.current_user_can_read_conversation(m.conversation_id)));
DROP POLICY IF EXISTS "own receipt update" ON public.message_receipts;
CREATE POLICY "own receipt update" ON public.message_receipts FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = message_receipts.message_id
       AND public.current_user_can_read_conversation(m.conversation_id)));

DROP POLICY IF EXISTS "read business conversation registry" ON public.business_conversations;
CREATE POLICY "read business conversation registry" ON public.business_conversations
  FOR SELECT TO authenticated
  USING (public.current_user_can_read_conversation(conversation_id));

-- ---------- Storage ----------
DROP POLICY IF EXISTS "chat media read" ON storage.objects;
CREATE POLICY "chat media read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media'
         AND public.current_user_can_read_conversation(public.safe_uuid((storage.foldername(name))[1])));
DROP POLICY IF EXISTS "chat media insert" ON storage.objects;
CREATE POLICY "chat media insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media' AND owner = auth.uid()
              AND public.current_user_can_send_conversation(public.safe_uuid((storage.foldername(name))[1])));
DROP POLICY IF EXISTS "product photo read" ON storage.objects;
CREATE POLICY "product photo read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-photos'
         AND public.current_user_is_business_member(public.safe_uuid((storage.foldername(name))[1])));
DROP POLICY IF EXISTS "product photo insert" ON storage.objects;
CREATE POLICY "product photo insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-photos'
              AND public.current_user_can_manage_business(public.safe_uuid((storage.foldername(name))[1])));
DROP POLICY IF EXISTS "product photo update" ON storage.objects;
CREATE POLICY "product photo update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-photos'
         AND public.current_user_can_manage_business(public.safe_uuid((storage.foldername(name))[1])))
  WITH CHECK (bucket_id = 'product-photos'
              AND public.current_user_can_manage_business(public.safe_uuid((storage.foldername(name))[1])));
DROP POLICY IF EXISTS "product photo delete" ON storage.objects;
CREATE POLICY "product photo delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-photos'
         AND public.current_user_can_manage_business(public.safe_uuid((storage.foldername(name))[1])));

-- ---------- Helper arbitrary-user jadi INTERNAL ----------
REVOKE ALL ON FUNCTION public.can_manage_business(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_sell_business(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_business_member(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_role_of(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_business(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_sell_business(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.business_role_of(uuid,uuid) TO service_role;