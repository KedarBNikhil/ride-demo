-- Phase 1: phone-authenticated customer and captain profiles.
-- auth.users is managed by Supabase Auth; app-specific data lives in public.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text unique,
  full_name text,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'te')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.captain_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  vehicle_type text check (vehicle_type in ('bike', 'auto')),
  onboarding_status text not null default 'draft'
    check (onboarding_status in ('draft', 'submitted', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger captain_profiles_set_updated_at
before update on public.captain_profiles
for each row execute function public.set_updated_at();

-- This trigger creates the database profile once, at first verified sign-up.
-- Do not insert into auth.users from the app.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.captain_profiles enable row level security;

grant select on public.profiles to authenticated;
grant update (full_name, preferred_language) on public.profiles to authenticated;
grant select, insert on public.captain_profiles to authenticated;
grant update (vehicle_type) on public.captain_profiles to authenticated;

create policy "Users can read their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Captains can read their own profile"
on public.captain_profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can start their own captain profile"
on public.captain_profiles for insert to authenticated
with check ((select auth.uid()) = user_id and onboarding_status = 'draft');

create policy "Captains can update their own vehicle type"
on public.captain_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- These functions are invoked only by triggers. Do not expose privileged RPCs.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- This project-level DDL event trigger is already installed. It must not be an RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
