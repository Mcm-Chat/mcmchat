CREATE OR REPLACE FUNCTION public.complete_preparation_job(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  j public.preparation_jobs;
  it public.preparation_job_items;
  ph public.preparation_item_photos;
  _qty numeric; _before numeric; _after numeric; _photos integer := 0; _sort integer;
  _uid uuid := auth.uid();
BEGIN
  SELECT * INTO j FROM public.preparation_jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tugas tidak ditemukan'; END IF;

  -- Otorisasi: hanya pegawai yang ditugaskan, pembuat, atau pengelola bisnis.
  IF _uid IS NULL OR NOT (
       j.assigned_user_id = _uid
    OR j.created_by = _uid
    OR public.can_manage_business(j.business_id, _uid)
  ) THEN
    RAISE EXCEPTION 'Anda tidak berwenang menyelesaikan tugas ini';
  END IF;

  IF j.status = 'completed' THEN
    RETURN jsonb_build_object('id', j.id, 'status', 'completed', 'already', true);
  END IF;
  IF j.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Tugas sudah dibatalkan'; END IF;
  IF j.expires_at < now() THEN RAISE EXCEPTION 'Tautan tugas sudah kedaluwarsa'; END IF;

  FOR it IN SELECT * FROM public.preparation_job_items WHERE job_id = _job ORDER BY sort_order LOOP
    IF it.require_photo AND NOT EXISTS (SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id) THEN
      RAISE EXCEPTION 'Item % belum memiliki foto', it.product_name;
    END IF;
    IF it.require_location AND NOT EXISTS (
      SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id AND lat IS NOT NULL AND lng IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Item % belum memiliki lokasi', it.product_name;
    END IF;

    _qty := coalesce(it.actual_qty_base, it.requested_qty_base);

    INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
    VALUES (it.variant_id, j.business_id, it.product_id, 0)
    ON CONFLICT (variant_id) DO NOTHING;

    SELECT qty_base INTO _before FROM public.inventory_balances WHERE variant_id = it.variant_id FOR UPDATE;
    _after := _before - _qty;
    IF _after < 0 THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi (tersedia %, dibutuhkan %)', it.product_name, _before, _qty;
    END IF;
    UPDATE public.inventory_balances SET qty_base = _after, updated_at = now() WHERE variant_id = it.variant_id;

    INSERT INTO public.inventory_movements (
      business_id, product_id, variant_id, movement_type, qty_base,
      balance_before, balance_after, ref_type, ref_id, note, created_by
    ) VALUES (
      j.business_id, it.product_id, it.variant_id, 'preparation', -_qty,
      _before, _after, 'preparation_job_item', it.id,
      'Penyiapan ' || j.code, j.assigned_user_id
    ) ON CONFLICT (ref_type, ref_id) DO NOTHING;

    SELECT coalesce(max(sort_order), -1) + 1 INTO _sort FROM public.product_photos WHERE product_id = it.product_id;
    FOR ph IN SELECT * FROM public.preparation_item_photos WHERE job_item_id = it.id ORDER BY sort_order LOOP
      INSERT INTO public.product_photos (
        business_id, product_id, variant_id, image_path, caption,
        location_lat, location_lng, location_accuracy, location_label, location_url,
        group_label, sort_order, preparation_job_id, preparation_job_item_id, source_photo_id,
        source_type, location_mode, created_by
      ) VALUES (
        j.business_id, it.product_id, it.variant_id, ph.storage_path, ph.caption,
        ph.lat, ph.lng, ph.accuracy, ph.location_label, ph.maps_url,
        it.product_name || ' — ' || it.variant_name, _sort, j.id, it.id, ph.id,
        'preparation',
        CASE WHEN ph.lat IS NOT NULL AND ph.lng IS NOT NULL THEN 'auto' ELSE 'none' END,
        j.assigned_user_id
      ) ON CONFLICT (source_photo_id) DO NOTHING;
      _sort := _sort + 1;
      _photos := _photos + 1;
    END LOOP;

    UPDATE public.preparation_job_items
      SET status = 'done', actual_qty_base = _qty WHERE id = it.id;
  END LOOP;

  UPDATE public.preparation_jobs
    SET status = 'completed', completed_at = now() WHERE id = _job;

  RETURN jsonb_build_object('id', j.id, 'status', 'completed', 'already', false, 'photos', _photos);
END $function$;

REVOKE ALL ON FUNCTION public.complete_preparation_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_preparation_job(uuid) TO authenticated;