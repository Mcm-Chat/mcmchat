-- =====================================================================
-- Jumlah per unit kanonik dari definisi varian
-- =====================================================================
CREATE OR REPLACE FUNCTION public.variant_display_factor(_variant uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
           WHEN v.stock_type = 'weight' THEN
             CASE lower(coalesce(nullif(v.display_unit,''),'g'))
               WHEN 'mg' THEN 0.001 WHEN 'g' THEN 1 WHEN 'ons' THEN 100 WHEN 'kg' THEN 1000
               ELSE 1 END
           ELSE greatest(coalesce(nullif(v.units_per_display,0), nullif(v.conversion_factor,0), 1), 0.000001)
         END
  FROM public.product_variants v WHERE v.id = _variant
$$;

-- Isi pasti satu unit fisik varian: base, tampilan, satuan tampilan.
CREATE OR REPLACE FUNCTION public.variant_unit_quantity(_variant uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _v public.product_variants; _f numeric; _base numeric;
BEGIN
  SELECT * INTO _v FROM public.product_variants WHERE id = _variant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _f := public.variant_display_factor(_variant);
  _base := coalesce(nullif(_v.base_quantity_grams, 0), _f);
  IF _base IS NULL OR _base <= 0 THEN _base := _f; END IF;
  RETURN jsonb_build_object(
    'variant_id', _v.id,
    'qty_base', _base,
    'qty_display', round(_base / nullif(_f,0), 6),
    'unit', coalesce(nullif(_v.display_unit,''), _v.base_unit, 'pcs'),
    'base_unit', _v.base_unit,
    'editable', (_v.base_quantity_grams IS NULL OR _v.base_quantity_grams = 0)
  );
END $$;

REVOKE ALL ON FUNCTION public.variant_display_factor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.variant_unit_quantity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.variant_display_factor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.variant_unit_quantity(uuid) TO authenticated, service_role;

-- =====================================================================
-- Kartu produk: server-derived, wajib varian aktif, media publik saja
-- =====================================================================
CREATE OR REPLACE FUNCTION public.build_product_card(_product uuid, _variant uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _p public.products; _v public.product_variants; _q jsonb;
  _avail numeric; _cnt int; _photos jsonb; _f numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Harus masuk terlebih dahulu'; END IF;
  IF _variant IS NULL THEN RAISE EXCEPTION 'Varian wajib dipilih untuk kartu produk'; END IF;
  SELECT * INTO _p FROM public.products WHERE id = _product;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;
  SELECT * INTO _v FROM public.product_variants
   WHERE id = _variant AND product_id = _product AND business_id = _p.business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak sesuai dengan produk ini'; END IF;
  IF NOT _v.is_active THEN RAISE EXCEPTION 'Varian ini tidak aktif'; END IF;
  IF NOT public.is_business_member(_p.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengirim katalog bisnis ini';
  END IF;

  _q := public.variant_unit_quantity(_v.id);
  _f := public.variant_display_factor(_v.id);

  SELECT coalesce(sum(u.qty_base),0), count(*)::int INTO _avail, _cnt
    FROM public.variant_stock_units u
   WHERE u.variant_id = _v.id AND u.status = 'available';

  -- HANYA media publik: foto varian (bukan unit, bukan draft konfirmasi)
  -- dan foto unit berstatus available. Draft/reserved/ready/delivered dikecualikan.
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'sort'), '[]'::jsonb) INTO _photos FROM (
    SELECT jsonb_build_object(
             'id', ph.id, 'image_path', ph.image_path, 'caption', coalesce(ph.caption,''),
             'location_url', coalesce(ph.location_url,''), 'location_label', coalesce(ph.location_label,''),
             'location_lat', ph.location_lat, 'location_lng', ph.location_lng,
             'sort', lpad(coalesce(ph.sort_order,0)::text, 6, '0')
           ) AS x
      FROM public.product_photos ph
      LEFT JOIN public.variant_stock_units u ON u.id = ph.stock_unit_id
     WHERE ph.variant_id = _v.id
       AND coalesce(ph.needs_variant_confirmation, false) = false
       AND (ph.stock_unit_id IS NULL OR u.status = 'available')
     LIMIT 12
  ) s;

  RETURN jsonb_build_object(
    'type', 'product_card',
    'productId', _p.id,
    'variantId', _v.id,
    'businessId', _p.business_id,
    'productName', _p.name,
    'variantName', _v.name,
    'price', round(coalesce(_v.price, _p.price, 0), 2),
    'unit', _q->>'unit',
    'description', coalesce(_p.description,''),
    'perUnitQty', (_q->>'qty_display')::numeric,
    'perUnitQtyBase', (_q->>'qty_base')::numeric,
    'perUnitUnit', _q->>'unit',
    'perUnitEditable', (_q->>'editable')::boolean,
    'availableQtyBase', _avail,
    'availableQtyDisplay', round(_avail / nullif(_f,0), 6),
    'availableUnitCount', _cnt,
    'stockLabel', to_char(round(_avail / nullif(_f,0), 6), 'FM999999990.######') || ' ' || (_q->>'unit'),
    'photos', _photos
  );
END $$;

REVOKE ALL ON FUNCTION public.build_product_card(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_product_card(uuid, uuid) TO authenticated, service_role;

-- =====================================================================
-- create_chat_order: isi per unit diturunkan dari varian
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_chat_order(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _conv uuid := (_payload->>'conversation_id')::uuid;
  _biz uuid := (_payload->>'business_id')::uuid;
  _idem text := coalesce(_payload->>'idempotency_key','');
  _items jsonb := coalesce(_payload->'items','[]'::jsonb);
  _it jsonb; _o public.chat_orders; _v public.product_variants; _prod text;
  _base numeric; _i int := 0; _sub numeric := 0; _existing uuid;
  _seller boolean; _buyer uuid; _cust uuid; _name text; _claim uuid; _role public.business_role;
  _q jsonb; _qty numeric; _unit text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Harus masuk terlebih dahulu'; END IF;
  IF NOT public.current_user_can_send_conversation(_conv) THEN
    RAISE EXCEPTION 'Tidak berwenang mengirim ke percakapan ini';
  END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Minimal satu item'; END IF;
  IF jsonb_array_length(_items) > 50 THEN RAISE EXCEPTION 'Terlalu banyak item pada satu pesanan'; END IF;

  _role := public.business_role_of(_biz, _uid);
  _seller := _role IN ('owner','admin','agent','cashier');

  IF _role IS NOT NULL AND NOT _seller THEN
    RAISE EXCEPTION 'Peran Anda tidak berwenang membuat pesanan untuk bisnis ini';
  END IF;

  IF NOT _seller THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.business_conversations bc
       WHERE bc.conversation_id = _conv AND bc.business_id = _biz
         AND (bc.customer_id = _uid
              OR EXISTS (SELECT 1 FROM public.direct_conversations dc
                          WHERE dc.conversation_id = _conv AND _uid IN (dc.user_low, dc.user_high)))
    ) THEN
      RAISE EXCEPTION 'Katalog bisnis ini tidak tersedia pada percakapan ini';
    END IF;
  ELSIF NOT EXISTS (
      SELECT 1 FROM public.business_conversations bc WHERE bc.conversation_id = _conv AND bc.business_id = _biz
    ) AND NOT EXISTS (
      SELECT 1 FROM public.direct_conversations dc WHERE dc.conversation_id = _conv AND _uid IN (dc.user_low, dc.user_high)
    ) THEN
    RAISE EXCEPTION 'Percakapan ini tidak terhubung dengan bisnis Anda';
  END IF;

  IF _idem <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('chat_order:' || _biz::text || ':' || _idem, 0));
    SELECT id INTO _existing FROM public.chat_orders WHERE business_id = _biz AND idempotency_key = _idem;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;

  IF _seller THEN
    SELECT bc.customer_id INTO _buyer FROM public.business_conversations bc
      WHERE bc.conversation_id = _conv AND bc.business_id = _biz;
    IF _buyer IS NULL THEN
      SELECT CASE WHEN dc.user_low = _uid THEN dc.user_high ELSE dc.user_low END INTO _buyer
        FROM public.direct_conversations dc WHERE dc.conversation_id = _conv;
    END IF;
    _claim := nullif(_payload->>'buyer_user_id','')::uuid;
    IF _buyer IS NULL THEN
      RAISE EXCEPTION 'Pembeli tidak dapat ditentukan dari percakapan ini';
    END IF;
    IF _claim IS NOT NULL AND _claim <> _buyer THEN
      RAISE EXCEPTION 'Pembeli harus peserta percakapan ini';
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
      _cust, _name, 'buyer_requested', coalesce(_payload->>'note',''), nullif(_idem,''))
    RETURNING * INTO _o;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO _existing FROM public.chat_orders WHERE business_id = _biz AND idempotency_key = _idem;
    IF _existing IS NULL THEN RAISE; END IF;
    RETURN _existing;
  END;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _v FROM public.product_variants WHERE id = (_it->>'variant_id')::uuid AND business_id = _biz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak valid untuk bisnis ini'; END IF;
    IF NOT _v.is_active THEN RAISE EXCEPTION 'Varian % tidak aktif', _v.name; END IF;
    SELECT name INTO _prod FROM public.products WHERE id = _v.product_id;

    -- Isi per unit KANONIK dari definisi varian. Pembeli tidak boleh mengubahnya;
    -- penjual boleh menawarkan isi lain hanya bila varian mengizinkan.
    _q := public.variant_unit_quantity(_v.id);
    _qty := (_q->>'qty_display')::numeric;
    _unit := _q->>'unit';
    IF (_it ? 'per_unit_qty') AND nullif(_it->>'per_unit_qty','') IS NOT NULL THEN
      IF (_it->>'per_unit_qty')::numeric <> _qty OR coalesce(nullif(_it->>'per_unit_unit',''), _unit) <> _unit THEN
        IF NOT _seller OR NOT (_q->>'editable')::boolean THEN
          RAISE EXCEPTION 'Isi per unit % mengikuti definisi varian', _prod;
        END IF;
        _qty := (_it->>'per_unit_qty')::numeric;
        _unit := coalesce(nullif(_it->>'per_unit_unit',''), _unit);
      END IF;
    END IF;

    _base := public.convert_to_base(_v.id, _qty, _unit);
    IF _base IS NULL OR _base <= 0 THEN RAISE EXCEPTION 'Jumlah per unit tidak valid untuk %', _prod; END IF;
    IF coalesce((_it->>'unit_count')::int,0) <= 0 THEN RAISE EXCEPTION 'Jumlah unit harus lebih dari nol'; END IF;
    IF (_it->>'unit_count')::int > 100 THEN RAISE EXCEPTION 'Jumlah unit per item maksimal 100'; END IF;

    INSERT INTO public.chat_order_items (chat_order_id, business_id, product_id, variant_id, product_name, variant_name,
      unit_count, per_unit_qty, per_unit_unit, per_unit_qty_base, price, discount, sort_order)
    VALUES (_o.id, _biz, _v.product_id, _v.id, _prod, _v.name,
      (_it->>'unit_count')::int, _qty, _unit, _base,
      round(coalesce((_it->>'price')::numeric, _v.price), 2), round(coalesce((_it->>'discount')::numeric,0),2), _i);
    _sub := _sub + greatest(0, round(coalesce((_it->>'price')::numeric, _v.price),2) - round(coalesce((_it->>'discount')::numeric,0),2)) * (_it->>'unit_count')::int;
    _i := _i + 1;
  END LOOP;

  UPDATE public.chat_orders SET subtotal = round(_sub,2), total = round(_sub,2) WHERE id = _o.id;
  RETURN _o.id;
END $function$;

REVOKE ALL ON FUNCTION public.create_chat_order(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_chat_order(jsonb) TO authenticated, service_role;

-- =====================================================================
-- Pesanan + kartu chat dalam satu transaksi
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_chat_order_with_message(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _order uuid; _conv uuid; _msg uuid; _cid text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Harus masuk terlebih dahulu'; END IF;
  _order := public.create_chat_order(_payload);
  SELECT conversation_id INTO _conv FROM public.chat_orders WHERE id = _order;
  _cid := 'chat-order:' || _order::text;

  SELECT id INTO _msg FROM public.messages
   WHERE conversation_id = _conv AND client_id = _cid LIMIT 1;

  IF _msg IS NULL THEN
    INSERT INTO public.messages (conversation_id, sender_id, kind, body, client_id, payload)
    VALUES (_conv, _uid, 'order', 'Permintaan pesanan', _cid,
            jsonb_build_object('chatOrderId', _order))
    ON CONFLICT DO NOTHING
    RETURNING id INTO _msg;
    IF _msg IS NULL THEN
      SELECT id INTO _msg FROM public.messages
       WHERE conversation_id = _conv AND client_id = _cid LIMIT 1;
    END IF;
  END IF;

  RETURN jsonb_build_object('order_id', _order, 'message_id', _msg);
END $$;

REVOKE ALL ON FUNCTION public.create_chat_order_with_message(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_chat_order_with_message(jsonb) TO authenticated, service_role;

-- =====================================================================
-- Kapabilitas pesanan per aktor + status
-- =====================================================================
CREATE OR REPLACE FUNCTION public.my_chat_order_capability(_order uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _o public.chat_orders; _manage boolean; _read boolean; _buyer boolean; _reason text := '';
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('read',false,'confirm',false,'approve',false,'request_changes',false,
                              'dispatch',false,'cancel',false,'finalize',false,'reason','Harus masuk terlebih dahulu');
  END IF;
  SELECT * INTO _o FROM public.chat_orders WHERE id = _order;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('read',false,'confirm',false,'approve',false,'request_changes',false,
                              'dispatch',false,'cancel',false,'finalize',false,'reason','Pesanan tidak ditemukan');
  END IF;

  _read := public.chat_order_actor_can_read(_order, _uid);
  _manage := public.chat_order_actor_can_manage(_order, _uid);
  _buyer := (_o.buyer_user_id = _uid);

  IF NOT _read THEN _reason := 'Anda tidak berhak melihat pesanan ini';
  ELSIF _o.status = 'cancelled' THEN _reason := 'Pesanan dibatalkan';
  ELSIF _o.status = 'delivered' THEN _reason := 'Pesanan sudah terkirim';
  ELSIF NOT _manage AND NOT _buyer THEN _reason := 'Anda hanya dapat melihat pesanan ini';
  END IF;

  RETURN jsonb_build_object(
    'read', _read,
    'is_buyer', _buyer,
    'is_manager', _manage,
    'confirm', _manage AND _o.status IN ('buyer_requested','changes_requested'),
    'approve', _buyer AND _o.status = 'seller_confirmed',
    'request_changes', _buyer AND _o.status = 'seller_confirmed',
    'dispatch', _manage AND _o.status = 'buyer_approved',
    'cancel', (_manage OR _buyer) AND _o.status NOT IN ('cancelled','delivered'),
    'finalize', _manage AND _o.status = 'ready_for_payment',
    'status', _o.status,
    'reason', _reason
  );
END $$;

REVOKE ALL ON FUNCTION public.my_chat_order_capability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_chat_order_capability(uuid) TO authenticated, service_role;

-- =====================================================================
-- Direktori pegawai operasional (tanpa viewer, tanpa PIN)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.business_preparation_staff(_business uuid)
RETURNS TABLE(user_id uuid, role public.business_role, display_name text, avatar_color text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.user_id, m.role,
         COALESCE(NULLIF(m.staff_display_name, ''), p.display_name, 'Pegawai'),
         COALESCE(p.avatar_color, 'emerald')
  FROM public.business_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.business_id = _business
    AND m.role IN ('owner','admin','agent','cashier')
    AND public.can_sell_business(_business, auth.uid())
  ORDER BY m.created_at
$$;

REVOKE ALL ON FUNCTION public.business_preparation_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_preparation_staff(uuid) TO authenticated, service_role;