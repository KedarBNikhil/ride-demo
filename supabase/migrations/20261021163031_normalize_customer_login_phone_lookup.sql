-- Recognize active Customer accounts whose legacy profile phone values are
-- valid Indian numbers but are not stored in canonical E.164 form.
create or replace function public.customer_login_account_exists(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with requested_phone as (
    select public.normalize_indian_phone(p_phone) as value
  )
  select exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    join public.user_app_roles registered_app
      on registered_app.user_id = profile.id
      and registered_app.app_variant = 'customer'
    cross join requested_phone
    where case
      when regexp_replace(coalesce(profile.phone, ''), '\D', '', 'g') ~ '^(91)?[0-9]{10}$'
        then public.normalize_indian_phone(profile.phone)
      else null
    end = requested_phone.value
      and profile.deleted_at is null
      and account.phone_confirmed_at is not null
      and account.banned_until is null
  );
$$;
