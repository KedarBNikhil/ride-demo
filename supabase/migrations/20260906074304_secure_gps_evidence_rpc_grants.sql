-- CREATE FUNCTION starts with default function ACLs. Keep the operator queue
-- authenticated-only after the return-shape replacement in the GPS migration.
revoke all on function public.operator_captain_ride_verification_queue(text) from public, anon;
grant execute on function public.operator_captain_ride_verification_queue(text) to authenticated;
