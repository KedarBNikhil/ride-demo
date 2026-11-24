-- Aadhar is the canonical third onboarding document. Keep a tiny normalization
-- trigger so an already-installed client that still submits `insurance` cannot
-- strand a Captain while its OTA update is downloading.
create or replace function public.normalize_legacy_insurance_document_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.document_type = 'insurance' then new.document_type := 'aadhar'; end if;
  return new;
end;
$$;

drop trigger if exists normalize_legacy_insurance_document_type_before_write on public.captain_onboarding_documents;
create trigger normalize_legacy_insurance_document_type_before_write
before insert or update of document_type on public.captain_onboarding_documents
for each row execute function public.normalize_legacy_insurance_document_type();

alter table public.captain_onboarding_documents
  drop constraint captain_onboarding_documents_document_type_check;
update public.captain_onboarding_documents
set document_type = 'aadhar'
where document_type = 'insurance';
alter table public.captain_onboarding_documents
  add constraint captain_onboarding_documents_document_type_check
  check (document_type in ('license', 'rc', 'aadhar'));

alter table private.test_captain_document_templates
  drop constraint test_captain_document_templates_document_type_check;
update private.test_captain_document_templates
set document_type = 'aadhar'
where document_type = 'insurance';
alter table private.test_captain_document_templates
  add constraint test_captain_document_templates_document_type_check
  check (document_type in ('license', 'rc', 'aadhar'));

create or replace function public.finalize_test_captain_document_approval(
  p_user_id uuid,
  p_application_id uuid,
  p_document_hashes jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_application public.captain_onboarding_applications;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if not exists (select 1 from private.test_captain_document_program program where program.singleton and program.enabled and program.ends_at > now()) then return false; end if;
  select * into v_application from public.captain_onboarding_applications application where application.id = p_application_id and application.user_id = p_user_id for update;
  if not found then return false; end if;
  if v_application.status = 'approved' then return true; end if;
  if v_application.status <> 'submitted' then return false; end if;
  if (select count(*) from public.captain_onboarding_documents document where document.application_id = p_application_id and document.user_id = p_user_id and document.document_type in ('license', 'rc', 'aadhar')) <> 3 then return false; end if;
  update public.captain_onboarding_documents set verification_status = 'verified', verified_at = now() where application_id = p_application_id and user_id = p_user_id and document_type in ('license', 'rc', 'aadhar');
  insert into private.test_captain_document_approvals (user_id, application_id, document_hashes)
  values (p_user_id, p_application_id, p_document_hashes)
  on conflict (user_id) do update set application_id = excluded.application_id, document_hashes = excluded.document_hashes, approved_at = now(), revoked_at = null, revocation_note = null;
  update public.captain_onboarding_applications set status = 'approved', reviewed_at = now(), review_note = 'Automatically approved for the closed-test document set.' where id = p_application_id;
  return true;
end;
$$;

-- This deliberately exposes only the assigned Captain's verification details
-- to the customer who owns that one ride.
create function public.customer_assigned_captain_details(p_ride_id uuid)
returns table (full_name text, vehicle_type text, phone text, vehicle_plate_number text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_production_user();
  return query
  select profile.full_name, captain.vehicle_type, nullif(trim(profile.phone), ''), application.vehicle_plate_number
  from public.rides ride
  join public.profiles profile on profile.id = ride.captain_id
  join public.captain_profiles captain on captain.user_id = ride.captain_id
  left join public.captain_onboarding_applications application on application.user_id = ride.captain_id
  where ride.id = p_ride_id and ride.customer_id = auth.uid() and ride.captain_id is not null;
end;
$$;
revoke all on function public.customer_assigned_captain_details(uuid) from public, anon;
grant execute on function public.customer_assigned_captain_details(uuid) to authenticated;

revoke all on function public.normalize_legacy_insurance_document_type() from public, anon, authenticated;
