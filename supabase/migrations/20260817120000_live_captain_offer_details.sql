create or replace function public.captain_open_offer()
returns table (
  offer_id uuid, ride_id uuid, pickup_address text, drop_address text,
  pickup_latitude numeric, pickup_longitude numeric, drop_latitude numeric, drop_longitude numeric,
  estimated_fare numeric, pickup_distance_meters numeric, pickup_eta_seconds integer, expires_at timestamptz
)
language sql security definer set search_path = '' as $$
  select offer.id, ride.id, ride.pickup_address, ride.drop_address,
    ride.pickup_latitude, ride.pickup_longitude, ride.drop_latitude, ride.drop_longitude,
    ride.estimated_fare, offer.pickup_distance_meters, offer.estimated_pickup_eta_seconds, offer.expires_at
  from public.ride_offers offer join public.rides ride on ride.id = offer.ride_id
  where offer.captain_id = auth.uid() and offer.status = 'offered' and offer.expires_at > now() and ride.status = 'searching'
  order by offer.offered_at limit 1;
$$;
revoke all on function public.captain_open_offer() from public, anon;
grant execute on function public.captain_open_offer() to authenticated;
