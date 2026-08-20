-- Diagnostic mode: captain availability and dispatch do not depend on GPS.
-- Existing location columns remain intact so this can be reverted later.

create or replace function public.captain_set_availability(
  p_is_online boolean,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('captain');

  insert into public.captain_availability(captain_id, is_online, updated_at)
  values (auth.uid(), p_is_online, now())
  on conflict (captain_id) do update
    set is_online = excluded.is_online,
        updated_at = now();
end;
$$;

create or replace function public.dispatch_ride_round(p_ride_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_round integer;
begin
  select * into v_ride
  from public.rides
  where id = p_ride_id and status = 'searching' and captain_id is null
  for update;

  if not found then return 0; end if;
  if exists (
    select 1 from public.ride_offers
    where ride_id = p_ride_id and status = 'offered' and expires_at > now()
  ) then return 0; end if;

  v_round := coalesce((select max(offer_round) from public.ride_offers where ride_id = p_ride_id), 0) + 1;
  if v_round > 4 then return 0; end if;

  with candidates as (
    select availability.captain_id
    from public.captain_availability availability
    join public.captain_profiles captain on captain.user_id = availability.captain_id
    where availability.is_online
      and captain.vehicle_type = v_ride.ride_type
      and not exists (
        select 1 from public.rides active
        where active.captain_id = availability.captain_id
          and active.status in ('accepted', 'arrived', 'in_progress')
      )
      and not exists (
        select 1 from public.ride_offers open_offer
        where open_offer.captain_id = availability.captain_id
          and open_offer.status = 'offered' and open_offer.expires_at > now()
      )
      and not exists (
        select 1 from public.ride_offers previous_offer
        where previous_offer.ride_id = p_ride_id
          and previous_offer.captain_id = availability.captain_id
      )
    order by availability.updated_at desc
    limit 3
  )
  insert into public.ride_offers (
    ride_id, captain_id, expires_at, offer_round,
    pickup_distance_meters, estimated_pickup_eta_seconds
  )
  select p_ride_id, captain_id, now() + interval '30 seconds', v_round, 0, 60
  from candidates
  on conflict (ride_id, captain_id) do nothing;

  return (
    select count(*) from public.ride_offers
    where ride_id = p_ride_id and offer_round = v_round and status = 'offered'
  );
end;
$$;

revoke all on function public.captain_set_availability(boolean, numeric, numeric) from public, anon;
grant execute on function public.captain_set_availability(boolean, numeric, numeric) to authenticated;
revoke all on function public.dispatch_ride_round(uuid) from public, anon, authenticated;
