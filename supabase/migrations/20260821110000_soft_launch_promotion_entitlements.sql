-- Supersedes the broad free-ride switch with a server-authoritative soft-launch
-- promotion. It is disabled by default, including in production.
alter table public.ride_pricing_settings
  add column if not exists promotion_enabled boolean not null default false,
  add column if not exists maximum_free_rides smallint not null default 5 check (maximum_free_rides between 1 and 100),
  add column if not exists maximum_free_distance_meters integer not null default 2000 check (maximum_free_distance_meters between 1 and 50000),
  add column if not exists promotion_environment text not null default 'demo' check (promotion_environment in ('demo', 'production')),
  add column if not exists promotion_policy_code text not null default 'demo-free-five-under-2km' check (char_length(trim(promotion_policy_code)) between 1 and 100);
update public.ride_pricing_settings set free_customer_rides_enabled = false, promotion_enabled = false where singleton;

alter table public.rides
  add column if not exists pricing_policy_code text,
  add column if not exists free_ride_sequence smallint,
  add column if not exists pricing_distance_meters integer;
alter table public.rides add constraint rides_pricing_distance_meters_check check (pricing_distance_meters is null or pricing_distance_meters >= 0);
alter table public.rides add constraint rides_free_sequence_check check (free_ride_sequence is null or free_ride_sequence between 1 and 100);
comment on column public.rides.pricing_policy_code is 'Server policy snapshot used when the customer charge was decided.';
comment on column public.rides.free_ride_sequence is 'Reserved promotion slot; it only becomes consumed when the ride completes.';
comment on column public.rides.pricing_distance_meters is 'Authoritative initial route distance used for the customer charge decision.';

create table public.customer_promotion_entitlements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  ride_id uuid unique references public.rides(id) on delete restrict,
  policy_code text not null check (char_length(trim(policy_code)) between 1 and 100),
  sequence smallint not null check (sequence between 1 and 100),
  state text not null default 'reserved' check (state in ('reserved', 'completed', 'released')),
  reserved_at timestamptz not null default now(),
  completed_at timestamptz,
  released_at timestamptz,
  check ((state = 'reserved' and completed_at is null and released_at is null) or (state = 'completed' and completed_at is not null and released_at is null) or (state = 'released' and completed_at is null and released_at is not null))
);
create unique index customer_promotion_entitlements_active_sequence_idx
  on public.customer_promotion_entitlements(customer_id, policy_code, sequence)
  where state in ('reserved', 'completed');
create index customer_promotion_entitlements_customer_state_idx on public.customer_promotion_entitlements(customer_id, policy_code, state);
alter table public.customer_promotion_entitlements enable row level security;
revoke all on table public.customer_promotion_entitlements from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_promotion_entitlements to service_role;

-- Old creation paths never grant a promotion; only create_routed_ride below is
-- allowed to write the trusted decision snapshot.
create or replace function public.apply_ride_customer_pricing()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.pricing_policy_code is null then
    new.customer_charge_amount := coalesce(new.final_fare, new.estimated_fare, 0);
    new.customer_charge_type := 'standard'; new.customer_charge_status := 'pending';
    new.payment_status := 'pending'; new.payment_method := null; new.paid_at := null;
  end if;
  return new;
end; $$;

create or replace function public.create_routed_ride(
  p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text,
  p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric,
  p_passenger_count smallint, p_trip_distance_meters integer, p_trip_duration_seconds integer, p_encoded_polyline text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_base_fare numeric(10,2); v_distance_surcharge numeric(10,2); v_settings public.ride_pricing_settings; v_sequence smallint; v_free boolean := false;
begin
  if p_customer_id is null then raise exception 'Customer is required'; end if;
  if p_ride_type not in ('bike','auto') then raise exception 'Invalid ride type'; end if;
  if (p_ride_type = 'bike' and p_passenger_count <> 1) or (p_ride_type = 'auto' and p_passenger_count not between 1 and 3) then raise exception 'Invalid passenger count'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 or p_drop_latitude not between -90 and 90 or p_drop_longitude not between -180 and 180 then raise exception 'Valid pickup and drop locations are required'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280 or char_length(trim(p_drop_address)) not between 1 and 280 then raise exception 'Pickup and destination are required'; end if;
  if p_trip_distance_meters not between 1 and 250000 or p_trip_duration_seconds not between 1 and 86400 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  if exists (select 1 from public.rides where customer_id = p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  select * into v_settings from public.ride_pricing_settings where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));
  if exists (select 1 from public.rides where customer_id = p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  if v_settings.promotion_enabled and p_trip_distance_meters <= v_settings.maximum_free_distance_meters then
    select candidate.sequence into v_sequence
    from generate_series(1, v_settings.maximum_free_rides) as candidate(sequence)
    where not exists (select 1 from public.customer_promotion_entitlements entitlement where entitlement.customer_id = p_customer_id and entitlement.policy_code = v_settings.promotion_policy_code and entitlement.sequence = candidate.sequence and entitlement.state in ('reserved', 'completed'))
    order by candidate.sequence limit 1;
    v_free := v_sequence is not null;
  end if;
  v_base_fare := case when p_ride_type = 'bike' then 20 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end;
  v_distance_surcharge := ceil(greatest(0, p_trip_distance_meters - 2000) / 100) * 1;
  insert into public.rides (customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, passenger_count, pricing_rule_version, trip_distance_meters, base_fare, distance_surcharge, pickup_surcharge, estimated_fare, fare_approval_status, pricing_policy_code, free_ride_sequence, pricing_distance_meters, customer_charge_amount, customer_charge_type, customer_charge_status, payment_status, payment_method)
  values (p_customer_id, p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, p_passenger_count, 'google-routes-2026-08-18', p_trip_distance_meters, v_base_fare, v_distance_surcharge, 0, v_base_fare + v_distance_surcharge, case when v_free then 'approved' else 'estimated' end, v_settings.promotion_policy_code, v_sequence, p_trip_distance_meters, case when v_free then 0 else v_base_fare + v_distance_surcharge end, case when v_free then 'free' else 'standard' end, case when v_free then 'not_required' else 'pending' end, case when v_free then 'not_required' else 'pending' end, null)
  returning id into v_ride_id;
  if v_free then
    insert into public.customer_promotion_entitlements(customer_id, ride_id, policy_code, sequence) values (p_customer_id, v_ride_id, v_settings.promotion_policy_code, v_sequence);
  end if;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline) values (v_ride_id, 'initial_trip', p_trip_distance_meters, p_trip_duration_seconds, p_encoded_polyline);
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

create or replace function public.finalize_customer_promotion_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if new.status = 'completed' then
    update public.customer_promotion_entitlements set state = 'completed', completed_at = coalesce(new.completed_at, now())
      where ride_id = new.id and state = 'reserved';
  elsif new.status = 'cancelled' then
    update public.customer_promotion_entitlements set state = 'released', released_at = now()
      where ride_id = new.id and state = 'reserved';
  end if;
  return new;
end; $$;
drop trigger if exists rides_finalize_customer_promotion_entitlement on public.rides;
create trigger rides_finalize_customer_promotion_entitlement after update of status on public.rides
  for each row execute function public.finalize_customer_promotion_entitlement();

create or replace function public.customer_promotion_status()
returns table (promotion_enabled boolean, policy_code text, maximum_free_rides smallint, maximum_free_distance_meters integer, completed_free_rides integer, reserved_free_rides integer, remaining_free_rides integer)
language plpgsql security definer set search_path = '' as $$
declare v_settings public.ride_pricing_settings;
begin
  perform public.require_pilot_user('customer');
  select * into v_settings from public.ride_pricing_settings where singleton;
  return query select v_settings.promotion_enabled, v_settings.promotion_policy_code, v_settings.maximum_free_rides, v_settings.maximum_free_distance_meters,
    count(*) filter (where entitlement.state = 'completed')::integer, count(*) filter (where entitlement.state = 'reserved')::integer,
    greatest(0, v_settings.maximum_free_rides - count(*) filter (where entitlement.state in ('completed','reserved')))::integer
  from public.customer_promotion_entitlements entitlement
  where entitlement.customer_id = auth.uid() and entitlement.policy_code = v_settings.promotion_policy_code;
end; $$;

revoke all on function public.finalize_customer_promotion_entitlement(), public.customer_promotion_status() from public, anon;
grant execute on function public.customer_promotion_status() to authenticated;
