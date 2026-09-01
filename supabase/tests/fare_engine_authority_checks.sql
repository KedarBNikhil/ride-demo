-- Fare-engine boundary and authority checks. Run with a privileged read-only
-- connection after migration 20260901043332 is applied:
-- psql "$DATABASE_URL" -f supabase/tests/fare_engine_authority_checks.sql

\set ON_ERROR_STOP on

\echo '1. Pickup-surcharge slab boundaries use decimal division, never integer truncation.'
with cases(ride_type, distance_meters, expected_surcharge) as (
  values
    ('bike'::text, 800, 0::numeric), ('bike', 801, 2), ('bike', 900, 2), ('bike', 901, 4), ('bike', 1001, 6),
    ('auto', 600, 0), ('auto', 601, 1), ('auto', 700, 1), ('auto', 701, 2), ('auto', 1001, 5)
)
select ride_type, distance_meters, expected_surcharge,
  private.pickup_surcharge_for_distance(ride_type, distance_meters) as calculated_surcharge,
  expected_surcharge = private.pickup_surcharge_for_distance(ride_type, distance_meters) as passes
from cases
order by ride_type, distance_meters;

\echo '2. Only service_role can finalize a route-based fare; the fallback booking RPC is disabled.'
select
  not has_function_privilege('authenticated', 'public.request_ride(text,text,text,numeric,numeric,numeric,numeric,smallint)'::regprocedure, 'execute') as client_fallback_booking_denied,
  not has_function_privilege('service_role', 'public.request_ride(text,text,text,numeric,numeric,numeric,numeric,smallint)'::regprocedure, 'execute') as service_fallback_booking_denied,
  not has_function_privilege('authenticated', 'public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text)'::regprocedure, 'execute') as client_fare_finalization_denied,
  has_function_privilege('service_role', 'public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text)'::regprocedure, 'execute') as service_fare_finalization_allowed;

\echo '3. Both finalizers call the single helper; direct Captain acceptance stays rejected.'
select
  pg_get_functiondef('public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text)'::regprocedure) ~ 'private\.pickup_surcharge_for_distance' as acceptance_uses_single_helper,
  pg_get_functiondef('public.apply_captain_road_distance(uuid,integer,integer,text)'::regprocedure) ~ 'private\.pickup_surcharge_for_distance' as route_persistence_uses_single_helper,
  pg_get_functiondef('public.respond_to_ride_offer(uuid,boolean)'::regprocedure) ~ 'Captain acceptance must use the pickup-route service' as direct_acceptance_rejected;
