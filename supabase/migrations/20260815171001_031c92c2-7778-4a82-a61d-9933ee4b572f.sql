ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS photo_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_label text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.record_purchase(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_variant public.product_variants%ROWTYPE;
  pr public.products%ROWTYPE;
  v_qty numeric(18,6);
  v_purchase_id uuid;
  v_variant_id uuid := nullif(_payload->>'variant_id','')::uuid;
  v_product_id uuid := nullif(_payload->>'product_id','')::uuid;
  v_loc text := COALESCE(_payload->>'location_url','');
BEGIN
  IF v_variant_id IS NOT NULL THEN
    SELECT * INTO v_variant FROM public.product_variants WHERE id = v_variant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
    v_product_id := v_variant.product_id;
  END IF;

  SELECT * INTO pr FROM public.products WHERE id = v_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gudang tidak ditemukan'; END IF;
  IF NOT public.current_user_can_manage_business(pr.business_id) THEN
    RAISE EXCEPTION 'Tidak berhak mencatat pembelian';
  END IF;

  v_qty := (_payload->>'qty_base')::numeric;
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembelian harus lebih dari nol';
  END IF;

  IF v_loc <> '' AND v_loc !~* '^https://' THEN
    RAISE EXCEPTION 'Link lokasi harus https';
  END IF;

  INSERT INTO public.purchases (
    business_id, product_id, variant_id, supplier_name, supplier_contact,
    qty_base, display_qty, display_unit, unit_cost, total_cost, note, purchased_at, created_by,
    photo_path, location_url, location_label
  ) VALUES (
    pr.business_id, pr.id, v_variant_id,
    COALESCE(_payload->>'supplier_name', ''),
    COALESCE(_payload->>'supplier_contact', ''),
    v_qty,
    COALESCE((_payload->>'display_qty')::numeric, 0),
    COALESCE(_payload->>'display_unit', pr.buy_unit),
    COALESCE((_payload->>'unit_cost')::numeric, 0),
    COALESCE((_payload->>'total_cost')::numeric, 0),
    COALESCE(_payload->>'note', ''),
    COALESCE((_payload->>'purchased_at')::timestamptz, now()),
    auth.uid(),
    COALESCE(_payload->>'photo_path', ''),
    v_loc,
    COALESCE(_payload->>'location_label', '')
  ) RETURNING id INTO v_purchase_id;

  PERFORM public.warehouse_apply(
    pr.id, v_qty, 'restock'::public.inventory_movement_type,
    COALESCE(_payload->>'note',''), v_variant_id, 'purchase', v_purchase_id, NULL
  );

  RETURN v_purchase_id;
END $function$;