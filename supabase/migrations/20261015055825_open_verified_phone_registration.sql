-- Production migration applied as version 20261015055825.
-- Replace the phone allowlist with private per-app enrollment records.
-- OTP confirmation remains mandatory. Captain onboarding and approval remain
-- governed by the existing captain application/document workflow.
create table public.user_app_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  app_variant text not null check (app_variant in ('customer', 'captain')),
  registered_at timestamptz not null default now(),
  primary key (user_id, app_variant)
);
alter table public.user_app_roles enable row level security;
revoke all on table public.user_app_roles from public, anon, authenticated;
grant select, insert, delete on table public.user_app_roles to service_role;

insert into public.user_app_roles (user_id, app_variant)
select auth_user_id, app_variant from public.pilot_identity_allowlist
where auth_user_id is not null and enabled and disabled_at is null
on conflict (user_id, app_variant) do nothing;

create or replace function public.current_verified_pilot_identity(p_app_variant text default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return false; end if;
  if p_app_variant is not null and p_app_variant not in ('customer', 'captain') then return false; end if;
  return exists (
    select 1 from auth.users account
    join public.profiles profile on profile.id = account.id and profile.deleted_at is null
    join public.user_app_roles registered_app on registered_app.user_id = account.id
    where account.id = auth.uid() and account.phone_confirmed_at is not null and account.banned_until is null
      and (p_app_variant is null or registered_app.app_variant = p_app_variant)
  );
end;
$$;

create or replace function public.require_pilot_user(p_app_variant text default null)
returns void language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.deleted_at is null
  ) then raise exception 'Authentication required'; end if;
  if not public.production_auth_is_enforced() then return; end if;
  if not public.current_verified_pilot_identity(p_app_variant) then
    raise exception 'A verified account registered for this app is required';
  end if;
end;
$$;

create or replace function public.verify_pilot_identity(p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  if not public.production_auth_is_enforced() then raise exception 'Production authentication is not enabled'; end if;
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A verified phone session is required';
  end if;
  if not exists (
    select 1 from auth.users account
    join public.profiles profile on profile.id = account.id and profile.deleted_at is null
    where account.id = auth.uid() and account.phone_confirmed_at is not null and account.banned_until is null
  ) then raise exception 'A verified phone session is required'; end if;
  insert into public.user_app_roles (user_id, app_variant) values (auth.uid(), p_app_variant)
  on conflict (user_id, app_variant) do nothing;
end;
$$;

create or replace function public.assert_pilot_identity_for_user(p_user_id uuid, p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.production_auth_is_enforced() then return; end if;
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  if not exists (
    select 1 from auth.users account
    join public.profiles profile on profile.id = account.id and profile.deleted_at is null
    join public.user_app_roles registered_app on registered_app.user_id = account.id and registered_app.app_variant = p_app_variant
    where account.id = p_user_id and account.phone_confirmed_at is not null and account.banned_until is null
  ) then raise exception 'A verified account registered for this app is required'; end if;
end;
$$;

create or replace function public.customer_login_account_exists(p_phone text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles profile
    join auth.users account on account.id = profile.id
    join public.user_app_roles registered_app on registered_app.user_id = profile.id and registered_app.app_variant = 'customer'
    where profile.phone = public.normalize_indian_phone(p_phone)
      and profile.deleted_at is null and account.phone_confirmed_at is not null and account.banned_until is null
  );
$$;

-- Preserve the existing deletion, registration-history, availability, and
-- session-revocation behavior while also removing the user's app enrollments.
create or replace function public.delete_current_account(p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_phone text; v_phone_hash bytea;
begin
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select public.normalize_indian_phone(u.phone) into v_phone from auth.users u
    where u.id = v_user_id and u.phone_confirmed_at is not null and u.banned_until is null;
  if v_phone is null then raise exception 'A verified phone session is required'; end if;
  if exists (select 1 from public.rides r where
    ((p_app_variant = 'customer' and r.customer_id = v_user_id) or (p_app_variant = 'captain' and r.captain_id = v_user_id))
    and r.status in ('requested', 'searching', 'accepted', 'arrived', 'in_progress')) then
    raise exception 'Complete or cancel your active ride before deleting this account';
  end if;
  v_phone_hash := extensions.digest(convert_to(v_phone, 'utf8'), 'sha256');
  insert into public.phone_registration_history (normalized_phone_hash, first_registered_at, last_registered_at, customer_registered, captain_registered)
  values (v_phone_hash, now(), now(), p_app_variant = 'customer', p_app_variant = 'captain')
  on conflict (normalized_phone_hash) do update set last_registered_at = excluded.last_registered_at,
    customer_registered = public.phone_registration_history.customer_registered or excluded.customer_registered,
    captain_registered = public.phone_registration_history.captain_registered or excluded.captain_registered;
  update public.captain_availability set is_online = false, updated_at = now() where captain_id = v_user_id;
  delete from public.user_app_roles where user_id = v_user_id;
  update public.pilot_identity_allowlist set auth_user_id = null, updated_at = now() where auth_user_id = v_user_id;
  update public.profiles set phone = null, full_name = null, deleted_at = now() where id = v_user_id and deleted_at is null;
  delete from auth.sessions where user_id = v_user_id;
  update auth.users set phone = null, phone_confirmed_at = null, banned_until = 'infinity', raw_user_meta_data = '{}'::jsonb where id = v_user_id;
end;
$$;

revoke all on function public.current_verified_pilot_identity(text) from public, anon;
revoke all on function public.verify_pilot_identity(text) from public, anon;
revoke all on function public.assert_pilot_identity_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.customer_login_account_exists(text) from public;
grant execute on function public.current_verified_pilot_identity(text), public.verify_pilot_identity(text) to authenticated;
grant execute on function public.assert_pilot_identity_for_user(uuid,text) to service_role;
grant execute on function public.customer_login_account_exists(text) to anon, authenticated;
