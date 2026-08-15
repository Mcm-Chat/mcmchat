CREATE TABLE public.call_reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  peer_id UUID,
  peer_name TEXT,
  note TEXT,
  remind_at TIMESTAMPTZ NOT NULL,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_reminders_user_due_idx ON public.call_reminders (user_id, done_at, remind_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_reminders TO authenticated;
GRANT ALL ON public.call_reminders TO service_role;

ALTER TABLE public.call_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "call_reminders_select_own" ON public.call_reminders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "call_reminders_insert_own" ON public.call_reminders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "call_reminders_update_own" ON public.call_reminders
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "call_reminders_delete_own" ON public.call_reminders
  FOR DELETE TO authenticated USING (user_id = auth.uid());