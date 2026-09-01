-- The route-based fare finalizers share one immutable backend calculation.
-- This schema is not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;

create or replace function private.pickup_surcharge_for_distance(
  p_ride_type text,
  p_pickup_distance_meters integer
)
returns numeric(10,2)
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if p_pickup_distance_meters not between 1 and 100000 then
    raise exception 'Invalid Google route';
  end if;

  case p_ride_type
    when 'auto' then
      return ceil(greatest(0::numeric, p_pickup_distance_meters - 600) / 100) * 1;
    when 'bike' then
      return ceil(greatest(0::numeric, p_pickup_distance_meters - 800) / 100) * 2;
    else
      raise exception 'Invalid ride type';
  end case;
end;
$$;

revoke all on function private.pickup_surcharge_for_distance(text, integer) from public;

create or replace function public.accept_ride_offer_with_pickup_route(
  p_offer_id uuid,
  p_captain_id uuid,
  p_pickup_distance_meters integer,
  p_duration_seconds integer,
  p_encoded_polyline text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.ride_offers;
  v_ride public.rides;
  v_pickup_surcharge numeric(10,2);
begin
  if p_captain_id is null then raise exception 'Captain is required'; end if;
  if p_pickup_distance_meters not between 1 and 100000
    or p_duration_seconds not between 1 and 43200
    or char_length(p_encoded_polyline) not between 1 and 200000 then
    raise exception 'Invalid Google route';
  end if;

  select * into v_offer
  from public.ride_offers
  where id = p_offer_id
  for update;

  if not found
    or v_offer.captain_id <> p_captain_id
    or v_offer.status <> 'offered'
    or v_offer.expires_at <= now() then
    raise exception 'Offer is no longer available';
  end if;

  select * into v_ride
  from public.rides
  where id = v_offer.ride_id
    and status = 'searching'
    and captain_id is null
  for update;

  if not found then
    raise exception 'Ride was already accepted or cancelled';
  end if;

  v_pickup_surcharge := private.pickup_surcharge_for_distance(
    v_ride.ride_type,
    p_pickup_distance_meters
  );

  update public.rides
  set captain_id = p_captain_id,
      status = 'accepted',
      accepted_at = now(),
      pickup_distance_meters = p_pickup_distance_meters,
      pickup_surcharge = v_pickup_surcharge,
      final_fare = estimated_fare + v_pickup_surcharge,
      customer_charge_amount = case when customer_charge_type = 'free' then 0 else estimated_fare + v_pickup_surcharge end,
      fare_approval_status = case when customer_charge_type = 'free' then 'approved' when v_pickup_surcharge > 0 then 'pending' else 'approved' end,
      updated_at = now()
  where id = v_ride.id
  returning * into v_ride;

  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (v_ride.id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update
    set distance_meters = excluded.distance_meters,
        duration_seconds = excluded.duration_seconds,
        encoded_polyline = excluded.encoded_polyline,
        created_at = now();

  update public.ride_offers
  set status = case when id = v_offer.id then 'accepted' else 'cancelled' end,
      responded_at = case when id = v_offer.id then now() else null end
  where ride_id = v_ride.id
    and status = 'offered';

  update public.captain_availability
  set is_online = false, updated_at = now()
  where captain_id = p_captain_id;

  insert into public.ride_status_history (ride_id, status, actor_type)
  values (v_ride.id, 'accepted', 'captain');

  return v_ride;
end;
$$;

create or replace function public.apply_captain_road_distance(
  p_ride_id uuid,
  p_pickup_distance_meters integer,
  p_duration_seconds integer,
  p_encoded_polyline text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_pickup_surcharge numeric(10,2);
begin
  if p_pickup_distance_meters not between 1 and 100000
    or p_duration_seconds not between 1 and 43200
    or char_length(p_encoded_polyline) not between 1 and 200000 then
    raise exception 'Invalid Google route';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
    and status = 'accepted'
  for update;

  if not found then raise exception 'Ride is not awaiting captain route'; end if;

  v_pickup_surcharge := private.pickup_surcharge_for_distance(
    v_ride.ride_type,
    p_pickup_distance_meters
  );

  update public.rides
  set pickup_distance_meters = p_pickup_distance_meters,
      pickup_surcharge = v_pickup_surcharge,
      final_fare = estimated_fare + v_pickup_surcharge,
      customer_charge_amount = case when customer_charge_type = 'free' then 0 else estimated_fare + v_pickup_surcharge end,
      fare_approval_status = case when customer_charge_type = 'free' then 'approved' when v_pickup_surcharge > 0 then 'pending' else 'approved' end
  where id = p_ride_id
  returning * into v_ride;

  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (p_ride_id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update
    set distance_meters = excluded.distance_meters,
        duration_seconds = excluded.duration_seconds,
        encoded_polyline = excluded.encoded_polyline,
        created_at = now();

  return v_ride;
end;
$$;

revoke all on function public.accept_ride_offer_with_pickup_route(uuid, uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.accept_ride_offer_with_pickup_route(uuid, uuid, integer, integer, text)
  to service_role;

revoke all on function public.apply_captain_road_distance(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.apply_captain_road_distance(uuid, integer, integer, text)
  to service_role;

-- Client rides must be created only through a verified Google-route quote.
revoke all on function public.request_ride(text, text, text, numeric, numeric, numeric, numeric, smallint)
  from public, anon, authenticated;
grant execute on function public.request_ride(text, text, text, numeric, numeric, numeric, numeric, smallint)
  to service_role;
