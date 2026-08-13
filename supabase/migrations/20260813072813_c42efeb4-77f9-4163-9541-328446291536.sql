DROP POLICY IF EXISTS "member reads conversation" ON public.conversations;
CREATE POLICY "member reads conversation" ON public.conversations
FOR SELECT TO authenticated
USING (public.is_conv_member(id, auth.uid()) OR created_by = auth.uid());

DELETE FROM public.conversations c
WHERE NOT EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id);