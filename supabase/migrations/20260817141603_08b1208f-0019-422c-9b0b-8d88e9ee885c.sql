DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ')
    INTO cols
  FROM pg_attribute
  WHERE attrelid = 'public.preparation_jobs'::regclass
    AND attnum > 0 AND NOT attisdropped
    AND attname <> 'delivered_pin';

  EXECUTE 'REVOKE SELECT ON public.preparation_jobs FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.preparation_jobs TO authenticated', cols);
  EXECUTE format('GRANT SELECT (%s) ON public.preparation_jobs TO anon', cols);
END $$;

GRANT ALL ON public.preparation_jobs TO service_role;