DROP INDEX IF EXISTS public.idx_product_photos_source;
CREATE UNIQUE INDEX idx_product_photos_source ON public.product_photos(source_photo_id);