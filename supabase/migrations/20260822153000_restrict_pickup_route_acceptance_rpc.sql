-- Supabase grants execute on newly created functions to API roles by default.
-- Acceptance is intentionally callable only from the verified service function.
revoke all on function public.accept_ride_offer_with_pickup_route(uuid, uuid, integer, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.accept_ride_offer_with_pickup_route(uuid, uuid, integer, integer, text) to service_role;
