-- Staging-only grants for the existing trusted ride-maps and notification functions.
grant select on public.rides, public.ride_offers, public.captain_availability, public.customer_payment_issues to service_role;
grant select, update on public.google_routes_call_log to service_role;
grant select, delete on public.push_device_tokens, public.captain_fcm_device_tokens to service_role;
