-- These functions are callable only by the Edge Function's service-role JWT.
-- They keep private template and audit data out of the Data API.
create or replace function public.test_captain_document_program_for_service()
returns table (enabled boolean, ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  return query
    select program.enabled, program.ends_at
    from private.test_captain_document_program program
    where program.singleton;
end;
$$;

create or replace function public.test_captain_document_templates_for_service()
returns table (document_type text, sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  return query
    select template.document_type, template.sha256
    from private.test_captain_document_templates template
    where template.enabled;
end;
$$;

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
declare
  v_application public.captain_onboarding_applications;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if not exists (
    select 1
    from private.test_captain_document_program program
    where program.singleton and program.enabled and program.ends_at > now()
  ) then return false; end if;

  select * into v_application
  from public.captain_onboarding_applications application
  where application.id = p_application_id and application.user_id = p_user_id
  for update;
  if not found then return false; end if;
  if v_application.status = 'approved' then return true; end if;
  if v_application.status <> 'submitted' then return false; end if;
  if (select count(*) from public.captain_onboarding_documents document
      where document.application_id = p_application_id
        and document.user_id = p_user_id
        and document.document_type in ('license', 'rc', 'insurance')) <> 3 then return false; end if;

  update public.captain_onboarding_documents
  set verification_status = 'verified', verified_at = now()
  where application_id = p_application_id
    and user_id = p_user_id
    and document_type in ('license', 'rc', 'insurance');

  insert into private.test_captain_document_approvals (user_id, application_id, document_hashes)
  values (p_user_id, p_application_id, p_document_hashes)
  on conflict (user_id) do update
  set application_id = excluded.application_id,
      document_hashes = excluded.document_hashes,
      approved_at = now(),
      revoked_at = null,
      revocation_note = null;

  update public.captain_onboarding_applications
  set status = 'approved',
      reviewed_at = now(),
      review_note = 'Automatically approved for the closed-test document set.'
  where id = p_application_id;
  return true;
end;
$$;

revoke all on function public.test_captain_document_program_for_service(), public.test_captain_document_templates_for_service(), public.finalize_test_captain_document_approval(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.test_captain_document_program_for_service(), public.test_captain_document_templates_for_service(), public.finalize_test_captain_document_approval(uuid, uuid, jsonb) to service_role;
