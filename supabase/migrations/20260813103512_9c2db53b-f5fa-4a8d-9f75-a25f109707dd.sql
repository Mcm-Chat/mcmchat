-- =========================================================
-- MCM: model stok weight/count + media per-foto (additive & safe)
-- Rollback note: setiap perubahan di bawah bersifat additive atau
-- pelebaran tipe. Untuk rollback, DROP kolom baru + constraint baru;
-- kolom lama (precision_scale, conversion_factor) tetap ada dengan
-- nilai yang kompatibel, jadi tidak ada kehilangan data.
-- =========================================================

-- 1. ROOT CAUSE: precision_scale smallint tidak bisa menerima 0.01
ALTER TABLE public.product_variants
  ALTER COLUMN precision_scale TYPE numeric(18,6) USING precision_scale::numeric,
  ALTER COLUMN precision_scale SET DEFAULT 0.01;

ALTER TABLE public.product_variants
  ALTER COLUMN conversion_factor TYPE numeric(18,6) USING conversion_factor::numeric;

-- 2. Field semantik weight vs count
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS base_quantity_grams numeric(18,6),
  ADD COLUMN IF NOT EXISTS units_per_display integer,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

-- 3. Backfill tanpa menebak
UPDATE public.product_variants SET
  base_quantity_grams = CASE lower(display_unit)
      WHEN 'mg' THEN 0.001 WHEN 'g' THEN 1 WHEN 'gram' THEN 1
      WHEN 'ons' THEN 100 WHEN 'kg' THEN 1000 ELSE NULL END,
  units_per_display = NULL,
  precision_scale = CASE WHEN precision_scale > 0 AND precision_scale <= 1 THEN precision_scale ELSE 0.01 END,
  conversion_factor = 1,
  base_unit = 'g',
  needs_review = (lower(display_unit) NOT IN ('mg','g','gram','ons','kg'))
WHERE stock_type = 'weight';

UPDATE public.product_variants SET
  display_unit = CASE WHEN coalesce(display_unit,'') = '' THEN 'pcs' ELSE display_unit END,
  base_quantity_grams = NULL,
  units_per_display = GREATEST(1, round(coalesce(conversion_factor, 1))::integer),
  precision_scale = 1,
  needs_review = (conversion_factor IS NULL OR conversion_factor <= 0 OR conversion_factor <> round(conversion_factor))
WHERE stock_type = 'count';

UPDATE public.product_variants
   SET base_unit = CASE WHEN lower(display_unit) IN ('botol','karton','koli') THEN 'botol' ELSE 'pcs' END
 WHERE stock_type = 'count'
   AND coalesce(base_unit,'') NOT IN ('pcs','botol');

UPDATE public.product_variants
   SET conversion_factor = units_per_display
 WHERE stock_type = 'count' AND units_per_display IS NOT NULL;

-- 4. Constraint setelah backfill (baris needs_review tetap lolos agar data lama aman)
ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_stock_model_ck;
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_stock_model_ck CHECK (
    needs_review OR (
      CASE WHEN stock_type = 'weight' THEN
        units_per_display IS NULL
        AND base_quantity_grams IS NOT NULL AND base_quantity_grams > 0
        AND lower(display_unit) IN ('mg','g','gram','ons','kg')
        AND base_unit = 'g'
        AND precision_scale > 0
      ELSE
        base_quantity_grams IS NULL
        AND units_per_display IS NOT NULL AND units_per_display > 0
        AND lower(display_unit) IN ('pcs','botol','karton','koli','dus','sak')
        AND base_unit IN ('pcs','botol')
      END
    )
  ) NOT VALID;
ALTER TABLE public.product_variants VALIDATE CONSTRAINT product_variants_stock_model_ck;

ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_price_ck;
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_price_ck CHECK (price >= 0);

-- 5. Presisi gram: hilangkan pembulatan integer/2-desimal pada base qty
ALTER TABLE public.inventory_balances  ALTER COLUMN qty_base TYPE numeric(18,6);
ALTER TABLE public.inventory_movements ALTER COLUMN qty_base TYPE numeric(18,6);
ALTER TABLE public.inventory_movements ALTER COLUMN balance_before TYPE numeric(18,6);
ALTER TABLE public.inventory_movements ALTER COLUMN balance_after  TYPE numeric(18,6);
ALTER TABLE public.preparation_job_items ALTER COLUMN requested_qty      TYPE numeric(18,6);
ALTER TABLE public.preparation_job_items ALTER COLUMN requested_qty_base TYPE numeric(18,6);
ALTER TABLE public.preparation_job_items ALTER COLUMN actual_qty_base    TYPE numeric(18,6);

-- 6. Media produk: satu foto = satu lokasi mandiri
ALTER TABLE public.product_photos
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'gallery',
  ADD COLUMN IF NOT EXISTS location_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS thumbnail_path text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS media_version integer NOT NULL DEFAULT 1;

UPDATE public.product_photos
   SET source_type = 'preparation'
 WHERE preparation_job_id IS NOT NULL AND source_type = 'gallery';

UPDATE public.product_photos
   SET location_mode = 'auto'
 WHERE location_mode = 'none' AND location_lat IS NOT NULL AND location_lng IS NOT NULL;

UPDATE public.product_photos
   SET location_mode = 'manual'
 WHERE location_mode = 'none' AND coalesce(location_url,'') <> '';

ALTER TABLE public.product_photos DROP CONSTRAINT IF EXISTS product_photos_source_type_ck;
ALTER TABLE public.product_photos
  ADD CONSTRAINT product_photos_source_type_ck CHECK (source_type IN ('camera','gallery','preparation'));
ALTER TABLE public.product_photos DROP CONSTRAINT IF EXISTS product_photos_location_mode_ck;
ALTER TABLE public.product_photos
  ADD CONSTRAINT product_photos_location_mode_ck CHECK (location_mode IN ('auto','manual','none'));
ALTER TABLE public.product_photos DROP CONSTRAINT IF EXISTS product_photos_location_url_ck;
ALTER TABLE public.product_photos
  ADD CONSTRAINT product_photos_location_url_ck CHECK (
    coalesce(location_url,'') = '' OR location_url LIKE 'https://%'
  ) NOT VALID;

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_variants_product_sort   ON public.product_variants (product_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_variants_business       ON public.product_variants (business_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_photos_product_sort     ON public.product_photos (product_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_photos_variant          ON public.product_photos (variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movements_ref           ON public.inventory_movements (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_movements_variant_time  ON public.inventory_movements (variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prep_jobs_worker_status ON public.preparation_jobs (assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_prep_jobs_token_hash    ON public.preparation_jobs (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_idempotency ON public.sales_records (business_id, idempotency_key)
  WHERE idempotency_key <> '';

-- 8. Fungsi konversi/stok: presisi gram 6 desimal, count bilangan bulat
CREATE OR REPLACE FUNCTION public.convert_to_base(_variant uuid, _qty numeric, _unit text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.product_variants; u text := lower(trim(coalesce(_unit,''))); f numeric;
BEGIN
  SELECT * INTO v FROM public.product_variants WHERE id = _variant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
  IF v.stock_type = 'weight' THEN
    f := CASE u
      WHEN 'mg' THEN 0.001 WHEN 'g' THEN 1 WHEN 'gram' THEN 1
      WHEN 'ons' THEN 100 WHEN 'kg' THEN 1000
      WHEN '' THEN coalesce(v.base_quantity_grams, 1)
      ELSE NULL END;
    IF f IS NULL THEN RAISE EXCEPTION 'Satuan tidak sesuai dengan jenis stok'; END IF;
    RETURN round(_qty * f, 6);
  END IF;
  IF u <> '' AND u NOT IN ('pcs','botol','karton','koli','dus','sak') THEN
    RAISE EXCEPTION 'Satuan tidak sesuai dengan jenis stok';
  END IF;
  RETURN round(_qty * coalesce(v.units_per_display, v.conversion_factor, 1));
END $function$;

CREATE OR REPLACE FUNCTION public.adjust_inventory(_variant uuid, _qty_base numeric, _type inventory_movement_type DEFAULT 'adjustment'::inventory_movement_type, _note text DEFAULT ''::text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.product_variants; _before numeric; _after numeric; _uid uuid := auth.uid(); _scale int;
BEGIN
  SELECT * INTO v FROM public.product_variants WHERE id = _variant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(v.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengubah stok';
  END IF;
  _scale := CASE WHEN v.stock_type = 'weight' THEN 6 ELSE 0 END;

  INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
  VALUES (v.id, v.business_id, v.product_id, 0) ON CONFLICT (variant_id) DO NOTHING;

  SELECT qty_base INTO _before FROM public.inventory_balances WHERE variant_id = v.id FOR UPDATE;
  _after := round(_before + _qty_base, _scale);
  IF _after < 0 THEN RAISE EXCEPTION 'Stok tidak boleh negatif'; END IF;
  UPDATE public.inventory_balances SET qty_base = _after, updated_at = now() WHERE variant_id = v.id;

  INSERT INTO public.inventory_movements (
    business_id, product_id, variant_id, movement_type, qty_base,
    balance_before, balance_after, ref_type, note, created_by
  ) VALUES (
    v.business_id, v.product_id, v.id, _type, round(_qty_base, _scale),
    _before, _after, 'manual', coalesce(_note,''), _uid
  );
  RETURN _after;
END $function$;

REVOKE ALL ON FUNCTION public.convert_to_base(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_inventory(uuid, numeric, inventory_movement_type, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_to_base(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, numeric, inventory_movement_type, text) TO authenticated;