-- A Customer may not receive or retain a free-ride reservation while the same
-- verified phone belongs to a currently approved Captain.  This deliberately
-- uses Auth's confirmed phone, not a display/profile value or client input.
create or replace function private.verified_indian_phone_for_user(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if p_user_id is null then
    return null;
  end if;

  select public.normalize_indian_phone(user_record.phone)
  into v_phone
  from auth.users user_record
  where user_record.id = p_user_id
    and user_record.phone_confirmed_at is not null
    and user_record.banned_until is null;

  return v_phone;
end;
$$;

-- Serializes a promotion allocation/finalization with a Captain activation
-- for this canonical phone.  A null return is intentionally non-promotional:
-- anonymous/demo users have no verified phone to compare.
create or replace function private.lock_verified_phone_identity(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  v_phone := private.verified_indian_phone_for_user(p_user_id);
  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_phone, 917326));
  end if;
  return v_phone;
end;
$$;

-- "Active Captain" is the existing lifecycle's approved onboarding
-- application with its Captain profile and a non-deleted account.  A draft,
-- submitted, rejected, deleted, unverified, or banned identity is not active.
create or replace function private.has_active_captain_for_verified_phone(p_customer_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  v_phone := private.verified_indian_phone_for_user(p_customer_id);
  if v_phone is null then
    return false;
  end if;

  return exists (
    select 1
    from public.captain_profiles captain
    join public.captain_onboarding_applications application
      on application.user_id = captain.user_id
      and application.status = 'approved'
    join public.profiles captain_profile
      on captain_profile.id = captain.user_id
      and captain_profile.deleted_at is null
    join auth.users captain_user
      on captain_user.id = captain.user_id
      and captain_user.phone_confirmed_at is not null
      and captain_user.banned_until is null
    where private.verified_indian_phone_for_user(captain.user_id) = v_phone
  );
end;
$$;

-- Captain approval is the only current transition into the active lifecycle.
-- Take the same per-phone lock as promotion paths, so an activation and a
-- concurrent booking are serialized before a reservation can be written.
create or replace function public.create_captain_profile_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform private.lock_verified_phone_identity(new.user_id);
    insert into public.captain_profiles (user_id, vehicle_type)
    values (new.user_id, new.vehicle_type)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.create_routed_ride(
  p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text,
  p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric,
  p_passenger_count smallint, p_trip_distance_meters integer, p_trip_duration_seconds integer, p_encoded_polyline text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  v_active_captain_phone boolean := false;
begin
  if p_customer_id is null then raise exception 'Customer is required'; end if;
  if p_ride_type not in ('bike','auto') then raise exception 'Invalid ride type'; end if;
  if (p_ride_type = 'bike' and p_passenger_count <> 1) or (p_ride_type = 'auto' and p_passenger_count not between 1 and 3) then raise exception 'Invalid passenger count'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 or p_drop_latitude not between -90 and 90 or p_drop_longitude not between -180 and 180 then raise exception 'Valid pickup and drop locations are required'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280 or char_length(trim(p_drop_address)) not between 1 and 280 then raise exception 'Pickup and destination are required'; end if;
  if p_trip_distance_meters not between 1 and 250000 or p_trip_duration_seconds not between 1 and 86400 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;

  if not exists (select 1 from public.profiles profile where profile.id = p_customer_id and profile.deleted_at is null) then
    raise exception 'An active customer account is required';
  end if;

  v_phone := private.lock_verified_phone_identity(p_customer_id);
  v_active_captain_phone := private.has_active_captain_for_verified_phone(p_customer_id);
  if v_phone is not null then
    select exists (
      select 1 from public.phone_registration_history history
      where history.normalized_phone_hash = extensions.digest(convert_to(v_phone, 'utf8'), 'sha256')
        and history.customer_registered
    ) into v_returning_customer;
  end if;

  if exists (select 1 from public.rides where customer_id = p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  select * into v_settings from public.ride_pricing_settings where singleton for share;
  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));
  if exists (select 1 from public.rides where customer_id = p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;

  if v_settings.promotion_enabled and not v_returning_customer and not v_active_captain_phone and p_trip_distance_meters <= v_settings.maximum_free_distance_meters then
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

-- Release a reservation, rather than deleting it, if the rider becomes
-- ineligible before the authoritative final fare is fixed.  The ride becomes
-- an ordinary paid ride and retains its reservation row for auditability.
create or replace function private.reprice_active_captain_promo_ride(
  p_ride public.rides,
  p_final_fare numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ride.customer_charge_type <> 'free' then
    return false;
  end if;

  perform private.lock_verified_phone_identity(p_ride.customer_id);
  if not private.has_active_captain_for_verified_phone(p_ride.customer_id) then
    return false;
  end if;

  update public.customer_promotion_entitlements
  set state = 'released', released_at = now()
  where ride_id = p_ride.id and state = 'reserved';

  update public.rides
  set customer_charge_amount = p_final_fare,
      customer_charge_type = 'standard',
      customer_charge_status = 'pending',
      payment_status = 'pending',
      payment_method = null,
      fare_approval_status = case when coalesce(p_ride.pickup_surcharge, 0) > 0 then 'pending' else 'approved' end,
      updated_at = now()
  where id = p_ride.id;

  return true;
end;
$$;

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
  v_pickup_surcharge numeric(10,2);
  v_final_fare numeric(10,0);
begin
  if p_captain_id is null then raise exception 'Captain is required'; end if;
  if p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> p_captain_id or v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'Offer is no longer available'; end if;
  select * into v_ride from public.rides where id = v_offer.ride_id and status = 'searching' and captain_id is null for update;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;

  v_pickup_surcharge := private.pickup_surcharge_for_distance(v_ride.ride_type, p_pickup_distance_meters);
  v_final_fare := private.round_fare_half_down(v_ride.estimated_fare + v_pickup_surcharge);
  update public.rides
  set captain_id = p_captain_id, status = 'accepted', accepted_at = now(), pickup_distance_meters = p_pickup_distance_meters,
      pickup_surcharge = v_pickup_surcharge, final_fare = v_final_fare, updated_at = now()
  where id = v_ride.id
  returning * into v_ride;

  perform private.reprice_active_captain_promo_ride(v_ride, v_final_fare);
  select * into v_ride from public.rides where id = v_ride.id;
  if v_ride.customer_charge_type <> 'free' then
    update public.rides
    set customer_charge_amount = v_final_fare,
        fare_approval_status = case when v_pickup_surcharge > 0 then 'pending' else 'approved' end,
        updated_at = now()
    where id = v_ride.id
    returning * into v_ride;
  else
    update public.rides
    set customer_charge_amount = 0, fare_approval_status = 'approved', updated_at = now()
    where id = v_ride.id
    returning * into v_ride;
  end if;

  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (v_ride.id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
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
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_pickup_surcharge numeric(10,2);
  v_final_fare numeric(10,0);
begin
  if p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  select * into v_ride from public.rides where id = p_ride_id and status = 'accepted' for update;
  if not found then raise exception 'Ride is not awaiting captain route'; end if;

  v_pickup_surcharge := private.pickup_surcharge_for_distance(v_ride.ride_type, p_pickup_distance_meters);
  v_final_fare := private.round_fare_half_down(v_ride.estimated_fare + v_pickup_surcharge);
  update public.rides
  set pickup_distance_meters = p_pickup_distance_meters, pickup_surcharge = v_pickup_surcharge, final_fare = v_final_fare, updated_at = now()
  where id = p_ride_id
  returning * into v_ride;

  perform private.reprice_active_captain_promo_ride(v_ride, v_final_fare);
  select * into v_ride from public.rides where id = v_ride.id;
  update public.rides
  set customer_charge_amount = case when v_ride.customer_charge_type = 'free' then 0 else v_final_fare end,
      fare_approval_status = case when v_ride.customer_charge_type = 'free' then 'approved' when v_pickup_surcharge > 0 then 'pending' else 'approved' end,
      updated_at = now()
  where id = v_ride.id
  returning * into v_ride;

  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (p_ride_id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update set distance_meters = excluded.distance_meters, duration_seconds = excluded.duration_seconds, encoded_polyline = excluded.encoded_polyline, created_at = now();
  return v_ride;
end;
$$;

create or replace function public.customer_promotion_status()
returns table (
  promotion_enabled boolean, policy_code text, maximum_free_rides smallint,
  maximum_free_distance_meters integer, completed_free_rides integer,
  reserved_free_rides integer, remaining_free_rides integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.ride_pricing_settings;
  v_phone text;
  v_returning_customer boolean := false;
  v_active_captain_phone boolean := false;
begin
  perform public.require_pilot_user('customer');
  select * into v_settings from public.ride_pricing_settings where singleton;
  v_phone := private.lock_verified_phone_identity(auth.uid());
  v_active_captain_phone := private.has_active_captain_for_verified_phone(auth.uid());
  if v_phone is not null then
    select exists (
      select 1 from public.phone_registration_history history
      where history.normalized_phone_hash = extensions.digest(convert_to(v_phone, 'utf8'), 'sha256')
        and history.customer_registered
    ) into v_returning_customer;
  end if;

  return query
  select v_settings.promotion_enabled and not v_returning_customer and not v_active_captain_phone,
    v_settings.promotion_policy_code, v_settings.maximum_free_rides, v_settings.maximum_free_distance_meters,
    count(*) filter (where entitlement.state = 'completed')::integer,
    count(*) filter (where entitlement.state = 'reserved')::integer,
    case when v_returning_customer or v_active_captain_phone then 0
      else greatest(0, v_settings.maximum_free_rides - count(*) filter (where entitlement.state in ('completed','reserved')))
    end::integer
  from public.customer_promotion_entitlements entitlement
  where entitlement.customer_id = auth.uid()
    and entitlement.policy_code = v_settings.promotion_policy_code;
end;
$$;

revoke all on function private.verified_indian_phone_for_user(uuid), private.lock_verified_phone_identity(uuid), private.has_active_captain_for_verified_phone(uuid), private.reprice_active_captain_promo_ride(public.rides, numeric) from public;
revoke all on function public.create_captain_profile_on_approval(), public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text), public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text), public.apply_captain_road_distance(uuid,integer,integer,text), public.customer_promotion_status() from public, anon;
revoke all on function public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text), public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text), public.apply_captain_road_distance(uuid,integer,integer,text) from authenticated;
grant execute on function public.customer_promotion_status() to authenticated;
grant execute on function public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text), public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text), public.apply_captain_road_distance(uuid,integer,integer,text) to service_role;
