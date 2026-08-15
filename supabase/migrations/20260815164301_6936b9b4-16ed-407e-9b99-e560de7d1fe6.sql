-- 1. Kolom gudang pada products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_kind public.stock_type NOT NULL DEFAULT 'count',
  ADD COLUMN IF NOT EXISTS base_unit text NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS buy_unit text NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS buy_factor numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_buy_factor_ck,
  DROP CONSTRAINT IF EXISTS products_purchase_price_ck;
ALTER TABLE public.products
  ADD CONSTRAINT products_buy_factor_ck CHECK (buy_factor > 0),
  ADD CONSTRAINT products_purchase_price_ck CHECK (purchase_price >= 0);

-- 2. Saldo stok gudang (satu baris per produk)
CREATE TABLE IF NOT EXISTS public.product_stock_balances (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  qty_base numeric(18,6) NOT NULL DEFAULT 0 CHECK (qty_base >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.product_stock_balances TO authenticated;
GRANT ALL ON public.product_stock_balances TO service_role;

ALTER TABLE public.product_stock_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse readable by business members" ON public.product_stock_balances;
CREATE POLICY "warehouse readable by business members"
  ON public.product_stock_balances FOR SELECT TO authenticated
  USING (public.current_user_is_business_member(business_id));

CREATE INDEX IF NOT EXISTS idx_product_stock_business ON public.product_stock_balances (business_id);

DROP TRIGGER IF EXISTS product_stock_balances_updated_at ON public.product_stock_balances;
CREATE TRIGGER product_stock_balances_updated_at
  BEFORE UPDATE ON public.product_stock_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Pembelian & pergerakan boleh tanpa varian (langsung ke gudang)
ALTER TABLE public.purchases ALTER COLUMN variant_id DROP NOT NULL;
ALTER TABLE public.inventory_movements ALTER COLUMN variant_id DROP NOT NULL;

-- 4. Backfill: jenis stok + satuan dari varian pertama, saldo dari total varian
WITH first_variant AS (
  SELECT DISTINCT ON (v.product_id)
    v.product_id, v.stock_type, v.base_unit, v.display_unit,
    CASE WHEN v.stock_type = 'weight'
         THEN COALESCE(v.base_quantity_grams, 1)
         ELSE COALESCE(v.units_per_display, 1) END AS factor
  FROM public.product_variants v
  ORDER BY v.product_id, v.sort_order, v.created_at
)
UPDATE public.products p
   SET stock_kind = fv.stock_type,
       base_unit = fv.base_unit,
       buy_unit = fv.display_unit,
       buy_factor = GREATEST(fv.factor, 0.000001)
  FROM first_variant fv
 WHERE fv.product_id = p.id;

INSERT INTO public.product_stock_balances (product_id, business_id, qty_base)
SELECT p.id, p.business_id, COALESCE((
  SELECT SUM(b.qty_base) FROM public.inventory_balances b WHERE b.product_id = p.id
), 0)
FROM public.products p
ON CONFLICT (product_id) DO NOTHING;

UPDATE public.products p
   SET purchase_price = sub.avg_cost * p.buy_factor
  FROM (
    SELECT product_id, SUM(total_cost) / NULLIF(SUM(qty_base), 0) AS avg_cost
    FROM public.purchases GROUP BY product_id
  ) sub
 WHERE sub.product_id = p.id AND sub.avg_cost IS NOT NULL AND p.purchase_price = 0;

-- 5. Inti: penerapan saldo gudang secara atomik
CREATE OR REPLACE FUNCTION public.warehouse_apply(
  _product uuid,
  _delta numeric,
  _type public.inventory_movement_type,
  _note text DEFAULT '',
  _variant uuid DEFAULT NULL,
  _ref_type text DEFAULT 'manual',
  _ref_id uuid DEFAULT NULL,
  _stock_unit uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pr public.products;
  _scale int;
  _before numeric;
  _after numeric;
BEGIN
  SELECT * INTO pr FROM public.products WHERE id = _product;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gudang tidak ditemukan'; END IF;
  _scale := CASE WHEN pr.stock_kind = 'weight' THEN 6 ELSE 0 END;

  INSERT INTO public.product_stock_balances (product_id, business_id, qty_base)
  VALUES (pr.id, pr.business_id, 0) ON CONFLICT (product_id) DO NOTHING;

  SELECT qty_base INTO _before FROM public.product_stock_balances
    WHERE product_id = pr.id FOR UPDATE;
  _before := COALESCE(_before, 0);

  IF _ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.inventory_movements m
     WHERE m.ref_type = _ref_type AND m.ref_id = _ref_id
  ) THEN
    RETURN _before;
  END IF;

  _after := round(_before + _delta, _scale);
  IF _after < 0 THEN RAISE EXCEPTION 'Stok gudang tidak mencukupi'; END IF;

  UPDATE public.product_stock_balances
     SET qty_base = _after, updated_at = now()
   WHERE product_id = pr.id;

  INSERT INTO public.inventory_movements (
    business_id, product_id, variant_id, movement_type, qty_base,
    balance_before, balance_after, ref_type, ref_id, note, created_by, stock_unit_id
  ) VALUES (
    pr.business_id, pr.id, _variant, _type, round(_delta, _scale),
    _before, _after, COALESCE(_ref_type,'manual'), _ref_id,
    COALESCE(_note,''), auth.uid(), _stock_unit
  ) ON CONFLICT (ref_type, ref_id) DO NOTHING;

  RETURN _after;
END $$;

REVOKE ALL ON FUNCTION public.warehouse_apply(uuid, numeric, public.inventory_movement_type, text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 6. Koreksi/tambah stok langsung di gudang
CREATE OR REPLACE FUNCTION public.adjust_warehouse(
  _product uuid,
  _qty_base numeric,
  _type public.inventory_movement_type DEFAULT 'adjustment',
  _note text DEFAULT ''
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE pr public.products; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO pr FROM public.products WHERE id = _product;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gudang tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(pr.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengubah stok';
  END IF;
  RETURN public.warehouse_apply(pr.id, _qty_base, _type, _note, NULL, 'manual', NULL, NULL);
END $$;

GRANT EXECUTE ON FUNCTION public.adjust_warehouse(uuid, numeric, public.inventory_movement_type, text) TO authenticated;

-- 7. adjust_inventory lama tetap ada, kini memotong gudang
CREATE OR REPLACE FUNCTION public.adjust_inventory(
  _variant uuid,
  _qty_base numeric,
  _type public.inventory_movement_type DEFAULT 'adjustment',
  _note text DEFAULT ''
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.product_variants; _uid uuid := auth.uid();
BEGIN
  SELECT * INTO v FROM public.product_variants WHERE id = _variant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
  IF _uid IS NULL OR NOT public.can_manage_business(v.business_id, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang mengubah stok';
  END IF;
  RETURN public.warehouse_apply(v.product_id, _qty_base, _type, _note, v.id, 'manual', NULL, NULL);
END $$;

-- 8. Unit fisik penyiapan memotong gudang
CREATE OR REPLACE FUNCTION public.apply_unit_balance(
  _unit public.variant_stock_units,
  _delta numeric,
  _kind text,
  _note text,
  _ref_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _ref uuid; _reftype text;
BEGIN
  IF _delta = 0 THEN RETURN; END IF;
  IF coalesce(_ref_key,'') = '' THEN RAISE EXCEPTION 'ref key wajib untuk pergerakan stok unit'; END IF;
  _reftype := 'stock_unit_' || _kind;
  _ref := md5('stock_unit:' || _unit.id::text || ':' || _kind || ':' || _ref_key)::uuid;

  PERFORM public.warehouse_apply(
    _unit.product_id,
    _delta,
    CASE WHEN _delta > 0 THEN 'restock'::public.inventory_movement_type
         ELSE 'preparation'::public.inventory_movement_type END,
    coalesce(_note,''),
    _unit.variant_id,
    _reftype,
    _ref,
    _unit.id
  );
END $$;

-- 9. Pembelian masuk ke gudang (varian opsional)
CREATE OR REPLACE FUNCTION public.record_purchase(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_variant public.product_variants%ROWTYPE;
  pr public.products%ROWTYPE;
  v_qty numeric(18,6);
  v_purchase_id uuid;
  v_variant_id uuid := nullif(_payload->>'variant_id','')::uuid;
  v_product_id uuid := nullif(_payload->>'product_id','')::uuid;
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

  INSERT INTO public.purchases (
    business_id, product_id, variant_id, supplier_name, supplier_contact,
    qty_base, display_qty, display_unit, unit_cost, total_cost, note, purchased_at, created_by
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
    auth.uid()
  ) RETURNING id INTO v_purchase_id;

  PERFORM public.warehouse_apply(
    pr.id, v_qty, 'restock'::public.inventory_movement_type,
    COALESCE(_payload->>'note',''), v_variant_id, 'purchase', v_purchase_id, NULL
  );

  RETURN v_purchase_id;
END $$;

-- 10. Indikator katalog memakai stok gudang
CREATE OR REPLACE FUNCTION public.catalog_product_indicators(_business uuid)
RETURNS TABLE(product_id uuid, total_cost numeric, total_qty_base numeric, avg_cost_base numeric, stock_base numeric, stock_value numeric, sold_base numeric, sold_revenue numeric, profit numeric, last_supplier text, last_purchase_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH allowed AS (
    SELECT public.current_user_is_business_member(_business) AS ok
  ),
  buy AS (
    SELECT p.product_id, SUM(p.total_cost) AS total_cost, SUM(p.qty_base) AS total_qty
    FROM public.purchases p, allowed
    WHERE allowed.ok AND p.business_id = _business
    GROUP BY p.product_id
  ),
  last_buy AS (
    SELECT DISTINCT ON (p.product_id) p.product_id, p.supplier_name, p.purchased_at
    FROM public.purchases p, allowed
    WHERE allowed.ok AND p.business_id = _business
    ORDER BY p.product_id, p.purchased_at DESC
  ),
  stock AS (
    SELECT b.product_id, b.qty_base AS qty
    FROM public.product_stock_balances b, allowed
    WHERE allowed.ok AND b.business_id = _business
  ),
  sold AS (
    SELECT m.product_id,
           SUM(ABS(m.qty_base)) AS qty,
           SUM(
             ABS(m.qty_base)
             / NULLIF(CASE WHEN v.stock_type = 'weight'
                           THEN COALESCE(v.base_quantity_grams, 1)
                           ELSE COALESCE(v.units_per_display, 1) END, 0)
             * v.price
           ) AS revenue
    FROM public.inventory_movements m
    JOIN public.product_variants v ON v.id = m.variant_id, allowed
    WHERE allowed.ok AND m.business_id = _business AND m.movement_type = 'sale'
    GROUP BY m.product_id
  )
  SELECT pr.id,
         COALESCE(buy.total_cost, 0),
         COALESCE(buy.total_qty, 0),
         CASE WHEN COALESCE(buy.total_qty, 0) > 0
              THEN buy.total_cost / buy.total_qty
              ELSE CASE WHEN pr.buy_factor > 0 THEN pr.purchase_price / pr.buy_factor ELSE 0 END END,
         COALESCE(stock.qty, 0),
         COALESCE(stock.qty, 0) * CASE WHEN COALESCE(buy.total_qty, 0) > 0
              THEN buy.total_cost / buy.total_qty
              ELSE CASE WHEN pr.buy_factor > 0 THEN pr.purchase_price / pr.buy_factor ELSE 0 END END,
         COALESCE(sold.qty, 0),
         COALESCE(sold.revenue, 0),
         COALESCE(sold.revenue, 0) - COALESCE(sold.qty, 0) * CASE WHEN COALESCE(buy.total_qty, 0) > 0
              THEN buy.total_cost / buy.total_qty
              ELSE CASE WHEN pr.buy_factor > 0 THEN pr.purchase_price / pr.buy_factor ELSE 0 END END,
         COALESCE(last_buy.supplier_name, ''),
         last_buy.purchased_at
  FROM public.products pr
  LEFT JOIN buy ON buy.product_id = pr.id
  LEFT JOIN last_buy ON last_buy.product_id = pr.id
  LEFT JOIN stock ON stock.product_id = pr.id
  LEFT JOIN sold ON sold.product_id = pr.id
  WHERE pr.business_id = _business
    AND public.current_user_is_business_member(_business);
$$;

-- 11. Saldo gudang otomatis dibuat untuk produk baru
CREATE OR REPLACE FUNCTION public.ensure_product_stock_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.product_stock_balances (product_id, business_id, qty_base)
  VALUES (NEW.id, NEW.business_id, 0)
  ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_products_stock_balance ON public.products;
CREATE TRIGGER trg_products_stock_balance
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.ensure_product_stock_balance();