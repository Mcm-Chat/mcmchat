-- Tabel-level SELECT membatalkan REVOKE kolom sebelumnya, sehingga setiap
-- anggota bisnis (termasuk 'viewer') masih bisa membaca staff_pin.
-- Cabut akses tabel penuh, lalu berikan hanya kolom aman.

REVOKE ALL ON public.business_members FROM anon;
REVOKE SELECT ON public.business_members FROM authenticated;

GRANT SELECT (
  id, business_id, user_id, role, staff_display_name,
  staff_pin_confirmed_at, created_at, updated_at
) ON public.business_members TO authenticated;

-- Penulisan tetap lewat RLS yang sudah ada.
GRANT INSERT, UPDATE, DELETE ON public.business_members TO authenticated;
GRANT ALL ON public.business_members TO service_role;
