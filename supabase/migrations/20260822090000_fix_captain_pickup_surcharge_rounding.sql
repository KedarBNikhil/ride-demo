-- Keep pickup distance arithmetic numeric so CEIL rounds a partial 100 m block up.
-- No historical ride data is changed by this migration.
create or replace function public.apply_captain_road_distance(
  p_ride_id uuid,
  p_pickup_distance_meters integer,
  p_duration_seconds integer,
  p_encoded_polyline text
)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_pickup_surcharge numeric(10,2);
begin
  if p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  select * into v_ride from public.rides where id = p_ride_id and status = 'accepted' for update;
  if not found then raise exception 'Ride is not awaiting captain route'; end if;
  v_pickup_surcharge := case
    when v_ride.ride_type = 'auto' then ceil(greatest(0::numeric, p_pickup_distance_meters - 600) / 100) * 1
    else ceil(greatest(0::numeric, p_pickup_distance_meters - 800) / 100) * 2
  end;
  update public.rides set pickup_distance_meters = p_pickup_distance_meters, pickup_surcharge = v_pickup_surcharge,
    final_fare = estimated_fare + v_pickup_surcharge, customer_charge_amount = case when customer_charge_type = 'free' then 0 else estimated_fare + v_pickup_surcharge end,
    fare_approval_status = case when customer_charge_type = 'free' then 'approved' when v_pickup_surcharge > 0 then 'pending' else 'approved' end where id = p_ride_id returning * into v_ride;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline) values (p_ride_id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
    on conflict (ride_id, route_kind) do update set distance_meters = excluded.distance_meters, duration_seconds = excluded.duration_seconds, encoded_polyline = excluded.encoded_polyline, created_at = now();
  return v_ride;
end;
$$;
