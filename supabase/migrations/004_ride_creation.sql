-- Phase 2: a customer-owned ride request and its server-created initial event.
-- Captain assignment, fare settlement, and dispatch are deliberately separate
-- phases; customers cannot set those fields through the Data API.

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  captain_id uuid references public.captain_profiles (user_id) on delete set null,
  ride_type text not null check (ride_type in ('bike', 'auto')),
  status text not null default 'requested'
    check (status in ('requested', 'searching', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled')),
  pickup_address text not null check (char_length(trim(pickup_address)) between 1 and 280),
  drop_address text not null check (char_length(trim(drop_address)) between 1 and 280),
  pickup_latitude numeric(9, 6) check (pickup_latitude between -90 and 90),
  pickup_longitude numeric(9, 6) check (pickup_longitude between -180 and 180),
  drop_latitude numeric(9, 6) check (drop_latitude between -90 and 90),
  drop_longitude numeric(9, 6) check (drop_longitude between -180 and 180),
  estimated_fare numeric(10, 2) not null check (estimated_fare > 0),
  final_fare numeric(10, 2) check (final_fare >= 0),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_coordinates_are_complete
    check ((pickup_latitude is null and pickup_longitude is null) or (pickup_latitude is not null and pickup_longitude is not null)),
  constraint ride_drop_coordinates_are_complete
    check ((drop_latitude is null and drop_longitude is null) or (drop_latitude is not null and drop_longitude is not null)),
  constraint ride_terminal_times_match_status
    check ((status = 'completed') = (completed_at is not null) and (status = 'cancelled') = (cancelled_at is not null))
);

create table public.ride_status_history (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  status text not null check (status in ('requested', 'searching', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled')),
  actor_type text not null check (actor_type in ('customer', 'captain', 'system')),
  created_at timestamptz not null default now()
);

create index rides_customer_requested_at_idx on public.rides (customer_id, requested_at desc);
create index rides_captain_status_idx on public.rides (captain_id, status) where captain_id is not null;
create index ride_status_history_ride_created_at_idx on public.ride_status_history (ride_id, created_at);

create trigger rides_set_updated_at
before update on public.rides
for each row execute function public.set_updated_at();

create function public.add_initial_ride_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ride_status_history (ride_id, status, actor_type)
  values (new.id, 'requested', 'customer');
  return new;
end;
$$;

create trigger add_initial_ride_status_history_after_insert
after insert on public.rides
for each row execute function public.add_initial_ride_status_history();

alter table public.rides enable row level security;
alter table public.ride_status_history enable row level security;

grant select, insert on public.rides to authenticated;
grant select on public.ride_status_history to authenticated;

create policy "Customers can create requested rides"
on public.rides for insert to authenticated
with check (
  (select auth.uid()) = customer_id
  and captain_id is null
  and status = 'requested'
  and final_fare is null
  and accepted_at is null
  and completed_at is null
  and cancelled_at is null
);

create policy "Customers can read their own rides"
on public.rides for select to authenticated
using ((select auth.uid()) = customer_id);

create policy "Ride participants can read status history"
on public.ride_status_history for select to authenticated
using (
  exists (
    select 1 from public.rides
    where rides.id = ride_status_history.ride_id
      and ((select auth.uid()) = rides.customer_id or (select auth.uid()) = rides.captain_id)
  )
);

revoke execute on function public.add_initial_ride_status_history() from public, anon, authenticated;
