
REVOKE ALL ON TABLE public.direct_conversations FROM authenticated, anon, PUBLIC;
GRANT SELECT ON TABLE public.direct_conversations TO authenticated;
GRANT ALL ON TABLE public.direct_conversations TO service_role;
