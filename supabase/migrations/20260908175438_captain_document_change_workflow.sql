-- Canonical onboarding documents remain the single source of truth after a
-- Captain is approved. A document-change approval blocks only NEW work.
alter table public.captain_onboarding_documents
  add column if not exists change_request_status text not null default 'none'
    check (change_request_status in ('none', 'requested', 'approved', 'rejected')),
  add column if not exists change_requested_at timestamptz,
  add column if not exists change_reviewed_at timestamptz,
  add column if not exists change_reviewed_by uuid references public.profiles(id) on delete restrict,
  add column if not exists replacement_submitted_at timestamptz,
  add column if not exists review_note text;

alter table public.captain_onboarding_documents
  drop constraint if exists captain_onboarding_documents_verification_status_check;
alter table public.captain_onboarding_documents
  add constraint captain_onboarding_documents_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected', 'reupload_required'));

create or replace function private.captain_documents_are_eligible(p_captain_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.captain_onboarding_applications application
    where application.user_id = p_captain_id and application.status = 'approved'
  ) and (select count(*) from public.captain_onboarding_documents document
    where document.user_id = p_captain_id and document.verification_status = 'verified') = 3;
$$;

create or replace function public.captain_request_document_change(p_document_id uuid)
returns public.captain_onboarding_documents
language plpgsql security definer set search_path = '' as $$
declare v_document public.captain_onboarding_documents;
begin
  perform public.require_pilot_user('captain');
  select * into v_document from public.captain_onboarding_documents
    where id = p_document_id and user_id = auth.uid() for update;
  if not found then raise exception 'Document not found'; end if;
  if v_document.verification_status <> 'verified' then raise exception 'Only verified documents can be changed'; end if;
  if v_document.change_request_status in ('requested', 'approved') then raise exception 'A document change is already pending'; end if;
  update public.captain_onboarding_documents set change_request_status = 'requested', change_requested_at = now(), change_reviewed_at = null,
    change_reviewed_by = null, review_note = null where id = v_document.id returning * into v_document;
  return v_document;
end;
$$;

create or replace function public.captain_submit_document_replacement(p_document_id uuid, p_storage_path text)
returns public.captain_onboarding_documents
language plpgsql security definer set search_path = '' as $$
declare v_document public.captain_onboarding_documents;
begin
  perform public.require_pilot_user('captain');
  if p_storage_path !~ ('^' || auth.uid()::text || '/[a-z_]+-[0-9]+\\.(jpg|jpeg|png|webp)$') then raise exception 'Invalid document storage path'; end if;
  select * into v_document from public.captain_onboarding_documents where id = p_document_id and user_id = auth.uid() for update;
  if not found or v_document.change_request_status <> 'approved' or v_document.verification_status <> 'reupload_required' then raise exception 'Document replacement is not authorized'; end if;
  update public.captain_onboarding_documents set storage_path = p_storage_path, verification_status = 'pending', replacement_submitted_at = now(), verified_at = null
    where id = v_document.id returning * into v_document;
  return v_document;
end;
$$;

create or replace function public.operator_review_captain_document_change(p_document_id uuid, p_approve boolean, p_note text default null)
returns public.captain_onboarding_documents
language plpgsql security definer set search_path = '' as $$
declare v_document public.captain_onboarding_documents;
begin
  if not public.is_settlement_operator() then raise exception 'Operator authorization is required'; end if;
  select * into v_document from public.captain_onboarding_documents where id = p_document_id for update;
  if not found or v_document.change_request_status <> 'requested' then raise exception 'No pending document change request'; end if;
  update public.captain_onboarding_documents set change_request_status = case when p_approve then 'approved' else 'rejected' end,
    verification_status = case when p_approve then 'reupload_required' else verification_status end,
    change_reviewed_at = now(), change_reviewed_by = auth.uid(), review_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
    where id = v_document.id returning * into v_document;
  return v_document;
end;
$$;

create or replace function public.operator_verify_captain_document(p_document_id uuid, p_approve boolean, p_note text default null)
returns public.captain_onboarding_documents
language plpgsql security definer set search_path = '' as $$
declare v_document public.captain_onboarding_documents;
begin
  if not public.is_settlement_operator() then raise exception 'Operator authorization is required'; end if;
  select * into v_document from public.captain_onboarding_documents where id = p_document_id for update;
  if not found or v_document.verification_status <> 'pending' then raise exception 'Document is not awaiting verification'; end if;
  update public.captain_onboarding_documents set verification_status = case when p_approve then 'verified' else 'rejected' end,
    verified_at = case when p_approve then now() else null end, change_request_status = case when p_approve then 'none' else 'approved' end,
    change_reviewed_at = now(), change_reviewed_by = auth.uid(), review_note = nullif(left(trim(coalesce(p_note, '')), 500), '')
    where id = v_document.id returning * into v_document;
  return v_document;
end;
$$;

create or replace function private.reject_ineligible_captain_ride()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'searching' and new.status = 'accepted' and new.captain_id is not null
    and not private.captain_documents_are_eligible(new.captain_id) then
    raise exception 'DOCUMENT_UPDATE_REQUIRED';
  end if;
  return new;
end;
$$;
drop trigger if exists reject_ineligible_captain_ride on public.rides;
create trigger reject_ineligible_captain_ride before update of status, captain_id on public.rides
for each row execute function private.reject_ineligible_captain_ride();

create or replace function public.captain_set_availability(p_is_online boolean, p_latitude numeric default null, p_longitude numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  if p_is_online and not private.captain_documents_are_eligible(auth.uid()) then raise exception 'DOCUMENT_UPDATE_REQUIRED'; end if;
  if (p_latitude is null) <> (p_longitude is null) then raise exception 'Availability location must include both latitude and longitude'; end if;
  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then raise exception 'Invalid availability location'; end if;
  insert into public.captain_availability(captain_id, is_online, latitude, longitude, updated_at)
  values (auth.uid(), p_is_online, p_latitude, p_longitude, now())
  on conflict (captain_id) do update set is_online = excluded.is_online, latitude = coalesce(excluded.latitude, public.captain_availability.latitude), longitude = coalesce(excluded.longitude, public.captain_availability.longitude), updated_at = now();
end;
$$;

drop policy if exists "Captains can upload replacement document files" on storage.objects;
create policy "Captains can upload replacement document files" on storage.objects for insert to authenticated with check (
  bucket_id = 'captain-documents' and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (select 1 from public.captain_onboarding_documents document where document.user_id = (select auth.uid()) and document.change_request_status = 'approved' and document.verification_status = 'reupload_required')
);

revoke all on function private.captain_documents_are_eligible(uuid), private.reject_ineligible_captain_ride() from public, anon, authenticated;
revoke all on function public.captain_request_document_change(uuid), public.captain_submit_document_replacement(uuid,text), public.operator_review_captain_document_change(uuid,boolean,text), public.operator_verify_captain_document(uuid,boolean,text) from public, anon;
grant execute on function public.captain_request_document_change(uuid), public.captain_submit_document_replacement(uuid,text), public.captain_set_availability(boolean,numeric,numeric) to authenticated;
grant execute on function public.operator_review_captain_document_change(uuid,boolean,text), public.operator_verify_captain_document(uuid,boolean,text) to authenticated;
