-- A search is a short-lived matching attempt, not a reservation that can be
-- revived when a captain comes online much later.
create or replace function public.refresh_captain_dispatch()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_captain_id uuid := auth.uid();
  v_vehicle_type text;
  v_ride_id uuid;
  v_offer_id uuid;
begin
  if v_captain_id is null then raise exception 'Authentication required'; end if;

  update public.rides
  set status = 'cancelled', cancellation_reason_code = 'other',
      cancellation_reason_detail = 'No captain was available in time.'
  where status = 'searching' and captain_id is null
    and requested_at <= now() - interval '2 minutes';

  update public.ride_offers offer
  set status = 'cancelled'
  from public.rides ride
  where offer.ride_id = ride.id and offer.status = 'offered' and ride.status = 'cancelled';

  select captain.vehicle_type into v_vehicle_type
  from public.captain_profiles captain
  join public.captain_availability availability on availability.captain_id = captain.user_id
  where captain.user_id = v_captain_id and availability.is_online
    and availability.updated_at > now() - interval '60 seconds'
    and availability.latitude is not null and availability.longitude is not null
  for update of availability;
  if not found then return null; end if;

  update public.ride_offers set status = 'expired'
  where captain_id = v_captain_id and status = 'offered' and expires_at <= now();
  if exists (select 1 from public.ride_offers where captain_id = v_captain_id and status = 'offered' and expires_at > now()) then return null; end if;

  select ride.id into v_ride_id from public.rides ride
  where ride.status = 'searching' and ride.captain_id is null and ride.ride_type = v_vehicle_type
    and ride.requested_at > now() - interval '2 minutes'
    and not exists (select 1 from public.ride_offers offer where offer.ride_id = ride.id and offer.status = 'offered' and offer.expires_at > now())
  order by ride.requested_at limit 1 for update of ride skip locked;
  if v_ride_id is null then return null; end if;

  insert into public.ride_offers (ride_id, captain_id, expires_at)
  values (v_ride_id, v_captain_id, now() + interval '30 seconds')
  on conflict (ride_id, captain_id) do update
    set status = 'offered', offered_at = now(), expires_at = excluded.expires_at, responded_at = null
    where public.ride_offers.status in ('rejected', 'expired', 'cancelled')
  returning id into v_offer_id;
  if v_offer_id is not null then
    insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride_id, 'searching', 'system');
  end if;
  return v_offer_id;
end;
$$;
