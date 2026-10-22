-- Closed-test Captain onboarding is intentionally separate from the normal
-- manual-review path. The Edge Function calculates hashes from stored bytes;
-- hashes supplied by clients are never trusted.
create table private.test_captain_document_program (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  ends_at timestamptz not null,
  updated_at timestamptz not null default now()
);

insert into private.test_captain_document_program (singleton, enabled, ends_at)
values (true, true, now() + interval '14 days')
on conflict (singleton) do nothing;

create table private.test_captain_document_templates (
  document_type text primary key check (document_type in ('license', 'rc', 'insurance')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into private.test_captain_document_templates (document_type, sha256)
values
  ('license', 'ec824f9157fc7b852106c92faa474b1c898de4e1434695d20fc5a5aa7dd2e156'),
  ('rc', '7dd764e8ad9dc5b9c57a269a09a55cfd292fe10b2d23683ef21956c8fbf08a81'),
  ('insurance', '71bdfb26ddc87690006940b9d8bc2a4b3dfe60c0070b2c6027144e549b41acbc')
on conflict (document_type) do update
set sha256 = excluded.sha256,
    enabled = true,
    updated_at = now();

create table private.test_captain_document_approvals (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  application_id uuid not null unique references public.captain_onboarding_applications (id) on delete cascade,
  document_hashes jsonb not null,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_note text,
  check ((revoked_at is null and revocation_note is null) or (revoked_at is not null))
);

alter table private.test_captain_document_program enable row level security;
alter table private.test_captain_document_templates enable row level security;
alter table private.test_captain_document_approvals enable row level security;
revoke all on table private.test_captain_document_program, private.test_captain_document_templates, private.test_captain_document_approvals from public, anon, authenticated;

create or replace function private.test_captain_document_access_is_active(p_captain_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from private.test_captain_document_approvals approval
      where approval.user_id = p_captain_id
        and approval.revoked_at is not null
    ) then false
    when exists (
      select 1
      from private.test_captain_document_approvals approval
      where approval.user_id = p_captain_id
    ) then exists (
      select 1
      from private.test_captain_document_program program
      where program.singleton
        and program.enabled
        and program.ends_at > now()
    )
    else true
  end;
$$;

create or replace function private.captain_documents_are_eligible(p_captain_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.test_captain_document_access_is_active(p_captain_id)
    and exists (
      select 1
      from public.captain_onboarding_applications application
      where application.user_id = p_captain_id
        and application.status = 'approved'
    )
    and (
      select count(*)
      from public.captain_onboarding_documents document
      where document.user_id = p_captain_id
        and document.verification_status = 'verified'
    ) = 3;
$$;

revoke all on function private.test_captain_document_access_is_active(uuid), private.captain_documents_are_eligible(uuid) from public, anon, authenticated;
