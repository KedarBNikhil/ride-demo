-- Fare-engine authority checks. Run with a privileged read-only connection
-- after migration 20260911090000 is applied:
-- psql "$DATABASE_URL" -f supabase/tests/fare_engine_authority_checks.sql

\set ON_ERROR_STOP on

\echo '1. Captain-to-pickup distance never adds a surcharge for either ride type.'
with cases(ride_type, distance_meters, expected_surcharge) as (
  values
    ('bike'::text, 1, 0::numeric), ('bike', 800, 0), ('bike', 100000, 0),
    ('auto', 1, 0), ('auto', 600, 0), ('auto', 100000, 0)
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

\echo '3. Both finalizers persist a zero pickup surcharge and immediately approve the fare; direct Captain acceptance stays rejected.'
select
  pg_get_functiondef('public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text)'::regprocedure) ~ 'pickup_surcharge = 0' as acceptance_sets_zero_surcharge,
  pg_get_functiondef('public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text)'::regprocedure) ~ 'fare_approval_status = ''approved''' as acceptance_immediately_approves_fare,
  pg_get_functiondef('public.apply_captain_road_distance(uuid,integer,integer,text)'::regprocedure) ~ 'pickup_surcharge = 0' as route_persistence_sets_zero_surcharge,
  pg_get_functiondef('public.apply_captain_road_distance(uuid,integer,integer,text)'::regprocedure) ~ 'fare_approval_status = ''approved''' as route_persistence_immediately_approves_fare,
  pg_get_functiondef('public.respond_to_ride_offer(uuid,boolean)'::regprocedure) ~ 'Captain acceptance must use the pickup-route service' as direct_acceptance_rejected;
