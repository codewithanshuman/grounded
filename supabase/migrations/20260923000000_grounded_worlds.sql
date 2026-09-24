create table if not exists public.grounded_worlds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  world_name text not null check (char_length(world_name) between 3 and 80),
  state jsonb not null default '{"trees":[],"buildings":[],"totalRuns":0,"totalFuturesSimulated":0,"bestImprovementPct":0}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.grounded_worlds enable row level security;

-- The Supabase project keeps "Automatically expose new tables" disabled.
-- Grant only the operations used by the authenticated browser client; RLS
-- below still restricts every row to its owning auth user.
revoke all on table public.grounded_worlds from anon;
grant select, insert, update on table public.grounded_worlds to authenticated;

drop policy if exists "Owners can read their Grounded world" on public.grounded_worlds;
create policy "Owners can read their Grounded world"
  on public.grounded_worlds for select
  using (auth.uid() = user_id);

drop policy if exists "Owners can create their Grounded world" on public.grounded_worlds;
create policy "Owners can create their Grounded world"
  on public.grounded_worlds for insert
  with check (auth.uid() = user_id);

drop policy if exists "Owners can update their Grounded world" on public.grounded_worlds;
create policy "Owners can update their Grounded world"
  on public.grounded_worlds for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
