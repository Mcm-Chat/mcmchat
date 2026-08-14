-- ============================================================
-- A. TIPE
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.stock_unit_status AS ENUM ('draft','available','reserved','preparing','ready','delivered','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.stock_unit_source AS ENUM ('manual','preparation','legacy','return');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.chat_order_status AS ENUM ('buyer_requested','seller_confirmed','changes_requested','buyer_approved','dispatched_to_preparation','preparing','ready_for_payment','delivered','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.unit_slot_mode AS ENUM ('existing','prepare_new');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.unit_slot_status AS ENUM ('pending','reserved','preparing','ready','delivered','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- A1. UNIT FISIK (SSOT)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.variant_stock_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  unit_seq integer NOT NULL DEFAULT 0,
  unit_label text NOT NULL DEFAULT '',
  qty_base numeric(18,6) NOT NULL DEFAULT 0,
  status public.stock_unit_status NOT NULL DEFAULT 'draft',
  note text NOT NULL DEFAULT '',
  source_type public.stock_unit_source NOT NULL DEFAULT 'manual',
  chat_order_id uuid,
  chat_order_item_id uuid,
  unit_slot_id uuid,
  preparation_job_id uuid REFERENCES public.preparation_jobs(id) ON DELETE SET NULL,
  preparation_job_item_id uuid REFERENCES public.preparation_job_items(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  customer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  reserved_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  released_at timestamptz,
  version integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vsu_qty_positive CHECK (status IN ('draft','void') OR qty_base > 0),
  CONSTRAINT vsu_delivered_needs_owner CHECK (
    status <> 'delivered' OR (delivered_at IS NOT NULL AND (customer_user_id IS NOT NULL OR customer_id IS NOT NULL OR chat_order_id IS NOT NULL))
  ),
  CONSTRAINT vsu_alloc_needs_slot CHECK (
    status NOT IN ('reserved','preparing') OR unit_slot_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS vsu_one_active_slot ON public.variant_stock_units(unit_slot_id) WHERE unit_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vsu_variant_status ON public.variant_stock_units(variant_id, status);
CREATE INDEX IF NOT EXISTS vsu_business ON public.variant_stock_units(business_id, status);
CREATE INDEX IF NOT EXISTS vsu_customer ON public.variant_stock_units(customer_user_id) WHERE customer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vsu_order ON public.variant_stock_units(chat_order_id);

-- ============================================================
-- A2. PESANAN CHAT
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  buyer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT '',
  status public.chat_order_status NOT NULL DEFAULT 'buyer_requested',
  note text NOT NULL DEFAULT '',
  seller_note text NOT NULL DEFAULT '',
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  discount numeric(18,2) NOT NULL DEFAULT 0,
  extra_fee numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL DEFAULT 0,
  preparation_job_id uuid REFERENCES public.preparation_jobs(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  sales_record_id uuid REFERENCES public.sales_records(id) ON DELETE SET NULL,
  ledger_id uuid REFERENCES public.ledgers(id) ON DELETE SET NULL,
  request_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  result_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL DEFAULT '',
  confirmed_at timestamptz,
  approved_at timestamptz,
  dispatched_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_orders_idem ON public.chat_orders(business_id, idempotency_key) WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS chat_orders_conv ON public.chat_orders(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_orders_biz ON public.chat_orders(business_id, status);

CREATE TABLE IF NOT EXISTS public.chat_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_order_id uuid NOT NULL REFERENCES public.chat_orders(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT '',
  variant_name text NOT NULL DEFAULT '',
  unit_count integer NOT NULL DEFAULT 1 CHECK (unit_count > 0),
  per_unit_qty numeric(18,6) NOT NULL DEFAULT 0 CHECK (per_unit_qty > 0),
  per_unit_unit text NOT NULL DEFAULT '',
  per_unit_qty_base numeric(18,6) NOT NULL DEFAULT 0 CHECK (per_unit_qty_base > 0),
  price numeric(18,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  discount numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  availability_note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_order_items_order ON public.chat_order_items(chat_order_id, sort_order);

CREATE TABLE IF NOT EXISTS public.chat_order_unit_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_order_id uuid NOT NULL REFERENCES public.chat_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.chat_order_items(id) ON DELETE CASCADE,
  slot_no integer NOT NULL CHECK (slot_no > 0),
  qty_base numeric(18,6) NOT NULL CHECK (qty_base > 0),
  mode public.unit_slot_mode NOT NULL DEFAULT 'prepare_new',
  stock_unit_id uuid REFERENCES public.variant_stock_units(id) ON DELETE SET NULL,
  preparation_job_item_id uuid REFERENCES public.preparation_job_items(id) ON DELETE SET NULL,
  status public.unit_slot_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, slot_no)
);
CREATE INDEX IF NOT EXISTS chat_order_slots_order ON public.chat_order_unit_slots(chat_order_id, slot_no);
CREATE UNIQUE INDEX IF NOT EXISTS chat_order_slots_unit ON public.chat_order_unit_slots(stock_unit_id) WHERE stock_unit_id IS NOT NULL;

ALTER TABLE public.variant_stock_units
  DROP CONSTRAINT IF EXISTS vsu_slot_fk,
  ADD CONSTRAINT vsu_slot_fk FOREIGN KEY (unit_slot_id) REFERENCES public.chat_order_unit_slots(id) ON DELETE SET NULL;
ALTER TABLE public.variant_stock_units
  DROP CONSTRAINT IF EXISTS vsu_order_fk,
  ADD CONSTRAINT vsu_order_fk FOREIGN KEY (chat_order_id) REFERENCES public.chat_orders(id) ON DELETE SET NULL;
ALTER TABLE public.variant_stock_units
  DROP CONSTRAINT IF EXISTS vsu_order_item_fk,
  ADD CONSTRAINT vsu_order_item_fk FOREIGN KEY (chat_order_item_id) REFERENCES public.chat_order_items(id) ON DELETE SET NULL;

-- ============================================================
-- A3. KOLOM TAMBAHAN PADA TABEL LAMA
-- ============================================================
ALTER TABLE public.product_photos ADD COLUMN IF NOT EXISTS stock_unit_id uuid REFERENCES public.variant_stock_units(id) ON DELETE SET NULL;
ALTER TABLE public.product_photos ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE public.product_photos ADD COLUMN IF NOT EXISTS needs_variant_confirmation boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS product_photos_unit ON public.product_photos(stock_unit_id);

ALTER TABLE public.preparation_job_items ADD COLUMN IF NOT EXISTS chat_order_slot_id uuid REFERENCES public.chat_order_unit_slots(id) ON DELETE SET NULL;
ALTER TABLE public.preparation_job_items ADD COLUMN IF NOT EXISTS stock_unit_id uuid REFERENCES public.variant_stock_units(id) ON DELETE SET NULL;
ALTER TABLE public.preparation_job_items ADD COLUMN IF NOT EXISTS unit_index integer NOT NULL DEFAULT 0;
ALTER TABLE public.preparation_job_items ADD COLUMN IF NOT EXISTS unit_total integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS prep_items_slot ON public.preparation_job_items(chat_order_slot_id) WHERE chat_order_slot_id IS NOT NULL;

ALTER TABLE public.preparation_jobs ADD COLUMN IF NOT EXISTS chat_order_id uuid REFERENCES public.chat_orders(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS stock_unit_id uuid REFERENCES public.variant_stock_units(id) ON DELETE SET NULL;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS stock_unit_ids uuid[] NOT NULL DEFAULT '{}';

-- ============================================================
-- A4. TRIGGER KONSISTENSI + updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.vsu_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.product_variants;
BEGIN
  SELECT * INTO v FROM public.product_variants WHERE id = NEW.variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
  IF NEW.product_id <> v.product_id OR NEW.business_id <> v.business_id THEN
    RAISE EXCEPTION 'Unit tidak konsisten dengan varian';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('reserved','preparing','ready','delivered') AND NEW.status = 'draft' THEN
      RAISE EXCEPTION 'Unit yang sudah dialokasikan tidak bisa kembali menjadi draf';
    END IF;
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vsu_guard_trg ON public.variant_stock_units;
CREATE TRIGGER vsu_guard_trg BEFORE INSERT OR UPDATE ON public.variant_stock_units
  FOR EACH ROW EXECUTE FUNCTION public.vsu_guard();

CREATE OR REPLACE FUNCTION public.vsu_no_hard_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Unit yang pernah dialokasikan tidak boleh dihapus permanen';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS vsu_no_hard_delete_trg ON public.variant_stock_units;
CREATE TRIGGER vsu_no_hard_delete_trg BEFORE DELETE ON public.variant_stock_units
  FOR EACH ROW EXECUTE FUNCTION public.vsu_no_hard_delete();

DROP TRIGGER IF EXISTS chat_orders_touch ON public.chat_orders;
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER chat_orders_touch BEFORE UPDATE ON public.chat_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS chat_order_items_touch ON public.chat_order_items;
CREATE TRIGGER chat_order_items_touch BEFORE UPDATE ON public.chat_order_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS chat_order_slots_touch ON public.chat_order_unit_slots;
CREATE TRIGGER chat_order_slots_touch BEFORE UPDATE ON public.chat_order_unit_slots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- H. GRANT + RLS
-- ============================================================
GRANT SELECT ON public.variant_stock_units TO authenticated;
GRANT SELECT ON public.chat_orders TO authenticated;
GRANT SELECT ON public.chat_order_items TO authenticated;
GRANT SELECT ON public.chat_order_unit_slots TO authenticated;
GRANT ALL ON public.variant_stock_units TO service_role;
GRANT ALL ON public.chat_orders TO service_role;
GRANT ALL ON public.chat_order_items TO service_role;
GRANT ALL ON public.chat_order_unit_slots TO service_role;

ALTER TABLE public.variant_stock_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_order_unit_slots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_user_can_read_chat_order(_order uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_orders o
    WHERE o.id = _order
      AND (o.buyer_user_id = auth.uid()
        OR o.created_by = auth.uid()
        OR public.is_business_member(o.business_id, auth.uid()))
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_read_stock_unit(_unit uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.variant_stock_units u
    WHERE u.id = _unit
      AND (public.is_business_member(u.business_id, auth.uid())
        OR (u.customer_user_id = auth.uid() AND u.status = 'delivered'))
  )
$$;

DROP POLICY IF EXISTS "stock units readable" ON public.variant_stock_units;
CREATE POLICY "stock units readable" ON public.variant_stock_units FOR SELECT TO authenticated
  USING (public.is_business_member(business_id, auth.uid())
      OR (customer_user_id = auth.uid() AND status = 'delivered'));

DROP POLICY IF EXISTS "chat orders readable" ON public.chat_orders;
CREATE POLICY "chat orders readable" ON public.chat_orders FOR SELECT TO authenticated
  USING (buyer_user_id = auth.uid() OR created_by = auth.uid()
      OR public.is_business_member(business_id, auth.uid()));

DROP POLICY IF EXISTS "chat order items readable" ON public.chat_order_items;
CREATE POLICY "chat order items readable" ON public.chat_order_items FOR SELECT TO authenticated
  USING (public.current_user_can_read_chat_order(chat_order_id));

DROP POLICY IF EXISTS "chat order slots readable" ON public.chat_order_unit_slots;
CREATE POLICY "chat order slots readable" ON public.chat_order_unit_slots FOR SELECT TO authenticated
  USING (public.current_user_can_read_chat_order(chat_order_id));

-- ============================================================
-- A5. HELPER INTERNAL: PERGERAKAN SALDO PER UNIT
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_unit_balance(_unit public.variant_stock_units, _delta numeric, _kind text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before numeric; _after numeric; _scale int;
BEGIN
  IF _delta = 0 THEN RETURN; END IF;
  SELECT CASE WHEN stock_type = 'weight' THEN 6 ELSE 0 END INTO _scale
    FROM public.product_variants WHERE id = _unit.variant_id;
  INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
  VALUES (_unit.variant_id, _unit.business_id, _unit.product_id, 0)
  ON CONFLICT (variant_id) DO NOTHING;
  SELECT qty_base INTO _before FROM public.inventory_balances WHERE variant_id = _unit.variant_id FOR UPDATE;
  _after := round(_before + _delta, _scale);
  IF _after < 0 THEN RAISE EXCEPTION 'Stok tidak mencukupi untuk unit ini'; END IF;
  UPDATE public.inventory_balances SET qty_base = _after, updated_at = now() WHERE variant_id = _unit.variant_id;
  INSERT INTO public.inventory_movements (
    business_id, product_id, variant_id, movement_type, qty_base,
    balance_before, balance_after, ref_type, ref_id, note, created_by, stock_unit_id
  ) VALUES (
    _unit.business_id, _unit.product_id, _unit.variant_id,
    CASE WHEN _delta > 0 THEN 'restock'::public.inventory_movement_type ELSE 'preparation'::public.inventory_movement_type END,
    round(_delta, _scale), _before, _after, 'stock_unit_' || _kind, gen_random_uuid(),
    coalesce(_note,''), auth.uid(), _unit.id
  );
END $$;

-- ============================================================
-- A6. RPC UNIT
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_stock_unit(_variant uuid, _qty_base numeric, _note text DEFAULT '', _label text DEFAULT '')
RETURNS public.variant_stock_units LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.product_variants; u public.variant_stock_units; _uid uuid := auth.uid(); _seq int;
BEGIN
  SELECT * INTO v FROM public.product_variants WHERE id = _variant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(v.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang menambah unit';
  END IF;
  IF coalesce(_qty_base,0) <= 0 THEN RAISE EXCEPTION 'Jumlah unit harus lebih dari nol'; END IF;
  SELECT coalesce(max(unit_seq),0) + 1 INTO _seq FROM public.variant_stock_units WHERE variant_id = _variant;
  INSERT INTO public.variant_stock_units (business_id, product_id, variant_id, unit_seq, unit_label, qty_base, status, note, source_type, created_by, updated_by)
  VALUES (v.business_id, v.product_id, v.id, _seq,
          coalesce(nullif(_label,''), 'Unit ' || _seq), _qty_base, 'draft', coalesce(_note,''), 'manual', _uid, _uid)
  RETURNING * INTO u;
  RETURN u;
END $$;

CREATE OR REPLACE FUNCTION public.activate_stock_unit(_unit uuid)
RETURNS public.variant_stock_units LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.variant_stock_units; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO u FROM public.variant_stock_units WHERE id = _unit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(u.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengaktifkan unit';
  END IF;
  IF u.status = 'available' THEN RETURN u; END IF;
  IF u.status <> 'draft' THEN RAISE EXCEPTION 'Hanya unit draf yang bisa diaktifkan'; END IF;
  IF u.qty_base <= 0 THEN RAISE EXCEPTION 'Jumlah unit harus lebih dari nol'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_photos WHERE stock_unit_id = u.id) THEN
    RAISE EXCEPTION 'Unit wajib memiliki minimal satu foto';
  END IF;
  PERFORM public.apply_unit_balance(u, u.qty_base, 'activate', 'Aktivasi unit ' || u.unit_label);
  UPDATE public.variant_stock_units
     SET status = 'available', released_at = NULL, updated_by = _uid
   WHERE id = u.id RETURNING * INTO u;
  RETURN u;
END $$;

CREATE OR REPLACE FUNCTION public.void_stock_unit(_unit uuid, _reason text DEFAULT '')
RETURNS public.variant_stock_units LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.variant_stock_units; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO u FROM public.variant_stock_units WHERE id = _unit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unit tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(u.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang membatalkan unit';
  END IF;
  IF u.status = 'void' THEN RETURN u; END IF;
  IF u.status IN ('reserved','preparing','delivered') THEN
    RAISE EXCEPTION 'Unit sedang terikat pesanan; batalkan pesanan terlebih dahulu';
  END IF;
  IF u.status = 'available' THEN
    PERFORM public.apply_unit_balance(u, -u.qty_base, 'void', 'Unit dibatalkan');
  END IF;
  UPDATE public.variant_stock_units
     SET status = 'void', note = CASE WHEN coalesce(_reason,'') = '' THEN note ELSE _reason END, updated_by = _uid
   WHERE id = u.id RETURNING * INTO u;
  RETURN u;
END $$;

-- ============================================================
-- C. PESANAN CHAT
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_chat_order(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _conv uuid := (_payload->>'conversation_id')::uuid;
  _biz uuid := (_payload->>'business_id')::uuid;
  _idem text := coalesce(_payload->>'idempotency_key','');
  _items jsonb := coalesce(_payload->'items','[]'::jsonb);
  _it jsonb; _o public.chat_orders; _v public.product_variants; _prod text;
  _base numeric; _i int := 0; _sub numeric := 0; _existing uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Harus masuk terlebih dahulu'; END IF;
  IF NOT public.current_user_can_send_conversation(_conv) THEN
    RAISE EXCEPTION 'Tidak berwenang mengirim ke percakapan ini';
  END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Minimal satu item'; END IF;
  IF _idem <> '' THEN
    SELECT id INTO _existing FROM public.chat_orders WHERE business_id = _biz AND idempotency_key = _idem;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;
  -- Bisnis harus sah untuk percakapan ini: registry business_conversations atau caller anggota bisnis.
  IF NOT (
    EXISTS (SELECT 1 FROM public.business_conversations bc WHERE bc.conversation_id = _conv AND bc.business_id = _biz)
    OR public.is_business_member(_biz, _uid)
  ) THEN
    RAISE EXCEPTION 'Katalog bisnis ini tidak tersedia pada percakapan ini';
  END IF;

  INSERT INTO public.chat_orders (business_id, conversation_id, buyer_user_id, seller_id, created_by,
    customer_name, status, note, idempotency_key)
  VALUES (_biz, _conv,
    CASE WHEN public.is_business_member(_biz, _uid) THEN nullif(_payload->>'buyer_user_id','')::uuid ELSE _uid END,
    CASE WHEN public.is_business_member(_biz, _uid) THEN _uid ELSE NULL END,
    _uid, coalesce(_payload->>'customer_name',''), 'buyer_requested', coalesce(_payload->>'note',''), _idem)
  RETURNING * INTO _o;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _v FROM public.product_variants WHERE id = (_it->>'variant_id')::uuid AND business_id = _biz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak valid untuk bisnis ini'; END IF;
    SELECT name INTO _prod FROM public.products WHERE id = _v.product_id;
    _base := public.convert_to_base(_v.id, (_it->>'per_unit_qty')::numeric, coalesce(_it->>'per_unit_unit', _v.display_unit));
    IF _base IS NULL OR _base <= 0 THEN RAISE EXCEPTION 'Jumlah per unit tidak valid untuk %', _prod; END IF;
    IF coalesce((_it->>'unit_count')::int,0) <= 0 THEN RAISE EXCEPTION 'Jumlah unit harus lebih dari nol'; END IF;
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
END $$;

CREATE OR REPLACE FUNCTION public.confirm_chat_order(_order uuid, _items jsonb DEFAULT '[]'::jsonb, _note text DEFAULT '', _discount numeric DEFAULT 0, _extra numeric DEFAULT 0)
RETURNS public.chat_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.chat_orders; _uid uuid := auth.uid(); _it jsonb; _sub numeric := 0;
BEGIN
  SELECT * INTO o FROM public.chat_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_sell_business(o.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengonfirmasi pesanan';
  END IF;
  IF o.status = 'seller_confirmed' THEN RETURN o; END IF;
  IF o.status NOT IN ('buyer_requested','changes_requested') THEN
    RAISE EXCEPTION 'Pesanan tidak dalam status yang bisa dikonfirmasi';
  END IF;

  FOR _it IN SELECT * FROM jsonb_array_elements(coalesce(_items,'[]'::jsonb)) LOOP
    UPDATE public.chat_order_items SET
      unit_count = greatest(1, coalesce((_it->>'unit_count')::int, unit_count)),
      price = round(coalesce((_it->>'price')::numeric, price),2),
      discount = round(coalesce((_it->>'discount')::numeric, discount),2),
      availability_note = coalesce(_it->>'availability_note', availability_note)
    WHERE id = (_it->>'id')::uuid AND chat_order_id = o.id;
  END LOOP;

  SELECT coalesce(sum(greatest(0, price - discount) * unit_count),0) INTO _sub
    FROM public.chat_order_items WHERE chat_order_id = o.id;

  UPDATE public.chat_orders SET status = 'seller_confirmed', confirmed_at = now(), seller_id = _uid,
    seller_note = coalesce(_note, seller_note),
    discount = greatest(0, coalesce(_discount,0)), extra_fee = greatest(0, coalesce(_extra,0)),
    subtotal = round(_sub,2), total = round(greatest(0, _sub - greatest(0,coalesce(_discount,0)) + greatest(0,coalesce(_extra,0))),2)
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION public.approve_chat_order(_order uuid)
RETURNS public.chat_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.chat_orders; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO o FROM public.chat_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  IF _uid IS NULL OR o.buyer_user_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'Hanya pembeli yang bisa menyetujui pesanan ini';
  END IF;
  IF o.status = 'buyer_approved' THEN RETURN o; END IF;
  IF o.status <> 'seller_confirmed' THEN RAISE EXCEPTION 'Pesanan belum dikonfirmasi penjual'; END IF;
  UPDATE public.chat_orders SET status = 'buyer_approved', approved_at = now() WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION public.request_chat_order_changes(_order uuid, _note text DEFAULT '')
RETURNS public.chat_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.chat_orders; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO o FROM public.chat_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  IF _uid IS NULL OR o.buyer_user_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'Hanya pembeli yang bisa meminta perubahan';
  END IF;
  IF o.status NOT IN ('buyer_requested','seller_confirmed','changes_requested') THEN
    RAISE EXCEPTION 'Perubahan tidak bisa diminta pada tahap ini';
  END IF;
  UPDATE public.chat_orders SET status = 'changes_requested', note = coalesce(nullif(_note,''), note)
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_chat_order(_order uuid, _reason text DEFAULT '', _void_ready boolean DEFAULT false)
RETURNS public.chat_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.chat_orders; _uid uuid := auth.uid(); u public.variant_stock_units; _manager boolean;
BEGIN
  SELECT * INTO o FROM public.chat_orders WHERE id = _order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesanan tidak ditemukan'; END IF;
  _manager := _uid IS NOT NULL AND public.can_manage_business(o.business_id, _uid);
  IF NOT _manager AND (o.buyer_user_id IS DISTINCT FROM _uid
      OR o.status NOT IN ('buyer_requested','seller_confirmed','changes_requested','buyer_approved')) THEN
    RAISE EXCEPTION 'Tidak berwenang membatalkan pesanan pada tahap ini';
  END IF;
  IF o.status = 'cancelled' THEN RETURN o; END IF;
  IF o.status = 'delivered' THEN RAISE EXCEPTION 'Pesanan sudah dikirim'; END IF;

  FOR u IN SELECT vsu.* FROM public.variant_stock_units vsu
            WHERE vsu.chat_order_id = o.id ORDER BY vsu.id FOR UPDATE LOOP
    IF u.status = 'reserved' AND u.source_type <> 'preparation' THEN
      PERFORM public.apply_unit_balance(u, u.qty_base, 'release', 'Pembatalan pesanan');
      UPDATE public.variant_stock_units SET status = 'available', unit_slot_id = NULL, chat_order_id = NULL,
        chat_order_item_id = NULL, reserved_at = NULL, released_at = now(), updated_by = _uid WHERE id = u.id;
    ELSIF u.status IN ('preparing') THEN
      UPDATE public.variant_stock_units SET status = 'void', unit_slot_id = NULL, released_at = now(), updated_by = _uid WHERE id = u.id;
    ELSIF u.status = 'ready' THEN
      IF _void_ready THEN
        UPDATE public.variant_stock_units SET status = 'void', unit_slot_id = NULL, released_at = now(), updated_by = _uid WHERE id = u.id;
      ELSE
        PERFORM public.apply_unit_balance(u, u.qty_base, 'release', 'Unit siap dikembalikan ke stok');
        UPDATE public.variant_stock_units SET status = 'available', unit_slot_id = NULL, chat_order_id = NULL,
          chat_order_item_id = NULL, reserved_at = NULL, released_at = now(), updated_by = _uid WHERE id = u.id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.chat_order_unit_slots SET status = 'cancelled', stock_unit_id = NULL WHERE chat_order_id = o.id AND status <> 'delivered';

  IF o.preparation_job_id IS NOT NULL THEN
    UPDATE public.preparation_jobs SET status = 'cancelled', revoked_at = coalesce(revoked_at, now())
     WHERE id = o.preparation_job_id AND status <> 'completed';
  END IF;

  UPDATE public.chat_orders SET status = 'cancelled', cancelled_at = now(),
    seller_note = CASE WHEN coalesce(_reason,'') = '' THEN seller_note ELSE _reason END
   WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END $$;

-- ============================================================
-- D. LANJUT KE PEGAWAI
-- ============================================================
CREATE OR REPLACE FUNCTION public.dispatch_chat_order(_order uuid, _assigned uuid, _slots jsonb, _expires_hours integer DEFAULT 168)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  o public.chat_orders; _uid uuid := auth.uid(); _token text; _job public.preparation_jobs;
  _s jsonb; _item public.chat_order_items; _slot public.chat_order_unit_slots;
  u public.variant_stock_units; _pi uuid; _i int := 0; _total int; _prod text;
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

  -- Slot harus tepat sejumlah unit yang diminta pada setiap item.
  FOR _item IN SELECT * FROM public.chat_order_items WHERE chat_order_id = o.id ORDER BY sort_order LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(_slots) e WHERE (e->>'item_id')::uuid = _item.id) <> _item.unit_count THEN
      RAISE EXCEPTION 'Jumlah slot untuk % harus tepat % unit', _item.product_name, _item.unit_count;
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

  SELECT count(*) INTO _total FROM jsonb_array_elements(_slots);

  FOR _s IN SELECT * FROM jsonb_array_elements(_slots) LOOP
    SELECT * INTO _item FROM public.chat_order_items WHERE id = (_s->>'item_id')::uuid AND chat_order_id = o.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item pesanan tidak valid'; END IF;
    SELECT name INTO _prod FROM public.products WHERE id = _item.product_id;
    _i := _i + 1;

    INSERT INTO public.chat_order_unit_slots (chat_order_id, item_id, slot_no, qty_base, mode, status)
    VALUES (o.id, _item.id, coalesce((_s->>'slot_no')::int, _i), _item.per_unit_qty_base,
      coalesce((_s->>'mode')::public.unit_slot_mode, 'prepare_new'), 'pending')
    ON CONFLICT (item_id, slot_no) DO UPDATE SET mode = EXCLUDED.mode, qty_base = EXCLUDED.qty_base, status = 'pending'
    RETURNING * INTO _slot;

    INSERT INTO public.preparation_job_items (job_id, product_id, variant_id, product_name, variant_name,
      requested_qty, requested_unit, requested_qty_base, require_photo, require_location, notes, sort_order,
      chat_order_slot_id, unit_index, unit_total)
    VALUES (_job.id, _item.product_id, _item.variant_id, _prod, _item.variant_name,
      _item.per_unit_qty, _item.per_unit_unit, _item.per_unit_qty_base,
      coalesce((_s->>'require_photo')::boolean, true), coalesce((_s->>'require_location')::boolean, true),
      coalesce(_s->>'notes',''), _i - 1, _slot.id, _i, _total)
    RETURNING id INTO _pi;

    UPDATE public.chat_order_unit_slots SET preparation_job_item_id = _pi WHERE id = _slot.id;

    IF (_s->>'mode') = 'existing' THEN
      SELECT * INTO u FROM public.variant_stock_units WHERE id = (_s->>'stock_unit_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unit siap tidak ditemukan'; END IF;
      IF u.status <> 'available' THEN RAISE EXCEPTION 'Unit % sudah tidak tersedia', u.unit_label; END IF;
      IF u.variant_id <> _item.variant_id THEN RAISE EXCEPTION 'Unit tidak cocok dengan varian pesanan'; END IF;
      IF round(u.qty_base,6) <> round(_item.per_unit_qty_base,6) THEN
        RAISE EXCEPTION 'Jumlah unit % tidak sama dengan permintaan', u.unit_label;
      END IF;
      PERFORM public.apply_unit_balance(u, -u.qty_base, 'reserve', 'Dipesan untuk ' || _job.code);
      UPDATE public.variant_stock_units SET status = 'reserved', unit_slot_id = _slot.id, chat_order_id = o.id,
        chat_order_item_id = _item.id, preparation_job_id = _job.id, preparation_job_item_id = _pi,
        conversation_id = o.conversation_id, customer_user_id = o.buyer_user_id, customer_id = o.customer_id,
        reserved_at = now(), updated_by = _uid WHERE id = u.id;
      UPDATE public.chat_order_unit_slots SET stock_unit_id = u.id, status = 'reserved' WHERE id = _slot.id;
      UPDATE public.preparation_job_items SET stock_unit_id = u.id WHERE id = _pi;
    END IF;
  END LOOP;

  UPDATE public.chat_orders SET status = 'dispatched_to_preparation', dispatched_at = now(),
    preparation_job_id = _job.id WHERE id = o.id;

  RETURN jsonb_build_object('id', _job.id, 'code', _job.code, 'token', _token, 'expires_at', _job.expires_at, 'already', false);
END $$;

-- ============================================================
-- E. PENYELESAIAN PEGAWAI (order-aware)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_preparation_job(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j public.preparation_jobs; it public.preparation_job_items; ph public.preparation_item_photos;
  _qty numeric; _before numeric; _after numeric; _photos integer := 0; _sort integer;
  _uid uuid := auth.uid(); u public.variant_stock_units; _newu public.variant_stock_units; _seq int;
BEGIN
  SELECT * INTO j FROM public.preparation_jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tugas tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT (j.assigned_user_id = _uid OR j.created_by = _uid OR public.can_manage_business(j.business_id, _uid)) THEN
    RAISE EXCEPTION 'Anda tidak berwenang menyelesaikan tugas ini';
  END IF;
  IF j.status = 'completed' THEN
    RETURN jsonb_build_object('id', j.id, 'status', 'completed', 'already', true);
  END IF;
  IF j.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Tugas sudah dibatalkan'; END IF;
  IF j.expires_at < now() THEN RAISE EXCEPTION 'Tautan tugas sudah kedaluwarsa'; END IF;

  FOR it IN SELECT * FROM public.preparation_job_items WHERE job_id = _job ORDER BY sort_order LOOP
    _qty := coalesce(it.actual_qty_base, it.requested_qty_base);

    -- Unit existing yang sudah direservasi: verifikasi saja, tidak dikurangi kedua kali.
    IF it.stock_unit_id IS NOT NULL THEN
      SELECT * INTO u FROM public.variant_stock_units WHERE id = it.stock_unit_id FOR UPDATE;
      IF u.status IN ('reserved','preparing') THEN
        UPDATE public.variant_stock_units SET status = 'ready', ready_at = now(), updated_by = _uid WHERE id = u.id;
        UPDATE public.chat_order_unit_slots SET status = 'ready' WHERE id = it.chat_order_slot_id;
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

    INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
    VALUES (it.variant_id, j.business_id, it.product_id, 0) ON CONFLICT (variant_id) DO NOTHING;
    SELECT qty_base INTO _before FROM public.inventory_balances WHERE variant_id = it.variant_id FOR UPDATE;
    _after := _before - _qty;
    IF _after < 0 THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi (tersedia %, dibutuhkan %)', it.product_name, _before, _qty;
    END IF;
    UPDATE public.inventory_balances SET qty_base = _after, updated_at = now() WHERE variant_id = it.variant_id;
    INSERT INTO public.inventory_movements (business_id, product_id, variant_id, movement_type, qty_base,
      balance_before, balance_after, ref_type, ref_id, note, created_by)
    VALUES (j.business_id, it.product_id, it.variant_id, 'preparation', -_qty, _before, _after,
      'preparation_job_item', it.id, 'Penyiapan ' || j.code, j.assigned_user_id)
    ON CONFLICT (ref_type, ref_id) DO NOTHING;

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

    IF it.chat_order_slot_id IS NOT NULL THEN
      UPDATE public.chat_order_unit_slots SET stock_unit_id = _newu.id, status = 'ready' WHERE id = it.chat_order_slot_id;
    END IF;

    SELECT coalesce(max(sort_order), -1) + 1 INTO _sort FROM public.product_photos WHERE product_id = it.product_id;
    FOR ph IN SELECT * FROM public.preparation_item_photos WHERE job_item_id = it.id ORDER BY sort_order LOOP
      INSERT INTO public.product_photos (business_id, product_id, variant_id, stock_unit_id, is_primary, image_path, caption,
        location_lat, location_lng, location_accuracy, location_label, location_url,
        group_label, sort_order, preparation_job_id, preparation_job_item_id, source_photo_id,
        source_type, location_mode, created_by)
      VALUES (j.business_id, it.product_id, it.variant_id, _newu.id, (_photos = 0), ph.storage_path, ph.caption,
        ph.lat, ph.lng, ph.accuracy, ph.location_label, ph.maps_url,
        it.product_name || ' — ' || it.variant_name, _sort, j.id, it.id, ph.id, 'preparation',
        CASE WHEN ph.lat IS NOT NULL AND ph.lng IS NOT NULL THEN 'auto' ELSE 'none' END, j.assigned_user_id)
      ON CONFLICT (source_photo_id) DO NOTHING;
      _sort := _sort + 1; _photos := _photos + 1;
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
END $$;

-- ============================================================
-- F. PEMBAYARAN + PENGIRIMAN
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_chat_order_delivery(_order uuid, _payment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.chat_orders; _uid uuid := auth.uid(); _method public.payment_method;
  _due date; _paid numeric; _total numeric; _sub numeric; _number text;
  _ord public.orders; _rec public.sales_records; _ledger uuid; _msg uuid;
  _item public.chat_order_items; u public.variant_stock_units; _units jsonb := '[]'::jsonb;
  _unit_ids uuid[]; _payload jsonb; _idem text;
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

  _method := coalesce((_payment->>'payment_method')::public.payment_method, 'cash');
  _due := nullif(_payment->>'due_date','')::date;
  _idem := coalesce(nullif(_payment->>'idempotency_key',''), 'chatorder:' || o.id::text);

  SELECT coalesce(sum(greatest(0, price - discount) * unit_count),0) INTO _sub
    FROM public.chat_order_items WHERE chat_order_id = o.id;
  _total := round(greatest(0, _sub - o.discount + o.extra_fee), 2);
  IF _total <= 0 THEN RAISE EXCEPTION 'Total pesanan harus lebih dari nol'; END IF;
  _paid := least(greatest(0, coalesce((_payment->>'paid_amount')::numeric, 0)), _total);
  IF _method IN ('cash','transfer') THEN _paid := _total; END IF;
  IF _method = 'dp' AND _paid <= 0 THEN RAISE EXCEPTION 'DP harus lebih dari nol'; END IF;
  IF _method IN ('dp','credit') AND _due IS NULL THEN RAISE EXCEPTION 'Tanggal jatuh tempo wajib untuk DP atau kredit'; END IF;

  -- Semua slot harus siap.
  IF EXISTS (SELECT 1 FROM public.chat_order_unit_slots WHERE chat_order_id = o.id AND status <> 'ready') THEN
    RAISE EXCEPTION 'Masih ada unit yang belum siap';
  END IF;

  _number := 'INV-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*9000)+1000)::int::text, 4, '0');

  INSERT INTO public.orders (business_id, number, buyer_user_id, customer_id, note, discount, shipping, total, status)
  VALUES (o.business_id, _number, o.buyer_user_id, o.customer_id, o.note, o.discount, o.extra_fee, _total, 'completed')
  RETURNING * INTO _ord;

  FOR _item IN SELECT * FROM public.chat_order_items WHERE chat_order_id = o.id ORDER BY sort_order LOOP
    SELECT coalesce(array_agg(s.stock_unit_id), '{}') INTO _unit_ids
      FROM public.chat_order_unit_slots s WHERE s.item_id = _item.id AND s.stock_unit_id IS NOT NULL;
    INSERT INTO public.order_items (order_id, business_id, product_id, variant_id, name, variant_name,
      qty, qty_num, qty_base, unit, price, discount, photo_ids, stock_unit_ids)
    VALUES (_ord.id, o.business_id, _item.product_id, _item.variant_id, _item.product_name, _item.variant_name,
      _item.unit_count, _item.unit_count, _item.per_unit_qty_base * _item.unit_count, _item.per_unit_unit,
      _item.price, _item.discount, '{}', _unit_ids);
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
    IF _ledger IS NOT NULL THEN
      INSERT INTO public.ledger_events (ledger_id, actor_id, label, detail)
      VALUES (_ledger, _uid, 'Catatan dibuat dari penjualan', _number);
    END IF;
  END IF;

  -- Pindahkan unit ke pembeli.
  FOR u IN SELECT vsu.* FROM public.variant_stock_units vsu
            WHERE vsu.chat_order_id = o.id AND vsu.status = 'ready' ORDER BY vsu.id FOR UPDATE LOOP
    UPDATE public.variant_stock_units SET status = 'delivered', delivered_at = now(),
      customer_user_id = o.buyer_user_id, customer_id = o.customer_id, updated_by = _uid WHERE id = u.id;
    _units := _units || jsonb_build_object(
      'id', u.id, 'label', u.unit_label, 'qtyBase', u.qty_base, 'note', u.note,
      'photos', coalesce((SELECT jsonb_agg(jsonb_build_object('path', p.image_path, 'caption', p.caption,
          'mapsUrl', p.location_url, 'locationLabel', p.location_label, 'accuracy', p.location_accuracy))
        FROM public.product_photos p WHERE p.stock_unit_id = u.id), '[]'::jsonb));
  END LOOP;

  UPDATE public.chat_order_unit_slots SET status = 'delivered' WHERE chat_order_id = o.id;

  _payload := jsonb_build_object('type','chat_order_result','chatOrderId', o.id, 'number', _number,
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
END $$;

-- ============================================================
-- ACL FUNGSI
-- ============================================================
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_stock_unit(uuid,numeric,text,text)',
    'public.activate_stock_unit(uuid)',
    'public.void_stock_unit(uuid,text)',
    'public.create_chat_order(jsonb)',
    'public.confirm_chat_order(uuid,jsonb,text,numeric,numeric)',
    'public.approve_chat_order(uuid)',
    'public.request_chat_order_changes(uuid,text)',
    'public.cancel_chat_order(uuid,text,boolean)',
    'public.dispatch_chat_order(uuid,uuid,jsonb,integer)',
    'public.complete_preparation_job(uuid)',
    'public.finalize_chat_order_delivery(uuid,jsonb)',
    'public.current_user_can_read_chat_order(uuid)',
    'public.current_user_can_read_stock_unit(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.apply_unit_balance(public.variant_stock_units,numeric,text,text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.vsu_guard() FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.vsu_no_hard_delete() FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated';
END $$;

-- ============================================================
-- J. MIGRASI DATA LEGACY (idempoten)
-- ============================================================
DO $$
DECLARE p record; ph record; _v public.product_variants; _n int; _qty numeric; _seq int; _unit uuid;
BEGIN
  FOR p IN SELECT DISTINCT product_id FROM public.product_photos WHERE variant_id IS NULL LOOP
    SELECT count(*) INTO _n FROM public.product_variants WHERE product_id = p.product_id AND is_active;
    IF _n <> 1 THEN CONTINUE; END IF;
    SELECT * INTO _v FROM public.product_variants WHERE product_id = p.product_id AND is_active;
    FOR ph IN SELECT * FROM public.product_photos WHERE product_id = p.product_id AND variant_id IS NULL ORDER BY sort_order LOOP
      _qty := coalesce(_v.base_quantity_grams, nullif(_v.conversion_factor,0), 1);
      SELECT coalesce(max(unit_seq),0) + 1 INTO _seq FROM public.variant_stock_units WHERE variant_id = _v.id;
      INSERT INTO public.variant_stock_units (business_id, product_id, variant_id, unit_seq, unit_label,
        qty_base, status, note, source_type, created_by, updated_by)
      VALUES (_v.business_id, _v.product_id, _v.id, _seq, 'Unit ' || _seq, _qty, 'draft',
        'Perlu konfirmasi unit (foto lama)', 'legacy', NULL, NULL)
      RETURNING id INTO _unit;
      UPDATE public.product_photos
         SET variant_id = _v.id, stock_unit_id = _unit, needs_variant_confirmation = true,
             is_primary = true
       WHERE id = ph.id;
    END LOOP;
  END LOOP;
END $$;