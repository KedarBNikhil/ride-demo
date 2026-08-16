-- A captain is dispatchable only while their open dashboard renews presence.
-- This avoids offering rides to a captain who left the app while still marked online.

create or replace function public.request_ride(
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
    and availability.updated_at > now() - interval '60 seconds'
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

create or replace function public.refresh_captain_dispatch()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captain_id uuid := auth.uid();
  v_vehicle_type text;
  v_ride_id uuid;
  v_offer_id uuid;
begin
  if v_captain_id is null then raise exception 'Authentication required'; end if;

  select captain.vehicle_type into v_vehicle_type
  from public.captain_profiles captain
  join public.captain_availability availability on availability.captain_id = captain.user_id
  where captain.user_id = v_captain_id
    and availability.is_online
    and availability.updated_at > now() - interval '60 seconds'
    and availability.latitude is not null
    and availability.longitude is not null
  for update of availability;
  if not found then return null; end if;

  update public.ride_offers
  set status = 'expired'
  where captain_id = v_captain_id and status = 'offered' and expires_at <= now();

  if exists (select 1 from public.ride_offers where captain_id = v_captain_id and status = 'offered' and expires_at > now()) then return null; end if;

  select ride.id into v_ride_id
  from public.rides ride
  where ride.status = 'searching' and ride.captain_id is null and ride.ride_type = v_vehicle_type
    and not exists (select 1 from public.ride_offers offer where offer.ride_id = ride.id and offer.status = 'offered' and offer.expires_at > now())
  order by ride.requested_at limit 1 for update of ride skip locked;
  if v_ride_id is null then return null; end if;

  insert into public.ride_offers (ride_id, captain_id, expires_at)
  values (v_ride_id, v_captain_id, now() + interval '30 seconds')
  on conflict (ride_id, captain_id) do update
    set status = 'offered', offered_at = now(), expires_at = excluded.expires_at, responded_at = null
    where public.ride_offers.status in ('rejected', 'expired', 'cancelled')
  returning id into v_offer_id;
  if v_offer_id is not null then
    insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride_id, 'searching', 'system');
  end if;
  return v_offer_id;
end;
$$;

-- This deliberately returns only the data a customer needs for their own assigned ride.
create function public.customer_assigned_captain(p_ride_id uuid)
returns table (full_name text, vehicle_type text)
language sql
security definer
set search_path = ''
as $$
  select profile.full_name, captain.vehicle_type
  from public.rides ride
  join public.profiles profile on profile.id = ride.captain_id
  join public.captain_profiles captain on captain.user_id = ride.captain_id
  where ride.id = p_ride_id
    and ride.customer_id = auth.uid()
    and ride.captain_id is not null;
$$;

revoke all on function public.customer_assigned_captain(uuid) from public, anon;
grant execute on function public.customer_assigned_captain(uuid) to authenticated;
