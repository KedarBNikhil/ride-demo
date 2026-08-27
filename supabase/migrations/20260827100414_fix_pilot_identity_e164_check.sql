alter table public.pilot_identity_allowlist
  drop constraint pilot_identity_allowlist_phone_e164_check;

alter table public.pilot_identity_allowlist
  add constraint pilot_identity_allowlist_phone_e164_check
  check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
