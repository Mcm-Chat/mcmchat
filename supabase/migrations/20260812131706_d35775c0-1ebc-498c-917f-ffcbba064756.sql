-- 1. Order items: dukung varian, satuan, dan jumlah desimal
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS qty_num numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_base numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variant_name text NOT NULL DEFAULT '';

ALTER TABLE public.order_items ALTER COLUMN qty SET DEFAULT 1;

-- 2. Idempotensi penjualan
CREATE UNIQUE INDEX IF NOT EXISTS sales_records_business_idem_key
  ON public.sales_records (business_id, idempotency_key);

-- 3. Satu ledger per sales record
CREATE UNIQUE INDEX IF NOT EXISTS ledgers_sales_record_unique
  ON public.ledgers (sales_record_id) WHERE sales_record_id IS NOT NULL;

-- 4. Transaksi penjualan atomik
CREATE OR REPLACE FUNCTION public.create_sale_tx(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _biz uuid := (_payload->>'business_id')::uuid;
  _idem text := coalesce(_payload->>'idempotency_key','');
  _existing public.sales_records;
  _order public.orders;
  _rec public.sales_records;
  _it jsonb;
  _subtotal numeric := 0;
  _discount numeric := greatest(0, coalesce((_payload->>'discount')::numeric, 0));
  _extra numeric := greatest(0, coalesce((_payload->>'extra_fee')::numeric, 0));
  _total numeric;
  _paid numeric;
  _method public.payment_method := coalesce((_payload->>'payment_method')::public.payment_method, 'cash');
  _due date := nullif(_payload->>'due_date','')::date;
  _number text;
  _conv uuid := nullif(_payload->>'conversation_id','')::uuid;
  _cust_user uuid := nullif(_payload->>'customer_user_id','')::uuid;
  _cust_name text := coalesce(_payload->>'customer_name','Pelanggan');
  _note text := coalesce(_payload->>'note','');
  _items jsonb := coalesce(_payload->'items','[]'::jsonb);
  _ledger uuid;
BEGIN
  IF _uid IS NULL OR NOT public.can_sell_business(_biz, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mencatat penjualan';
  END IF;
  IF _idem = '' THEN RAISE EXCEPTION 'Kunci idempotensi wajib'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Minimal satu item penjualan'; END IF;

  SELECT * INTO _existing FROM public.sales_records
   WHERE business_id = _biz AND idempotency_key = _idem;
  IF FOUND THEN
    RETURN jsonb_build_object('sale_id', _existing.id, 'order_id', _existing.order_id,
      'total', _existing.total, 'paid', _existing.paid_amount, 'already', true,
      'number', coalesce(_existing.payload->>'number',''));
  END IF;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF coalesce((_it->>'qty')::numeric,0) <= 0 THEN RAISE EXCEPTION 'Jumlah item harus lebih dari nol'; END IF;
    IF coalesce((_it->>'price')::numeric,0) < 0 OR coalesce((_it->>'discount')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'Harga dan diskon tidak boleh negatif';
    END IF;
    _subtotal := _subtotal + greatest(0, (_it->>'price')::numeric - coalesce((_it->>'discount')::numeric,0)) * (_it->>'qty')::numeric;
  END LOOP;

  _total := round(greatest(0, _subtotal - _discount + _extra), 2);
  IF _total <= 0 THEN RAISE EXCEPTION 'Total penjualan harus lebih dari nol'; END IF;
  _paid := least(greatest(0, coalesce((_payload->>'paid_amount')::numeric, 0)), _total);
  IF _method = 'cash' OR _method = 'transfer' THEN _paid := _total; END IF;
  IF _method = 'dp' AND _paid <= 0 THEN RAISE EXCEPTION 'DP harus lebih dari nol'; END IF;
  IF _method IN ('dp','credit') AND _due IS NULL THEN RAISE EXCEPTION 'Tanggal jatuh tempo wajib untuk DP atau kredit'; END IF;

  _number := 'INV-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*9000)+1000)::int::text, 4, '0');

  INSERT INTO public.orders (business_id, number, buyer_user_id, note, discount, shipping, total, status)
  VALUES (_biz, _number, _cust_user, _note, _discount, _extra, _total, 'new')
  RETURNING * INTO _order;

  INSERT INTO public.order_items (order_id, business_id, product_id, variant_id, name, variant_name,
    qty, qty_num, qty_base, unit, price, discount, photo_ids)
  SELECT _order.id, _biz,
    nullif(_it2->>'product_id','')::uuid,
    nullif(_it2->>'variant_id','')::uuid,
    coalesce(_it2->>'name',''),
    coalesce(_it2->>'variant_name',''),
    greatest(1, ceil((_it2->>'qty')::numeric)::int),
    (_it2->>'qty')::numeric,
    coalesce((_it2->>'qty_base')::numeric, (_it2->>'qty')::numeric),
    coalesce(_it2->>'unit',''),
    (_it2->>'price')::numeric,
    coalesce((_it2->>'discount')::numeric, 0),
    coalesce((SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(_it2->'photo_ids','[]'::jsonb)) AS value), '{}')
  FROM jsonb_array_elements(_items) AS _it2;

  INSERT INTO public.sales_records (business_id, seller_id, order_id, idempotency_key, customer_user_id,
    conversation_id, subtotal, discount, extra_fee, total, paid_amount, payment_method, due_date, note, payload)
  VALUES (_biz, _uid, _order.id, _idem, _cust_user, _conv, round(_subtotal,2), _discount, _extra, _total,
    _paid, _method, _due, _note,
    jsonb_build_object('number', _number, 'customerName', _cust_name, 'items', _items))
  RETURNING * INTO _rec;

  IF _total - _paid > 0 THEN
    INSERT INTO public.ledgers (owner_id, counterpart_user_id, counterpart_name, type, amount, paid_amount,
      due_date, note, sales_record_id, conversation_id, status)
    VALUES (_uid, _cust_user, _cust_name, 'receivable', _total, _paid, _due,
      'Penjualan ' || _number, _rec.id, _conv,
      CASE WHEN _paid > 0 THEN 'partially_paid'::public.ledger_status ELSE 'active'::public.ledger_status END)
    ON CONFLICT (sales_record_id) DO NOTHING
    RETURNING id INTO _ledger;

    IF _ledger IS NOT NULL THEN
      INSERT INTO public.ledger_events (ledger_id, actor_id, label, detail)
      VALUES (_ledger, _uid, 'Catatan dibuat dari penjualan', _number);
    END IF;
  END IF;

  RETURN jsonb_build_object('sale_id', _rec.id, 'order_id', _order.id, 'ledger_id', _ledger,
    'total', _total, 'paid', _paid, 'number', _number, 'already', false);
END $$;

REVOKE ALL ON FUNCTION public.create_sale_tx(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_tx(jsonb) TO authenticated;