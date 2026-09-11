-- Focused regression checks for migration 20260910180655.
-- The trip component deliberately excludes the existing, separate pickup surcharge.
\set ON_ERROR_STOP on

with cases(distance_meters, expected_fare) as (
  values
    (1, 18::numeric),
    (2000, 18::numeric),
    (2001, 19::numeric),
    (2100, 19::numeric),
    (2101, 20::numeric),
    (2500, 23::numeric)
), results as (
  select distance_meters, expected_fare,
    private.round_fare_half_down(18 + ceil(greatest(0, distance_meters - 2000)::numeric / 100)) as actual_fare
  from cases
)
select distance_meters, expected_fare, actual_fare, actual_fare = expected_fare as passed
from results
order by distance_meters;

-- Ensure the live authoritive booking RPC has the Bike ₹18 rule and Auto tariff is retained.
select
  pg_get_functiondef('public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text)'::regprocedure) like '%when p_ride_type = ''bike'' then 18 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end%' as bike_18_auto_unchanged,
  has_function_privilege('service_role', 'public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text)'::regprocedure, 'execute') as service_booking_remains_available,
  not has_function_privilege('authenticated', 'public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text)'::regprocedure, 'execute') as customer_direct_booking_remains_blocked;
