-- A Captain may reserve exactly one next ride while finishing an in-progress
-- ride.  The existing lifecycle values stay unchanged: the reservation is an
-- accepted ride linked to the ride that must finish first.
alter table public.rides
  add column queued_after_ride_id uuid references public.rides(id) on delete restrict;

create unique index rides_one_queued_next_ride_per_captain_idx
  on public.rides (captain_id)
  where queued_after_ride_id is not null and status in ('accepted', 'arrived', 'in_progress');

alter table public.ride_offers
  add column active_ride_remaining_meters integer
    check (active_ride_remaining_meters is null or active_ride_remaining_meters between 1 and 500);

-- This protects the queue invariant for every caller, including an older app
-- or a direct RPC call: a reservation cannot reach pickup or trip states
-- before the preceding ride has completed.
create function public.prevent_queued_ride_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.queued_after_ride_id is not null
    and new.status in ('arrived', 'in_progress')
    and not exists (
      select 1 from public.rides predecessor
      where predecessor.id = new.queued_after_ride_id and predecessor.status = 'completed'
    ) then
    raise exception 'Complete the current ride before starting the queued ride';
  end if;
  return new;
end;
$$;

create trigger rides_prevent_queued_ride_progress
before update of status on public.rides
for each row execute function public.prevent_queued_ride_progress();

revoke all on function public.prevent_queued_ride_progress() from public, anon, authenticated;

-- This is service-only. The Edge Function obtains the remaining road distance
-- from Google Routes using the location already recorded for the active ride.
create function public.offer_near_completion_ride(
  p_captain_id uuid,
  p_remaining_distance_meters integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.rides;
  v_offer_ride public.rides;
  v_offer_id uuid;
  v_captain_location extensions.geography;
begin
  if p_captain_id is null or p_remaining_distance_meters not between 1 and 500 then
    raise exception 'Captain is not near the destination';
  end if;

  select * into v_active
  from public.rides
  where captain_id = p_captain_id and status = 'in_progress'
  order by started_at desc
  limit 1
  for update;
  if not found or v_active.captain_latitude is null or v_active.captain_longitude is null then return null; end if;
  if exists (
    select 1 from public.rides
    where captain_id = p_captain_id and queued_after_ride_id is not null
      and status in ('accepted', 'arrived', 'in_progress')
  ) then return null; end if;
  if exists (
    select 1 from public.ride_offers
    where captain_id = p_captain_id and status = 'offered' and expires_at > now()
  ) then return null; end if;

  v_captain_location := extensions.st_setsrid(
    extensions.st_makepoint(v_active.captain_longitude, v_active.captain_latitude), 4326
  )::extensions.geography;

  select ride.* into v_offer_ride
  from public.rides ride
  join public.captain_profiles captain on captain.user_id = p_captain_id
  where ride.status = 'searching' and ride.captain_id is null
    and ride.ride_type = captain.vehicle_type
    and ride.pickup_latitude is not null and ride.pickup_longitude is not null
    and extensions.st_dwithin(
      extensions.st_setsrid(extensions.st_makepoint(ride.pickup_longitude, ride.pickup_latitude), 4326)::extensions.geography,
      v_captain_location,
      3000
    )
    and not exists (
      select 1 from public.ride_offers prior
      where prior.ride_id = ride.id and prior.captain_id = p_captain_id
    )
  order by extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(ride.pickup_longitude, ride.pickup_latitude), 4326)::extensions.geography,
    v_captain_location
  ), ride.requested_at
  limit 1
  for update skip locked;
  if not found then return null; end if;

  insert into public.ride_offers (
    ride_id, captain_id, expires_at, offer_round,
    active_ride_remaining_meters
  ) values (
    v_offer_ride.id, p_captain_id, now() + interval '30 seconds',
    coalesce((select max(offer_round) from public.ride_offers where ride_id = v_offer_ride.id), 0) + 1,
    p_remaining_distance_meters
  ) returning id into v_offer_id;
  return v_offer_id;
end;
$$;

-- Preserve the normal claim exactly as before, but link the new ride to the
-- active one if this offer was made through the near-completion path.
create or replace function public.accept_ride_offer_with_pickup_route(
  p_offer_id uuid, p_captain_id uuid, p_pickup_distance_meters integer,
  p_duration_seconds integer, p_encoded_polyline text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.ride_offers;
  v_ride public.rides;
  v_active public.rides;
  v_final_fare numeric(10,0);
  v_at_pickup boolean;
begin
  if p_captain_id is null then raise exception 'Captain is required'; end if;
  v_at_pickup := p_pickup_distance_meters = 0 and p_duration_seconds = 0 and p_encoded_polyline = 'AT_PICKUP';
  if not v_at_pickup and (p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000) then
    raise exception 'Invalid Google route';
  end if;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> p_captain_id or v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'Offer is no longer available'; end if;
  select * into v_ride from public.rides where id = v_offer.ride_id and status = 'searching' and captain_id is null for update;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;
  if v_offer.active_ride_remaining_meters is not null then
    select * into v_active from public.rides where captain_id = p_captain_id and status = 'in_progress' order by started_at desc limit 1 for update;
    if not found or v_offer.active_ride_remaining_meters not between 1 and 500 then raise exception 'Captain is no longer eligible for a next ride'; end if;
    if exists (select 1 from public.rides where captain_id = p_captain_id and queued_after_ride_id is not null and status in ('accepted', 'arrived', 'in_progress')) then raise exception 'Captain already has a queued next ride'; end if;
  end if;
  v_final_fare := private.round_fare_half_down(v_ride.estimated_fare);
  update public.rides set captain_id = p_captain_id, status = 'accepted', accepted_at = now(), pickup_distance_meters = p_pickup_distance_meters,
    pickup_surcharge = 0, final_fare = v_final_fare,
    queued_after_ride_id = case when v_offer.active_ride_remaining_meters is null then null else v_active.id end,
    updated_at = now()
  where id = v_ride.id returning * into v_ride;
  perform private.reprice_active_captain_promo_ride(v_ride, v_final_fare);
  select * into v_ride from public.rides where id = v_ride.id;
  update public.rides set customer_charge_amount = case when customer_charge_type = 'free' then 0 else v_final_fare end,
    fare_approval_status = 'approved', updated_at = now() where id = v_ride.id returning * into v_ride;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (v_ride.id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update set distance_meters = excluded.distance_meters, duration_seconds = excluded.duration_seconds, encoded_polyline = excluded.encoded_polyline, created_at = now();
  update public.ride_offers set status = case when id = v_offer.id then 'accepted' else 'cancelled' end, responded_at = case when id = v_offer.id then now() else null end where ride_id = v_ride.id and status = 'offered';
  update public.captain_availability set is_online = false, updated_at = now() where captain_id = p_captain_id;
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, 'accepted', 'captain');
  return v_ride;
end;
$$;

revoke all on function public.offer_near_completion_ride(uuid, integer) from public, anon, authenticated;
grant execute on function public.offer_near_completion_ride(uuid, integer) to service_role;
