-- Return only whether an active, production Customer account exists for a
-- normalized phone number. Captain-only profiles do not qualify because the
-- Customer pilot identity must also be bound to the same Auth user.
create or replace function public.customer_login_account_exists(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    join public.pilot_identity_allowlist customer_identity
      on customer_identity.auth_user_id = profile.id
     and customer_identity.app_variant = 'customer'
     and customer_identity.enabled
     and customer_identity.disabled_at is null
    where profile.phone = public.normalize_indian_phone(p_phone)
      and profile.deleted_at is null
      and account.phone_confirmed_at is not null
      and account.banned_until is null
  );
$$;

revoke all on function public.customer_login_account_exists(text) from public;
grant execute on function public.customer_login_account_exists(text) to anon, authenticated;
