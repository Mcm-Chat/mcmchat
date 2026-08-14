-- 1) Kolom tautan pesanan akhir pada unit fisik
ALTER TABLE public.variant_stock_units
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL;

-- 2) Unique alokasi slot hanya untuk slot aktif/delivered; slot cancelled tetap menyimpan riwayat unit
DROP INDEX IF EXISTS public.chat_order_slots_unit;
CREATE UNIQUE INDEX chat_order_slots_unit_active ON public.chat_order_unit_slots (stock_unit_id)
  WHERE stock_unit_id IS NOT NULL AND status <> 'cancelled';

-- 3) apply_unit_balance dengan ref idempoten deterministik
DROP FUNCTION IF EXISTS public.apply_unit_balance(public.variant_stock_units, numeric, text, text);
CREATE OR REPLACE FUNCTION public.apply_unit_balance(
  _unit public.variant_stock_units, _delta numeric, _kind text, _note text, _ref_key text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _before numeric; _after numeric; _scale int; _ref uuid; _reftype text;
BEGIN
  IF _delta = 0 THEN RETURN; END IF;
  IF coalesce(_ref_key,'') = '' THEN RAISE EXCEPTION 'ref key wajib untuk pergerakan stok unit'; END IF;
  _reftype := 'stock_unit_' || _kind;
  _ref := md5('stock_unit:' || _unit.id::text || ':' || _kind || ':' || _ref_key)::uuid;

  SELECT CASE WHEN stock_type = 'weight' THEN 6 ELSE 0 END INTO _scale
    FROM public.product_variants WHERE id = _unit.variant_id;

  INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
  VALUES (_unit.variant_id, _unit.business_id, _unit.product_id, 0)
  ON CONFLICT (variant_id) DO NOTHING;
  SELECT qty_base INTO _before FROM public.inventory_balances WHERE variant_id = _unit.variant_id FOR UPDATE;

  -- Idempotensi: di bawah lock saldo, pergerakan dengan ref sama tidak diproses ulang.
  IF EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.ref_type = _reftype AND m.ref_id = _ref) THEN
    RETURN;
  END IF;

  _after := round(_before + _delta, _scale);
  IF _after < 0 THEN RAISE EXCEPTION 'Stok tidak mencukupi untuk unit ini'; END IF;
  UPDATE public.inventory_balances SET qty_base = _after, updated_at = now() WHERE variant_id = _unit.variant_id;
  INSERT INTO public.inventory_movements (
    business_id, product_id, variant_id, movement_type, qty_base,
    balance_before, balance_after, ref_type, ref_id, note, created_by, stock_unit_id
  ) VALUES (
    _unit.business_id, _unit.product_id, _unit.variant_id,
    CASE WHEN _delta > 0 THEN 'restock'::public.inventory_movement_type ELSE 'preparation'::public.inventory_movement_type END,
    round(_delta, _scale), _before, _after, _reftype, _ref,
    coalesce(_note,''), auth.uid(), _unit.id
  ) ON CONFLICT (ref_type, ref_id) DO NOTHING;
END $fn$;
REVOKE ALL ON FUNCTION public.apply_unit_balance(public.variant_stock_units, numeric, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_unit_balance(public.variant_stock_units, numeric, text, text, text) TO service_role;

-- 4) create_chat_order: idempoten aman + pembeli diturunkan dari percakapan
CREATE OR REPLACE FUNCTION public.create_chat_order(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _conv uuid := (_payload->>'conversation_id')::uuid;
  _biz uuid := (_payload->>'business_id')::uuid;
  _idem text := coalesce(_payload->>'idempotency_key','');
  _items jsonb := coalesce(_payload->'items','[]'::jsonb);
  _it jsonb; _o public.chat_orders; _v public.product_variants; _prod text;
  _base numeric; _i int := 0; _sub numeric := 0; _existing uuid;
  _seller boolean; _buyer uuid; _cust uuid; _name text; _claim uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Harus masuk terlebih dahulu'; END IF;
  IF NOT public.current_user_can_send_conversation(_conv) THEN
    RAISE EXCEPTION 'Tidak berwenang mengirim ke percakapan ini';
  END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Minimal satu item'; END IF;
  IF jsonb_array_length(_items) > 50 THEN RAISE EXCEPTION 'Terlalu banyak item pada satu pesanan'; END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.business_conversations bc WHERE bc.conversation_id = _conv AND bc.business_id = _biz)
    OR public.is_business_member(_biz, _uid)
  ) THEN
    RAISE EXCEPTION 'Katalog bisnis ini tidak tersedia pada percakapan ini';
  END IF;

  -- Kunci idempotensi: klik ganda paralel menunggu, lalu mengembalikan order yang sama.
  IF _idem <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('chat_order:' || _biz::text || ':' || _idem, 0));
    SELECT id INTO _existing FROM public.chat_orders WHERE business_id = _biz AND idempotency_key = _idem;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;

  _seller := public.is_business_member(_biz, _uid);

  IF _seller THEN
    -- Pembeli WAJIB peserta percakapan; tidak boleh diambil dari payload bebas.
    SELECT bc.customer_id INTO _buyer FROM public.business_conversations bc
      WHERE bc.conversation_id = _conv AND bc.business_id = _biz;
    IF _buyer IS NULL THEN
      SELECT CASE WHEN dc.user_low = _uid THEN dc.user_high ELSE dc.user_low END INTO _buyer
        FROM public.direct_conversations dc WHERE dc.conversation_id = _conv;
    END IF;
    _claim := nullif(_payload->>'buyer_user_id','')::uuid;
    IF _claim IS NOT NULL AND _buyer IS NOT NULL AND _claim <> _buyer THEN
      RAISE EXCEPTION 'Pembeli harus peserta percakapan ini';
    END IF;
    IF _claim IS NOT NULL AND _buyer IS NULL THEN
      RAISE EXCEPTION 'Pembeli tidak dapat ditentukan dari percakapan ini';
    END IF;
  ELSE
    _buyer := _uid;
  END IF;

  IF _buyer IS NOT NULL THEN
    SELECT c.id INTO _cust FROM public.customers c WHERE c.business_id = _biz AND c.user_id = _buyer LIMIT 1;
    SELECT p.display_name INTO _name FROM public.profiles p WHERE p.id = _buyer;
  END IF;
  IF coalesce(_name,'') = '' THEN
    SELECT c.name INTO _name FROM public.customers c WHERE c.id = _cust;
  END IF;
  IF coalesce(_name,'') = '' THEN _name := coalesce(nullif(_payload->>'customer_name',''), 'Pelanggan'); END IF;

  BEGIN
    INSERT INTO public.chat_orders (business_id, conversation_id, buyer_user_id, seller_id, created_by,
      customer_id, customer_name, status, note, idempotency_key)
    VALUES (_biz, _conv, _buyer, CASE WHEN _seller THEN _uid ELSE NULL END, _uid,
      _cust, _name, 'buyer_requested', coalesce(_payload->>'note',''), _idem)
    RETURNING * INTO _o;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO _existing FROM public.chat_orders WHERE business_id = _biz AND idempotency_key = _idem;
    IF _existing IS NULL THEN RAISE; END IF;
    RETURN _existing;
  END;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _v FROM public.product_variants WHERE id = (_it->>'variant_id')::uuid AND business_id = _biz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak valid untuk bisnis ini'; END IF;
    SELECT name INTO _prod FROM public.products WHERE id = _v.product_id;
    _base := public.convert_to_base(_v.id, (_it->>'per_unit_qty')::numeric, coalesce(_it->>'per_unit_unit', _v.display_unit));
    IF _base IS NULL OR _base <= 0 THEN RAISE EXCEPTION 'Jumlah per unit tidak valid untuk %', _prod; END IF;
    IF coalesce((_it->>'unit_count')::int,0) <= 0 THEN RAISE EXCEPTION 'Jumlah unit harus lebih dari nol'; END IF;
    IF (_it->>'unit_count')::int > 100 THEN RAISE EXCEPTION 'Jumlah unit per item maksimal 100'; END IF;
    INSERT INTO public.chat_order_items (chat_order_id, business_id, product_id, variant_id, product_name, variant_name,
      unit_count, per_unit_qty, per_unit_unit, per_unit_qty_base, price, discount, sort_order)
    VALUES (_o.id, _biz, _v.product_id, _v.id, _prod, _v.name,
      (_it->>'unit_count')::int, (_it->>'per_unit_qty')::numeric,
      coalesce(_it->>'per_unit_unit', _v.display_unit), _base,
      round(coalesce((_it->>'price')::numeric, _v.price), 2), round(coalesce((_it->>'discount')::numeric,0),2), _i);
    _sub := _sub + greatest(0, round(coalesce((_it->>'price')::numeric, _v.price),2) - round(coalesce((_it->>'discount')::numeric,0),2)) * (_it->>'unit_count')::int;
    _i := _i + 1;
  END LOOP;

  UPDATE public.chat_orders SET subtotal = round(_sub,2), total = round(_sub,2) WHERE id = _o.id;
  RETURN _o.id;
END $fn$;

-- 5) dispatch_chat_order: validasi slot ketat sebelum menulis apa pun
CREATE OR REPLACE FUNCTION public.dispatch_chat_order(_order uuid, _assigned uuid, _slots jsonb, _expires_hours integer DEFAULT 168)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  o public.chat_orders; _uid uuid := auth.uid(); _token text; _job public.preparation_jobs;
  _s jsonb; _item public.chat_order_items; _slot public.chat_order_unit_slots;
  u public.variant_stock_units; _pi uuid; _i int := 0; _total int; _prod text; _expect int;
BEGIN
  SELECT * INTO o FROM public.chat_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(o.business_id, _uid) THEN
    RAISE EXCEPTION 'Hanya pemilik/pengelola toko yang bisa melanjutkan ke pegawai';
  END IF;
  IF o.status IN ('dispatched_to_preparation','preparing') AND o.preparation_job_id IS NOT NULL THEN
    SELECT * INTO _job FROM public.preparation_jobs WHERE id = o.preparation_job_id;
    RETURN jsonb_build_object('id', _job.id, 'code', _job.code, 'already', true);
  END IF;
  IF o.status <> 'buyer_approved' THEN RAISE EXCEPTION 'Pembeli belum menyetujui pesanan'; END IF;
  IF NOT public.is_business_member(o.business_id, _assigned) THEN RAISE EXCEPTION 'Pegawai bukan anggota bisnis ini'; END IF;

  SELECT count(*) INTO _total FROM jsonb_array_elements(_slots);
  IF _total = 0 THEN RAISE EXCEPTION 'Slot unit belum ditentukan'; END IF;
  IF _total > 200 THEN RAISE EXCEPTION 'Jumlah slot terlalu banyak untuk satu tugas'; END IF;

  SELECT coalesce(sum(unit_count),0) INTO _expect FROM public.chat_order_items WHERE chat_order_id = o.id;
  IF _total <> _expect THEN RAISE EXCEPTION 'Total slot (%) harus sama dengan total unit pesanan (%)', _total, _expect; END IF;

  -- Semua slot harus merujuk item pesanan ini, tanpa duplikat, dengan slot_no tepat 1..unit_count.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_slots) e
     WHERE NOT EXISTS (SELECT 1 FROM public.chat_order_items i
                        WHERE i.id = (e->>'item_id')::uuid AND i.chat_order_id = o.id)
  ) THEN RAISE EXCEPTION 'Item pesanan tidak valid'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_slots) e
    GROUP BY (e->>'item_id')::uuid, (e->>'slot_no')::int HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Nomor slot ganda pada item yang sama'; END IF;

  FOR _item IN SELECT * FROM public.chat_order_items WHERE chat_order_id = o.id ORDER BY sort_order LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(_slots) e WHERE (e->>'item_id')::uuid = _item.id) <> _item.unit_count THEN
      RAISE EXCEPTION 'Jumlah slot untuk % harus tepat % unit', _item.product_name, _item.unit_count;
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(_slots) e
         WHERE (e->>'item_id')::uuid = _item.id
           AND coalesce((e->>'slot_no')::int, 0) BETWEEN 1 AND _item.unit_count) <> _item.unit_count THEN
      RAISE EXCEPTION 'Nomor slot % harus 1..%', _item.product_name, _item.unit_count;
    END IF;
  END LOOP;

  _token := encode(extensions.gen_random_bytes(24),'hex');
  INSERT INTO public.preparation_jobs (business_id, code, conversation_id, customer_id, customer_user_id, customer_name,
    assigned_user_id, notes, token_hash, token_prefix, expires_at, created_by, status, chat_order_id)
  VALUES (o.business_id,
    'PRP-' || to_char(now(),'YYMMDD') || '-' || upper(substr(encode(extensions.gen_random_bytes(4),'hex'),1,5)),
    o.conversation_id, o.customer_id, o.buyer_user_id, coalesce(o.customer_name,''),
    _assigned, o.note, encode(extensions.digest(_token,'sha256'),'hex'), left(_token,6),
    now() + make_interval(hours => greatest(1, coalesce(_expires_hours,168))), _uid, 'sent', o.id)
  RETURNING * INTO _job;

  FOR _s IN SELECT * FROM jsonb_array_elements(_slots) LOOP
    SELECT * INTO _item FROM public.chat_order_items WHERE id = (_s->>'item_id')::uuid AND chat_order_id = o.id;
    SELECT name INTO _prod FROM public.products WHERE id = _item.product_id;
    _i := _i + 1;

    INSERT INTO public.chat_order_unit_slots (chat_order_id, item_id, slot_no, qty_base, mode, status)
    VALUES (o.id, _item.id, (_s->>'slot_no')::int, _item.per_unit_qty_base,
      coalesce((_s->>'mode')::public.unit_slot_mode, 'prepare_new'), 'pending')
    ON CONFLICT (item_id, slot_no) DO UPDATE SET mode = EXCLUDED.mode, qty_base = EXCLUDED.qty_base, status = 'pending'
    RETURNING * INTO _slot;

    INSERT INTO public.preparation_job_items (job_id, product_id, variant_id, product_name, variant_name,
      requested_qty, requested_unit, requested_qty_base, require_photo, require_location, notes, sort_order,
      chat_order_slot_id, unit_index, unit_total)
    VALUES (_job.id, _item.product_id, _item.variant_id, _prod, _item.variant_name,
      _item.per_unit_qty, _item.per_unit_unit, _item.per_unit_qty_base,
      coalesce((_s->>'require_photo')::boolean, true), coalesce((_s->>'require_location')::boolean, true),
      coalesce(_s->>'notes',''), _i - 1, _slot.id, (_s->>'slot_no')::int, _item.unit_count)
    RETURNING id INTO _pi;

    UPDATE public.chat_order_unit_slots SET preparation_job_item_id = _pi WHERE id = _slot.id;

    IF (_s->>'mode') = 'existing' THEN
      SELECT * INTO u FROM public.variant_stock_units WHERE id = (_s->>'stock_unit_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unit siap tidak ditemukan'; END IF;
      IF u.business_id <> o.business_id THEN RAISE EXCEPTION 'Unit bukan milik bisnis ini'; END IF;
      IF u.status <> 'available' THEN RAISE EXCEPTION 'Unit % sudah tidak tersedia', u.unit_label; END IF;
      IF u.variant_id <> _item.variant_id THEN RAISE EXCEPTION 'Unit tidak cocok dengan varian pesanan'; END IF;
      IF round(u.qty_base,6) <> round(_item.per_unit_qty_base,6) THEN
        RAISE EXCEPTION 'Jumlah unit % tidak sama dengan permintaan', u.unit_label;
      END IF;
      PERFORM public.apply_unit_balance(u, -u.qty_base, 'reserve', 'Dipesan untuk ' || _job.code, 'slot:' || _slot.id::text);
      UPDATE public.variant_stock_units SET status = 'reserved', unit_slot_id = _slot.id, chat_order_id = o.id,
        chat_order_item_id = _item.id, preparation_job_id = _job.id, preparation_job_item_id = _pi,
        conversation_id = o.conversation_id, customer_user_id = o.buyer_user_id, customer_id = o.customer_id,
        reserved_at = now(), released_at = NULL, updated_by = _uid WHERE id = u.id;
      UPDATE public.chat_order_unit_slots SET stock_unit_id = u.id, status = 'reserved' WHERE id = _slot.id;
      UPDATE public.preparation_job_items SET stock_unit_id = u.id WHERE id = _pi;
    END IF;
  END LOOP;

  UPDATE public.chat_orders SET status = 'dispatched_to_preparation', dispatched_at = now(),
    preparation_job_id = _job.id WHERE id = o.id;

  RETURN jsonb_build_object('id', _job.id, 'code', _job.code, 'token', _token, 'expires_at', _job.expires_at, 'already', false);
END $fn$;

-- 6) cancel_chat_order: slot sebagai SSOT, riwayat unit dipertahankan
CREATE OR REPLACE FUNCTION public.cancel_chat_order(_order uuid, _reason text DEFAULT ''::text, _void_ready boolean DEFAULT false)
RETURNS public.chat_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE o public.chat_orders; _uid uuid := auth.uid(); u public.variant_stock_units;
        s public.chat_order_unit_slots; _manager boolean;
BEGIN
  -- Urutan lock konsisten: chat_order -> preparation_job -> slots -> units
  SELECT * INTO o FROM public.chat_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  _manager := _uid IS NOT NULL AND public.can_manage_business(o.business_id, _uid);
  IF NOT _manager AND (o.buyer_user_id IS DISTINCT FROM _uid
      OR o.status NOT IN ('buyer_requested','seller_confirmed','changes_requested','buyer_approved')) THEN
    RAISE EXCEPTION 'Tidak berwenang membatalkan pesanan pada tahap ini';
  END IF;
  IF o.status = 'cancelled' THEN RETURN o; END IF;
  IF o.status = 'delivered' THEN RAISE EXCEPTION 'Pesanan sudah dikirim'; END IF;

  IF o.preparation_job_id IS NOT NULL THEN
    PERFORM 1 FROM public.preparation_jobs WHERE id = o.preparation_job_id FOR UPDATE;
  END IF;

  FOR s IN SELECT * FROM public.chat_order_unit_slots WHERE chat_order_id = o.id AND status <> 'delivered'
            ORDER BY item_id, slot_no FOR UPDATE LOOP
    IF s.stock_unit_id IS NOT NULL THEN
      SELECT * INTO u FROM public.variant_stock_units WHERE id = s.stock_unit_id FOR UPDATE;
      IF FOUND AND u.chat_order_id = o.id THEN
        IF u.status = 'preparing' THEN
          UPDATE public.variant_stock_units SET status = 'void', unit_slot_id = NULL,
            released_at = now(), updated_by = _uid WHERE id = u.id;
        ELSIF u.status IN ('reserved','ready') THEN
          IF s.mode = 'prepare_new' AND u.status = 'ready' AND _void_ready THEN
            UPDATE public.variant_stock_units SET status = 'void', unit_slot_id = NULL,
              released_at = now(), updated_by = _uid WHERE id = u.id;
          ELSE
            -- Kembalikan saldo tepat sekali (ref deterministik per slot).
            PERFORM public.apply_unit_balance(u, u.qty_base, 'release', 'Pembatalan pesanan',
              'slot:' || s.id::text);
            UPDATE public.variant_stock_units SET status = 'available', unit_slot_id = NULL, chat_order_id = NULL,
              chat_order_item_id = NULL, preparation_job_id = NULL, preparation_job_item_id = NULL,
              customer_user_id = NULL, customer_id = NULL,
              reserved_at = NULL, released_at = now(), updated_by = _uid WHERE id = u.id;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Unit yang menempel ke order tanpa slot aktif (pengaman) tetap dilepas.
  FOR u IN SELECT vsu.* FROM public.variant_stock_units vsu
            WHERE vsu.chat_order_id = o.id AND vsu.status IN ('reserved','preparing')
            ORDER BY vsu.id FOR UPDATE LOOP
    IF u.status = 'reserved' THEN
      PERFORM public.apply_unit_balance(u, u.qty_base, 'release', 'Pembatalan pesanan', 'order:' || o.id::text);
      UPDATE public.variant_stock_units SET status = 'available', unit_slot_id = NULL, chat_order_id = NULL,
        chat_order_item_id = NULL, reserved_at = NULL, released_at = now(), updated_by = _uid WHERE id = u.id;
    ELSE
      UPDATE public.variant_stock_units SET status = 'void', unit_slot_id = NULL,
        released_at = now(), updated_by = _uid WHERE id = u.id;
    END IF;
  END LOOP;

  -- Riwayat: stock_unit_id TIDAK dihapus; unique index hanya berlaku untuk slot non-cancelled.
  UPDATE public.chat_order_unit_slots SET status = 'cancelled'
   WHERE chat_order_id = o.id AND status <> 'delivered';

  IF o.preparation_job_id IS NOT NULL THEN
    UPDATE public.preparation_jobs SET status = 'cancelled', revoked_at = coalesce(revoked_at, now())
     WHERE id = o.preparation_job_id AND status <> 'completed';
  END IF;

  UPDATE public.chat_orders SET status = 'cancelled', cancelled_at = now(),
    seller_note = CASE WHEN coalesce(_reason,'') = '' THEN seller_note ELSE _reason END
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $fn$;

-- 7) complete_preparation_job: lock order dulu, verifikasi unit existing, primary photo per unit, saldo sekali
CREATE OR REPLACE FUNCTION public.complete_preparation_job(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  j public.preparation_jobs; it public.preparation_job_items; ph public.preparation_item_photos;
  _qty numeric; _photos integer := 0; _uphotos integer; _sort integer; _order uuid;
  _uid uuid := auth.uid(); u public.variant_stock_units; _newu public.variant_stock_units; _seq int;
  _slot public.chat_order_unit_slots; _tmp public.variant_stock_units;
BEGIN
  -- Urutan lock konsisten dengan cancel_chat_order: chat_order -> preparation_job -> slots -> units
  SELECT chat_order_id INTO _order FROM public.preparation_jobs WHERE id = _job;
  IF _order IS NOT NULL THEN PERFORM 1 FROM public.chat_orders WHERE id = _order FOR UPDATE; END IF;

  SELECT * INTO j FROM public.preparation_jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tugas tidak ditemukan'; END IF;
  IF j.chat_order_id IS DISTINCT FROM _order THEN RAISE EXCEPTION 'Tugas berubah, coba lagi'; END IF;
  IF _uid IS NULL OR NOT (j.assigned_user_id = _uid OR j.created_by = _uid OR public.can_manage_business(j.business_id, _uid)) THEN
    RAISE EXCEPTION 'Anda tidak berwenang menyelesaikan tugas ini';
  END IF;
  IF j.status = 'completed' THEN
    RETURN jsonb_build_object('id', j.id, 'status', 'completed', 'already', true);
  END IF;
  IF j.status = 'cancelled' OR j.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Tugas sudah dibatalkan'; END IF;
  IF j.expires_at < now() THEN RAISE EXCEPTION 'Tautan tugas sudah kedaluwarsa'; END IF;

  FOR it IN SELECT * FROM public.preparation_job_items WHERE job_id = _job ORDER BY sort_order LOOP
    _qty := coalesce(it.actual_qty_base, it.requested_qty_base);
    _uphotos := 0;

    IF it.chat_order_slot_id IS NOT NULL THEN
      SELECT * INTO _slot FROM public.chat_order_unit_slots WHERE id = it.chat_order_slot_id FOR UPDATE;
      IF _slot.status = 'cancelled' THEN RAISE EXCEPTION 'Slot unit sudah dibatalkan'; END IF;
    ELSE
      _slot := NULL;
    END IF;

    -- Unit existing yang sudah direservasi: verifikasi keterkaitan + kelengkapan, tanpa mengurangi saldo lagi.
    IF it.stock_unit_id IS NOT NULL THEN
      SELECT * INTO u FROM public.variant_stock_units WHERE id = it.stock_unit_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unit % tidak ditemukan', it.product_name; END IF;
      IF j.chat_order_id IS NOT NULL AND u.chat_order_id IS DISTINCT FROM j.chat_order_id THEN
        RAISE EXCEPTION 'Unit tidak terkait dengan pesanan ini';
      END IF;
      IF it.chat_order_slot_id IS NOT NULL AND u.unit_slot_id IS DISTINCT FROM it.chat_order_slot_id THEN
        RAISE EXCEPTION 'Unit tidak terkait dengan slot tugas ini';
      END IF;
      IF u.status NOT IN ('reserved','preparing','ready') THEN
        RAISE EXCEPTION 'Unit % tidak dalam status yang dapat diselesaikan', it.product_name;
      END IF;

      IF it.require_photo AND NOT (
        EXISTS (SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id)
        OR EXISTS (SELECT 1 FROM public.product_photos WHERE stock_unit_id = u.id)
      ) THEN RAISE EXCEPTION 'Unit % belum memiliki foto', it.product_name; END IF;
      IF it.require_location AND NOT (
        EXISTS (SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id AND lat IS NOT NULL AND lng IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.product_photos WHERE stock_unit_id = u.id AND location_lat IS NOT NULL AND location_lng IS NOT NULL)
      ) THEN RAISE EXCEPTION 'Unit % belum memiliki lokasi', it.product_name; END IF;

      -- Foto tambahan dari penyiapan tetap disalin ke unit ini.
      SELECT coalesce(max(sort_order), -1) + 1 INTO _sort FROM public.product_photos WHERE product_id = it.product_id;
      SELECT count(*) INTO _uphotos FROM public.product_photos WHERE stock_unit_id = u.id;
      FOR ph IN SELECT * FROM public.preparation_item_photos WHERE job_item_id = it.id ORDER BY sort_order LOOP
        INSERT INTO public.product_photos (business_id, product_id, variant_id, stock_unit_id, is_primary, image_path, caption,
          location_lat, location_lng, location_accuracy, location_label, location_url,
          group_label, sort_order, preparation_job_id, preparation_job_item_id, source_photo_id,
          source_type, location_mode, created_by)
        VALUES (j.business_id, it.product_id, it.variant_id, u.id, (_uphotos = 0), ph.storage_path, ph.caption,
          ph.lat, ph.lng, ph.accuracy, ph.location_label, ph.maps_url,
          it.product_name || ' — ' || it.variant_name, _sort, j.id, it.id, ph.id, 'preparation',
          CASE WHEN ph.lat IS NOT NULL AND ph.lng IS NOT NULL THEN 'auto' ELSE 'none' END, j.assigned_user_id)
        ON CONFLICT (source_photo_id) DO NOTHING;
        _sort := _sort + 1; _uphotos := _uphotos + 1; _photos := _photos + 1;
      END LOOP;

      IF u.status IN ('reserved','preparing') THEN
        UPDATE public.variant_stock_units SET status = 'ready', ready_at = now(), updated_by = _uid WHERE id = u.id;
      END IF;
      IF it.chat_order_slot_id IS NOT NULL THEN
        UPDATE public.chat_order_unit_slots SET status = 'ready', stock_unit_id = u.id WHERE id = it.chat_order_slot_id;
      END IF;
      UPDATE public.preparation_job_items SET status = 'done', actual_qty_base = u.qty_base WHERE id = it.id;
      CONTINUE;
    END IF;

    IF it.require_photo AND NOT EXISTS (SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id) THEN
      RAISE EXCEPTION 'Item % belum memiliki foto', it.product_name;
    END IF;
    IF it.require_location AND NOT EXISTS (
      SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id AND lat IS NOT NULL AND lng IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Item % belum memiliki lokasi', it.product_name;
    END IF;

    -- Unit fisik baru hasil penyiapan.
    SELECT coalesce(max(unit_seq),0) + 1 INTO _seq FROM public.variant_stock_units WHERE variant_id = it.variant_id;
    INSERT INTO public.variant_stock_units (business_id, product_id, variant_id, unit_seq, unit_label, qty_base,
      status, note, source_type, chat_order_id, chat_order_item_id, unit_slot_id,
      preparation_job_id, preparation_job_item_id, conversation_id, customer_user_id, customer_id,
      ready_at, created_by, updated_by)
    VALUES (j.business_id, it.product_id, it.variant_id, _seq,
      CASE WHEN it.unit_total > 0 THEN 'Unit ' || it.unit_index || '/' || it.unit_total ELSE 'Unit ' || _seq END,
      _qty,
      CASE WHEN j.chat_order_id IS NOT NULL THEN 'ready'::public.stock_unit_status ELSE 'available'::public.stock_unit_status END,
      it.notes, 'preparation', j.chat_order_id,
      (SELECT s.item_id FROM public.chat_order_unit_slots s WHERE s.id = it.chat_order_slot_id),
      it.chat_order_slot_id, j.id, it.id, j.conversation_id, j.customer_user_id, j.customer_id,
      now(), _uid, _uid)
    RETURNING * INTO _newu;

    -- Saldo: unit "available" (penyiapan stok umum) sudah tercakup dalam saldo => net nol.
    -- Unit pesanan yang berakhir "ready" mengurangi saldo tepat sekali (ref deterministik per unit).
    IF j.chat_order_id IS NOT NULL THEN
      PERFORM public.apply_unit_balance(_newu, -_qty, 'consume', 'Penyiapan ' || j.code,
        'prepare_new:' || coalesce(it.chat_order_slot_id::text, it.id::text));
    END IF;

    IF it.chat_order_slot_id IS NOT NULL THEN
      UPDATE public.chat_order_unit_slots SET stock_unit_id = _newu.id, status = 'ready' WHERE id = it.chat_order_slot_id;
    END IF;

    SELECT coalesce(max(sort_order), -1) + 1 INTO _sort FROM public.product_photos WHERE product_id = it.product_id;
    _uphotos := 0;
    FOR ph IN SELECT * FROM public.preparation_item_photos WHERE job_item_id = it.id ORDER BY sort_order LOOP
      INSERT INTO public.product_photos (business_id, product_id, variant_id, stock_unit_id, is_primary, image_path, caption,
        location_lat, location_lng, location_accuracy, location_label, location_url,
        group_label, sort_order, preparation_job_id, preparation_job_item_id, source_photo_id,
        source_type, location_mode, created_by)
      VALUES (j.business_id, it.product_id, it.variant_id, _newu.id, (_uphotos = 0), ph.storage_path, ph.caption,
        ph.lat, ph.lng, ph.accuracy, ph.location_label, ph.maps_url,
        it.product_name || ' — ' || it.variant_name, _sort, j.id, it.id, ph.id, 'preparation',
        CASE WHEN ph.lat IS NOT NULL AND ph.lng IS NOT NULL THEN 'auto' ELSE 'none' END, j.assigned_user_id)
      ON CONFLICT (source_photo_id) DO NOTHING;
      _sort := _sort + 1; _uphotos := _uphotos + 1; _photos := _photos + 1;
    END LOOP;

    UPDATE public.preparation_job_items SET status = 'done', actual_qty_base = _qty, stock_unit_id = _newu.id WHERE id = it.id;
  END LOOP;

  UPDATE public.preparation_jobs SET status = 'completed', completed_at = now() WHERE id = _job;

  IF j.chat_order_id IS NOT NULL THEN
    UPDATE public.chat_orders SET status = 'ready_for_payment', ready_at = now()
     WHERE id = j.chat_order_id AND status IN ('dispatched_to_preparation','preparing');
  END IF;

  RETURN jsonb_build_object('id', j.id, 'status', 'completed', 'already', false, 'photos', _photos,
    'chat_order_id', j.chat_order_id);
END $fn$;

-- 8) finalize_chat_order_delivery: validasi unit per slot, pembayaran ketat, tautan order akhir
CREATE OR REPLACE FUNCTION public.finalize_chat_order_delivery(_order uuid, _payment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  o public.chat_orders; _uid uuid := auth.uid(); _method public.payment_method;
  _due date; _paid numeric; _total numeric; _sub numeric; _number text;
  _ord public.orders; _rec public.sales_records; _ledger uuid; _msg uuid; _oi uuid;
  _item public.chat_order_items; u public.variant_stock_units; _units jsonb := '[]'::jsonb;
  _unit_ids uuid[]; _payload jsonb; _idem text; s public.chat_order_unit_slots; _cnt int;
BEGIN
  SELECT * INTO o FROM public.chat_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_sell_business(o.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengirim pesanan ini';
  END IF;
  IF o.status = 'delivered' THEN
    RETURN jsonb_build_object('already', true, 'order_id', o.order_id, 'sale_id', o.sales_record_id,
      'ledger_id', o.ledger_id, 'message_id', o.result_message_id);
  END IF;
  IF o.status <> 'ready_for_payment' THEN RAISE EXCEPTION 'Pesanan belum siap dikirim'; END IF;
  IF o.preparation_job_id IS NOT NULL THEN
    PERFORM 1 FROM public.preparation_jobs WHERE id = o.preparation_job_id FOR UPDATE;
  END IF;

  _method := coalesce((_payment->>'payment_method')::public.payment_method, 'cash');
  _due := nullif(_payment->>'due_date','')::date;
  _idem := coalesce(nullif(_payment->>'idempotency_key',''), 'chatorder:' || o.id::text);

  SELECT coalesce(sum(greatest(0, price - discount) * unit_count),0) INTO _sub
    FROM public.chat_order_items WHERE chat_order_id = o.id;
  _total := round(greatest(0, _sub - o.discount + o.extra_fee), 2);
  IF _total <= 0 THEN RAISE EXCEPTION 'Total pesanan harus lebih dari nol'; END IF;

  _paid := round(coalesce((_payment->>'paid_amount')::numeric, 0), 2);
  IF _paid < 0 THEN RAISE EXCEPTION 'Jumlah dibayar tidak boleh negatif'; END IF;
  IF _paid > _total THEN RAISE EXCEPTION 'Jumlah dibayar melebihi total'; END IF;
  IF _method IN ('cash','transfer') THEN
    _paid := _total;
  ELSIF _method = 'dp' THEN
    IF _paid <= 0 THEN RAISE EXCEPTION 'DP harus lebih dari nol'; END IF;
    IF _paid >= _total THEN RAISE EXCEPTION 'DP lunas: gunakan metode tunai atau transfer'; END IF;
  ELSIF _method = 'credit' THEN
    IF _paid <> 0 THEN RAISE EXCEPTION 'Kredit tidak menerima pembayaran awal: gunakan DP'; END IF;
  END IF;
  IF _method IN ('dp','credit') THEN
    IF _due IS NULL THEN RAISE EXCEPTION 'Tanggal jatuh tempo wajib untuk DP atau kredit'; END IF;
    IF _due < current_date THEN RAISE EXCEPTION 'Tanggal jatuh tempo tidak boleh sebelum tanggal transaksi'; END IF;
  END IF;

  -- Setiap slot wajib siap, punya unit unik, cocok varian dan jumlahnya.
  SELECT count(*) INTO _cnt FROM public.chat_order_unit_slots WHERE chat_order_id = o.id AND status <> 'ready';
  IF _cnt > 0 THEN RAISE EXCEPTION 'Masih ada unit yang belum siap'; END IF;
  SELECT count(DISTINCT stock_unit_id) INTO _cnt FROM public.chat_order_unit_slots
   WHERE chat_order_id = o.id AND stock_unit_id IS NOT NULL;
  IF _cnt <> (SELECT count(*) FROM public.chat_order_unit_slots WHERE chat_order_id = o.id) THEN
    RAISE EXCEPTION 'Setiap slot harus memiliki unit fisik yang berbeda';
  END IF;
  IF _cnt <> (SELECT coalesce(sum(unit_count),0) FROM public.chat_order_items WHERE chat_order_id = o.id) THEN
    RAISE EXCEPTION 'Jumlah unit siap tidak sesuai dengan pesanan';
  END IF;

  FOR s IN SELECT * FROM public.chat_order_unit_slots WHERE chat_order_id = o.id ORDER BY item_id, slot_no FOR UPDATE LOOP
    SELECT * INTO u FROM public.variant_stock_units WHERE id = s.stock_unit_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unit fisik slot tidak ditemukan'; END IF;
    IF u.status <> 'ready' THEN RAISE EXCEPTION 'Unit % belum siap', u.unit_label; END IF;
    IF u.chat_order_id IS DISTINCT FROM o.id OR u.unit_slot_id IS DISTINCT FROM s.id
       OR u.chat_order_item_id IS DISTINCT FROM s.item_id THEN
      RAISE EXCEPTION 'Unit % tidak terkait dengan slot pesanan ini', u.unit_label;
    END IF;
    SELECT * INTO _item FROM public.chat_order_items WHERE id = s.item_id;
    IF u.variant_id IS DISTINCT FROM _item.variant_id THEN RAISE EXCEPTION 'Varian unit tidak cocok'; END IF;
    IF round(u.qty_base,6) <> round(_item.per_unit_qty_base,6) THEN RAISE EXCEPTION 'Jumlah unit tidak cocok'; END IF;
  END LOOP;

  _number := 'INV-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*9000)+1000)::int::text, 4, '0');

  INSERT INTO public.orders (business_id, number, buyer_user_id, customer_id, note, discount, shipping, total, status)
  VALUES (o.business_id, _number, o.buyer_user_id, o.customer_id, o.note, o.discount, o.extra_fee, _total, 'completed')
  RETURNING * INTO _ord;

  FOR _item IN SELECT * FROM public.chat_order_items WHERE chat_order_id = o.id ORDER BY sort_order LOOP
    SELECT coalesce(array_agg(s2.stock_unit_id ORDER BY s2.slot_no), '{}') INTO _unit_ids
      FROM public.chat_order_unit_slots s2 WHERE s2.item_id = _item.id AND s2.stock_unit_id IS NOT NULL;
    INSERT INTO public.order_items (order_id, business_id, product_id, variant_id, name, variant_name,
      qty, qty_num, qty_base, unit, price, discount, photo_ids, stock_unit_ids)
    VALUES (_ord.id, o.business_id, _item.product_id, _item.variant_id, _item.product_name, _item.variant_name,
      _item.unit_count, _item.unit_count, _item.per_unit_qty_base * _item.unit_count, _item.per_unit_unit,
      _item.price, _item.discount, '{}', _unit_ids)
    RETURNING id INTO _oi;
    -- Tautan final: setiap unit menunjuk baris pesanan akhir.
    UPDATE public.variant_stock_units SET order_id = _ord.id, order_item_id = _oi
     WHERE chat_order_id = o.id AND chat_order_item_id = _item.id;
  END LOOP;

  INSERT INTO public.sales_records (business_id, seller_id, order_id, idempotency_key, customer_user_id, customer_id,
    conversation_id, subtotal, discount, extra_fee, total, paid_amount, payment_method, due_date, note, payload)
  VALUES (o.business_id, _uid, _ord.id, _idem, o.buyer_user_id, o.customer_id, o.conversation_id,
    round(_sub,2), o.discount, o.extra_fee, _total, _paid, _method, _due, o.note,
    jsonb_build_object('number', _number, 'customerName', coalesce(o.customer_name,'Pelanggan'), 'chatOrderId', o.id))
  RETURNING * INTO _rec;

  IF _total - _paid > 0 THEN
    INSERT INTO public.ledgers (owner_id, counterpart_user_id, counterpart_name, type, amount, paid_amount,
      due_date, note, sales_record_id, conversation_id, status)
    VALUES (_uid, o.buyer_user_id, coalesce(o.customer_name,'Pelanggan'), 'receivable', _total, _paid, _due,
      'Penjualan ' || _number, _rec.id, o.conversation_id,
      CASE WHEN _paid > 0 THEN 'partially_paid'::public.ledger_status ELSE 'active'::public.ledger_status END)
    ON CONFLICT (sales_record_id) DO NOTHING
    RETURNING id INTO _ledger;
    IF _ledger IS NULL THEN
      SELECT id INTO _ledger FROM public.ledgers WHERE sales_record_id = _rec.id;
    ELSE
      INSERT INTO public.ledger_events (ledger_id, actor_id, label, detail)
      VALUES (_ledger, _uid, 'Catatan dibuat dari penjualan', _number);
    END IF;
  END IF;

  FOR s IN SELECT * FROM public.chat_order_unit_slots WHERE chat_order_id = o.id ORDER BY item_id, slot_no LOOP
    UPDATE public.variant_stock_units SET status = 'delivered', delivered_at = now(),
      customer_user_id = o.buyer_user_id, customer_id = o.customer_id, updated_by = _uid
     WHERE id = s.stock_unit_id RETURNING * INTO u;
    _units := _units || jsonb_build_object(
      'id', u.id, 'stockUnitId', u.id, 'slotId', s.id, 'chatOrderItemId', s.item_id,
      'orderItemId', u.order_item_id, 'label', u.unit_label, 'qtyBase', u.qty_base, 'note', u.note,
      'photos', coalesce((SELECT jsonb_agg(jsonb_build_object('path', p.image_path, 'caption', p.caption,
          'mapsUrl', p.location_url, 'locationLabel', p.location_label, 'accuracy', p.location_accuracy,
          'isPrimary', p.is_primary) ORDER BY p.sort_order)
        FROM public.product_photos p WHERE p.stock_unit_id = u.id), '[]'::jsonb));
  END LOOP;

  UPDATE public.chat_order_unit_slots SET status = 'delivered' WHERE chat_order_id = o.id;

  _payload := jsonb_build_object('type','chat_order_result','chatOrderId', o.id, 'orderId', _ord.id, 'number', _number,
    'total', _total, 'paid', _paid, 'outstanding', _total - _paid, 'paymentMethod', _method, 'dueDate', _due,
    'units', _units,
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('name', i.product_name, 'variantName', i.variant_name,
        'unitCount', i.unit_count, 'perUnitQty', i.per_unit_qty, 'unit', i.per_unit_unit,
        'price', i.price, 'discount', i.discount) ORDER BY i.sort_order)
      FROM public.chat_order_items i WHERE i.chat_order_id = o.id), '[]'::jsonb));

  INSERT INTO public.messages (conversation_id, sender_id, kind, body, payload)
  VALUES (o.conversation_id, _uid, 'order', 'Hasil pesanan ' || _number, _payload)
  RETURNING id INTO _msg;

  UPDATE public.chat_orders SET status = 'delivered', delivered_at = now(), total = _total, subtotal = round(_sub,2),
    order_id = _ord.id, sales_record_id = _rec.id, ledger_id = _ledger, result_message_id = _msg
   WHERE id = o.id;

  RETURN jsonb_build_object('already', false, 'order_id', _ord.id, 'sale_id', _rec.id, 'ledger_id', _ledger,
    'message_id', _msg, 'number', _number, 'total', _total, 'paid', _paid);
END $fn$;

REVOKE ALL ON FUNCTION public.create_chat_order(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispatch_chat_order(uuid, uuid, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_chat_order(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_preparation_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_chat_order_delivery(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_chat_order(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_chat_order(uuid, uuid, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_chat_order(uuid, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_preparation_job(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_chat_order_delivery(uuid, jsonb) TO authenticated, service_role;