-- Temporary demo compatibility: the local OTP 1234 adapter deliberately uses
-- anonymous Supabase users. They are authenticated database identities and
-- need the normal ownership-checked dispatch path for end-to-end app testing.
-- When paid phone authentication replaces the demo adapter, restore the
-- is_anonymous check here to make this production-only again.
create or replace function public.is_production_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null;
$$;
