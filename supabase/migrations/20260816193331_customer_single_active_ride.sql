-- Booking is idempotent per customer. Locking the profile serializes concurrent
-- taps/retries, and an existing active ride is returned instead of duplicated.
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

  -- Serialize every booking attempt for this customer before checking state.
  perform 1 from public.profiles where id = auth.uid() for update;
  select id into v_ride_id
  from public.rides
  where customer_id = auth.uid()
    and status in ('requested', 'searching', 'accepted', 'arrived', 'in_progress')
  order by requested_at desc
  limit 1;
  if v_ride_id is not null then return v_ride_id; end if;

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
