create table public.customer_saved_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 40),
  address text not null check (char_length(trim(address)) between 1 and 500),
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, label)
);

create index customer_saved_addresses_customer_created_idx on public.customer_saved_addresses(customer_id, created_at desc);
alter table public.customer_saved_addresses enable row level security;
revoke all on public.customer_saved_addresses from public, anon;
grant select, insert, update, delete on public.customer_saved_addresses to authenticated;

create policy "Customers manage own saved addresses" on public.customer_saved_addresses
  for all to authenticated
  using ((select auth.uid()) = customer_id)
  with check ((select auth.uid()) = customer_id);
