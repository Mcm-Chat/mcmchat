CREATE OR REPLACE FUNCTION public.vsu_no_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Penghapusan berantai (cascade) dari induk, mis. hapus akun/bisnis/produk,
  -- berjalan pada kedalaman trigger > 1 dan harus tetap diizinkan.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Unit yang pernah dialokasikan tidak boleh dihapus permanen';
  END IF;
  RETURN OLD;
END;
$$;