-- ============ ENUMS ============
create type public.contact_request_status as enum ('pending','accepted','rejected','blocked','cancelled');
create type public.conversation_type as enum ('direct','group','business');
create type public.message_kind as enum ('text','image','document','voice','system','ledger','order','sales_card','location');
create type public.call_kind as enum ('audio','video');
create type public.call_status as enum ('ringing','ongoing','ended','missed','declined','failed','unconfigured');
create type public.business_role as enum ('owner','admin','agent','cashier','viewer');
create type public.ledger_type as enum ('receivable','payable');
create type public.ledger_status as enum ('pending_approval','active','partially_paid','paid','rejected','disputed','cancelled');
create type public.order_status as enum ('new','processing','shipped','completed','cancelled');
create type public.payment_method as enum ('cash','transfer','dp','credit');
create type public.inbox_status as enum ('open','pending','closed');

-- ============ HELPERS ============
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.gen_mcm_pin()
returns text language plpgsql volatile set search_path = public as $$
declare alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; out text := ''; i int;
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    if i = 4 then out := out || '-'; end if;
  end loop;
  return out;
end $$;

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pin text not null,
  display_name text not null default 'Pengguna MCM',
  bio text not null default '',
  avatar_url text,
  avatar_color text not null default 'emerald',
  is_online boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_pin_key on public.profiles (pin);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
alter table public.profiles enable row level security;
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.assign_pin()
returns trigger language plpgsql security definer set search_path = public as $$
declare candidate text; tries int := 0;
begin
  if new.pin is not null and new.pin <> '' then return new; end if;
  loop
    candidate := public.gen_mcm_pin();
    exit when not exists (select 1 from public.profiles where pin = candidate);
    tries := tries + 1;
    if tries > 40 then raise exception 'unable to allocate pin'; end if;
  end loop;
  new.pin := candidate;
  return new;
end $$;
create trigger profiles_assign_pin before insert on public.profiles for each row execute function public.assign_pin();

-- ============ USER SETTINGS ============
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'dark',
  privacy jsonb not null default '{"lastSeen":"kontak","online":true,"photo":"kontak","readReceipts":true,"addToGroup":"kontak","canCall":"kontak"}'::jsonb,
  security jsonb not null default '{"appLock":false,"twoFactor":false}'::jsonb,
  notifications jsonb not null default '{"chat":true,"group":true,"calls":true,"ledger":true,"business":true,"lockPreview":false,"sound":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
alter table public.user_settings enable row level security;
create policy "own settings" on public.user_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger user_settings_updated_at before update on public.user_settings for each row execute function public.set_updated_at();

-- new user bootstrap
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', 'Pengguna MCM'))
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ============ DEVICES ============
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null default 'web',
  push_token text,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
alter table public.devices enable row level security;
create policy "own devices" on public.devices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger devices_updated_at before update on public.devices for each row execute function public.set_updated_at();

-- ============ CONTACTS ============
create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  message text not null default '',
  status public.contact_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_requests_no_self check (requester_id <> target_id)
);
create unique index contact_requests_pair_key on public.contact_requests (requester_id, target_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_requests TO authenticated;
GRANT ALL ON public.contact_requests TO service_role;
alter table public.contact_requests enable row level security;
create policy "requests visible to parties" on public.contact_requests for select to authenticated using (requester_id = auth.uid() or target_id = auth.uid());
create policy "create own request" on public.contact_requests for insert to authenticated with check (requester_id = auth.uid());
create policy "parties update request" on public.contact_requests for update to authenticated using (requester_id = auth.uid() or target_id = auth.uid()) with check (requester_id = auth.uid() or target_id = auth.uid());
create policy "requester deletes request" on public.contact_requests for delete to authenticated using (requester_id = auth.uid());
create trigger contact_requests_updated_at before update on public.contact_requests for each row execute function public.set_updated_at();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references auth.users(id) on delete cascade,
  alias text,
  note text not null default '',
  is_blocked boolean not null default false,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_no_self check (owner_id <> contact_id)
);
create unique index contacts_pair_key on public.contacts (owner_id, contact_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
alter table public.contacts enable row level security;
create policy "own contacts read" on public.contacts for select to authenticated using (owner_id = auth.uid() or contact_id = auth.uid());
create policy "own contacts write" on public.contacts for insert to authenticated with check (owner_id = auth.uid());
create policy "own contacts update" on public.contacts for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own contacts delete" on public.contacts for delete to authenticated using (owner_id = auth.uid());
create trigger contacts_updated_at before update on public.contacts for each row execute function public.set_updated_at();

create table public.pin_search_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pin text not null,
  created_at timestamptz not null default now()
);
create index pin_search_log_user_time on public.pin_search_log (user_id, created_at desc);
GRANT SELECT, INSERT ON public.pin_search_log TO authenticated;
GRANT ALL ON public.pin_search_log TO service_role;
alter table public.pin_search_log enable row level security;
create policy "own search log" on public.pin_search_log for select to authenticated using (user_id = auth.uid());
create policy "own search log insert" on public.pin_search_log for insert to authenticated with check (user_id = auth.uid());

-- ============ CONVERSATIONS ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type public.conversation_type not null default 'direct',
  title text,
  avatar_color text not null default 'emerald',
  created_by uuid not null references auth.users(id) on delete cascade,
  business_id uuid,
  assignee_id uuid references auth.users(id) on delete set null,
  inbox_status public.inbox_status not null default 'open',
  disappearing_hours int not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  is_muted boolean not null default false,
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  last_read_at timestamptz not null default 'epoch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index conversation_members_key on public.conversation_members (conversation_id, user_id);

create or replace function public.is_conv_member(_conv uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = _conv and user_id = _uid)
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
alter table public.conversations enable row level security;
create policy "member reads conversation" on public.conversations for select to authenticated using (public.is_conv_member(id, auth.uid()));
create policy "creator inserts conversation" on public.conversations for insert to authenticated with check (created_by = auth.uid());
create policy "member updates conversation" on public.conversations for update to authenticated using (public.is_conv_member(id, auth.uid())) with check (public.is_conv_member(id, auth.uid()));
create policy "creator deletes conversation" on public.conversations for delete to authenticated using (created_by = auth.uid());
create trigger conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_members TO authenticated;
GRANT ALL ON public.conversation_members TO service_role;
alter table public.conversation_members enable row level security;
create policy "member reads members" on public.conversation_members for select to authenticated using (public.is_conv_member(conversation_id, auth.uid()));
create policy "member adds members" on public.conversation_members for insert to authenticated
  with check (user_id = auth.uid() or public.is_conv_member(conversation_id, auth.uid())
    or exists (select 1 from public.conversations c where c.id = conversation_id and c.created_by = auth.uid()));
create policy "own membership update" on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own membership delete" on public.conversation_members for delete to authenticated using (user_id = auth.uid());
create trigger conversation_members_updated_at before update on public.conversation_members for each row execute function public.set_updated_at();

-- ============ MESSAGES ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind public.message_kind not null default 'text',
  body text not null default '',
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size int,
  duration_sec int,
  reply_to_id uuid references public.messages(id) on delete set null,
  payload jsonb,
  location_lat double precision,
  location_lng double precision,
  location_accuracy double precision,
  location_label text,
  location_maps_url text,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_conv_time on public.messages (conversation_id, created_at desc);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
alter table public.messages enable row level security;
create policy "member reads messages" on public.messages for select to authenticated using (public.is_conv_member(conversation_id, auth.uid()));
create policy "member sends messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_conv_member(conversation_id, auth.uid()));
create policy "sender edits messages" on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy "sender deletes messages" on public.messages for delete to authenticated using (sender_id = auth.uid());
create trigger messages_updated_at before update on public.messages for each row execute function public.set_updated_at();

create or replace function public.bump_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
create trigger messages_bump_conversation after insert on public.messages for each row execute function public.bump_conversation();

create table public.message_hides (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.message_hides TO authenticated;
GRANT ALL ON public.message_hides TO service_role;
alter table public.message_hides enable row level security;
create policy "own hides" on public.message_hides for select to authenticated using (user_id = auth.uid());
create policy "own hides insert" on public.message_hides for insert to authenticated with check (user_id = auth.uid());
create policy "own hides delete" on public.message_hides for delete to authenticated using (user_id = auth.uid());

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now()
);
create unique index message_reactions_key on public.message_reactions (message_id, user_id, emoji);
GRANT SELECT, INSERT, DELETE ON public.message_reactions TO authenticated;
GRANT ALL ON public.message_reactions TO service_role;
alter table public.message_reactions enable row level security;
create policy "member reads reactions" on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_conv_member(m.conversation_id, auth.uid())));
create policy "own reaction insert" on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_conv_member(m.conversation_id, auth.uid())));
create policy "own reaction delete" on public.message_reactions for delete to authenticated using (user_id = auth.uid());

create table public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);
GRANT SELECT, INSERT, UPDATE ON public.message_receipts TO authenticated;
GRANT ALL ON public.message_receipts TO service_role;
alter table public.message_receipts enable row level security;
create policy "member reads receipts" on public.message_receipts for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_conv_member(m.conversation_id, auth.uid())));
create policy "own receipt insert" on public.message_receipts for insert to authenticated with check (user_id = auth.uid());
create policy "own receipt update" on public.message_receipts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ CALLS ============
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete set null,
  initiator_id uuid not null references auth.users(id) on delete cascade,
  kind public.call_kind not null default 'audio',
  status public.call_status not null default 'unconfigured',
  room_name text,
  provider text not null default 'none',
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.call_participants (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);
create or replace function public.is_call_participant(_call uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.call_participants where call_id = _call and user_id = _uid)
      or exists (select 1 from public.calls where id = _call and initiator_id = _uid)
$$;
GRANT SELECT, INSERT, UPDATE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;
alter table public.calls enable row level security;
create policy "participant reads call" on public.calls for select to authenticated using (public.is_call_participant(id, auth.uid()));
create policy "initiator creates call" on public.calls for insert to authenticated with check (initiator_id = auth.uid());
create policy "participant updates call" on public.calls for update to authenticated using (public.is_call_participant(id, auth.uid())) with check (public.is_call_participant(id, auth.uid()));
create trigger calls_updated_at before update on public.calls for each row execute function public.set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.call_participants TO authenticated;
GRANT ALL ON public.call_participants TO service_role;
alter table public.call_participants enable row level security;
create policy "participant reads roster" on public.call_participants for select to authenticated using (public.is_call_participant(call_id, auth.uid()));
create policy "add participant" on public.call_participants for insert to authenticated
  with check (user_id = auth.uid() or exists (select 1 from public.calls c where c.id = call_id and c.initiator_id = auth.uid()));
create policy "own participant update" on public.call_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ BUSINESS ============
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default '',
  description text not null default '',
  address text not null default '',
  hours text not null default '',
  contact text not null default '',
  logo_emoji text not null default 'ߏ',
  greeting text not null default '',
  away_message text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.business_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index business_members_key on public.business_members (business_id, user_id);

create or replace function public.business_role_of(_biz uuid, _uid uuid)
returns public.business_role language sql stable security definer set search_path = public as $$
  select role from public.business_members where business_id = _biz and user_id = _uid limit 1
$$;
create or replace function public.can_manage_business(_biz uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.business_role_of(_biz, _uid) in ('owner','admin')
$$;
create or replace function public.can_sell_business(_biz uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.business_role_of(_biz, _uid) in ('owner','admin','agent','cashier')
$$;
create or replace function public.is_business_member(_biz uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.business_role_of(_biz, _uid) is not null
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;
alter table public.businesses enable row level security;
create policy "read business" on public.businesses for select to authenticated using (is_public or public.is_business_member(id, auth.uid()));
create policy "create business" on public.businesses for insert to authenticated with check (owner_id = auth.uid());
create policy "manage business" on public.businesses for update to authenticated using (public.can_manage_business(id, auth.uid())) with check (public.can_manage_business(id, auth.uid()));
create policy "owner deletes business" on public.businesses for delete to authenticated using (owner_id = auth.uid());
create trigger businesses_updated_at before update on public.businesses for each row execute function public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_members TO authenticated;
GRANT ALL ON public.business_members TO service_role;
alter table public.business_members enable row level security;
create policy "read business members" on public.business_members for select to authenticated using (user_id = auth.uid() or public.is_business_member(business_id, auth.uid()));
create policy "add business member" on public.business_members for insert to authenticated
  with check (public.can_manage_business(business_id, auth.uid()) or exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));
create policy "update business member" on public.business_members for update to authenticated using (public.can_manage_business(business_id, auth.uid())) with check (public.can_manage_business(business_id, auth.uid()));
create policy "remove business member" on public.business_members for delete to authenticated using (public.can_manage_business(business_id, auth.uid()));
create trigger business_members_updated_at before update on public.business_members for each row execute function public.set_updated_at();

alter table public.conversations add constraint conversations_business_fk foreign key (business_id) references public.businesses(id) on delete set null;

create or replace function public.seed_business_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.business_members (business_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict (business_id, user_id) do nothing;
  return new;
end $$;
create trigger businesses_seed_owner after insert on public.businesses for each row execute function public.seed_business_owner();

-- ============ PRODUCTS ============
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  category text not null default '',
  description text not null default '',
  sku text not null default '',
  emoji text not null default 'ߓ',
  price numeric(14,2) not null default 0 check (price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  stock int not null default 0 check (stock >= 0),
  variants jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_business on public.products (business_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
alter table public.products enable row level security;
create policy "read products" on public.products for select to authenticated
  using (public.is_business_member(business_id, auth.uid())
    or (is_active and exists (select 1 from public.businesses b where b.id = business_id and b.is_public)));
create policy "manage products" on public.products for insert to authenticated with check (public.can_manage_business(business_id, auth.uid()));
create policy "update products" on public.products for update to authenticated using (public.can_manage_business(business_id, auth.uid())) with check (public.can_manage_business(business_id, auth.uid()));
create policy "delete products" on public.products for delete to authenticated using (public.can_manage_business(business_id, auth.uid()));
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();

create table public.product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  image_path text not null,
  image_url text,
  caption text not null default '',
  location_url text not null default '',
  location_lat double precision,
  location_lng double precision,
  location_label text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_photos_product on public.product_photos (product_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_photos TO authenticated;
GRANT ALL ON public.product_photos TO service_role;
alter table public.product_photos enable row level security;
create policy "read product photos" on public.product_photos for select to authenticated
  using (public.is_business_member(business_id, auth.uid())
    or exists (select 1 from public.products p join public.businesses b on b.id = p.business_id where p.id = product_id and p.is_active and b.is_public));
create policy "insert product photos" on public.product_photos for insert to authenticated with check (public.can_manage_business(business_id, auth.uid()));
create policy "update product photos" on public.product_photos for update to authenticated using (public.can_manage_business(business_id, auth.uid())) with check (public.can_manage_business(business_id, auth.uid()));
create policy "delete product photos" on public.product_photos for delete to authenticated using (public.can_manage_business(business_id, auth.uid()));
create trigger product_photos_updated_at before update on public.product_photos for each row execute function public.set_updated_at();

-- ============ QUICK REPLIES ============
create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  shortcut text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;
GRANT ALL ON public.quick_replies TO service_role;
alter table public.quick_replies enable row level security;
create policy "read quick replies" on public.quick_replies for select to authenticated using (public.is_business_member(business_id, auth.uid()));
create policy "write quick replies" on public.quick_replies for insert to authenticated with check (public.can_manage_business(business_id, auth.uid()));
create policy "update quick replies" on public.quick_replies for update to authenticated using (public.can_manage_business(business_id, auth.uid())) with check (public.can_manage_business(business_id, auth.uid()));
create policy "delete quick replies" on public.quick_replies for delete to authenticated using (public.can_manage_business(business_id, auth.uid()));
create trigger quick_replies_updated_at before update on public.quick_replies for each row execute function public.set_updated_at();

-- ============ CUSTOMERS / ORDERS / SALES ============
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  pin text,
  address text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
alter table public.customers enable row level security;
create policy "read customers" on public.customers for select to authenticated using (public.is_business_member(business_id, auth.uid()));
create policy "write customers" on public.customers for insert to authenticated with check (public.can_sell_business(business_id, auth.uid()));
create policy "update customers" on public.customers for update to authenticated using (public.can_sell_business(business_id, auth.uid())) with check (public.can_sell_business(business_id, auth.uid()));
create policy "delete customers" on public.customers for delete to authenticated using (public.can_manage_business(business_id, auth.uid()));
create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  buyer_user_id uuid references auth.users(id) on delete set null,
  number text not null,
  status public.order_status not null default 'new',
  note text not null default '',
  address text not null default '',
  shipping numeric(14,2) not null default 0 check (shipping >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
alter table public.orders enable row level security;
create policy "read orders" on public.orders for select to authenticated using (public.is_business_member(business_id, auth.uid()) or buyer_user_id = auth.uid());
create policy "write orders" on public.orders for insert to authenticated with check (public.can_sell_business(business_id, auth.uid()));
create policy "update orders" on public.orders for update to authenticated using (public.can_sell_business(business_id, auth.uid())) with check (public.can_sell_business(business_id, auth.uid()));
create policy "delete orders" on public.orders for delete to authenticated using (public.can_manage_business(business_id, auth.uid()));
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  qty int not null default 1 check (qty > 0),
  price numeric(14,2) not null default 0 check (price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  photo_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
alter table public.order_items enable row level security;
create policy "read order items" on public.order_items for select to authenticated
  using (public.is_business_member(business_id, auth.uid()) or exists (select 1 from public.orders o where o.id = order_id and o.buyer_user_id = auth.uid()));
create policy "write order items" on public.order_items for insert to authenticated with check (public.can_sell_business(business_id, auth.uid()));
create policy "update order items" on public.order_items for update to authenticated using (public.can_sell_business(business_id, auth.uid())) with check (public.can_sell_business(business_id, auth.uid()));
create policy "delete order items" on public.order_items for delete to authenticated using (public.can_sell_business(business_id, auth.uid()));

create table public.sales_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  seller_id uuid not null references auth.users(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  idempotency_key text not null,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  extra_fee numeric(14,2) not null default 0 check (extra_fee >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  payment_method public.payment_method not null default 'cash',
  due_date date,
  note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index sales_records_idem_key on public.sales_records (seller_id, idempotency_key);
GRANT SELECT, INSERT, UPDATE ON public.sales_records TO authenticated;
GRANT ALL ON public.sales_records TO service_role;
alter table public.sales_records enable row level security;
create policy "read sales" on public.sales_records for select to authenticated
  using (public.is_business_member(business_id, auth.uid()) or customer_user_id = auth.uid());
create policy "write sales" on public.sales_records for insert to authenticated
  with check (seller_id = auth.uid() and public.can_sell_business(business_id, auth.uid()));
create policy "update sales" on public.sales_records for update to authenticated using (public.can_sell_business(business_id, auth.uid())) with check (public.can_sell_business(business_id, auth.uid()));
create trigger sales_records_updated_at before update on public.sales_records for each row execute function public.set_updated_at();

-- ============ LEDGERS ============
create table public.ledgers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  counterpart_user_id uuid references auth.users(id) on delete set null,
  counterpart_name text not null,
  sales_record_id uuid references public.sales_records(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  type public.ledger_type not null,
  status public.ledger_status not null default 'active',
  amount numeric(14,2) not null check (amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  due_date date,
  note text not null default '',
  reminder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledgers_paid_not_negative check (paid_amount <= amount)
);
create index ledgers_owner on public.ledgers (owner_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledgers TO authenticated;
GRANT ALL ON public.ledgers TO service_role;
alter table public.ledgers enable row level security;
create policy "read ledgers" on public.ledgers for select to authenticated using (owner_id = auth.uid() or counterpart_user_id = auth.uid());
create policy "create ledgers" on public.ledgers for insert to authenticated with check (owner_id = auth.uid());
create policy "update ledgers" on public.ledgers for update to authenticated
  using (owner_id = auth.uid() or counterpart_user_id = auth.uid()) with check (owner_id = auth.uid() or counterpart_user_id = auth.uid());
create policy "delete ledgers" on public.ledgers for delete to authenticated using (owner_id = auth.uid());
create trigger ledgers_updated_at before update on public.ledgers for each row execute function public.set_updated_at();

create table public.ledger_payments (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  recorded_by uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'cash',
  proof_path text,
  note text not null default '',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create or replace function public.can_see_ledger(_ledger uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ledgers l where l.id = _ledger and (l.owner_id = _uid or l.counterpart_user_id = _uid))
$$;
GRANT SELECT, INSERT ON public.ledger_payments TO authenticated;
GRANT ALL ON public.ledger_payments TO service_role;
alter table public.ledger_payments enable row level security;
create policy "read ledger payments" on public.ledger_payments for select to authenticated using (public.can_see_ledger(ledger_id, auth.uid()));
create policy "add ledger payments" on public.ledger_payments for insert to authenticated
  with check (recorded_by = auth.uid() and public.can_see_ledger(ledger_id, auth.uid()));

create table public.ledger_events (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  label text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT ON public.ledger_events TO authenticated;
GRANT ALL ON public.ledger_events TO service_role;
alter table public.ledger_events enable row level security;
create policy "read ledger events" on public.ledger_events for select to authenticated using (public.can_see_ledger(ledger_id, auth.uid()));
create policy "add ledger events" on public.ledger_events for insert to authenticated
  with check (actor_id = auth.uid() and public.can_see_ledger(ledger_id, auth.uid()));

-- atomic partial payment
create or replace function public.record_ledger_payment(_ledger uuid, _amount numeric, _method text, _note text)
returns public.ledgers language plpgsql security definer set search_path = public as $$
declare l public.ledgers; remaining numeric;
begin
  if _amount is null or _amount <= 0 then raise exception 'Nominal pembayaran harus lebih dari nol'; end if;
  select * into l from public.ledgers where id = _ledger for update;
  if not found then raise exception 'Catatan tidak ditemukan'; end if;
  if not (l.owner_id = auth.uid() or l.counterpart_user_id = auth.uid()) then raise exception 'Tidak diizinkan'; end if;
  if l.status in ('cancelled','rejected') then raise exception 'Catatan sudah tidak aktif'; end if;
  remaining := l.amount - l.paid_amount;
  if _amount > remaining then raise exception 'Nominal melebihi sisa tagihan'; end if;
  insert into public.ledger_payments (ledger_id, recorded_by, amount, method, note)
  values (_ledger, auth.uid(), _amount, coalesce(_method,'cash'), coalesce(_note,''));
  update public.ledgers
     set paid_amount = paid_amount + _amount,
         status = case when paid_amount + _amount >= amount then 'paid'::public.ledger_status else 'partially_paid'::public.ledger_status end
   where id = _ledger returning * into l;
  insert into public.ledger_events (ledger_id, actor_id, label, detail)
  values (_ledger, auth.uid(), case when l.status = 'paid' then 'Pelunasan dicatat' else 'Pembayaran dicatat' end, coalesce(_method,'cash'));
  return l;
end $$;
revoke all on function public.record_ledger_payment(uuid, numeric, text, text) from public;
grant execute on function public.record_ledger_payment(uuid, numeric, text, text) to authenticated;

-- exact PIN lookup with rate limit
create or replace function public.find_profile_by_pin(_pin text)
returns table (id uuid, pin text, display_name text, bio text, avatar_url text, avatar_color text)
language plpgsql stable security definer set search_path = public as $$
declare recent int;
begin
  if auth.uid() is null then raise exception 'Tidak diizinkan'; end if;
  select count(*) into recent from public.pin_search_log where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if recent >= 20 then raise exception 'Terlalu banyak pencarian. Coba lagi sebentar lagi.'; end if;
  return query
    select p.id, p.pin, p.display_name, p.bio, p.avatar_url, p.avatar_color
    from public.profiles p
    where p.pin = upper(trim(_pin)) and p.id <> auth.uid();
end $$;
revoke all on function public.find_profile_by_pin(text) from public;
grant execute on function public.find_profile_by_pin(text) to authenticated;

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'chat',
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_time on public.notifications (user_id, created_at desc);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ REALTIME ============
alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;
alter table public.message_receipts replica identity full;
alter table public.conversations replica identity full;
alter table public.contact_requests replica identity full;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.message_receipts;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.contact_requests;