DROP POLICY IF EXISTS "add participant" ON public.call_participants;

CREATE POLICY "add participant" ON public.call_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.id = call_participants.call_id
        AND c.initiator_id = auth.uid()
        AND c.conversation_id IS NOT NULL
        AND public.is_conv_member(c.conversation_id, call_participants.user_id)
    )
  );