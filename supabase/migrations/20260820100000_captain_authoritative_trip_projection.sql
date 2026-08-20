-- Captain-facing ride data is deliberately projected through narrow RPCs.
-- Captains never receive general access to customer profiles.

create or replace function public.captain_open_offer()
returns table (
  offer_id uuid, ride_id uuid, pickup_address text, drop_address text,
  pickup_latitude numeric, pickup_longitude numeric, drop_latitude numeric, drop_longitude numeric,
  estimated_fare numeric, pickup_distance_meters numeric, pickup_eta_seconds integer, expires_at timestamptz,
  customer_name text, customer_phone text
)
language sql security definer set search_path = '' as $$
  select offer.id, ride.id, ride.pickup_address, ride.drop_address,
    ride.pickup_latitude, ride.pickup_longitude, ride.drop_latitude, ride.drop_longitude,
    ride.estimated_fare, offer.pickup_distance_meters, offer.estimated_pickup_eta_seconds, offer.expires_at,
    nullif(trim(customer.full_name), ''), nullif(trim(customer.phone), '')
  from public.ride_offers offer
  join public.rides ride on ride.id = offer.ride_id
  join public.profiles customer on customer.id = ride.customer_id
  where offer.captain_id = auth.uid() and offer.status = 'offered'
    and offer.expires_at > now() and ride.status = 'searching'
  order by offer.offered_at limit 1;
$$;

create or replace function public.captain_ride_detail(p_ride_id uuid)
returns table (
  ride_id uuid, status text, pickup_address text, drop_address text,
  pickup_latitude numeric, pickup_longitude numeric, drop_latitude numeric, drop_longitude numeric,
  estimated_fare numeric, final_fare numeric, base_fare numeric, distance_surcharge numeric, pickup_surcharge numeric,
  trip_distance_meters numeric, travelled_distance_km numeric, pickup_distance_meters numeric,
  pickup_duration_seconds integer, trip_duration_seconds integer, started_at timestamptz, completed_at timestamptz,
  customer_name text, customer_phone text
)
language sql security definer set search_path = '' as $$
  select ride.id, ride.status, ride.pickup_address, ride.drop_address,
    ride.pickup_latitude, ride.pickup_longitude, ride.drop_latitude, ride.drop_longitude,
    ride.estimated_fare, ride.final_fare, ride.base_fare, ride.distance_surcharge, ride.pickup_surcharge,
    ride.trip_distance_meters, ride.travelled_distance_km, ride.pickup_distance_meters,
    pickup_route.duration_seconds, trip_route.duration_seconds, ride.started_at, ride.completed_at,
    nullif(trim(customer.full_name), ''), nullif(trim(customer.phone), '')
  from public.rides ride
  join public.profiles customer on customer.id = ride.customer_id
  left join public.ride_route_results pickup_route on pickup_route.ride_id = ride.id and pickup_route.route_kind = 'captain_to_pickup'
  left join public.ride_route_results trip_route on trip_route.ride_id = ride.id and trip_route.route_kind = 'initial_trip'
  where ride.id = p_ride_id and ride.captain_id = auth.uid();
$$;

revoke all on function public.captain_open_offer() from public, anon;
revoke all on function public.captain_ride_detail(uuid) from public, anon;
grant execute on function public.captain_open_offer(), public.captain_ride_detail(uuid) to authenticated;
