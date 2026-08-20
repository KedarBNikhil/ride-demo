-- Phase 3: authoritative two-sided dispatch. The client only calls narrowly
-- scoped RPCs; assignment and state transitions are decided atomically here.

create table public.captain_availability (
  captain_id uuid primary key references public.captain_profiles (user_id) on delete cascade,
  is_online boolean not null default false,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  updated_at timestamptz not null default now(),
  constraint captain_availability_coordinates_complete
    check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null))
);

create table public.ride_offers (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides (id) on delete cascade,
  captain_id uuid not null references public.captain_profiles (user_id) on delete cascade,
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'rejected', 'expired', 'cancelled')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, captain_id),
  constraint offer_response_matches_status
    check ((status in ('accepted', 'rejected')) = (responded_at is not null))
);

create unique index one_open_offer_per_ride_idx
  on public.ride_offers (ride_id) where status = 'offered';
create index ride_offers_captain_open_idx
  on public.ride_offers (captain_id, expires_at) where status = 'offered';

alter table public.rides
  add column arrived_at timestamptz,
  add column started_at timestamptz,
  add column pickup_otp text not null default '1234',
  add constraint ride_lifecycle_times_match_status check (
    (status in ('arrived', 'in_progress', 'completed')) = (arrived_at is not null)
    and (status in ('in_progress', 'completed')) = (started_at is not null)
  );

alter table public.captain_availability enable row level security;
alter table public.ride_offers enable row level security;

grant select, insert, update on public.captain_availability to authenticated;
grant select on public.ride_offers to authenticated;
grant select on public.rides, public.ride_status_history to authenticated;
grant execute on function public.set_updated_at() to postgres;

create policy "Captains manage only their availability"
on public.captain_availability for all to authenticated
using ((select auth.uid()) = captain_id)
with check ((select auth.uid()) = captain_id);

create policy "Captains read only their own ride offers"
on public.ride_offers for select to authenticated
using ((select auth.uid()) = captain_id);

create policy "Captains read rides assigned to them"
on public.rides for select to authenticated
using ((select auth.uid()) = captain_id);

-- Return an offer for the nearest online compatible captain. This is a simple
-- development matcher; production matching can replace only this function.
create function public.request_ride(
  p_ride_type text,
  p_pickup_address text,
  p_drop_address text,
  p_pickup_latitude numeric,
  p_pickup_longitude numeric,
  p_drop_latitude numeric,
  p_drop_longitude numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride_id uuid;
  v_captain_id uuid;
  v_fare numeric(10, 2);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_ride_type not in ('bike', 'auto') then raise exception 'Invalid ride type'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280
     or char_length(trim(p_drop_address)) not between 1 and 280 then
    raise exception 'Pickup and destination are required';
  end if;
  if (p_pickup_latitude is null) <> (p_pickup_longitude is null)
     or (p_drop_latitude is null) <> (p_drop_longitude is null) then
    raise exception 'Coordinates must be supplied in pairs';
  end if;

  v_fare := case when p_ride_type = 'bike' then 55 else 75 end;
  insert into public.rides (
    customer_id, ride_type, status, pickup_address, drop_address,
    pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, estimated_fare
  ) values (
    auth.uid(), p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address),
    p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, v_fare
  ) returning id into v_ride_id;

  select availability.captain_id into v_captain_id
  from public.captain_availability availability
  join public.captain_profiles captain on captain.user_id = availability.captain_id
  where availability.is_online
    and captain.vehicle_type = p_ride_type
    and (p_pickup_latitude is null or (availability.latitude is not null and availability.longitude is not null))
  order by case when p_pickup_latitude is null then 0 else
    power(availability.latitude - p_pickup_latitude, 2) + power(availability.longitude - p_pickup_longitude, 2)
  end
  limit 1
  for update of availability skip locked;

  if v_captain_id is not null then
    insert into public.ride_offers (ride_id, captain_id, expires_at)
    values (v_ride_id, v_captain_id, now() + interval '30 seconds');
    insert into public.ride_status_history (ride_id, status, actor_type)
    values (v_ride_id, 'searching', 'system');
  end if;
  return v_ride_id;
end;
$$;

create function public.respond_to_ride_offer(p_offer_id uuid, p_accept boolean)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.ride_offers;
  v_ride public.rides;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> auth.uid() then raise exception 'Offer not found'; end if;
  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then
    if v_offer.status = 'offered' then update public.ride_offers set status = 'expired' where id = v_offer.id; end if;
    raise exception 'Offer is no longer available';
  end if;
  if not p_accept then
    update public.ride_offers set status = 'rejected', responded_at = now() where id = v_offer.id;
    select * into v_ride from public.rides where id = v_offer.ride_id;
    return v_ride;
  end if;
  update public.rides set captain_id = auth.uid(), status = 'accepted', accepted_at = now()
  where id = v_offer.ride_id and status = 'searching' and captain_id is null
  returning * into v_ride;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;
  update public.ride_offers set status = 'accepted', responded_at = now() where id = v_offer.id;
  update public.ride_offers set status = 'cancelled' where ride_id = v_offer.ride_id and id <> v_offer.id and status = 'offered';
  update public.captain_availability set is_online = false, updated_at = now() where captain_id = auth.uid();
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, 'accepted', 'captain');
  return v_ride;
end;
$$;

create function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare v_ride public.rides;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found then raise exception 'Ride not found'; end if;
  if (v_ride.status = 'accepted' and p_next_status = 'arrived') then
    update public.rides set status = 'arrived', arrived_at = now() where id = p_ride_id returning * into v_ride;
  elsif (v_ride.status = 'arrived' and p_next_status = 'in_progress') then
    update public.rides set status = 'in_progress', started_at = now() where id = p_ride_id returning * into v_ride;
  elsif (v_ride.status = 'in_progress' and p_next_status = 'completed') then
    update public.rides set status = 'completed', completed_at = now(), final_fare = estimated_fare where id = p_ride_id returning * into v_ride;
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = auth.uid();
  else
    raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, v_ride.status, 'captain');
  return v_ride;
end;
$$;

revoke all on function public.request_ride(text, text, text, numeric, numeric, numeric, numeric) from public;
revoke all on function public.respond_to_ride_offer(uuid, boolean) from public;
revoke all on function public.captain_transition_ride(uuid, text) from public;
grant execute on function public.request_ride(text, text, text, numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.respond_to_ride_offer(uuid, boolean) to authenticated;
grant execute on function public.captain_transition_ride(uuid, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.rides;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.ride_offers;
exception when duplicate_object then null;
end $$;
