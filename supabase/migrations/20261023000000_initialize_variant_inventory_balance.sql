-- Keep inventory_balances read-only for authenticated Data API clients.
-- Initializing a new variant must not require INSERT/UPDATE grants on balances.
-- Historical creation also installs this trigger for fresh/reset databases;
-- this migration installs it on existing databases. No existing stock changes.
CREATE OR REPLACE FUNCTION public.ensure_variant_inventory_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- An independent product FK does not guarantee that the parent product is
  -- in the same business. Check and lock that relationship before using the
  -- migration owner's privileges to create a balance.
  PERFORM 1
    FROM public.products AS product
   WHERE product.id = NEW.product_id
     AND product.business_id = NEW.business_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514', MESSAGE = 'variant_product_business_mismatch';
  END IF;

  INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
  VALUES (NEW.id, NEW.business_id, NEW.product_id, 0)
  ON CONFLICT (variant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_variant_inventory_balance() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS initialize_variant_inventory_balance ON public.product_variants;
CREATE TRIGGER initialize_variant_inventory_balance
  AFTER INSERT ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.ensure_variant_inventory_balance();
