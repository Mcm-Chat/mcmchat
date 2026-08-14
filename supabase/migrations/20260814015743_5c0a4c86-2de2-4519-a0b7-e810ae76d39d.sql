create or replace function public.my_connected_contacts()
returns table(contact_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.contact_id
  from public.contacts a
  join public.contacts b on b.owner_id = a.contact_id and b.contact_id = a.owner_id
  where a.owner_id = auth.uid() and not a.is_blocked and not b.is_blocked;
$$;

revoke all on function public.my_connected_contacts() from public, anon;
grant execute on function public.my_connected_contacts() to authenticated, service_role;