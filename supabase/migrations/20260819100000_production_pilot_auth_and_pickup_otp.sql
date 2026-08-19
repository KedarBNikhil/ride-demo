-- Production is deliberately opt-in so local anonymous sessions and demo OTP
-- 1234 remain available until an operator activates the invite-only pilot.
create table public.production_auth_settings (
  singleton boolean primary key default true check (singleton),
  pilot_auth_enforced boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.production_auth_settings (singleton) values (true)
on conflict (singleton) do nothing;
alter table public.production_auth_settings enable row level security;
revoke all on table public.production_auth_settings from public, anon, authenticated;

-- Operators seed an E.164 number and app variant before inviting a pilot. The
-- first successful verified login atomically binds it to that Auth user.
create table public.pilot_identity_allowlist (
  id uuid primary key default gen_random_uuid(),
  app_variant text not null check (app_variant in ('customer', 'captain')),
  phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  auth_user_id uuid references auth.users(id) on delete restrict,
  enabled boolean not null default true,
  approved_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_variant, phone_e164),
  unique (app_variant, auth_user_id),
  check ((enabled and disabled_at is null) or ((not enabled) and disabled_at is not null))
);
alter table public.pilot_identity_allowlist enable row level security;
revoke all on table public.pilot_identity_allowlist from public, anon, authenticated;

create or replace function public.production_auth_is_enforced()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select pilot_auth_enforced from public.production_auth_settings where singleton), false);
$$;

create or replace function public.current_verified_pilot_identity(p_app_variant text default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_phone text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return false; end if;
  select phone into v_phone from auth.users where id = auth.uid() and phone_confirmed_at is not null and banned_until is null;
  return v_phone is not null and exists (
    select 1 from public.pilot_identity_allowlist identity
    where identity.enabled and identity.disabled_at is null and identity.phone_e164 = v_phone
      and identity.auth_user_id = auth.uid()
      and (p_app_variant is null or identity.app_variant = p_app_variant)
  );
end;
$$;

-- Policy callers need a boolean. In demo mode an anonymous Auth identity is
-- accepted exactly as before; production mode requires a bound pilot entry.
create or replace function public.is_production_user()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.production_auth_is_enforced() then return auth.uid() is not null; end if;
  return public.current_verified_pilot_identity();
end;
$$;

create or replace function public.require_production_user(p_app_variant text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.production_auth_is_enforced() then
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    return;
  end if;
  if not public.current_verified_pilot_identity(p_app_variant) then raise exception 'A verified, allowlisted pilot account is required'; end if;
end;
$$;

-- Called immediately after real phone OTP verification. It makes a disabled
-- server boundary fail closed instead of allowing a production build to run in
-- accidental demo mode, then binds a pre-approved number to this Auth user.
create or replace function public.verify_pilot_identity(p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_identity public.pilot_identity_allowlist;
begin
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  if not public.production_auth_is_enforced() then raise exception 'Production authentication is not enabled'; end if;
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'A verified phone session is required'; end if;
  select phone into v_phone from auth.users where id = auth.uid() and phone_confirmed_at is not null and banned_until is null;
  if v_phone is null then raise exception 'A verified phone session is required'; end if;
  select * into v_identity from public.pilot_identity_allowlist
    where app_variant = p_app_variant and phone_e164 = v_phone and enabled and disabled_at is null for update;
  if not found then raise exception 'This phone number is not approved for the pilot'; end if;
  if v_identity.auth_user_id is not null and v_identity.auth_user_id <> auth.uid() then raise exception 'This pilot identity is already bound to another account'; end if;
  update public.pilot_identity_allowlist set auth_user_id = auth.uid(), updated_at = now() where id = v_identity.id;
end;
$$;

-- Edge Functions authenticate the JWT themselves and then use this
-- service-role-only check before performing privileged route operations.
create or replace function public.assert_pilot_identity_for_user(p_user_id uuid, p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text;
begin
  if not public.production_auth_is_enforced() then return; end if;
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  select phone into v_phone from auth.users where id = p_user_id and phone_confirmed_at is not null and banned_until is null;
  if v_phone is null or not exists (
    select 1 from public.pilot_identity_allowlist identity
    where identity.app_variant = p_app_variant and identity.phone_e164 = v_phone
      and identity.auth_user_id = p_user_id and identity.enabled and identity.disabled_at is null
  ) then raise exception 'A verified, allowlisted pilot account is required'; end if;
end;
$$;

-- The reusable plaintext profile PIN is intentionally removed. Only the
-- per-ride salt and digest below are persisted; the customer receives the
-- plaintext only in the RPC response that creates it.
alter table public.profiles drop column if exists customer_pickup_otp;
alter table public.rides
  add column pickup_otp_salt bytea,
  add column pickup_otp_digest bytea,
  add column pickup_otp_issued_at timestamptz,
  add column pickup_otp_expires_at timestamptz,
  add column pickup_otp_attempt_count smallint not null default 0 check (pickup_otp_attempt_count between 0 and 5),
  add column pickup_otp_verified_at timestamptz,
  add constraint rides_pickup_otp_material_is_complete check (
    (pickup_otp_salt is null and pickup_otp_digest is null and pickup_otp_issued_at is null and pickup_otp_expires_at is null)
    or (pickup_otp_salt is not null and pickup_otp_digest is not null and pickup_otp_issued_at is not null and pickup_otp_expires_at is not null and pickup_otp_expires_at > pickup_otp_issued_at)
  );

create or replace function public.issue_customer_pickup_otp(p_ride_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_bytes bytea; v_otp text; v_salt bytea; v_value bigint;
begin
  perform public.require_production_user('customer');
  select * into v_ride from public.rides where id = p_ride_id and customer_id = auth.uid()
    and status in ('accepted', 'arrived') and fare_approval_status = 'approved' for update;
  if not found then raise exception 'Pickup OTP is not available for this ride'; end if;
  if not public.production_auth_is_enforced() then return '1234'; end if;
  if v_ride.pickup_otp_issued_at > now() - interval '60 seconds' then raise exception 'Please wait before generating another pickup OTP'; end if;
  v_bytes := gen_random_bytes(4);
  v_value := ((get_byte(v_bytes, 0)::bigint << 24) + (get_byte(v_bytes, 1)::bigint << 16) + (get_byte(v_bytes, 2)::bigint << 8) + get_byte(v_bytes, 3)::bigint) % 1000000;
  v_otp := lpad(v_value::text, 6, '0');
  v_salt := gen_random_bytes(16);
  update public.rides set pickup_otp_salt = v_salt, pickup_otp_digest = digest(v_salt || convert_to(v_otp, 'utf8'), 'sha256'),
    pickup_otp_issued_at = now(), pickup_otp_expires_at = now() + interval '30 minutes', pickup_otp_attempt_count = 0, pickup_otp_verified_at = null
  where id = v_ride.id;
  return v_otp;
end;
$$;

create or replace function public.captain_start_ride(p_ride_id uuid, p_pickup_otp text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_production_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() and status = 'arrived' for update;
  if not found then raise exception 'Pickup OTP could not be verified'; end if;
  if not public.production_auth_is_enforced() then
    if p_pickup_otp <> '1234' then raise exception 'Pickup OTP could not be verified'; end if;
    update public.rides set status = 'in_progress', started_at = now() where id = v_ride.id returning * into v_ride;
    insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, 'in_progress', 'captain');
    return v_ride;
  end if;
  if p_pickup_otp !~ '^[0-9]{6}$' or v_ride.pickup_otp_digest is null or v_ride.pickup_otp_expires_at <= now() or v_ride.pickup_otp_attempt_count >= 5 then raise exception 'Pickup OTP could not be verified'; end if;
  if v_ride.pickup_otp_digest <> digest(v_ride.pickup_otp_salt || convert_to(p_pickup_otp, 'utf8'), 'sha256') then
    update public.rides set pickup_otp_attempt_count = pickup_otp_attempt_count + 1 where id = v_ride.id;
    raise exception 'Pickup OTP could not be verified';
  end if;
  update public.rides set status = 'in_progress', started_at = now(), pickup_otp_verified_at = now(), pickup_otp_salt = null, pickup_otp_digest = null,
    pickup_otp_issued_at = null, pickup_otp_expires_at = null where id = v_ride.id returning * into v_ride;
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, 'in_progress', 'captain');
  return v_ride;
end;
$$;

-- Keep already-installed demo clients functional through the app rollout. It
-- never exposes stored material: in demo it returns 1234; in production it
-- delegates to the new issuance boundary and is subject to the same cooldown.
create or replace function public.customer_pickup_pin(p_ride_id uuid)
returns text language sql security definer set search_path = '' as $$
  select public.issue_customer_pickup_otp(p_ride_id);
$$;

revoke all on function public.customer_pickup_pin(uuid) from public, anon;
revoke all on function public.production_auth_is_enforced() from public, anon, authenticated;
revoke all on function public.current_verified_pilot_identity(text) from public, anon;
revoke all on function public.is_production_user() from public, anon;
revoke all on function public.require_production_user() from public, anon;
revoke all on function public.require_production_user(text) from public, anon;
revoke all on function public.issue_customer_pickup_otp(uuid) from public, anon;
revoke all on function public.verify_pilot_identity(text) from public, anon;
revoke all on function public.assert_pilot_identity_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.current_verified_pilot_identity(text), public.is_production_user(), public.require_production_user(), public.require_production_user(text), public.customer_pickup_pin(uuid), public.issue_customer_pickup_otp(uuid), public.verify_pilot_identity(text) to authenticated;
grant execute on function public.assert_pilot_identity_for_user(uuid,text) to service_role;
