-- A captain starts an application before payout details are collected. Both are
-- required by the existing submitted_application_has_timestamp constraint at submission.

alter table public.captain_onboarding_applications
  alter column payout_method drop not null,
  alter column payout_details drop not null;

alter table public.captain_onboarding_applications
  drop constraint submitted_application_has_timestamp,
  add constraint submitted_application_is_complete
    check (
      status <> 'submitted'
      or (submitted_at is not null and payout_method is not null and payout_details is not null)
    );
