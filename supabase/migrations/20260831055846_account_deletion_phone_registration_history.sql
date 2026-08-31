-- Keep a privacy-conscious, server-only record of a phone's first registration
-- after an account is deleted. Ride, compensation, settlement, and dispute
-- records keep their existing profile foreign keys for accounting integrity.
alter table public.profiles
  add column if not exists deleted_at timestamptz;

create table public.phone_registration_history (
  normalized_phone_hash bytea primary key check (octet_length(normalized_phone_hash) = 32),
  first_registered_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now(),
  customer_registered boolean not null default false,
  captain_registered boolean not null default false
);
alter table public.phone_registration_history enable row level security;
revoke all on table public.phone_registration_history from public, anon, authenticated;
grant select, insert, update, delete on table public.phone_registration_history to service_role;

-- This mirrors the app's toIndianE164() behavior so 10-digit and 91-prefixed
-- inputs have one stable server-side representation before hashing.
create or replace function public.normalize_indian_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_digits ~ '^[0-9]{10}$' then return '+91' || v_digits; end if;
  if v_digits ~ '^91[0-9]{10}$' then return '+' || v_digits; end if;
  raise exception 'A valid Indian mobile number is required';
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, case when new.phone is null then null else public.normalize_indian_phone(new.phone) end);
  return new;
end;
$$;

-- A deleted profile must fail every RPC that already uses the normal pilot or
-- production-account guard, including demo-mode authenticated sessions.
create or replace function public.is_production_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.profiles profile where profile.id = auth.uid() and profile.deleted_at is null);
$$;

create or replace function public.require_pilot_user(p_app_variant text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.deleted_at is null
  ) then
    raise exception 'Authentication required';
  end if;
  if not public.production_auth_is_enforced() then return; end if;
  if not public.current_verified_pilot_identity(p_app_variant) then
    raise exception 'A verified, allowlisted pilot account is required';
  end if;
end;
$$;

alter policy "Users can read their own profile" on public.profiles
  using ((select auth.uid()) = id and deleted_at is null);
alter policy "Users can update their own profile" on public.profiles
  using ((select auth.uid()) = id and deleted_at is null)
  with check ((select auth.uid()) = id and deleted_at is null);
alter policy "Captains can read their own profile" on public.captain_profiles
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.profiles profile where profile.id = user_id and profile.deleted_at is null)
  );

create or replace function public.delete_current_account(p_app_variant text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_phone text;
  v_phone_hash bytea;
begin
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select public.normalize_indian_phone(user_record.phone)
    into v_phone
    from auth.users user_record
    where user_record.id = v_user_id
      and user_record.phone_confirmed_at is not null
      and user_record.banned_until is null;
  if v_phone is null then raise exception 'A verified phone session is required'; end if;

  if exists (
    select 1 from public.rides ride
    where (
      (p_app_variant = 'customer' and ride.customer_id = v_user_id)
      or (p_app_variant = 'captain' and ride.captain_id = v_user_id)
    ) and ride.status in ('requested', 'searching', 'accepted', 'arrived', 'in_progress')
  ) then
    raise exception 'Complete or cancel your active ride before deleting this account';
  end if;

  v_phone_hash := extensions.digest(convert_to(v_phone, 'utf8'), 'sha256');
  insert into public.phone_registration_history (
    normalized_phone_hash, first_registered_at, last_registered_at, customer_registered, captain_registered
  ) values (
    v_phone_hash, now(), now(), p_app_variant = 'customer', p_app_variant = 'captain'
  ) on conflict (normalized_phone_hash) do update set
    last_registered_at = excluded.last_registered_at,
    customer_registered = public.phone_registration_history.customer_registered or excluded.customer_registered,
    captain_registered = public.phone_registration_history.captain_registered or excluded.captain_registered;

  update public.captain_availability set is_online = false, updated_at = now() where captain_id = v_user_id;
  update public.pilot_identity_allowlist set auth_user_id = null, updated_at = now() where auth_user_id = v_user_id;
  update public.profiles set phone = null, full_name = null, deleted_at = now() where id = v_user_id and deleted_at is null;

  -- Keep foreign-keyed ride/accounting facts intact, but make the Auth identity
  -- unable to authenticate or retain a reusable phone number/session.
  delete from auth.sessions where user_id = v_user_id;
  update auth.users set phone = null, phone_confirmed_at = null, banned_until = 'infinity', raw_user_meta_data = '{}'::jsonb where id = v_user_id;
end;
$$;

-- Promotion eligibility is determined from the same server-side history, not
-- device state. A re-registered customer may book normally but receives no new
-- allocation under the existing promotion policy.
create or replace function public.create_routed_ride(
  p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text,
  p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric,
  p_passenger_count smallint, p_trip_distance_meters integer, p_trip_duration_seconds integer, p_encoded_polyline text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_base_fare numeric(10,2); v_distance_surcharge numeric(10,2); v_settings public.ride_pricing_settings; v_sequence smallint; v_free boolean := false; v_phone text; v_returning_customer boolean := false;
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
    select candidate.sequence into v_sequence from generate_series(1, v_settings.maximum_free_rides) as candidate(sequence)
      where not exists (select 1 from public.customer_promotion_entitlements entitlement where entitlement.customer_id = p_customer_id and entitlement.policy_code = v_settings.promotion_policy_code and entitlement.sequence = candidate.sequence and entitlement.state in ('reserved', 'completed'))
      order by candidate.sequence limit 1;
    v_free := v_sequence is not null;
  end if;
  v_base_fare := case when p_ride_type = 'bike' then 20 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end;
  v_distance_surcharge := ceil(greatest(0, p_trip_distance_meters - 2000) / 100) * 1;
  insert into public.rides (customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, passenger_count, pricing_rule_version, trip_distance_meters, base_fare, distance_surcharge, pickup_surcharge, estimated_fare, fare_approval_status, pricing_policy_code, free_ride_sequence, pricing_distance_meters, customer_charge_amount, customer_charge_type, customer_charge_status, payment_status, payment_method)
  values (p_customer_id, p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, p_passenger_count, 'google-routes-2026-08-18', p_trip_distance_meters, v_base_fare, v_distance_surcharge, 0, v_base_fare + v_distance_surcharge, case when v_free then 'approved' else 'estimated' end, v_settings.promotion_policy_code, v_sequence, p_trip_distance_meters, case when v_free then 0 else v_base_fare + v_distance_surcharge end, case when v_free then 'free' else 'standard' end, case when v_free then 'not_required' else 'pending' end, case when v_free then 'not_required' else 'pending' end, null)
  returning id into v_ride_id;
  if v_free then insert into public.customer_promotion_entitlements(customer_id, ride_id, policy_code, sequence) values (p_customer_id, v_ride_id, v_settings.promotion_policy_code, v_sequence); end if;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline) values (v_ride_id, 'initial_trip', p_trip_distance_meters, p_trip_duration_seconds, p_encoded_polyline);
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

create or replace function public.customer_promotion_status()
returns table (promotion_enabled boolean, policy_code text, maximum_free_rides smallint, maximum_free_distance_meters integer, completed_free_rides integer, reserved_free_rides integer, remaining_free_rides integer)
language plpgsql security definer set search_path = '' as $$
declare v_settings public.ride_pricing_settings; v_phone text; v_returning_customer boolean := false;
begin
  perform public.require_pilot_user('customer');
  select * into v_settings from public.ride_pricing_settings where singleton;
  select phone into v_phone from public.profiles where id = auth.uid() and deleted_at is null;
  if v_phone is not null then
    select exists (select 1 from public.phone_registration_history history where history.normalized_phone_hash = extensions.digest(convert_to(public.normalize_indian_phone(v_phone), 'utf8'), 'sha256') and history.customer_registered) into v_returning_customer;
  end if;
  return query select v_settings.promotion_enabled and not v_returning_customer, v_settings.promotion_policy_code, v_settings.maximum_free_rides, v_settings.maximum_free_distance_meters,
    count(*) filter (where entitlement.state = 'completed')::integer, count(*) filter (where entitlement.state = 'reserved')::integer,
    case when v_returning_customer then 0 else greatest(0, v_settings.maximum_free_rides - count(*) filter (where entitlement.state in ('completed','reserved')))::integer end
  from public.customer_promotion_entitlements entitlement where entitlement.customer_id = auth.uid() and entitlement.policy_code = v_settings.promotion_policy_code;
end;
$$;

revoke all on function public.normalize_indian_phone(text), public.delete_current_account(text) from public, anon;
grant execute on function public.delete_current_account(text) to authenticated;
