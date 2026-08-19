-- Google Maps results are created only by the authenticated Edge Function.
-- The app can read a route only when it is a customer/captain participant.
create table public.ride_route_results (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  route_kind text not null check (route_kind in ('initial_trip', 'captain_to_pickup', 'trip_started_destination')),
  distance_meters integer not null check (distance_meters > 0),
  duration_seconds integer not null check (duration_seconds > 0),
  encoded_polyline text not null check (char_length(encoded_polyline) between 1 and 200000),
  provider text not null default 'google_routes',
  created_at timestamptz not null default now(),
  unique (ride_id, route_kind)
);

create index ride_route_results_ride_id_idx on public.ride_route_results (ride_id, created_at);
alter table public.ride_route_results enable row level security;
grant select on public.ride_route_results to authenticated;
create policy "Ride participants read their route results"
on public.ride_route_results for select to authenticated
using (exists (
  select 1 from public.rides ride
  where ride.id = ride_route_results.ride_id
    and (ride.customer_id = (select auth.uid()) or ride.captain_id = (select auth.uid()))
));

-- Places and Geocoding get an independent, server-enforced daily ceiling.
-- Failed requests remain counted because Google might have received them.
create table public.google_places_call_log (
  id uuid primary key default gen_random_uuid(),
  call_kind text not null check (call_kind in ('autocomplete', 'place_details', 'geocode', 'reverse_geocode')),
  usage_day date not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text not null default 'reserved' check (outcome in ('reserved', 'succeeded', 'failed')),
  http_status integer,
  error_code text check (error_code is null or char_length(error_code) <= 120)
);
create index google_places_call_log_usage_day_idx on public.google_places_call_log (usage_day, requested_at);
alter table public.google_places_call_log enable row level security;

create function public.reserve_google_places_call(p_call_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_usage_day date := (now() at time zone 'Asia/Kolkata')::date; v_call_id uuid;
begin
  if p_call_kind not in ('autocomplete', 'place_details', 'geocode', 'reverse_geocode') then raise exception 'Invalid Google Places call kind'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nandyal-ride-google-places:' || v_usage_day::text, 0));
  if (select count(*) from public.google_places_call_log where usage_day = v_usage_day) >= 100 then
    raise exception using errcode = 'P0001', message = 'GOOGLE_PLACES_DAILY_CAP_REACHED';
  end if;
  insert into public.google_places_call_log (call_kind, usage_day) values (p_call_kind, v_usage_day) returning id into v_call_id;
  return v_call_id;
end;
$$;

create function public.finish_google_places_call(p_call_id uuid, p_succeeded boolean, p_http_status integer default null, p_error_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.google_places_call_log set completed_at = now(), outcome = case when p_succeeded then 'succeeded' else 'failed' end,
    http_status = p_http_status, error_code = case when p_error_code is null then null else left(p_error_code, 120) end
  where id = p_call_id;
  if not found then raise exception 'Unknown Google Places call'; end if;
end;
$$;

-- The Edge Function has authenticated the customer. This RPC is deliberately
-- service-role only, so the road distance cannot be supplied by a handset.
create function public.create_routed_ride(
  p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text,
  p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric,
  p_passenger_count smallint, p_trip_distance_meters integer, p_trip_duration_seconds integer, p_encoded_polyline text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_base_fare numeric(10,2); v_distance_surcharge numeric(10,2);
begin
  if p_customer_id is null then raise exception 'Customer is required'; end if;
  if p_ride_type not in ('bike','auto') then raise exception 'Invalid ride type'; end if;
  if (p_ride_type = 'bike' and p_passenger_count <> 1) or (p_ride_type = 'auto' and p_passenger_count not between 1 and 3) then raise exception 'Invalid passenger count'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 or p_drop_latitude not between -90 and 90 or p_drop_longitude not between -180 and 180 then raise exception 'Valid pickup and drop locations are required'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280 or char_length(trim(p_drop_address)) not between 1 and 280 then raise exception 'Pickup and destination are required'; end if;
  if p_trip_distance_meters not between 1 and 250000 or p_trip_duration_seconds not between 1 and 86400 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  if exists (select 1 from public.rides where customer_id=p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  v_base_fare := case when p_ride_type = 'bike' then 20 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end;
  v_distance_surcharge := ceil(greatest(0, p_trip_distance_meters - 2000) / 100) * 1;
  insert into public.rides (customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, passenger_count, pricing_rule_version, trip_distance_meters, base_fare, distance_surcharge, pickup_surcharge, estimated_fare, fare_approval_status)
  values (p_customer_id, p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, p_passenger_count, 'google-routes-2026-08-18', p_trip_distance_meters, v_base_fare, v_distance_surcharge, 0, v_base_fare + v_distance_surcharge, 'estimated')
  returning id into v_ride_id;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (v_ride_id, 'initial_trip', p_trip_distance_meters, p_trip_duration_seconds, p_encoded_polyline);
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

create function public.apply_captain_road_distance(p_ride_id uuid, p_pickup_distance_meters integer, p_duration_seconds integer, p_encoded_polyline text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_pickup_surcharge numeric(10,2);
begin
  if p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  select * into v_ride from public.rides where id=p_ride_id and status='accepted' for update;
  if not found then raise exception 'Ride is not awaiting captain route'; end if;
  v_pickup_surcharge := case when v_ride.ride_type = 'auto' then ceil(greatest(0, p_pickup_distance_meters - 600) / 100) * 1 else ceil(greatest(0, p_pickup_distance_meters - 800) / 100) * 2 end;
  update public.rides set pickup_distance_meters=p_pickup_distance_meters, pickup_surcharge=v_pickup_surcharge,
    final_fare=estimated_fare + v_pickup_surcharge, fare_approval_status=case when v_pickup_surcharge > 0 then 'pending' else 'approved' end
  where id=p_ride_id returning * into v_ride;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (p_ride_id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update set distance_meters=excluded.distance_meters, duration_seconds=excluded.duration_seconds, encoded_polyline=excluded.encoded_polyline, created_at=now();
  return v_ride;
end;
$$;

revoke all on table public.google_places_call_log from public, anon, authenticated;
revoke all on function public.reserve_google_places_call(text) from public, anon, authenticated;
revoke all on function public.finish_google_places_call(uuid,boolean,integer,text) from public, anon, authenticated;
revoke all on function public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text) from public, anon, authenticated;
revoke all on function public.apply_captain_road_distance(uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.reserve_google_places_call(text), public.finish_google_places_call(uuid,boolean,integer,text), public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text), public.apply_captain_road_distance(uuid,integer,integer,text) to service_role;
