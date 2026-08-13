ALTER TABLE public.order_items
  ALTER COLUMN qty_num TYPE numeric(18,6),
  ALTER COLUMN qty_base TYPE numeric(18,6);