-- Realtime tidak boleh menyiarkan rahasia penyiapan (PIN pengiriman & hash token).
-- Column list publikasi tidak diizinkan bila replica identity FULL, jadi kembalikan
-- ke DEFAULT (kunci utama) lalu daftarkan ulang dengan daftar kolom aman.
ALTER TABLE public.preparation_jobs REPLICA IDENTITY DEFAULT;

ALTER PUBLICATION supabase_realtime DROP TABLE public.preparation_jobs;

ALTER PUBLICATION supabase_realtime ADD TABLE public.preparation_jobs
  (id, business_id, code, conversation_id, customer_id, customer_user_id,
   customer_name, order_id, assigned_user_id, status, notes, token_prefix,
   expires_at, revoked_at, opened_at, completed_at, created_by, created_at,
   updated_at, delivered_at, delivered_message_id, chat_order_id);