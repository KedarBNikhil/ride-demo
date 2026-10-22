# Production auth definition backup (read only)

Project: `wgvzmgyyoboyxdusoent` (`ride-demo`), queried 2026-10-15.

These are the definitions read from the live production database before the
proposed migration. The original migration sources are also retained in
`supabase/migrations/20260819100000_production_pilot_auth_and_pickup_otp.sql`,
`20260828142021_normalize_pilot_auth_phone_comparisons.sql`,
`20260831055846_account_deletion_phone_registration_history.sql`, and
`20260904103216_customer_login_account_lookup.sql`.

## Live control state

`production_auth_settings.pilot_auth_enforced = true`.

`pilot_identity_allowlist` and `production_auth_settings` both have RLS enabled,
no policies, and no SELECT privilege for `anon` or `authenticated`.

## `public.verify_pilot_identity(text)`

```sql
CREATE OR REPLACE FUNCTION public.verify_pilot_identity(p_app_variant text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_phone text; v_identity public.pilot_identity_allowlist;
begin
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  if not public.production_auth_is_enforced() then raise exception 'Production authentication is not enabled'; end if;
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'A verified phone session is required'; end if;
  select '+' || regexp_replace(phone, '[^0-9]', '', 'g') into v_phone
    from auth.users where id = auth.uid() and phone_confirmed_at is not null and banned_until is null;
  if v_phone is null then raise exception 'A verified phone session is required'; end if;
  select * into v_identity from public.pilot_identity_allowlist
    where app_variant = p_app_variant and phone_e164 = v_phone and enabled and disabled_at is null for update;
  if not found then raise exception 'This phone number is not approved for the pilot'; end if;
  if v_identity.auth_user_id is not null and v_identity.auth_user_id <> auth.uid() then raise exception 'This pilot identity is already bound to another account'; end if;
  update public.pilot_identity_allowlist set auth_user_id = auth.uid(), updated_at = now() where id = v_identity.id;
end;
$function$;
```

## `public.current_verified_pilot_identity(text)`

```sql
CREATE OR REPLACE FUNCTION public.current_verified_pilot_identity(p_app_variant text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_phone text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return false; end if;
  select '+' || regexp_replace(phone, '[^0-9]', '', 'g') into v_phone
    from auth.users where id = auth.uid() and phone_confirmed_at is not null and banned_until is null;
  return v_phone is not null and exists (
    select 1 from public.pilot_identity_allowlist identity
    where identity.enabled and identity.disabled_at is null and identity.phone_e164 = v_phone
      and identity.auth_user_id = auth.uid()
      and (p_app_variant is null or identity.app_variant = p_app_variant)
  );
end;
$function$;
```

## `public.require_pilot_user(text)`

```sql
CREATE OR REPLACE FUNCTION public.require_pilot_user(p_app_variant text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.deleted_at is null
  ) then raise exception 'Authentication required'; end if;
  if not public.production_auth_is_enforced() then return; end if;
  if not public.current_verified_pilot_identity(p_app_variant) then
    raise exception 'A verified, allowlisted pilot account is required';
  end if;
end;
$function$;
```

## `public.assert_pilot_identity_for_user(uuid,text)`

```sql
CREATE OR REPLACE FUNCTION public.assert_pilot_identity_for_user(p_user_id uuid, p_app_variant text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_phone text;
begin
  if not public.production_auth_is_enforced() then return; end if;
  if p_app_variant not in ('customer', 'captain') then raise exception 'Invalid app variant'; end if;
  select '+' || regexp_replace(phone, '[^0-9]', '', 'g') into v_phone
    from auth.users where id = p_user_id and phone_confirmed_at is not null and banned_until is null;
  if v_phone is null or not exists (
    select 1 from public.pilot_identity_allowlist identity
    where identity.app_variant = p_app_variant and identity.phone_e164 = v_phone
      and identity.auth_user_id = p_user_id and identity.enabled and identity.disabled_at is null
  ) then raise exception 'A verified, allowlisted pilot account is required'; end if;
end;
$function$;
```

## `public.customer_login_account_exists(text)`

```sql
CREATE OR REPLACE FUNCTION public.customer_login_account_exists(p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles profile
    join auth.users account on account.id = profile.id
    join public.pilot_identity_allowlist customer_identity
      on customer_identity.auth_user_id = profile.id
     and customer_identity.app_variant = 'customer'
     and customer_identity.enabled and customer_identity.disabled_at is null
    where profile.phone = public.normalize_indian_phone(p_phone)
      and profile.deleted_at is null and account.phone_confirmed_at is not null and account.banned_until is null
  );
$function$;
```

The production `delete_current_account(text)` definition is preserved in the
referenced account-deletion migration. The proposed migration changes only its
identity cleanup to additionally delete rows from the new enrollment table;
it retains its ride checks, phone-history write, Captain offline transition,
profile redaction, and Auth session revocation.
