-- Final fares are whole rupees, with an exact .50-down rule.
create or replace function private.round_fare_half_down(p_value numeric)
returns numeric(10,0)
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if p_value < 0 then
    raise exception 'Fare must be non-negative';
  end if;
  return case
    when p_value - trunc(p_value) > 0.5 then ceil(p_value)
    else floor(p_value)
  end;
end;
$$;

revoke all on function private.round_fare_half_down(numeric) from public;

-- Route distance, base fare, and all applicable initial fare components are
-- summed before the final whole-rupee rounding is applied.
create or replace function public.create_routed_ride(
  p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text,
  p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric,
  p_passenger_count smallint, p_trip_distance_meters integer, p_trip_duration_seconds integer, p_encoded_polyline text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_base_fare numeric(10,2); v_distance_surcharge numeric(10,2);
begin
  if p_customer_id is null then raise exception 'Customer is required'; end if;
  if p_ride_type not in ('bike','auto') then raise exception 'Invalid ride type'; end if;
  if (p_ride_type = 'bike' and p_passenger_count <> 1) or (p_ride_type = 'auto' and p_passenger_count not between 1 and 3) then raise exception 'Invalid passenger count'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 or p_drop_latitude not between -90 and 90 or p_drop_longitude not between -180 and 180 then raise exception 'Valid pickup and drop locations are required'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280 or char_length(trim(p_drop_address)) not between 1 and 280 then raise exception 'Pickup and destination are required'; end if;
  if p_trip_distance_meters not between 1 and 250000 or p_trip_duration_seconds not between 1 and 86400 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  if exists (select 1 from public.rides where customer_id=p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  v_base_fare := case when p_ride_type = 'bike' then 20 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end;
  v_distance_surcharge := ceil(greatest(0, p_trip_distance_meters - 2000) / 100) * 1;
  insert into public.rides (customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, passenger_count, pricing_rule_version, trip_distance_meters, base_fare, distance_surcharge, pickup_surcharge, estimated_fare, fare_approval_status)
  values (p_customer_id, p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, p_passenger_count, 'google-routes-2026-08-18', p_trip_distance_meters, v_base_fare, v_distance_surcharge, 0, private.round_fare_half_down(v_base_fare + v_distance_surcharge), 'estimated')
  returning id into v_ride_id;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (v_ride_id, 'initial_trip', p_trip_distance_meters, p_trip_duration_seconds, p_encoded_polyline);
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

-- Finalization uses the same post-component rounding for both customer and
-- captain-visible authoritative amounts.
create or replace function public.accept_ride_offer_with_pickup_route(
  p_offer_id uuid, p_captain_id uuid, p_pickup_distance_meters integer,
  p_duration_seconds integer, p_encoded_polyline text
)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_offer public.ride_offers; v_ride public.rides; v_pickup_surcharge numeric(10,2);
begin
  if p_captain_id is null then raise exception 'Captain is required'; end if;
  if p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> p_captain_id or v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'Offer is no longer available'; end if;
  select * into v_ride from public.rides where id = v_offer.ride_id and status = 'searching' and captain_id is null for update;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;
  v_pickup_surcharge := private.pickup_surcharge_for_distance(v_ride.ride_type, p_pickup_distance_meters);
  update public.rides set captain_id = p_captain_id, status = 'accepted', accepted_at = now(), pickup_distance_meters = p_pickup_distance_meters, pickup_surcharge = v_pickup_surcharge,
    final_fare = private.round_fare_half_down(estimated_fare + v_pickup_surcharge),
    customer_charge_amount = case when customer_charge_type = 'free' then 0 else private.round_fare_half_down(estimated_fare + v_pickup_surcharge) end,
    fare_approval_status = case when customer_charge_type = 'free' then 'approved' when v_pickup_surcharge > 0 then 'pending' else 'approved' end, updated_at = now()
  where id = v_ride.id returning * into v_ride;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline) values (v_ride.id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update set distance_meters = excluded.distance_meters, duration_seconds = excluded.duration_seconds, encoded_polyline = excluded.encoded_polyline, created_at = now();
  update public.ride_offers set status = case when id = v_offer.id then 'accepted' else 'cancelled' end, responded_at = case when id = v_offer.id then now() else null end where ride_id = v_ride.id and status = 'offered';
  update public.captain_availability set is_online = false, updated_at = now() where captain_id = p_captain_id;
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, 'accepted', 'captain');
  return v_ride;
end;
$$;

create or replace function public.apply_captain_road_distance(
  p_ride_id uuid, p_pickup_distance_meters integer, p_duration_seconds integer, p_encoded_polyline text
)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_pickup_surcharge numeric(10,2);
begin
  if p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  select * into v_ride from public.rides where id = p_ride_id and status = 'accepted' for update;
  if not found then raise exception 'Ride is not awaiting captain route'; end if;
  v_pickup_surcharge := private.pickup_surcharge_for_distance(v_ride.ride_type, p_pickup_distance_meters);
  update public.rides set pickup_distance_meters = p_pickup_distance_meters, pickup_surcharge = v_pickup_surcharge,
    final_fare = private.round_fare_half_down(estimated_fare + v_pickup_surcharge),
    customer_charge_amount = case when customer_charge_type = 'free' then 0 else private.round_fare_half_down(estimated_fare + v_pickup_surcharge) end,
    fare_approval_status = case when customer_charge_type = 'free' then 'approved' when v_pickup_surcharge > 0 then 'pending' else 'approved' end
  where id = p_ride_id returning * into v_ride;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline) values (p_ride_id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update set distance_meters = excluded.distance_meters, duration_seconds = excluded.duration_seconds, encoded_polyline = excluded.encoded_polyline, created_at = now();
  return v_ride;
end;
$$;

-- Preserve the existing service-only execution boundary.
revoke all on function public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text) from public, anon, authenticated;
grant execute on function public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text) to service_role;
revoke all on function public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text) to service_role;
revoke all on function public.apply_captain_road_distance(uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.apply_captain_road_distance(uuid,integer,integer,text) to service_role;
