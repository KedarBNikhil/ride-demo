-- All production booking flows use consume_google_route_quote through ride-maps.
-- Keep the legacy signature present for migration compatibility, but make it
-- unreachable so it cannot become a second pricing authority.
revoke all on function public.request_ride(
  text, text, text, numeric, numeric, numeric, numeric, smallint
) from public, anon, authenticated, service_role;
