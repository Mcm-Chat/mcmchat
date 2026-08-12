DROP INDEX IF EXISTS public.idx_inventory_movements_ref;
CREATE UNIQUE INDEX idx_inventory_movements_ref ON public.inventory_movements(ref_type, ref_id);