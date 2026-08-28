create or replace function public.current_verified_pilot_identity(p_app_variant text default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
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
$$;

create or replace function public.verify_pilot_identity(p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;

create or replace function public.assert_pilot_identity_for_user(p_user_id uuid, p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;
