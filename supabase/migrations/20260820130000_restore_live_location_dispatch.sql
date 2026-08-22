-- Restore the existing GPS-backed location path without removing the
-- diagnostic dispatch fallback. Existing columns and the PostGIS trigger are
-- the source of truth for captain availability and ride tracking.

create or replace function public.captain_set_availability(
  p_is_online boolean,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('captain');

  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Availability location must include both latitude and longitude';
  end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception 'Invalid availability location';
  end if;

  insert into public.captain_availability(captain_id, is_online, latitude, longitude, updated_at)
  values (auth.uid(), p_is_online, p_latitude, p_longitude, now())
  on conflict (captain_id) do update
    set is_online = excluded.is_online,
        latitude = coalesce(excluded.latitude, public.captain_availability.latitude),
        longitude = coalesce(excluded.longitude, public.captain_availability.longitude),
        updated_at = now();
end;
$$;

create or replace function public.captain_update_ride_location(
  p_ride_id uuid,
  p_latitude numeric,
  p_longitude numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_latitude numeric;
  v_previous_longitude numeric;
  v_status text;
begin
  perform public.require_production_user();
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid location';
  end if;

  select captain_latitude, captain_longitude, status
    into v_previous_latitude, v_previous_longitude, v_status
  from public.rides
  where id = p_ride_id
    and captain_id = auth.uid()
    and status in ('accepted', 'arrived', 'in_progress')
  for update;
  if not found then raise exception 'Active ride not found'; end if;

  update public.rides
  set captain_latitude = p_latitude,
      captain_longitude = p_longitude,
      travelled_distance_km = travelled_distance_km + case
        when v_status <> 'in_progress' or v_previous_latitude is null then 0
        else sqrt(
          power((p_latitude - v_previous_latitude) * 111.32, 2) +
          power((p_longitude - v_previous_longitude) * 111.32 * cos(radians(p_latitude)), 2)
        )
      end,
      updated_at = now()
  where id = p_ride_id;
end;
$$;

create or replace function public.dispatch_ride_round(p_ride_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_round integer;
  v_pickup extensions.geography;
begin
  select * into v_ride
  from public.rides
  where id = p_ride_id and status = 'searching' and captain_id is null
  for update;
  if not found then return 0; end if;
  if v_ride.pickup_latitude is null or v_ride.pickup_longitude is null then
    raise warning 'Dispatch skipped for ride %: pickup coordinates are missing', p_ride_id;
    return 0;
  end if;
  if exists (
    select 1 from public.ride_offers
    where ride_id = p_ride_id and status = 'offered' and expires_at > now()
  ) then return 0; end if;

  v_round := coalesce((select max(offer_round) from public.ride_offers where ride_id = p_ride_id), 0) + 1;
  if v_round > 4 then return 0; end if;
  v_pickup := extensions.st_setsrid(
    extensions.st_makepoint(v_ride.pickup_longitude, v_ride.pickup_latitude), 4326
  )::extensions.geography;

  if exists (
    select 1
    from public.captain_availability availability
    join public.captain_profiles captain on captain.user_id = availability.captain_id
    where availability.is_online and captain.vehicle_type = v_ride.ride_type
  ) and not exists (
    select 1
    from public.captain_availability availability
    join public.captain_profiles captain on captain.user_id = availability.captain_id
    where availability.is_online
      and captain.vehicle_type = v_ride.ride_type
      and availability.location is not null
      and availability.updated_at > now() - interval '90 seconds'
      and extensions.st_dwithin(availability.location, v_pickup, 3000)
  ) then
    raise warning 'No fresh nearby captain location for ride %; using availability fallback', p_ride_id;
  end if;

  with nearby as (
    select availability.captain_id,
      extensions.st_distance(availability.location, v_pickup) as meters
    from public.captain_availability availability
    join public.captain_profiles captain on captain.user_id = availability.captain_id
    where availability.is_online
      and captain.vehicle_type = v_ride.ride_type
      and availability.location is not null
      and availability.updated_at > now() - interval '90 seconds'
      and extensions.st_dwithin(availability.location, v_pickup, 3000)
      and not exists (select 1 from public.rides active where active.captain_id = availability.captain_id and active.status in ('accepted', 'arrived', 'in_progress'))
      and not exists (select 1 from public.ride_offers open_offer where open_offer.captain_id = availability.captain_id and open_offer.status = 'offered' and open_offer.expires_at > now())
      and not exists (select 1 from public.ride_offers previous_offer where previous_offer.ride_id = p_ride_id and previous_offer.captain_id = availability.captain_id)
    order by availability.location operator(extensions.<->) v_pickup
    limit 3
  ), fallback as (
    select availability.captain_id, null::double precision as meters
    from public.captain_availability availability
    join public.captain_profiles captain on captain.user_id = availability.captain_id
    where not exists (select 1 from nearby)
      and availability.is_online
      and captain.vehicle_type = v_ride.ride_type
      and not exists (select 1 from public.rides active where active.captain_id = availability.captain_id and active.status in ('accepted', 'arrived', 'in_progress'))
      and not exists (select 1 from public.ride_offers open_offer where open_offer.captain_id = availability.captain_id and open_offer.status = 'offered' and open_offer.expires_at > now())
      and not exists (select 1 from public.ride_offers previous_offer where previous_offer.ride_id = p_ride_id and previous_offer.captain_id = availability.captain_id)
    order by availability.updated_at desc
    limit 3
  ), candidates as (
    select * from nearby union all select * from fallback
  )
  insert into public.ride_offers(
    ride_id, captain_id, expires_at, offer_round,
    pickup_distance_meters, estimated_pickup_eta_seconds
  )
  select p_ride_id, captain_id, now() + interval '30 seconds', v_round,
    meters,
    case when meters is null then null else greatest(60, ceil(meters / 6.1)::integer) end
  from candidates
  on conflict (ride_id, captain_id) do nothing;

  return (
    select count(*) from public.ride_offers
    where ride_id = p_ride_id and offer_round = v_round and status = 'offered'
  );
end;
$$;

revoke all on function public.captain_set_availability(boolean, numeric, numeric) from public, anon;
grant execute on function public.captain_set_availability(boolean, numeric, numeric) to authenticated;
revoke all on function public.captain_update_ride_location(uuid, numeric, numeric) from public, anon;
grant execute on function public.captain_update_ride_location(uuid, numeric, numeric) to authenticated;
revoke all on function public.dispatch_ride_round(uuid) from public, anon, authenticated;
