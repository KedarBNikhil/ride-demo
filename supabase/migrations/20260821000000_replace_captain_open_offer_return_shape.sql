-- PostgreSQL cannot replace a function when its TABLE return shape changes.
-- Preflight confirmed no dependent database objects or function callers.
drop function public.captain_open_offer();

create function public.captain_open_offer()
returns table (
  offer_id uuid, ride_id uuid, pickup_address text, drop_address text,
  pickup_latitude numeric, pickup_longitude numeric, drop_latitude numeric, drop_longitude numeric,
  estimated_fare numeric, pickup_distance_meters numeric, pickup_eta_seconds integer, expires_at timestamptz,
  customer_name text, customer_phone text
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_production_user();
  return query
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
end;
$$;

revoke all on function public.captain_open_offer() from public, anon;
grant execute on function public.captain_open_offer() to authenticated, service_role;
