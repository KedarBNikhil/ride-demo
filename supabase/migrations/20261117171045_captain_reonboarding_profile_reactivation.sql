-- Preserve immutable Captain ride and earnings records while permitting a
-- controlled new onboarding application for a previously approved Captain.
create table public.captain_onboarding_resets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reset_at timestamptz not null default now()
);

alter table public.captain_onboarding_resets enable row level security;
revoke all on table public.captain_onboarding_resets from public, anon, authenticated;
grant select on table public.captain_onboarding_resets to authenticated;

create policy "Captains can read their own reonboarding reset"
on public.captain_onboarding_resets for select to authenticated
using ((select auth.uid()) = user_id);

-- Re-approval reactivates the existing Captain record and applies the newly
-- selected vehicle type without altering any historic rides or ledger rows.
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
    on conflict (user_id) do update
      set vehicle_type = excluded.vehicle_type,
          updated_at = now();
    delete from public.captain_onboarding_resets where user_id = new.user_id;
  end if;
  return new;
end;
$$;
