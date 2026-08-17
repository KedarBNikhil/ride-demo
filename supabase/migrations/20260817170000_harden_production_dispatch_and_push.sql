-- Production-pilot boundary: the demo's local OTP adapter uses anonymous
-- Supabase sessions only for demo/onboarding. Anonymous identities must not
-- obtain access to production dispatch, ride data, or push registration.
create or replace function public.is_production_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

create or replace function public.require_production_user()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_production_user() then
    raise exception 'A verified production account is required';
  end if;
end;
$$;

-- Keep the token table inaccessible from the Data API. This ownership policy
-- is defense in depth for its SECURITY DEFINER registration RPC and satisfies
-- RLS policy coverage without granting clients direct table privileges.
create policy "Production users manage only their own push tokens"
on public.push_device_tokens
for all
to authenticated
using (public.is_production_user() and (select auth.uid()) = user_id)
with check (public.is_production_user() and (select auth.uid()) = user_id);

alter policy "Captains manage only their availability" on public.captain_availability
using (public.is_production_user() and (select auth.uid()) = captain_id)
with check (public.is_production_user() and (select auth.uid()) = captain_id);

alter policy "Captains read only their own ride offers" on public.ride_offers
using (public.is_production_user() and (select auth.uid()) = captain_id);

alter policy "Ride participants can read status history" on public.ride_status_history
using (
  public.is_production_user()
  and exists (
    select 1 from public.rides
    where rides.id = ride_status_history.ride_id
      and ((select auth.uid()) = rides.customer_id or (select auth.uid()) = rides.captain_id)
  )
);

alter policy "Captains read rides assigned to them" on public.rides
using (public.is_production_user() and (select auth.uid()) = captain_id);

alter policy "Captains read rides offered to them" on public.rides
using (
  public.is_production_user()
  and exists (
    select 1 from public.ride_offers offer
    where offer.ride_id = rides.id
      and offer.captain_id = (select auth.uid())
      and offer.status = 'offered'
      and offer.expires_at > now()
  )
);

alter policy "Customers can cancel their own active rides" on public.rides
using (
  public.is_production_user()
  and (select auth.uid()) = customer_id
  and status in ('requested', 'searching', 'accepted', 'in_progress')
)
with check (
  public.is_production_user()
  and (select auth.uid()) = customer_id
  and status = 'cancelled'
  and cancellation_reason_code is not null
  and final_fare is null
  and completed_at is null
);

alter policy "Customers can create requested rides" on public.rides
with check (
  public.is_production_user()
  and (select auth.uid()) = customer_id
  and captain_id is null
  and status = 'requested'
  and final_fare is null
  and accepted_at is null
  and completed_at is null
  and cancelled_at is null
);

alter policy "Customers can read their own rides" on public.rides
using (public.is_production_user() and (select auth.uid()) = customer_id);

create or replace function public.register_push_device(p_expo_push_token text, p_platform text, p_app_variant text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_production_user();
  if p_platform <> 'android' or p_app_variant not in ('customer', 'captain') then
    raise exception 'Unsupported push device';
  end if;
  if p_expo_push_token !~ '^Expo(nent)?PushToken\\[[^]]+\\]$' then
    raise exception 'Invalid Expo push token';
  end if;
  if exists (
    select 1 from public.push_device_tokens
    where expo_push_token = p_expo_push_token and user_id <> auth.uid()
  ) then
    raise exception 'This device is registered to another account';
  end if;
  insert into public.push_device_tokens (user_id, expo_push_token, platform, app_variant)
  values (auth.uid(), p_expo_push_token, p_platform, p_app_variant)
  on conflict (expo_push_token) do update set
    platform = excluded.platform,
    app_variant = excluded.app_variant,
    last_seen_at = now()
  where public.push_device_tokens.user_id = auth.uid();
end;
$$;

create or replace function public.captain_open_offer()
returns table (offer_id uuid, ride_id uuid, pickup_address text, drop_address text,
  pickup_latitude numeric, pickup_longitude numeric, drop_latitude numeric, drop_longitude numeric,
  estimated_fare numeric, pickup_distance_meters numeric, pickup_eta_seconds integer, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_production_user();
  return query
  select offer.id, ride.id, ride.pickup_address, ride.drop_address,
    ride.pickup_latitude, ride.pickup_longitude, ride.drop_latitude, ride.drop_longitude,
    ride.estimated_fare, offer.pickup_distance_meters, offer.estimated_pickup_eta_seconds, offer.expires_at
  from public.ride_offers offer join public.rides ride on ride.id = offer.ride_id
  where offer.captain_id = auth.uid() and offer.status = 'offered' and offer.expires_at > now() and ride.status = 'searching'
  order by offer.offered_at limit 1;
end;
$$;

create or replace function public.customer_assigned_captain(p_ride_id uuid)
returns table(full_name text, vehicle_type text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_production_user();
  return query
  select profile.full_name, captain.vehicle_type
  from public.rides ride
  join public.profiles profile on profile.id = ride.captain_id
  join public.captain_profiles captain on captain.user_id = ride.captain_id
  where ride.id = p_ride_id and ride.customer_id = auth.uid() and ride.captain_id is not null;
end;
$$;

create or replace function public.customer_pickup_pin(p_ride_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_pin text;
begin
  perform public.require_production_user();
  select profile.customer_pickup_otp into v_pin
  from public.rides ride join public.profiles profile on profile.id = ride.customer_id
  where ride.id = p_ride_id and ride.customer_id = auth.uid() and ride.status in ('accepted','arrived');
  return v_pin;
end;
$$;

create or replace function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_production_user();
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status = 'accepted' and p_next_status = 'arrived' then
    update public.rides set status = 'arrived', arrived_at = now() where id = p_ride_id returning * into v_ride;
  elsif v_ride.status = 'in_progress' and p_next_status = 'completed' then
    update public.rides set status = 'completed', completed_at = now(), final_fare = estimated_fare where id = p_ride_id returning * into v_ride;
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = auth.uid();
  else
    raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, v_ride.status, 'captain');
  return v_ride;
end;
$$;

create or replace function public.captain_start_ride(p_ride_id uuid, p_pickup_otp text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_production_user();
  if p_pickup_otp !~ '^[0-9]{4}$' then raise exception 'Invalid pickup OTP'; end if;
  select ride.* into v_ride from public.rides ride join public.profiles customer on customer.id=ride.customer_id
  where ride.id=p_ride_id and ride.captain_id=auth.uid() and ride.status='arrived' and customer.customer_pickup_otp=p_pickup_otp for update of ride;
  if not found then raise exception 'Pickup OTP does not match'; end if;
  update public.rides set status='in_progress', started_at=now() where id=p_ride_id returning * into v_ride;
  insert into public.ride_status_history (ride_id,status,actor_type) values (v_ride.id,'in_progress','captain');
  return v_ride;
end;
$$;

create or replace function public.captain_update_ride_location(p_ride_id uuid, p_latitude numeric, p_longitude numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_previous_latitude numeric; v_previous_longitude numeric;
begin
  perform public.require_production_user();
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Invalid location'; end if;
  select captain_latitude,captain_longitude into v_previous_latitude,v_previous_longitude from public.rides where id=p_ride_id and captain_id=auth.uid() and status='in_progress' for update;
  if not found then raise exception 'Active ride not found'; end if;
  update public.rides set captain_latitude=p_latitude,captain_longitude=p_longitude,travelled_distance_km=travelled_distance_km+case when v_previous_latitude is null then 0 else sqrt(power((p_latitude-v_previous_latitude)*111.32,2)+power((p_longitude-v_previous_longitude)*111.32*cos(radians(p_latitude)),2)) end where id=p_ride_id;
end;
$$;

create or replace function public.customer_cancel_ride(p_ride_id uuid, p_reason_code text, p_reason_detail text default null)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_charge numeric(10,2):=0; v_minutes numeric;
begin
  perform public.require_production_user();
  if p_reason_code not in ('change_plans','another_ride','wait_time','fare_concern','captain_unreachable','other') then raise exception 'Invalid cancellation reason'; end if;
  if p_reason_code='other' and char_length(trim(coalesce(p_reason_detail,''))) not between 1 and 180 then raise exception 'Cancellation detail is required'; end if;
  select * into v_ride from public.rides where id=p_ride_id and customer_id=auth.uid() and status in ('requested','searching','accepted','in_progress') for update;
  if not found then raise exception 'Ride can no longer be cancelled'; end if;
  if v_ride.status='in_progress' then v_minutes:=greatest(0,extract(epoch from now()-v_ride.started_at)/60); v_charge:=least(v_ride.estimated_fare,greatest(15::numeric,round(10+coalesce(v_ride.travelled_distance_km,0)*12+v_minutes*1.5,2))); end if;
  update public.rides set status='cancelled',cancellation_reason_code=p_reason_code,cancellation_reason_detail=case when p_reason_code='other' then trim(p_reason_detail) else null end,cancellation_charge=v_charge,final_fare=case when v_charge>0 then v_charge else null end where id=v_ride.id returning * into v_ride;
  update public.ride_offers set status='cancelled',responded_at=null where ride_id=v_ride.id and status in ('offered','accepted');
  return v_ride;
end;
$$;

create or replace function public.customer_confirm_payment(p_ride_id uuid, p_method text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_production_user();
  if p_method not in ('cash','upi') then raise exception 'Invalid payment method'; end if;
  update public.rides set payment_status='paid',payment_method=p_method,paid_at=now() where id=p_ride_id and customer_id=auth.uid() and status='completed' and payment_status='pending' returning * into v_ride;
  if not found then raise exception 'Payment is not available for this ride'; end if;
  return v_ride;
end;
$$;

create or replace function public.customer_rate_captain(p_ride_id uuid, p_rating smallint, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_production_user();
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  update public.rides set customer_rating=p_rating,customer_rating_note=nullif(trim(coalesce(p_note,'')),'') where id=p_ride_id and customer_id=auth.uid() and status='completed' and payment_status='paid' and customer_rating is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end;
$$;

create or replace function public.request_ride(p_ride_type text, p_pickup_address text, p_drop_address text, p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_fare numeric(10,2);
begin
  perform public.require_production_user();
  if p_ride_type not in ('bike','auto') or p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 then raise exception 'Valid pickup location is required'; end if;
  if exists (select 1 from public.rides where customer_id = auth.uid() and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  v_fare := case when p_ride_type = 'bike' then 55 else 75 end;
  insert into public.rides (customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, estimated_fare)
  values (auth.uid(), p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, v_fare) returning id into v_ride_id;
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

create or replace function public.respond_to_ride_offer(p_offer_id uuid, p_accept boolean)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_offer public.ride_offers; v_ride public.rides;
begin
  perform public.require_production_user();
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> auth.uid() or v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'Offer is no longer available'; end if;
  if not p_accept then update public.ride_offers set status='rejected', responded_at=now() where id=v_offer.id; perform public.dispatch_ride_round(v_offer.ride_id); select * into v_ride from public.rides where id=v_offer.ride_id; return v_ride; end if;
  update public.rides set captain_id=auth.uid(), status='accepted', accepted_at=now() where id=v_offer.ride_id and status='searching' and captain_id is null returning * into v_ride;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;
  update public.ride_offers set status='accepted', responded_at=now() where id=v_offer.id;
  update public.ride_offers set status='cancelled', responded_at=null where ride_id=v_offer.ride_id and id<>v_offer.id and status='offered';
  update public.captain_availability set is_online=false, updated_at=now() where captain_id=auth.uid();
  insert into public.ride_status_history (ride_id,status,actor_type) values (v_ride.id,'accepted','captain');
  return v_ride;
end;
$$;

-- Dispatch is database-owned by pg_cron. It must not be triggerable by any
-- mobile client, including an authenticated but otherwise unprivileged user.
revoke all on function public.refresh_captain_dispatch() from public, anon, authenticated;
