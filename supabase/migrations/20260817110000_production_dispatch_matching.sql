-- Production dispatch: indexed geographical matching and concurrent offer rounds.
create extension if not exists postgis schema extensions;

alter table public.captain_availability add column if not exists location extensions.geography(Point, 4326);
alter table public.ride_offers add column if not exists offer_round integer not null default 1 check (offer_round > 0);
alter table public.ride_offers add column if not exists pickup_distance_meters numeric;
alter table public.ride_offers add column if not exists estimated_pickup_eta_seconds integer;

create or replace function public.set_availability_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.location := case when new.latitude is null then null
    else extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography end;
  return new;
end; $$;
drop trigger if exists captain_availability_set_location on public.captain_availability;
create trigger captain_availability_set_location before insert or update of latitude, longitude
on public.captain_availability for each row execute function public.set_availability_location();
update public.captain_availability
set location = extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
where latitude is not null and longitude is not null;
create index if not exists captain_availability_location_idx on public.captain_availability using gist (location);

drop index if exists public.one_open_offer_per_ride_idx;
create unique index if not exists one_open_offer_per_captain_idx
on public.ride_offers (captain_id) where status = 'offered';

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
    order by availability.location operator(extensions.<->) v_pickup limit 3
  ) insert into public.ride_offers (ride_id, captain_id, expires_at, offer_round, pickup_distance_meters, estimated_pickup_eta_seconds)
  select p_ride_id, captain_id, now() + interval '30 seconds', v_round, meters, greatest(60, ceil(meters / 6.1)::integer)
  from candidates on conflict (ride_id, captain_id) do nothing;
  return (select count(*) from public.ride_offers where ride_id = p_ride_id and offer_round = v_round and status = 'offered');
end; $$;

create or replace function public.refresh_captain_dispatch() returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid;
begin
  update public.ride_offers set status = 'expired' where status = 'offered' and expires_at <= now();
  select id into v_ride_id from public.rides where status = 'searching' and captain_id is null order by requested_at limit 1 for update skip locked;
  if v_ride_id is null then return null; end if;
  perform public.dispatch_ride_round(v_ride_id); return v_ride_id;
end; $$;

revoke all on function public.dispatch_ride_round(uuid) from public, anon, authenticated;

create or replace function public.request_ride(p_ride_type text, p_pickup_address text, p_drop_address text, p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_fare numeric(10,2);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_ride_type not in ('bike','auto') or p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 then raise exception 'Valid pickup location is required'; end if;
  if exists (select 1 from public.rides where customer_id = auth.uid() and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  v_fare := case when p_ride_type = 'bike' then 55 else 75 end;
  insert into public.rides (customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, estimated_fare)
  values (auth.uid(), p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, v_fare) returning id into v_ride_id;
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end; $$;

create or replace function public.respond_to_ride_offer(p_offer_id uuid, p_accept boolean)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_offer public.ride_offers; v_ride public.rides;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> auth.uid() or v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'Offer is no longer available'; end if;
  if not p_accept then update public.ride_offers set status='rejected', responded_at=now() where id=v_offer.id; perform public.dispatch_ride_round(v_offer.ride_id); select * into v_ride from public.rides where id=v_offer.ride_id; return v_ride; end if;
  update public.rides set captain_id=auth.uid(), status='accepted', accepted_at=now() where id=v_offer.ride_id and status='searching' and captain_id is null returning * into v_ride;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;
  update public.ride_offers set status='accepted', responded_at=now() where id=v_offer.id;
  update public.ride_offers set status='cancelled' where ride_id=v_offer.ride_id and id<>v_offer.id and status='offered';
  update public.captain_availability set is_online=false, updated_at=now() where captain_id=auth.uid();
  insert into public.ride_status_history (ride_id,status,actor_type) values (v_ride.id,'accepted','captain'); return v_ride;
end; $$;
