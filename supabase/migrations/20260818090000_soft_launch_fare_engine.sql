-- Soft-launch fare engine. All values are persisted with the ride so future
-- tariff changes never rewrite an existing customer quote.
alter table public.rides
  add column if not exists passenger_count smallint not null default 1,
  add column if not exists pricing_rule_version text not null default 'legacy',
  add column if not exists trip_distance_meters numeric,
  add column if not exists pickup_distance_meters numeric,
  add column if not exists base_fare numeric(10,2),
  add column if not exists distance_surcharge numeric(10,2),
  add column if not exists pickup_surcharge numeric(10,2),
  add column if not exists fare_approval_status text not null default 'approved';

alter table public.rides
  add constraint rides_passenger_count_is_valid check (
    (ride_type = 'bike' and passenger_count = 1) or
    (ride_type = 'auto' and passenger_count between 1 and 3)
  ) not valid,
  add constraint rides_fare_approval_status_is_valid check (fare_approval_status in ('estimated', 'pending', 'approved', 'declined')) not valid;

comment on column public.rides.pricing_rule_version is 'Soft-launch tariff version used for this ride.';
comment on column public.rides.final_fare is 'Customer-approved final fare. It is immutable after approval.';

create or replace function public.request_ride(
  p_ride_type text,
  p_pickup_address text,
  p_drop_address text,
  p_pickup_latitude numeric,
  p_pickup_longitude numeric,
  p_drop_latitude numeric,
  p_drop_longitude numeric,
  p_passenger_count smallint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ride_id uuid;
  v_trip_meters numeric;
  v_base_fare numeric(10,2);
  v_distance_surcharge numeric(10,2);
begin
  perform public.require_production_user();
  if p_ride_type not in ('bike','auto') then raise exception 'Invalid ride type'; end if;
  if (p_ride_type = 'bike' and p_passenger_count <> 1) or (p_ride_type = 'auto' and p_passenger_count not between 1 and 3) then raise exception 'Invalid passenger count'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180
    or p_drop_latitude not between -90 and 90 or p_drop_longitude not between -180 and 180 then raise exception 'Valid pickup and drop locations are required'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280 or char_length(trim(p_drop_address)) not between 1 and 280 then raise exception 'Pickup and destination are required'; end if;
  if exists (select 1 from public.rides where customer_id = auth.uid() and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;

  -- Match the demo's Haversine distance provider exactly. Before launch, the
  -- route-distance adapter replaces this source while the tariff stays intact.
  v_trip_meters := round(6371000 * 2 * atan2(
    sqrt(power(sin(radians(p_drop_latitude - p_pickup_latitude) / 2), 2) + cos(radians(p_pickup_latitude)) * cos(radians(p_drop_latitude)) * power(sin(radians(p_drop_longitude - p_pickup_longitude) / 2), 2)),
    sqrt(1 - (power(sin(radians(p_drop_latitude - p_pickup_latitude) / 2), 2) + cos(radians(p_pickup_latitude)) * cos(radians(p_drop_latitude)) * power(sin(radians(p_drop_longitude - p_pickup_longitude) / 2), 2)))
  ));
  v_base_fare := case when p_ride_type = 'bike' then 20 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end;
  v_distance_surcharge := ceil(greatest(0, v_trip_meters - 2000) / 100) * 1;

  insert into public.rides (
    customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude,
    passenger_count, pricing_rule_version, trip_distance_meters, base_fare, distance_surcharge, pickup_surcharge, estimated_fare, fare_approval_status
  ) values (
    auth.uid(), p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude,
    p_passenger_count, 'soft-launch-2026-08-18', v_trip_meters, v_base_fare, v_distance_surcharge, 0, v_base_fare + v_distance_surcharge, 'estimated'
  ) returning id into v_ride_id;
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

create or replace function public.respond_to_ride_offer(p_offer_id uuid, p_accept boolean)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_offer public.ride_offers; v_ride public.rides; v_pickup_surcharge numeric(10,2);
begin
  perform public.require_production_user();
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> auth.uid() or v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'Offer is no longer available'; end if;
  if not p_accept then
    update public.ride_offers set status='rejected', responded_at=now() where id=v_offer.id;
    perform public.dispatch_ride_round(v_offer.ride_id);
    select * into v_ride from public.rides where id=v_offer.ride_id;
    return v_ride;
  end if;
  select * into v_ride from public.rides where id=v_offer.ride_id and status='searching' and captain_id is null for update;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;
  v_pickup_surcharge := case when v_ride.ride_type = 'auto' then ceil(greatest(0, coalesce(v_offer.pickup_distance_meters, 0) - 600) / 100) * 1 else ceil(greatest(0, coalesce(v_offer.pickup_distance_meters, 0) - 800) / 100) * 2 end;
  update public.rides set
    captain_id=auth.uid(), status='accepted', accepted_at=now(), pickup_distance_meters=round(coalesce(v_offer.pickup_distance_meters, 0)),
    pickup_surcharge=v_pickup_surcharge, final_fare=estimated_fare + v_pickup_surcharge,
    fare_approval_status=case when v_pickup_surcharge > 0 then 'pending' else 'approved' end
  where id=v_offer.ride_id returning * into v_ride;
  update public.ride_offers set status='accepted', responded_at=now() where id=v_offer.id;
  update public.ride_offers set status='cancelled', responded_at=null where ride_id=v_offer.ride_id and id<>v_offer.id and status='offered';
  update public.captain_availability set is_online=false, updated_at=now() where captain_id=auth.uid();
  insert into public.ride_status_history (ride_id,status,actor_type) values (v_ride.id,'accepted','captain');
  return v_ride;
end;
$$;

create or replace function public.customer_approve_fare_quote(p_ride_id uuid, p_accept boolean)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_production_user();
  select * into v_ride from public.rides where id=p_ride_id and customer_id=auth.uid() and status='accepted' and fare_approval_status='pending' for update;
  if not found then raise exception 'Fare quote is not available'; end if;
  if p_accept then
    update public.rides set fare_approval_status='approved' where id=v_ride.id returning * into v_ride;
    return v_ride;
  end if;
  update public.rides set status='cancelled', cancelled_at=now(), fare_approval_status='declined', cancellation_reason_code='fare_concern', cancellation_reason_detail='Customer declined updated captain-distance fare', cancellation_charge=0, final_fare=null where id=v_ride.id returning * into v_ride;
  update public.ride_offers set status='cancelled', responded_at=null where ride_id=v_ride.id and status='accepted';
  update public.captain_availability set is_online=true, updated_at=now() where captain_id=v_ride.captain_id;
  return v_ride;
end;
$$;

create or replace function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_production_user();
  select * into v_ride from public.rides where id=p_ride_id and captain_id=auth.uid() for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status='accepted' and v_ride.fare_approval_status <> 'approved' then raise exception 'Customer has not approved the final fare'; end if;
  if v_ride.status='accepted' and p_next_status='arrived' then
    update public.rides set status='arrived', arrived_at=now() where id=p_ride_id returning * into v_ride;
  elsif v_ride.status='in_progress' and p_next_status='completed' then
    update public.rides set status='completed', completed_at=now(), final_fare=coalesce(final_fare, estimated_fare) where id=p_ride_id returning * into v_ride;
    update public.captain_availability set is_online=true, updated_at=now() where captain_id=auth.uid();
  else raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history (ride_id,status,actor_type) values (v_ride.id,v_ride.status,'captain');
  return v_ride;
end;
$$;

create or replace function public.customer_pickup_pin(p_ride_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_pin text;
begin
  perform public.require_production_user();
  select profile.customer_pickup_otp into v_pin from public.rides ride join public.profiles profile on profile.id=ride.customer_id
  where ride.id=p_ride_id and ride.customer_id=auth.uid() and ride.status in ('accepted','arrived') and ride.fare_approval_status='approved';
  return v_pin;
end;
$$;

revoke all on function public.request_ride(text,text,text,numeric,numeric,numeric,numeric,smallint) from public, anon;
revoke all on function public.request_ride(text,text,text,numeric,numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function public.customer_approve_fare_quote(uuid,boolean) from public, anon;
grant execute on function public.request_ride(text,text,text,numeric,numeric,numeric,numeric,smallint) to authenticated;
grant execute on function public.customer_approve_fare_quote(uuid,boolean) to authenticated;
