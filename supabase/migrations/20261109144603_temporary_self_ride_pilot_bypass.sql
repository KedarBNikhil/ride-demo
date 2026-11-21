-- Narrow, automatically expiring exception for the sole approved pilot who
-- tests the Customer and Captain apps with the same verified phone account.
-- This leaves dispatch, all other pilot accounts, and the normal fraud guard
-- unchanged.
create table private.temporary_self_ride_bypasses (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

revoke all on table private.temporary_self_ride_bypasses from public, anon, authenticated;

insert into private.temporary_self_ride_bypasses (customer_id, expires_at)
values ('c9c58592-4d16-461a-94bb-063ba6cb4c78', now() + interval '2 hours')
on conflict (customer_id) do update set expires_at = excluded.expires_at;

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
  if exists (
    select 1
    from private.temporary_self_ride_bypasses bypass
    where bypass.customer_id = p_customer_id
      and bypass.expires_at > now()
  ) then
    return false;
  end if;

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
