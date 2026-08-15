CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  supplier_name text NOT NULL DEFAULT '',
  supplier_contact text NOT NULL DEFAULT '',
  qty_base numeric(18,6) NOT NULL CHECK (qty_base > 0),
  display_qty numeric(18,6) NOT NULL DEFAULT 0,
  display_unit text NOT NULL DEFAULT '',
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  note text NOT NULL DEFAULT '',
  purchased_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_business_time ON public.purchases (business_id, purchased_at DESC);
CREATE INDEX idx_purchases_product ON public.purchases (product_id, purchased_at DESC);
CREATE INDEX idx_purchases_variant ON public.purchases (variant_id, purchased_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchases readable by business members"
  ON public.purchases FOR SELECT TO authenticated
  USING (public.current_user_is_business_member(business_id));

CREATE POLICY "purchases insert by managers"
  ON public.purchases FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_manage_business(business_id));

CREATE POLICY "purchases update by managers"
  ON public.purchases FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_business(business_id))
  WITH CHECK (public.current_user_can_manage_business(business_id));

CREATE POLICY "purchases delete by managers"
  ON public.purchases FOR DELETE TO authenticated
  USING (public.current_user_can_manage_business(business_id));

CREATE TRIGGER purchases_updated_at BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.record_purchase(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.product_variants%ROWTYPE;
  v_qty numeric(18,6);
  v_before numeric(18,6);
  v_after numeric(18,6);
  v_purchase_id uuid;
BEGIN
  SELECT * INTO v_variant FROM public.product_variants
    WHERE id = (_payload->>'variant_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Varian tidak ditemukan';
  END IF;
  IF NOT public.current_user_can_manage_business(v_variant.business_id) THEN
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
    v_variant.business_id,
    v_variant.product_id,
    v_variant.id,
    COALESCE(_payload->>'supplier_name', ''),
    COALESCE(_payload->>'supplier_contact', ''),
    v_qty,
    COALESCE((_payload->>'display_qty')::numeric, 0),
    COALESCE(_payload->>'display_unit', v_variant.display_unit),
    COALESCE((_payload->>'unit_cost')::numeric, 0),
    COALESCE((_payload->>'total_cost')::numeric, 0),
    COALESCE(_payload->>'note', ''),
    COALESCE((_payload->>'purchased_at')::timestamptz, now()),
    auth.uid()
  ) RETURNING id INTO v_purchase_id;

  INSERT INTO public.inventory_balances (variant_id, product_id, business_id, qty_base)
  VALUES (v_variant.id, v_variant.product_id, v_variant.business_id, 0)
  ON CONFLICT (variant_id) DO NOTHING;

  SELECT qty_base INTO v_before FROM public.inventory_balances
    WHERE variant_id = v_variant.id FOR UPDATE;
  v_before := COALESCE(v_before, 0);
  v_after := v_before + v_qty;

  UPDATE public.inventory_balances SET qty_base = v_after WHERE variant_id = v_variant.id;

  INSERT INTO public.inventory_movements (
    business_id, product_id, variant_id, movement_type, qty_base,
    balance_before, balance_after, ref_type, ref_id, note, created_by
  ) VALUES (
    v_variant.business_id, v_variant.product_id, v_variant.id, 'restock', v_qty,
    v_before, v_after, 'purchase', v_purchase_id,
    COALESCE(_payload->>'note', ''), auth.uid()
  );

  RETURN v_purchase_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_purchase(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.record_purchase(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.catalog_product_indicators(_business uuid)
RETURNS TABLE (
  product_id uuid,
  total_cost numeric,
  total_qty_base numeric,
  avg_cost_base numeric,
  stock_base numeric,
  stock_value numeric,
  sold_base numeric,
  sold_revenue numeric,
  profit numeric,
  last_supplier text,
  last_purchase_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allowed AS (
    SELECT public.current_user_is_business_member(_business) AS ok
  ),
  buy AS (
    SELECT p.product_id,
           SUM(p.total_cost) AS total_cost,
           SUM(p.qty_base) AS total_qty
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
    SELECT b.product_id, SUM(b.qty_base) AS qty
    FROM public.inventory_balances b, allowed
    WHERE allowed.ok AND b.business_id = _business
    GROUP BY b.product_id
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
              THEN buy.total_cost / buy.total_qty ELSE 0 END,
         COALESCE(stock.qty, 0),
         CASE WHEN COALESCE(buy.total_qty, 0) > 0
              THEN COALESCE(stock.qty, 0) * (buy.total_cost / buy.total_qty) ELSE 0 END,
         COALESCE(sold.qty, 0),
         COALESCE(sold.revenue, 0),
         COALESCE(sold.revenue, 0) - CASE WHEN COALESCE(buy.total_qty, 0) > 0
              THEN COALESCE(sold.qty, 0) * (buy.total_cost / buy.total_qty) ELSE 0 END,
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

REVOKE ALL ON FUNCTION public.catalog_product_indicators(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.catalog_product_indicators(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_product_category(_business uuid, _from text, _to text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.current_user_can_manage_business(_business) THEN
    RAISE EXCEPTION 'Tidak berhak mengubah kategori';
  END IF;
  UPDATE public.products
    SET category = COALESCE(NULLIF(btrim(_to), ''), 'Umum')
    WHERE business_id = _business AND category = _from;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_product_category(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rename_product_category(uuid, text, text) TO authenticated;