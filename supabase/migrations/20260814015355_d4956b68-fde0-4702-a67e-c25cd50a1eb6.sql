-- =====================================================================
-- TAHAP 2A: identitas, profil, PIN, kontak, blokir
-- =====================================================================

-- ---------- A1. PIN format + generator collision-safe ----------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pin_format_chk') then
    alter table public.profiles
      add constraint profiles_pin_format_chk
      check (pin ~ '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$') not valid;
    alter table public.profiles validate constraint profiles_pin_format_chk;
  end if;
end $$;

create or replace function public.gen_mcm_pin()
returns text
language plpgsql
set search_path = public
as $$
declare alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; out text := ''; i int;
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    if i = 4 then out := out || '-'; end if;
  end loop;
  return out;
end $$;

-- PIN selalu diterbitkan server; kolom sistem tidak dapat dimanipulasi.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare candidate text; tries int := 0;
begin
  if tg_op = 'INSERT' then
    loop
      candidate := public.gen_mcm_pin();
      exit when not exists (select 1 from public.profiles p where p.pin = candidate);
      tries := tries + 1;
      if tries > 60 then raise exception 'unable to allocate pin'; end if;
    end loop;
    new.pin := candidate;
    new.created_at := now();
    new.updated_at := now();
    new.avatar_version := coalesce(new.avatar_version, 0);
    return new;
  end if;

  new.id := old.id;
  new.pin := old.pin;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.avatar_version < old.avatar_version then
    new.avatar_version := old.avatar_version;
  end if;
  return new;
end $$;

drop trigger if exists profiles_assign_pin on public.profiles;
drop trigger if exists assign_pin_trg on public.profiles;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------- A2. Visibilitas profil ----------------------------------
create or replace function public.can_view_full_profile(_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when _owner = auth.uid() then true
    when exists (
      select 1 from public.contacts b
      where b.is_blocked
        and ((b.owner_id = _owner and b.contact_id = auth.uid())
          or (b.owner_id = auth.uid() and b.contact_id = _owner))
    ) then false
    -- kontak mutual (kedua sisi menyimpan) = hubungan diterima
    when exists (
      select 1 from public.contacts a
      join public.contacts b
        on b.owner_id = a.contact_id and b.contact_id = a.owner_id
      where a.owner_id = auth.uid() and a.contact_id = _owner
    ) then true
    -- percakapan bersama yang sah
    when exists (
      select 1
      from public.conversation_members m
      join public.conversation_members o on o.conversation_id = m.conversation_id
      where m.user_id = auth.uid() and o.user_id = _owner
    ) then true
    -- rekan bisnis yang sah
    when exists (
      select 1
      from public.business_members m
      join public.business_members o on o.business_id = m.business_id
      where m.user_id = auth.uid() and o.user_id = _owner
    ) then true
    else false
  end
$$;

drop policy if exists "profiles readable by authenticated" on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
drop policy if exists "profiles readable when related" on public.profiles;
create policy "profiles readable when related" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_view_full_profile(id));

-- kartu minimal: aman untuk hasil PIN, daftar kontak, request, chat list
create or replace function public.profile_cards(_ids uuid[])
returns table(id uuid, display_name text, avatar_color text, avatar_url text, avatar_version integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_color,
         case when public.can_view_avatar(p.id, auth.uid()) then p.avatar_url else null end,
         p.avatar_version
  from public.profiles p
  where auth.uid() is not null
    and p.id = any(coalesce(_ids, array[]::uuid[]));
$$;

create or replace function public.profile_full(_id uuid)
returns table(id uuid, pin text, display_name text, bio text, avatar_url text,
              avatar_color text, avatar_version integer, avatar_privacy text,
              is_online boolean, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.pin, p.display_name, p.bio,
         case when public.can_view_avatar(p.id, auth.uid()) then p.avatar_url else null end,
         p.avatar_color, p.avatar_version, p.avatar_privacy, p.is_online, p.last_seen_at
  from public.profiles p
  where p.id = _id and public.can_view_full_profile(p.id);
$$;

create or replace function public.my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.update_my_profile(_display_name text, _bio text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare name_clean text; bio_clean text; row public.profiles;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  name_clean := btrim(coalesce(_display_name, ''));
  bio_clean := btrim(coalesce(_bio, ''));
  if length(name_clean) < 2 or length(name_clean) > 40 then
    raise exception 'invalid_display_name';
  end if;
  if name_clean ~ '[[:cntrl:]]' or bio_clean ~ '[[:cntrl:]]' then
    raise exception 'invalid_characters';
  end if;
  if length(bio_clean) > 160 then raise exception 'invalid_bio'; end if;
  update public.profiles
     set display_name = name_clean, bio = bio_clean, updated_at = now()
   where id = auth.uid()
  returning * into row;
  return row;
end $$;

create or replace function public.set_my_presence(_online boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.profiles
     set is_online = coalesce(_online, false), last_seen_at = now()
   where id = auth.uid();
end $$;

create or replace function public.commit_my_avatar(_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); prev text; ver integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if _path is null or _path !~ ('^' || uid::text || '/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'invalid_avatar_path';
  end if;
  select avatar_url into prev from public.profiles where id = uid;
  update public.profiles
     set avatar_url = _path, avatar_version = avatar_version + 1, updated_at = now()
   where id = uid
  returning avatar_version into ver;
  return jsonb_build_object('path', _path, 'version', ver, 'previous_path', prev);
end $$;

create or replace function public.remove_my_avatar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); prev text; ver integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select avatar_url into prev from public.profiles where id = uid;
  update public.profiles
     set avatar_url = null, avatar_version = avatar_version + 1, updated_at = now()
   where id = uid
  returning avatar_version into ver;
  return jsonb_build_object('version', ver, 'previous_path', prev);
end $$;

create or replace function public.set_my_avatar_privacy(_privacy text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if _privacy not in ('contacts','contacts_except','only_share','nobody') then
    raise exception 'invalid_privacy';
  end if;
  update public.profiles set avatar_privacy = _privacy, updated_at = now() where id = auth.uid();
end $$;

-- pins_for_me: hanya self + kontak mutual
create or replace function public.pins_for_me(_ids uuid[])
returns table(id uuid, pin text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.pin
  from public.profiles p
  where auth.uid() is not null
    and p.id = any(coalesce(_ids, array[]::uuid[]))
    and (
      p.id = auth.uid()
      or exists (
        select 1 from public.contacts a
        join public.contacts b on b.owner_id = a.contact_id and b.contact_id = a.owner_id
        where a.owner_id = auth.uid() and a.contact_id = p.id and not a.is_blocked and not b.is_blocked
      )
    );
$$;

-- ---------- B. Pencarian PIN atomik + rate limit ---------------------
drop function if exists public.find_profile_by_pin(text);

create or replace function public.search_profile_by_pin(_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); norm text; recent int; found public.profiles;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  norm := upper(regexp_replace(coalesce(_pin,''), '[^0-9A-Za-z]', '', 'g'));
  if length(norm) = 8 then norm := substr(norm,1,4) || '-' || substr(norm,5,4); end if;
  if norm !~ '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$' then
    raise exception 'invalid_pin_format';
  end if;

  select count(*) into recent
  from public.pin_search_log
  where user_id = uid and created_at > now() - interval '1 minute';
  if recent >= 5 then raise exception 'rate_limited'; end if;
  select count(*) into recent
  from public.pin_search_log
  where user_id = uid and created_at > now() - interval '10 minutes';
  if recent >= 30 then raise exception 'rate_limited_cooldown'; end if;

  insert into public.pin_search_log (user_id, pin) values (uid, norm);

  select * into found from public.profiles p where p.pin = norm;
  if found.id is null or found.id = uid then
    return jsonb_build_object('found', false,
      'code', case when found.id = uid then 'self_pin' else 'not_found' end);
  end if;
  -- blokir dua arah: jawaban identik dengan "tidak ditemukan" (anti-enumerasi)
  if exists (
    select 1 from public.contacts b
    where b.is_blocked
      and ((b.owner_id = found.id and b.contact_id = uid)
        or (b.owner_id = uid and b.contact_id = found.id))
  ) then
    return jsonb_build_object('found', false, 'code', 'not_found');
  end if;

  return jsonb_build_object('found', true, 'code', 'ok', 'profile', jsonb_build_object(
    'id', found.id,
    'display_name', found.display_name,
    'avatar_color', found.avatar_color,
    'avatar_version', found.avatar_version,
    'avatar_url', case when public.can_view_avatar(found.id, uid) then found.avatar_url else null end
  ));
end $$;

-- ---------- B2. Permintaan kontak ------------------------------------
create or replace function public.send_contact_request(_target uuid, _message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); msg text; existing public.contact_requests; recent int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if _target is null or _target = uid then raise exception 'invalid_target'; end if;
  if not exists (select 1 from public.profiles where id = _target) then
    raise exception 'invalid_target';
  end if;
  if exists (
    select 1 from public.contacts b
    where b.is_blocked
      and ((b.owner_id = _target and b.contact_id = uid)
        or (b.owner_id = uid and b.contact_id = _target))
  ) then raise exception 'blocked'; end if;

  if exists (
    select 1 from public.contacts a
    join public.contacts b on b.owner_id = a.contact_id and b.contact_id = a.owner_id
    where a.owner_id = uid and a.contact_id = _target
  ) then raise exception 'already_connected'; end if;

  select count(*) into recent from public.contact_requests
   where requester_id = uid and created_at > now() - interval '1 minute';
  if recent >= 5 then raise exception 'rate_limited'; end if;

  msg := btrim(coalesce(_message, ''));
  msg := regexp_replace(msg, '[[:cntrl:]]', ' ', 'g');
  if length(msg) > 200 then msg := substr(msg, 1, 200); end if;

  select * into existing from public.contact_requests
   where (requester_id = uid and target_id = _target)
      or (requester_id = _target and target_id = uid);

  if existing.id is not null then
    if existing.status = 'blocked' then raise exception 'blocked'; end if;
    if existing.status = 'pending' then
      if existing.requester_id = uid then
        return jsonb_build_object('status', 'pending', 'code', 'already_pending');
      end if;
      return jsonb_build_object('status', 'pending', 'code', 'incoming_pending');
    end if;
    if existing.status = 'accepted' then raise exception 'already_connected'; end if;
    -- rejected / cancelled: cooldown 10 menit
    if existing.updated_at > now() - interval '10 minutes' then
      raise exception 'cooldown';
    end if;
    update public.contact_requests
       set requester_id = uid, target_id = _target, status = 'pending',
           message = msg, updated_at = now()
     where id = existing.id;
    return jsonb_build_object('status', 'pending', 'code', 'resent');
  end if;

  insert into public.contact_requests (requester_id, target_id, message, status)
  values (uid, _target, msg, 'pending');
  return jsonb_build_object('status', 'pending', 'code', 'sent');
end $$;

create or replace function public.cancel_contact_request(_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  update public.contact_requests
     set status = 'cancelled', updated_at = now()
   where requester_id = uid and target_id = _target and status = 'pending';
  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n);
end $$;

create or replace function public.respond_contact_request(_request uuid, _action contact_request_status)
returns public.contact_requests
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); r public.contact_requests;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if _action not in ('accepted','rejected','blocked') then raise exception 'invalid_action'; end if;

  select * into r from public.contact_requests where id = _request;
  if r.id is null then raise exception 'request_not_found'; end if;
  if r.target_id <> uid then raise exception 'not_authorized'; end if;
  if r.status <> 'pending' and _action <> 'blocked' then raise exception 'request_not_pending'; end if;

  update public.contact_requests set status = _action, updated_at = now()
   where id = _request returning * into r;

  if _action = 'accepted' then
    insert into public.contacts (owner_id, contact_id, source)
    values (r.target_id, r.requester_id, 'request'), (r.requester_id, r.target_id, 'request')
    on conflict (owner_id, contact_id) do nothing;
  elsif _action = 'blocked' then
    perform public.set_contact_blocked(r.requester_id, true);
  end if;
  return r;
end $$;

create or replace function public.set_contact_blocked(_target uuid, _blocked boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if _target is null or _target = uid then raise exception 'invalid_target'; end if;

  if _blocked then
    insert into public.contacts (owner_id, contact_id, is_blocked, source)
    values (uid, _target, true, 'manual')
    on conflict (owner_id, contact_id) do update set is_blocked = true, updated_at = now();
    -- semua permintaan tertunda dua arah dimatikan
    update public.contact_requests
       set status = case when target_id = uid then 'blocked' else 'cancelled' end,
           updated_at = now()
     where status = 'pending'
       and ((requester_id = uid and target_id = _target)
         or (requester_id = _target and target_id = uid));
  else
    -- unblock tidak memulihkan request lama dan tidak membuat hubungan baru
    update public.contacts set is_blocked = false, updated_at = now()
     where owner_id = uid and contact_id = _target;
  end if;
  return jsonb_build_object('blocked', _blocked);
end $$;

create or replace function public.save_contact_card(_target uuid, _source text, _alias text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); src text; alias_clean text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if _target is null or _target = uid then raise exception 'invalid_target'; end if;
  src := coalesce(nullif(btrim(_source), ''), 'manual');
  if src not in ('qr','pin','manual') then raise exception 'invalid_source'; end if;
  if not exists (select 1 from public.profiles where id = _target) then
    raise exception 'invalid_target';
  end if;
  if exists (
    select 1 from public.contacts b
    where b.is_blocked
      and ((b.owner_id = _target and b.contact_id = uid)
        or (b.owner_id = uid and b.contact_id = _target))
  ) then raise exception 'blocked'; end if;

  alias_clean := nullif(btrim(regexp_replace(coalesce(_alias,''), '[[:cntrl:]]', ' ', 'g')), '');
  if length(coalesce(alias_clean,'')) > 40 then raise exception 'invalid_alias'; end if;

  insert into public.contacts (owner_id, contact_id, source, alias)
  values (uid, _target, src, alias_clean)
  on conflict (owner_id, contact_id) do nothing;
  return jsonb_build_object('saved', true, 'connected', exists (
    select 1 from public.contacts b where b.owner_id = _target and b.contact_id = uid
  ));
end $$;

create or replace function public.update_my_contact(_target uuid, _alias text, _note text,
                                                    _starred boolean, _is_favorite boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); alias_clean text; note_clean text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  alias_clean := nullif(btrim(regexp_replace(coalesce(_alias,''), '[[:cntrl:]]', ' ', 'g')), '');
  note_clean := btrim(regexp_replace(coalesce(_note,''), '[[:cntrl:]]', ' ', 'g'));
  if length(coalesce(alias_clean,'')) > 40 or length(note_clean) > 200 then
    raise exception 'invalid_input';
  end if;
  update public.contacts
     set alias = coalesce(alias_clean, alias),
         note = case when _note is null then note else note_clean end,
         starred = coalesce(_starred, starred),
         is_favorite = coalesce(_is_favorite, is_favorite),
         updated_at = now()
   where owner_id = uid and contact_id = _target;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.contact_relation(_other uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'self', _other = auth.uid(),
    'saved', exists (select 1 from public.contacts c where c.owner_id = auth.uid() and c.contact_id = _other),
    'connected', exists (
      select 1 from public.contacts a
      join public.contacts b on b.owner_id = a.contact_id and b.contact_id = a.owner_id
      where a.owner_id = auth.uid() and a.contact_id = _other and not a.is_blocked and not b.is_blocked
    ),
    'blocked_by_me', exists (
      select 1 from public.contacts c
      where c.owner_id = auth.uid() and c.contact_id = _other and c.is_blocked
    ),
    'blocked_me', exists (
      select 1 from public.contacts c
      where c.owner_id = _other and c.contact_id = auth.uid() and c.is_blocked
    ),
    'outgoing_pending', exists (
      select 1 from public.contact_requests r
      where r.requester_id = auth.uid() and r.target_id = _other and r.status = 'pending'
    ),
    'incoming_request_id', (
      select r.id from public.contact_requests r
      where r.requester_id = _other and r.target_id = auth.uid() and r.status = 'pending' limit 1
    )
  )
  where auth.uid() is not null;
$$;

-- ---------- D. Policy write langsung dihapus -------------------------
drop policy if exists "create own request" on public.contact_requests;
drop policy if exists "parties update request" on public.contact_requests;
drop policy if exists "requester deletes request" on public.contact_requests;
drop policy if exists "own contacts write" on public.contacts;
drop policy if exists "own contacts update" on public.contacts;
drop policy if exists "own search log insert" on public.pin_search_log;

-- ---------- D2. GRANT / REVOKE ---------------------------------------
revoke all on public.profiles, public.contacts, public.contact_requests, public.pin_search_log
  from anon, public;

grant select on public.profiles to authenticated;
grant select, delete on public.contacts to authenticated;
grant select on public.contact_requests to authenticated;
grant select on public.pin_search_log to authenticated;
grant all on public.profiles, public.contacts, public.contact_requests, public.pin_search_log
  to service_role;
revoke all on sequence public.pin_search_log_id_seq from anon, public;
grant usage, select on sequence public.pin_search_log_id_seq to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.my_profile()',
    'public.update_my_profile(text,text)',
    'public.set_my_presence(boolean)',
    'public.commit_my_avatar(text)',
    'public.remove_my_avatar()',
    'public.set_my_avatar_privacy(text)',
    'public.profile_cards(uuid[])',
    'public.profile_full(uuid)',
    'public.can_view_full_profile(uuid)',
    'public.search_profile_by_pin(text)',
    'public.send_contact_request(uuid,text)',
    'public.cancel_contact_request(uuid)',
    'public.respond_contact_request(uuid,contact_request_status)',
    'public.set_contact_blocked(uuid,boolean)',
    'public.save_contact_card(uuid,text,text)',
    'public.update_my_contact(uuid,text,text,boolean,boolean)',
    'public.contact_relation(uuid)',
    'public.pins_for_me(uuid[])',
    'public.my_pin()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- helper internal: tidak executable klien
  execute 'revoke all on function public.gen_mcm_pin() from public, anon, authenticated';
  execute 'revoke all on function public.profiles_guard() from public, anon, authenticated';
end $$;