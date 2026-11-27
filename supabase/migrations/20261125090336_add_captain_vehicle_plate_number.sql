alter table public.captain_onboarding_applications
  add column if not exists vehicle_plate_number text;