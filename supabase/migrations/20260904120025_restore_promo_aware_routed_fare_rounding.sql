-- Restore the promotion reservation/snapshot that the fare-rounding migration
-- must preserve. Only the summed normal fare is rounded.
create or replace function public.create_routed_ride(
  p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text,
  p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric,
  p_passenger_count smallint, p_trip_distance_meters integer, p_trip_duration_seconds integer, p_encoded_polyline text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ride_id uuid;
  v_base_fare numeric(10,2);
  v_distance_surcharge numeric(10,2);
  v_normal_fare numeric(10,0);
  v_settings public.ride_pricing_settings;
  v_sequence smallint;
  v_free boolean := false;
  v_phone text;
  v_returning_customer boolean := false;
begin
  if p_customer_id is null then raise exception 'Customer is required'; end if;
  if p_ride_type not in ('bike','auto') then raise exception 'Invalid ride type'; end if;
  if (p_ride_type = 'bike' and p_passenger_count <> 1) or (p_ride_type = 'auto' and p_passenger_count not between 1 and 3) then raise exception 'Invalid passenger count'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 or p_drop_latitude not between -90 and 90 or p_drop_longitude not between -180 and 180 then raise exception 'Valid pickup and drop locations are required'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280 or char_length(trim(p_drop_address)) not between 1 and 280 then raise exception 'Pickup and destination are required'; end if;
  if p_trip_distance_meters not between 1 and 250000 or p_trip_duration_seconds not between 1 and 86400 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;

  select profile.phone into v_phone from public.profiles profile where profile.id = p_customer_id and profile.deleted_at is null;
  if not found then raise exception 'An active customer account is required'; end if;
  if v_phone is not null then
    select exists (
      select 1 from public.phone_registration_history history
      where history.normalized_phone_hash = extensions.digest(convert_to(public.normalize_indian_phone(v_phone), 'utf8'), 'sha256')
        and history.customer_registered
    ) into v_returning_customer;
  end if;

  if exists (select 1 from public.rides where customer_id = p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  select * into v_settings from public.ride_pricing_settings where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));
  if exists (select 1 from public.rides where customer_id = p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;

  if v_settings.promotion_enabled and not v_returning_customer and p_trip_distance_meters <= v_settings.maximum_free_distance_meters then
    select candidate.sequence into v_sequence
    from generate_series(1, v_settings.maximum_free_rides) as candidate(sequence)
    where not exists (
      select 1 from public.customer_promotion_entitlements entitlement
      where entitlement.customer_id = p_customer_id
        and entitlement.policy_code = v_settings.promotion_policy_code
        and entitlement.sequence = candidate.sequence
        and entitlement.state in ('reserved', 'completed')
    )
    order by candidate.sequence
    limit 1;
    v_free := v_sequence is not null;
  end if;

  v_base_fare := case when p_ride_type = 'bike' then 20 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end;
  v_distance_surcharge := ceil(greatest(0, p_trip_distance_meters - 2000) / 100) * 1;
  v_normal_fare := private.round_fare_half_down(v_base_fare + v_distance_surcharge);

  insert into public.rides (
    customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude,
    passenger_count, pricing_rule_version, trip_distance_meters, base_fare, distance_surcharge, pickup_surcharge, estimated_fare,
    fare_approval_status, pricing_policy_code, free_ride_sequence, pricing_distance_meters, customer_charge_amount,
    customer_charge_type, customer_charge_status, payment_status, payment_method
  ) values (
    p_customer_id, p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude,
    p_drop_latitude, p_drop_longitude, p_passenger_count, 'google-routes-2026-08-18', p_trip_distance_meters,
    v_base_fare, v_distance_surcharge, 0, v_normal_fare, case when v_free then 'approved' else 'estimated' end,
    v_settings.promotion_policy_code, v_sequence, p_trip_distance_meters, case when v_free then 0 else v_normal_fare end,
    case when v_free then 'free' else 'standard' end, case when v_free then 'not_required' else 'pending' end,
    case when v_free then 'not_required' else 'pending' end, null
  ) returning id into v_ride_id;

  if v_free then
    insert into public.customer_promotion_entitlements(customer_id, ride_id, policy_code, sequence)
    values (p_customer_id, v_ride_id, v_settings.promotion_policy_code, v_sequence);
  end if;

  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (v_ride_id, 'initial_trip', p_trip_distance_meters, p_trip_duration_seconds, p_encoded_polyline);
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

revoke all on function public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text)
  to service_role;
