ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_id text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_client_dedupe_idx
  ON public.messages (conversation_id, sender_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_conv_created_id_idx
  ON public.messages (conversation_id, created_at DESC, id DESC);