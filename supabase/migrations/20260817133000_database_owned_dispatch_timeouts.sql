-- Database-owned dispatch lifecycle: no captain app needs to be open for
-- offer expiry, reassignment, or the final no-captain timeout to happen.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.process_dispatch_timeouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride_id uuid;
  v_processed integer := 0;
begin
  -- An offer is authoritative for 30 seconds. Once it expires, the next
  -- available captains are considered by dispatch_ride_round below.
  update public.ride_offers
  set status = 'expired', responded_at = null
  where status = 'offered'
    and expires_at <= now();

  -- End a search after two minutes when no captain has accepted. This only
  -- affects unassigned searches; accepted and in-progress rides are never
  -- ended automatically.
  with expired_searches as (
    update public.rides
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason_code = 'other',
        cancellation_reason_detail = 'No captain accepted within two minutes.',
        updated_at = now()
    where status = 'searching'
      and captain_id is null
      and requested_at <= now() - interval '2 minutes'
    returning id
  )
  insert into public.ride_status_history (ride_id, status, actor_type)
  select id, 'cancelled', 'system'
  from expired_searches;

  -- Work through all still-searching rides. SKIP LOCKED makes concurrent
  -- captain refreshes and this cron job safe to run at the same time.
  for v_ride_id in
    select id
    from public.rides
    where status = 'searching' and captain_id is null
    order by requested_at
    for update skip locked
  loop
    perform public.dispatch_ride_round(v_ride_id);
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.process_dispatch_timeouts() from public, anon, authenticated;

-- Supabase Cron supports second intervals on this Postgres version. Fifteen
-- seconds keeps reassignment prompt without relying on any device polling.
select cron.schedule(
  'nandyal-ride-dispatch-timeouts',
  '15 seconds',
  'select public.process_dispatch_timeouts();'
);

-- Do not re-offer the same ride to a captain who has already been offered it.
-- This lets each scheduled round advance to the next nearby captains.
create or replace function public.dispatch_ride_round(p_ride_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_round integer; v_pickup extensions.geography;
begin
  select * into v_ride from public.rides where id = p_ride_id and status = 'searching' and captain_id is null for update;
  if not found or v_ride.pickup_latitude is null then return 0; end if;
  if exists (select 1 from public.ride_offers where ride_id = p_ride_id and status = 'offered' and expires_at > now()) then return 0; end if;
  v_round := coalesce((select max(offer_round) from public.ride_offers where ride_id = p_ride_id), 0) + 1;
  if v_round > 4 then return 0; end if;
  v_pickup := extensions.st_setsrid(extensions.st_makepoint(v_ride.pickup_longitude, v_ride.pickup_latitude), 4326)::extensions.geography;
  with candidates as (
    select availability.captain_id,
      extensions.st_distance(availability.location, v_pickup) as meters
    from public.captain_availability availability join public.captain_profiles captain on captain.user_id = availability.captain_id
    where availability.is_online and availability.updated_at > now() - interval '90 seconds'
      and captain.vehicle_type = v_ride.ride_type and availability.location is not null
      and extensions.st_dwithin(availability.location, v_pickup, 3000)
      and not exists (select 1 from public.rides active where active.captain_id = availability.captain_id and active.status in ('accepted','arrived','in_progress'))
      and not exists (select 1 from public.ride_offers open_offer where open_offer.captain_id = availability.captain_id and open_offer.status = 'offered' and open_offer.expires_at > now())
      and not exists (select 1 from public.ride_offers previous_offer where previous_offer.ride_id = p_ride_id and previous_offer.captain_id = availability.captain_id)
    order by availability.location operator(extensions.<->) v_pickup limit 3
  ) insert into public.ride_offers (ride_id, captain_id, expires_at, offer_round, pickup_distance_meters, estimated_pickup_eta_seconds)
  select p_ride_id, captain_id, now() + interval '30 seconds', v_round, meters, greatest(60, ceil(meters / 6.1)::integer)
  from candidates on conflict (ride_id, captain_id) do nothing;
  return (select count(*) from public.ride_offers where ride_id = p_ride_id and offer_round = v_round and status = 'offered');
end; $$;

revoke all on function public.dispatch_ride_round(uuid) from public, anon, authenticated;
