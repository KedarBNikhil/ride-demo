-- Captains become active only after a staff review of all onboarding documents.
-- A phone OTP creates public.profiles; it never creates public.captain_profiles.

revoke insert, update on public.captain_profiles from authenticated;
drop policy if exists "Users can start their own captain profile" on public.captain_profiles;
drop policy if exists "Captains can update their own vehicle type" on public.captain_profiles;

alter table public.captain_profiles
  drop column onboarding_status,
  alter column vehicle_type set not null;

create table public.captain_onboarding_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  full_name text not null,
  preferred_language text not null check (preferred_language in ('en', 'te')),
  vehicle_type text not null check (vehicle_type in ('bike', 'auto')),
  payout_method text not null check (payout_method in ('bank', 'upi')),
  payout_details jsonb not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submitted_application_has_timestamp
    check ((status <> 'submitted') or submitted_at is not null),
  constraint reviewed_application_has_timestamp
    check ((status not in ('approved', 'rejected')) or reviewed_at is not null)
);

create table public.captain_onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.captain_onboarding_applications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_type text not null check (document_type in ('license', 'rc', 'insurance')),
  storage_path text not null unique,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, document_type),
  constraint verified_document_has_timestamp
    check ((verification_status <> 'verified') or verified_at is not null)
);

create trigger captain_onboarding_applications_set_updated_at
before update on public.captain_onboarding_applications
for each row execute function public.set_updated_at();

create trigger captain_onboarding_documents_set_updated_at
before update on public.captain_onboarding_documents
for each row execute function public.set_updated_at();

-- Do not allow an approval until each required document has been verified by staff.
create function public.require_verified_captain_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if (select count(*) from public.captain_onboarding_documents
        where application_id = new.id and verification_status = 'verified') <> 3 then
      raise exception 'All captain documents must be verified before approval';
    end if;
  end if;
  return new;
end;
$$;

create trigger require_verified_captain_documents_before_approval
before update of status on public.captain_onboarding_applications
for each row execute function public.require_verified_captain_documents();

-- Only a successful staff approval creates the captain profile.
create function public.create_captain_profile_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    insert into public.captain_profiles (user_id, vehicle_type)
    values (new.user_id, new.vehicle_type)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger create_captain_profile_after_approval
after update of status on public.captain_onboarding_applications
for each row execute function public.create_captain_profile_on_approval();

alter table public.captain_onboarding_applications enable row level security;
alter table public.captain_onboarding_documents enable row level security;

grant select, insert, update on public.captain_onboarding_applications to authenticated;
grant select, insert, update, delete on public.captain_onboarding_documents to authenticated;

create policy "Captains can read their own onboarding application"
on public.captain_onboarding_applications for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Captains can start their own onboarding application"
on public.captain_onboarding_applications for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'draft' and reviewed_at is null);

create policy "Captains can submit their own draft application"
on public.captain_onboarding_applications for update to authenticated
using ((select auth.uid()) = user_id and status = 'draft')
with check (
  (select auth.uid()) = user_id
  and status in ('draft', 'submitted')
  and reviewed_at is null
);

create policy "Captains can read their own onboarding documents"
on public.captain_onboarding_documents for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Captains can add documents to their own draft application"
on public.captain_onboarding_documents for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and verification_status = 'pending'
  and verified_at is null
  and exists (
    select 1 from public.captain_onboarding_applications application
    where application.id = application_id
      and application.user_id = (select auth.uid())
      and application.status = 'draft'
  )
);

create policy "Captains can replace documents on their own draft application"
on public.captain_onboarding_documents for update to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.captain_onboarding_applications application
    where application.id = application_id
      and application.status = 'draft'
  )
)
with check ((select auth.uid()) = user_id and verification_status = 'pending' and verified_at is null);

create policy "Captains can remove documents from their own draft application"
on public.captain_onboarding_documents for delete to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.captain_onboarding_applications application
    where application.id = application_id
      and application.status = 'draft'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captain-documents', 'captain-documents', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Captains can view their own onboarding files"
on storage.objects for select to authenticated
using (
  bucket_id = 'captain-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Captains can upload files to their own draft application"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'captain-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.captain_onboarding_applications application
    where application.user_id = (select auth.uid())
      and application.status = 'draft'
  )
);

create policy "Captains can replace files on their own draft application"
on storage.objects for update to authenticated
using (
  bucket_id = 'captain-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.captain_onboarding_applications application
    where application.user_id = (select auth.uid())
      and application.status = 'draft'
  )
)
with check (
  bucket_id = 'captain-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "Captains can delete files on their own draft application"
on storage.objects for delete to authenticated
using (
  bucket_id = 'captain-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.captain_onboarding_applications application
    where application.user_id = (select auth.uid())
      and application.status = 'draft'
  )
);

revoke execute on function public.require_verified_captain_documents() from public, anon, authenticated;
revoke execute on function public.create_captain_profile_on_approval() from public, anon, authenticated;
