ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;

UPDATE public.contacts SET owner_id = owner_id WHERE false;

DELETE FROM public.contacts WHERE owner_id = contact_id;

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_not_self_ck;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_not_self_ck CHECK (owner_id <> contact_id);

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_source_ck;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_source_ck CHECK (source IN ('manual','qr_scan','request','import'));

DELETE FROM public.contacts c WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.contact_id);
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_contact_profile_fk;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_contact_profile_fk
  FOREIGN KEY (contact_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;