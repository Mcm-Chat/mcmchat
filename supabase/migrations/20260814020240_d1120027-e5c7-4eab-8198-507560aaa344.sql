create table public.call_diagnostic_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'livekit',
  status text not null check (status in ('pass','fail','warn')),
  latency_ms integer,
  code text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index call_diagnostic_runs_user_created_idx
  on public.call_diagnostic_runs (user_id, created_at desc);

grant select, insert, delete on public.call_diagnostic_runs to authenticated;
grant all on public.call_diagnostic_runs to service_role;

alter table public.call_diagnostic_runs enable row level security;

create policy "own diagnostics select" on public.call_diagnostic_runs
  for select to authenticated using (user_id = auth.uid());
create policy "own diagnostics insert" on public.call_diagnostic_runs
  for insert to authenticated with check (user_id = auth.uid());
create policy "own diagnostics delete" on public.call_diagnostic_runs
  for delete to authenticated using (user_id = auth.uid());