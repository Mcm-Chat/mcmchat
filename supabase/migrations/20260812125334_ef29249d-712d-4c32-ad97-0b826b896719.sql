REVOKE ALL ON FUNCTION public.convert_to_base(uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.convert_to_base(uuid, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_see_prep_job(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_see_prep_job(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM public, anon;

CREATE OR REPLACE FUNCTION public.adjust_inventory(
  _variant uuid, _qty_base numeric,
  _type public.inventory_movement_type DEFAULT 'adjustment',
  _note text DEFAULT ''
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.product_variants; _before numeric; _after numeric; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO v FROM public.product_variants WHERE id = _variant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(v.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengubah stok';
  END IF;

  INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
  VALUES (v.id, v.business_id, v.product_id, 0) ON CONFLICT (variant_id) DO NOTHING;

  SELECT qty_base INTO _before FROM public.inventory_balances WHERE variant_id = v.id FOR UPDATE;
  _after := round(_before + _qty_base, 2);
  IF _after < 0 THEN RAISE EXCEPTION 'Stok tidak boleh negatif'; END IF;
  UPDATE public.inventory_balances SET qty_base = _after, updated_at = now() WHERE variant_id = v.id;

  INSERT INTO public.inventory_movements (
    business_id, product_id, variant_id, movement_type, qty_base,
    balance_before, balance_after, ref_type, note, created_by
  ) VALUES (
    v.business_id, v.product_id, v.id, _type, round(_qty_base,2),
    _before, _after, 'manual', coalesce(_note,''), _uid
  );
  RETURN _after;
END $$;
REVOKE ALL ON FUNCTION public.adjust_inventory(uuid, numeric, public.inventory_movement_type, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, numeric, public.inventory_movement_type, text) TO authenticated, service_role;