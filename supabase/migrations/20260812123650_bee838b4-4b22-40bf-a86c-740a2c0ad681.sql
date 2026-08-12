create or replace function public.safe_uuid(_t text)
returns uuid language plpgsql immutable set search_path = public as $$
begin
  return _t::uuid;
exception when others then return null;
end $$;
revoke execute on function public.safe_uuid(text) from anon, public;
grant execute on function public.safe_uuid(text) to authenticated;

-- chat media: chat-media/{conversation_id}/{file}
create policy "chat media read" on storage.objects for select to authenticated
using (bucket_id = 'chat-media' and public.is_conv_member(public.safe_uuid((storage.foldername(name))[1]), auth.uid()));
create policy "chat media insert" on storage.objects for insert to authenticated
with check (bucket_id = 'chat-media' and owner = auth.uid() and public.is_conv_member(public.safe_uuid((storage.foldername(name))[1]), auth.uid()));
create policy "chat media delete" on storage.objects for delete to authenticated
using (bucket_id = 'chat-media' and owner = auth.uid());

-- product photos: product-photos/{business_id}/{file}
create policy "product photo read" on storage.objects for select to authenticated
using (bucket_id = 'product-photos' and public.is_business_member(public.safe_uuid((storage.foldername(name))[1]), auth.uid()));
create policy "product photo insert" on storage.objects for insert to authenticated
with check (bucket_id = 'product-photos' and public.can_manage_business(public.safe_uuid((storage.foldername(name))[1]), auth.uid()));
create policy "product photo update" on storage.objects for update to authenticated
using (bucket_id = 'product-photos' and public.can_manage_business(public.safe_uuid((storage.foldername(name))[1]), auth.uid()))
with check (bucket_id = 'product-photos' and public.can_manage_business(public.safe_uuid((storage.foldername(name))[1]), auth.uid()));
create policy "product photo delete" on storage.objects for delete to authenticated
using (bucket_id = 'product-photos' and public.can_manage_business(public.safe_uuid((storage.foldername(name))[1]), auth.uid()));

-- avatars: avatars/{user_id}/{file}
create policy "avatar read" on storage.objects for select to authenticated using (bucket_id = 'avatars');
create policy "avatar write" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar update" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar delete" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);