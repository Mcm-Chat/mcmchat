-- Save only the keys changed by this device. PostgreSQL locks the row during
-- UPDATE, so concurrent patches of distinct keys cannot replace one another.
-- The caller's account is derived from auth.uid(); the supplied id is a guard
-- against an old screen saving after the session has switched accounts.
create or replace function public.update_my_settings(_expected_user_id uuid, _patch jsonb)
returns public.user_settings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _section text;
  _key text;
  _value jsonb;
  _number numeric;
  _row public.user_settings;
begin
  if _uid is null or _expected_user_id is distinct from _uid then
    raise exception 'Akun berubah. Masuk kembali untuk menyimpan pengaturan.' using errcode = '42501';
  end if;
  if jsonb_typeof(_patch) is distinct from 'object' then
    raise exception 'Format pengaturan tidak valid.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(_patch) k where k not in ('theme','notifications','privacy','security','voice')) then
    raise exception 'Pengaturan tidak dikenali.' using errcode = '22023';
  end if;
  if _patch ? 'theme' and (_patch->>'theme' is null or _patch->>'theme' not in ('dark','light')) then
    raise exception 'Tema tidak valid.' using errcode = '22023';
  end if;
  foreach _section in array array['notifications','privacy','security','voice'] loop
    if _patch ? _section and jsonb_typeof(_patch->_section) is distinct from 'object' then
      raise exception 'Format pengaturan tidak valid.' using errcode = '22023';
    end if;
  end loop;
  foreach _section in array array['notifications','privacy','security'] loop
    for _key, _value in select key,value from jsonb_each(coalesce(_patch->_section, '{}'::jsonb)) loop
      if jsonb_typeof(_value) <> 'boolean'
        or (_section = 'notifications' and _key not in ('push','preview','sound','vibrate','chat','group','calls','tasks','sales','ledger','badge'))
        or (_section = 'privacy' and _key not in ('online','readReceipts'))
        or (_section = 'security' and _key not in ('appLock','twoFactor')) then
        raise exception 'Nilai pengaturan tidak valid.' using errcode = '22023';
      end if;
    end loop;
  end loop;
  for _key, _value in select key,value from jsonb_each(coalesce(_patch->'voice', '{}'::jsonb)) loop
    if _key not in ('enabled','preset','intensity','custom')
      or (_key = 'enabled' and jsonb_typeof(_value) <> 'boolean')
      or (_key = 'preset' and (jsonb_typeof(_value) <> 'string' or (_value #>> '{}') not in ('off','natural','deep','bright','warm','robot','radio','privacy','custom')))
      or (_key = 'intensity' and jsonb_typeof(_value) <> 'number')
      or (_key = 'custom' and jsonb_typeof(_value) <> 'object') then
      raise exception 'Nilai efek suara tidak valid.' using errcode = '22023';
    end if;
    if _key = 'intensity' and ((_value #>> '{}')::numeric < 0 or (_value #>> '{}')::numeric > 1) then
      raise exception 'Intensitas efek suara tidak valid.' using errcode = '22023';
    end if;
  end loop;
  for _key, _value in select key,value from jsonb_each(coalesce(_patch->'voice'->'custom', '{}'::jsonb)) loop
    if _key not in ('pitch','formant','tone','gate','denoise','gain','reverb','character') or jsonb_typeof(_value) <> 'number' then
      raise exception 'Parameter efek suara tidak valid.' using errcode = '22023';
    end if;
    _number := (_value #>> '{}')::numeric;
    if (_key = 'pitch' and (_number < -5 or _number > 5))
      or (_key in ('formant','tone') and (_number < -1 or _number > 1))
      or (_key = 'gate' and (_number < -80 or _number > -20))
      or (_key in ('denoise','character') and (_number < 0 or _number > 1))
      or (_key = 'gain' and (_number < -12 or _number > 12))
      or (_key = 'reverb' and (_number < 0 or _number > 0.4)) then
      raise exception 'Parameter efek suara di luar batas.' using errcode = '22023';
    end if;
  end loop;

  -- Handles simultaneous first-use on multiple devices without resetting defaults.
  insert into public.user_settings (user_id) values (_uid) on conflict (user_id) do nothing;
  update public.user_settings s set
    theme = coalesce(_patch->>'theme', s.theme),
    notifications = case when _patch ? 'notifications' then
      (case when jsonb_typeof(s.notifications) = 'object' then s.notifications else '{}'::jsonb end) || (_patch->'notifications') else s.notifications end,
    privacy = case when _patch ? 'privacy' then
      (case when jsonb_typeof(s.privacy) = 'object' then s.privacy else '{}'::jsonb end) || (_patch->'privacy') else s.privacy end,
    security = case when _patch ? 'security' then
      (case when jsonb_typeof(s.security) = 'object' then s.security else '{}'::jsonb end) || (_patch->'security') else s.security end,
    voice = case when _patch ? 'voice' then
      (case when jsonb_typeof(s.voice) = 'object' then s.voice else '{}'::jsonb end) || ((_patch->'voice') - 'custom') ||
      (case when _patch->'voice' ? 'custom' then jsonb_build_object('custom',
        (case when jsonb_typeof(s.voice->'custom') = 'object' then s.voice->'custom' else '{}'::jsonb end) || (_patch->'voice'->'custom')) else '{}'::jsonb end)
      else s.voice end
  where s.user_id = _uid
  returning s.* into _row;
  if _row.user_id is null then
    raise exception 'Pengaturan tidak dapat disimpan.' using errcode = '42501';
  end if;
  return _row;
end;
$$;

-- Keep row ownership enforced for invoker functions and direct clients alike.
alter table public.user_settings enable row level security;
grant select, insert, update on public.user_settings to authenticated;
revoke all on function public.update_my_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_my_settings(uuid, jsonb) to authenticated;
