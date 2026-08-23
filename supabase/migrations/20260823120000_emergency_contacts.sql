-- Emergency contacts saved per customer account for the Set up Safety flow.
create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_name text not null,
  phone_number text not null,
  created_at timestamptz not null default now()
);

create index if not exists emergency_contacts_user_id_idx
  on public.emergency_contacts (user_id, created_at);

alter table public.emergency_contacts enable row level security;

drop policy if exists "Users manage their own emergency contacts" on public.emergency_contacts;
create policy "Users manage their own emergency contacts"
  on public.emergency_contacts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
