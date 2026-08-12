-- ============ ENUMS ============
CREATE TYPE public.stock_type AS ENUM ('weight','count');
CREATE TYPE public.preparation_status AS ENUM ('draft','sent','opened','in_progress','ready','completed','cancelled');
CREATE TYPE public.preparation_item_status AS ENUM ('pending','in_progress','done');
CREATE TYPE public.inventory_movement_type AS ENUM ('preparation','sale','adjustment','restock','return');

-- ============ PRODUCT VARIANTS ============
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  stock_type public.stock_type NOT NULL DEFAULT 'count',
  base_unit text NOT NULL DEFAULT 'pcs',
  display_unit text NOT NULL DEFAULT 'pcs',
  precision_scale smallint NOT NULL DEFAULT 2,
  conversion_factor numeric(18,4) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  allow_decimal boolean NOT NULL DEFAULT false,
  price numeric(14,2) NOT NULL DEFAULT 0,
  sku text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_variants_product ON public.product_variants(product_id);
CREATE UNIQUE INDEX idx_product_variants_sku ON public.product_variants(business_id, sku) WHERE sku <> '';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variants readable by business members" ON public.product_variants FOR SELECT TO authenticated
  USING (public.is_business_member(business_id, auth.uid()));
CREATE POLICY "variants managed by business admins" ON public.product_variants FOR ALL TO authenticated
  USING (public.can_manage_business(business_id, auth.uid()))
  WITH CHECK (public.can_manage_business(business_id, auth.uid()));

-- ============ INVENTORY ============
CREATE TABLE public.inventory_balances (
  variant_id uuid PRIMARY KEY REFERENCES public.product_variants(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty_base numeric(18,2) NOT NULL DEFAULT 0 CHECK (qty_base >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inventory_balances TO authenticated;
GRANT ALL ON public.inventory_balances TO service_role;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "balances readable by business members" ON public.inventory_balances FOR SELECT TO authenticated
  USING (public.is_business_member(business_id, auth.uid()));
CREATE POLICY "balances managed by business admins" ON public.inventory_balances FOR ALL TO authenticated
  USING (public.can_manage_business(business_id, auth.uid()))
  WITH CHECK (public.can_manage_business(business_id, auth.uid()));

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  movement_type public.inventory_movement_type NOT NULL,
  qty_base numeric(18,2) NOT NULL,
  balance_before numeric(18,2) NOT NULL DEFAULT 0,
  balance_after numeric(18,2) NOT NULL DEFAULT 0,
  ref_type text NOT NULL DEFAULT '',
  ref_id uuid,
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_movements_variant ON public.inventory_movements(variant_id, created_at DESC);
CREATE UNIQUE INDEX idx_inventory_movements_ref ON public.inventory_movements(ref_type, ref_id) WHERE ref_id IS NOT NULL AND ref_type <> '';
GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movements readable by business members" ON public.inventory_movements FOR SELECT TO authenticated
  USING (public.is_business_member(business_id, auth.uid()));

-- ============ PREPARATION JOBS ============
CREATE TABLE public.preparation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code text NOT NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_user_id uuid,
  customer_name text NOT NULL DEFAULT '',
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  assigned_user_id uuid NOT NULL,
  status public.preparation_status NOT NULL DEFAULT 'sent',
  notes text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  revoked_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_prep_jobs_code ON public.preparation_jobs(business_id, code);
CREATE INDEX idx_prep_jobs_conversation ON public.preparation_jobs(conversation_id, created_at DESC);
CREATE INDEX idx_prep_jobs_assignee ON public.preparation_jobs(assigned_user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.preparation_jobs TO authenticated;
GRANT ALL ON public.preparation_jobs TO service_role;
ALTER TABLE public.preparation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs readable by admins and assignee" ON public.preparation_jobs FOR SELECT TO authenticated
  USING (public.can_manage_business(business_id, auth.uid()) OR assigned_user_id = auth.uid());
CREATE POLICY "jobs inserted by business admins" ON public.preparation_jobs FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_business(business_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "jobs updated by business admins" ON public.preparation_jobs FOR UPDATE TO authenticated
  USING (public.can_manage_business(business_id, auth.uid()))
  WITH CHECK (public.can_manage_business(business_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.can_see_prep_job(_job uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.preparation_jobs j
    WHERE j.id = _job
      AND (public.can_manage_business(j.business_id, _uid) OR j.assigned_user_id = _uid)
  )
$$;

CREATE TABLE public.preparation_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.preparation_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  product_name text NOT NULL DEFAULT '',
  variant_name text NOT NULL DEFAULT '',
  requested_qty numeric(18,2) NOT NULL CHECK (requested_qty > 0),
  requested_unit text NOT NULL DEFAULT 'pcs',
  requested_qty_base numeric(18,2) NOT NULL CHECK (requested_qty_base > 0),
  actual_qty_base numeric(18,2),
  require_photo boolean NOT NULL DEFAULT true,
  require_location boolean NOT NULL DEFAULT true,
  status public.preparation_item_status NOT NULL DEFAULT 'pending',
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prep_items_job ON public.preparation_job_items(job_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preparation_job_items TO authenticated;
GRANT ALL ON public.preparation_job_items TO service_role;
ALTER TABLE public.preparation_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prep items readable by job audience" ON public.preparation_job_items FOR SELECT TO authenticated
  USING (public.can_see_prep_job(job_id, auth.uid()));
CREATE POLICY "prep items managed by job admins" ON public.preparation_job_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.preparation_jobs j WHERE j.id = job_id AND public.can_manage_business(j.business_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.preparation_jobs j WHERE j.id = job_id AND public.can_manage_business(j.business_id, auth.uid())));

CREATE TABLE public.preparation_item_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_item_id uuid NOT NULL REFERENCES public.preparation_job_items(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.preparation_jobs(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  lat double precision,
  lng double precision,
  accuracy double precision,
  location_label text NOT NULL DEFAULT '',
  maps_url text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prep_photos_item ON public.preparation_item_photos(job_item_id, sort_order);
GRANT SELECT, INSERT, DELETE ON public.preparation_item_photos TO authenticated;
GRANT ALL ON public.preparation_item_photos TO service_role;
ALTER TABLE public.preparation_item_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prep photos readable by job audience" ON public.preparation_item_photos FOR SELECT TO authenticated
  USING (public.can_see_prep_job(job_id, auth.uid()));

-- ============ PRODUCT PHOTO LINKAGE ============
ALTER TABLE public.product_photos
  ADD COLUMN variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN location_accuracy double precision,
  ADD COLUMN group_label text NOT NULL DEFAULT '',
  ADD COLUMN preparation_job_id uuid REFERENCES public.preparation_jobs(id) ON DELETE SET NULL,
  ADD COLUMN preparation_job_item_id uuid REFERENCES public.preparation_job_items(id) ON DELETE SET NULL,
  ADD COLUMN source_photo_id uuid;
CREATE UNIQUE INDEX idx_product_photos_source ON public.product_photos(source_photo_id) WHERE source_photo_id IS NOT NULL;

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_variants_touch BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_prep_jobs_touch BEFORE UPDATE ON public.preparation_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_prep_items_touch BEFORE UPDATE ON public.preparation_job_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ UNIT CONVERSION ============
CREATE OR REPLACE FUNCTION public.convert_to_base(_variant uuid, _qty numeric, _unit text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.product_variants; u text := lower(trim(coalesce(_unit,'')));
BEGIN
  SELECT * INTO v FROM public.product_variants WHERE id = _variant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak ditemukan'; END IF;
  IF v.stock_type = 'weight' THEN
    RETURN round(_qty * CASE u
      WHEN 'mg' THEN 0.001 WHEN 'g' THEN 1 WHEN 'gram' THEN 1
      WHEN 'ons' THEN 100 WHEN 'kg' THEN 1000 WHEN '' THEN 1
      ELSE NULL END, 2);
  END IF;
  RETURN round(_qty * v.conversion_factor, 2);
END $$;

-- ============ CREATE JOB (returns plaintext token once) ============
CREATE OR REPLACE FUNCTION public.create_preparation_job(
  _business uuid, _assigned uuid, _items jsonb,
  _conversation uuid DEFAULT NULL, _customer uuid DEFAULT NULL,
  _customer_user uuid DEFAULT NULL, _customer_name text DEFAULT '',
  _order uuid DEFAULT NULL, _notes text DEFAULT '', _expires_hours integer DEFAULT 168
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  _uid uuid := auth.uid();
  _token text;
  _job public.preparation_jobs;
  _it jsonb; _i integer := 0; _base numeric; _variant public.product_variants; _prod text;
BEGIN
  IF _uid IS NULL OR NOT public.can_manage_business(_business, _uid) THEN
    RAISE EXCEPTION 'Tidak berwenang membuat perintah penyiapan';
  END IF;
  IF NOT public.is_business_member(_business, _assigned) THEN
    RAISE EXCEPTION 'Pegawai bukan anggota bisnis ini';
  END IF;
  IF jsonb_array_length(coalesce(_items,'[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Minimal satu item harus dipilih';
  END IF;

  _token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.preparation_jobs (
    business_id, code, conversation_id, customer_id, customer_user_id, customer_name,
    order_id, assigned_user_id, notes, token_hash, token_prefix,
    expires_at, created_by, status
  ) VALUES (
    _business,
    'PRP-' || to_char(now(),'YYMMDD') || '-' || upper(substr(encode(extensions.gen_random_bytes(4),'hex'),1,5)),
    _conversation, _customer, _customer_user, coalesce(_customer_name,''),
    _order, _assigned, coalesce(_notes,''),
    encode(extensions.digest(_token,'sha256'),'hex'), left(_token, 6),
    now() + make_interval(hours => greatest(1, coalesce(_expires_hours,168))),
    _uid, 'sent'
  ) RETURNING * INTO _job;

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _variant FROM public.product_variants WHERE id = (_it->>'variant_id')::uuid AND business_id = _business;
    IF NOT FOUND THEN RAISE EXCEPTION 'Varian tidak valid untuk bisnis ini'; END IF;
    SELECT name INTO _prod FROM public.products WHERE id = _variant.product_id;
    _base := public.convert_to_base(_variant.id, (_it->>'qty')::numeric, coalesce(_it->>'unit', _variant.display_unit));
    IF _base IS NULL OR _base <= 0 THEN RAISE EXCEPTION 'Jumlah/satuan tidak valid untuk %', _prod; END IF;
    INSERT INTO public.preparation_job_items (
      job_id, product_id, variant_id, product_name, variant_name,
      requested_qty, requested_unit, requested_qty_base,
      require_photo, require_location, notes, sort_order
    ) VALUES (
      _job.id, _variant.product_id, _variant.id, _prod, _variant.name,
      (_it->>'qty')::numeric, coalesce(_it->>'unit', _variant.display_unit), _base,
      coalesce((_it->>'require_photo')::boolean, true),
      coalesce((_it->>'require_location')::boolean, true),
      coalesce(_it->>'notes',''), _i
    );
    _i := _i + 1;
  END LOOP;

  RETURN jsonb_build_object('id', _job.id, 'code', _job.code, 'token', _token, 'expires_at', _job.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.create_preparation_job(uuid,uuid,jsonb,uuid,uuid,uuid,text,uuid,text,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.create_preparation_job(uuid,uuid,jsonb,uuid,uuid,uuid,text,uuid,text,integer) TO authenticated, service_role;

-- ============ TOKEN RESOLUTION (service role only) ============
CREATE OR REPLACE FUNCTION public.prep_job_id_by_token(_token text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT id FROM public.preparation_jobs
  WHERE token_hash = encode(extensions.digest(coalesce(_token,''),'sha256'),'hex')
    AND revoked_at IS NULL AND expires_at > now()
$$;
REVOKE ALL ON FUNCTION public.prep_job_id_by_token(text) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.prep_job_id_by_token(text) TO service_role;

-- ============ COMPLETE JOB (idempotent) ============
CREATE OR REPLACE FUNCTION public.complete_preparation_job(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j public.preparation_jobs;
  it public.preparation_job_items;
  ph public.preparation_item_photos;
  _qty numeric; _before numeric; _after numeric; _photos integer := 0; _sort integer;
BEGIN
  SELECT * INTO j FROM public.preparation_jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tugas tidak ditemukan'; END IF;
  IF j.status = 'completed' THEN
    RETURN jsonb_build_object('id', j.id, 'status', 'completed', 'already', true);
  END IF;

  FOR it IN SELECT * FROM public.preparation_job_items WHERE job_id = _job ORDER BY sort_order LOOP
    IF it.require_photo AND NOT EXISTS (SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id) THEN
      RAISE EXCEPTION 'Item % belum memiliki foto', it.product_name;
    END IF;
    IF it.require_location AND NOT EXISTS (
      SELECT 1 FROM public.preparation_item_photos WHERE job_item_id = it.id AND lat IS NOT NULL AND lng IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Item % belum memiliki lokasi', it.product_name;
    END IF;

    _qty := coalesce(it.actual_qty_base, it.requested_qty_base);

    -- stok: kurangi secara atomik, tidak boleh negatif
    INSERT INTO public.inventory_balances (variant_id, business_id, product_id, qty_base)
    VALUES (it.variant_id, j.business_id, it.product_id, 0)
    ON CONFLICT (variant_id) DO NOTHING;

    SELECT qty_base INTO _before FROM public.inventory_balances WHERE variant_id = it.variant_id FOR UPDATE;
    _after := _before - _qty;
    IF _after < 0 THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi (tersedia %, dibutuhkan %)', it.product_name, _before, _qty;
    END IF;
    UPDATE public.inventory_balances SET qty_base = _after, updated_at = now() WHERE variant_id = it.variant_id;

    INSERT INTO public.inventory_movements (
      business_id, product_id, variant_id, movement_type, qty_base,
      balance_before, balance_after, ref_type, ref_id, note, created_by
    ) VALUES (
      j.business_id, it.product_id, it.variant_id, 'preparation', -_qty,
      _before, _after, 'preparation_job_item', it.id,
      'Penyiapan ' || j.code, j.assigned_user_id
    ) ON CONFLICT (ref_type, ref_id) DO NOTHING;

    -- foto hasil masuk katalog sesuai product_id + variant_id
    SELECT coalesce(max(sort_order), -1) + 1 INTO _sort FROM public.product_photos WHERE product_id = it.product_id;
    FOR ph IN SELECT * FROM public.preparation_item_photos WHERE job_item_id = it.id ORDER BY sort_order LOOP
      INSERT INTO public.product_photos (
        business_id, product_id, variant_id, image_path, caption,
        location_lat, location_lng, location_accuracy, location_label, location_url,
        group_label, sort_order, preparation_job_id, preparation_job_item_id, source_photo_id
      ) VALUES (
        j.business_id, it.product_id, it.variant_id, ph.storage_path, ph.caption,
        ph.lat, ph.lng, ph.accuracy, ph.location_label, ph.maps_url,
        it.product_name || ' — ' || it.variant_name, _sort, j.id, it.id, ph.id
      ) ON CONFLICT (source_photo_id) DO NOTHING;
      _sort := _sort + 1;
      _photos := _photos + 1;
    END LOOP;

    UPDATE public.preparation_job_items
      SET status = 'done', actual_qty_base = _qty WHERE id = it.id;
  END LOOP;

  UPDATE public.preparation_jobs
    SET status = 'completed', completed_at = now() WHERE id = _job;

  RETURN jsonb_build_object('id', j.id, 'status', 'completed', 'already', false, 'photos', _photos);
END $$;
REVOKE ALL ON FUNCTION public.complete_preparation_job(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_preparation_job(uuid) TO authenticated, service_role;

-- ============ REALTIME ============
ALTER TABLE public.preparation_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.preparation_job_items REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.preparation_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.preparation_job_items;