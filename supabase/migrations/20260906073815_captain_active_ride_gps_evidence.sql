-- Active-ride GPS is narrowly scoped to the in-progress leg.  The sample
-- table is deliberately private to clients: Captains submit through the
-- guarded RPC and operators receive evidence through operator-only RPCs.

create table public.ride_location_samples (
  id uuid primary key default extensions.gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete restrict,
  captain_id uuid not null references public.captain_profiles(user_id) on delete restrict,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters >= 0 and accuracy_meters <= 50000),
  speed_mps double precision check (speed_mps is null or speed_mps between 0 and 150),
  heading_degrees double precision check (heading_degrees is null or heading_degrees between 0 and 360),
  altitude_meters double precision,
  mocked_location boolean,
  device_recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  tracking_session_id uuid not null,
  sequence_number bigint not null check (sequence_number >= 0),
  unique (tracking_session_id, sequence_number)
);

create index ride_location_samples_ride_recorded_idx on public.ride_location_samples (ride_id, device_recorded_at);
create index ride_location_samples_captain_recorded_idx on public.ride_location_samples (captain_id, device_recorded_at);

alter table public.ride_location_samples enable row level security;
revoke all on table public.ride_location_samples from public, anon, authenticated;
grant select, insert, update, delete on table public.ride_location_samples to service_role;

-- Thresholds are intentionally centralized. They are review signals, never
-- a basis for automatically deleting a completed ride or banning a Captain.
create or replace function private.ride_gps_evidence_metrics(p_ride_id uuid)
returns table (
  expected_samples integer,
  sample_count integer,
  first_sample_at timestamptz,
  last_sample_at timestamptz,
  coverage_percent numeric,
  largest_gap_seconds integer,
  tracked_distance_meters numeric,
  start_to_end_displacement_meters numeric,
  low_accuracy_sample_count integer,
  suspicious_jump_count integer,
  mocked_location_count integer,
  tracking_interrupted boolean,
  tracking_status text,
  tracking_reasons text[]
)
language sql
stable
set search_path = ''
as $$
  with constants as (
    select 45::numeric as target_seconds, 100::numeric as low_accuracy_meters,
      300::numeric as max_gap_seconds, 55::numeric as max_speed_mps,
      0.35::numeric as suspicious_coverage, 0.75::numeric as incomplete_coverage,
      180::numeric as meaningful_duration_seconds, 500::numeric as meaningful_trip_meters,
      100::numeric as minimal_movement_meters
  ), ride as (
    select id, started_at, completed_at, trip_distance_meters
    from public.rides where id = p_ride_id
  ), ordered as (
    select s.*, lag(s.latitude) over w as previous_latitude,
      lag(s.longitude) over w as previous_longitude,
      lag(s.device_recorded_at) over w as previous_at
    from public.ride_location_samples s
    where s.ride_id = p_ride_id
    window w as (order by s.device_recorded_at, s.received_at, s.id)
  ), segments as (
    select o.*, case when previous_at is null then null else extract(epoch from device_recorded_at - previous_at) end as gap_seconds,
      case when previous_at is null then 0 else extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(previous_longitude, previous_latitude), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
      ) end as segment_meters
    from ordered o
  ), summary as (
    select count(*)::integer as sample_count, min(device_recorded_at) as first_sample_at, max(device_recorded_at) as last_sample_at,
      coalesce(sum(segment_meters), 0)::numeric as tracked_distance_meters,
      coalesce(max(gap_seconds), 0)::numeric as interior_max_gap_seconds,
      count(*) filter (where accuracy_meters > (select low_accuracy_meters from constants))::integer as low_accuracy_sample_count,
      count(*) filter (where mocked_location is true)::integer as mocked_location_count,
      count(*) filter (where gap_seconds > 0 and segment_meters / gap_seconds > (select max_speed_mps from constants))::integer as suspicious_jump_count,
      (array_agg(latitude order by device_recorded_at, received_at, id))[1] as first_latitude,
      (array_agg(longitude order by device_recorded_at, received_at, id))[1] as first_longitude,
      (array_agg(latitude order by device_recorded_at desc, received_at desc, id desc))[1] as last_latitude,
      (array_agg(longitude order by device_recorded_at desc, received_at desc, id desc))[1] as last_longitude
    from segments
  ), calculated as (
    select r.*, s.*, c.*, greatest(1, ceil(greatest(0, extract(epoch from r.completed_at - r.started_at)) / c.target_seconds)::integer) as expected_samples,
      case when s.sample_count = 0 then extract(epoch from r.completed_at - r.started_at)
        else greatest(s.interior_max_gap_seconds, extract(epoch from s.first_sample_at - r.started_at), extract(epoch from r.completed_at - s.last_sample_at)) end as largest_gap_seconds,
      case when s.sample_count < 2 then 0 else extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(s.first_longitude, s.first_latitude), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(s.last_longitude, s.last_latitude), 4326)::extensions.geography
      ) end as start_to_end_displacement_meters
    from ride r cross join summary s cross join constants c
  ), evidence as (
    select *, round(100 * sample_count::numeric / expected_samples, 1) as coverage_percent,
      (sample_count = 0 and extract(epoch from completed_at - started_at) >= meaningful_duration_seconds)
        or sample_count::numeric / expected_samples < suspicious_coverage
        or largest_gap_seconds > max_gap_seconds
        or suspicious_jump_count > 0 or mocked_location_count > 0
        or (coalesce(trip_distance_meters, 0) >= meaningful_trip_meters and tracked_distance_meters < minimal_movement_meters) as suspicious,
      sample_count::numeric / expected_samples < incomplete_coverage
        or low_accuracy_sample_count > greatest(2, sample_count / 2) as incomplete
    from calculated
  )
  select expected_samples, sample_count, first_sample_at, last_sample_at, coverage_percent,
    ceil(largest_gap_seconds)::integer, tracked_distance_meters, start_to_end_displacement_meters,
    low_accuracy_sample_count, suspicious_jump_count, mocked_location_count,
    suspicious or incomplete,
    case when suspicious then 'suspicious' when incomplete then 'incomplete' else 'healthy' end,
    array_remove(array[
      case when sample_count = 0 and extract(epoch from completed_at - started_at) >= meaningful_duration_seconds then 'No GPS samples were received during a meaningful active ride.' end,
      case when sample_count > 0 and sample_count::numeric / expected_samples < suspicious_coverage then format('Only %s of about %s expected GPS observations were received.', sample_count, expected_samples) end,
      case when largest_gap_seconds > max_gap_seconds then format('Largest tracking gap: %s.', make_interval(secs => ceil(largest_gap_seconds)::integer)) end,
      case when suspicious_jump_count > 0 then 'Detected implausible movement between samples.' end,
      case when mocked_location_count > 0 then 'Device reported mocked-location observations.' end,
      case when coalesce(trip_distance_meters, 0) >= meaningful_trip_meters and tracked_distance_meters < minimal_movement_meters then 'GPS trail shows essentially no movement for the reported trip distance.' end,
      case when not suspicious and incomplete then format('Only %s of about %s expected GPS observations were received.', sample_count, expected_samples) end,
      case when not suspicious and low_accuracy_sample_count > greatest(2, sample_count / 2) then 'Most GPS observations had low accuracy.' end
    ], null)
  from evidence;
$$;

create or replace function public.record_active_ride_location(
  p_ride_id uuid, p_tracking_session_id uuid, p_sequence_number bigint,
  p_device_recorded_at timestamptz, p_latitude double precision, p_longitude double precision,
  p_accuracy_meters double precision, p_speed_mps double precision default null,
  p_heading_degrees double precision default null, p_altitude_meters double precision default null,
  p_mocked_location boolean default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_ride public.rides; v_insert_count integer := 0;
begin
  perform public.require_pilot_user('captain');
  if p_ride_id is null or p_tracking_session_id is null or p_sequence_number is null
    or p_latitude is null or p_longitude is null or p_accuracy_meters is null or p_device_recorded_at is null then
    raise exception 'GPS sample is incomplete';
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or p_accuracy_meters not between 0 and 50000 or p_speed_mps is not null and p_speed_mps not between 0 and 150
    or p_heading_degrees is not null and p_heading_degrees not between 0 and 360
    or p_sequence_number < 0 then raise exception 'GPS sample is invalid'; end if;
  if p_device_recorded_at < now() - interval '36 hours' or p_device_recorded_at > now() + interval '5 minutes' then
    raise exception 'GPS sample timestamp is outside the allowed window';
  end if;
  select * into v_ride from public.rides
  where id = p_ride_id and captain_id = auth.uid() and status = 'in_progress' for update;
  if not found then raise exception 'Started ride not found'; end if;
  insert into public.ride_location_samples(ride_id, captain_id, latitude, longitude, accuracy_meters, speed_mps, heading_degrees, altitude_meters, mocked_location, device_recorded_at, tracking_session_id, sequence_number)
  values (v_ride.id, auth.uid(), p_latitude, p_longitude, p_accuracy_meters, p_speed_mps, p_heading_degrees, p_altitude_meters, p_mocked_location, p_device_recorded_at, p_tracking_session_id, p_sequence_number)
  on conflict (tracking_session_id, sequence_number) do nothing;
  get diagnostics v_insert_count = row_count;
  if v_insert_count > 0 then
    update public.rides set captain_latitude = p_latitude, captain_longitude = p_longitude,
      travelled_distance_km = travelled_distance_km + case when captain_latitude is null then 0 else extensions.st_distance(
        extensions.st_setsrid(extensions.st_makepoint(captain_longitude, captain_latitude), 4326)::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography
      ) / 1000 end, updated_at = now() where id = v_ride.id;
  end if;
  return v_insert_count > 0;
end;
$$;

create or replace function public.operator_ride_gps_evidence(p_ride_id uuid)
returns table (
  expected_samples integer, sample_count integer, first_sample_at timestamptz, last_sample_at timestamptz,
  coverage_percent numeric, largest_gap_seconds integer, tracked_distance_meters numeric,
  start_to_end_displacement_meters numeric, low_accuracy_sample_count integer, suspicious_jump_count integer,
  mocked_location_count integer, tracking_interrupted boolean, tracking_status text, tracking_reasons text[],
  samples jsonb
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  return query select m.*, coalesce((select jsonb_agg(jsonb_build_object('latitude', s.latitude, 'longitude', s.longitude, 'accuracy_meters', s.accuracy_meters, 'speed_mps', s.speed_mps, 'heading_degrees', s.heading_degrees, 'device_recorded_at', s.device_recorded_at, 'mocked_location', s.mocked_location) order by s.device_recorded_at, s.received_at)
    from public.ride_location_samples s where s.ride_id = p_ride_id), '[]'::jsonb)
  from private.ride_gps_evidence_metrics(p_ride_id) m;
end;
$$;

drop function if exists public.operator_captain_ride_verification_queue(text);
create function public.operator_captain_ride_verification_queue(p_status text default 'PENDING')
returns table (compensation_id uuid, ride_id uuid, captain_id uuid, customer_name text, captain_name text, pickup_address text, drop_address text, normal_ride_fare numeric, customer_charge_amount numeric, customer_charge_type text, total_company_payable numeric, trip_distance_meters numeric, travelled_distance_km numeric, started_at timestamptz, completed_at timestamptz, pickup_otp_verified_at timestamptz, payment_status text, payment_method text, verification_status text, rejection_reason text, gps_tracking_status text, gps_tracking_reasons text[], gps_sample_count integer, gps_expected_samples integer, gps_coverage_percent numeric, gps_largest_gap_seconds integer, gps_tracked_distance_meters numeric)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status is not null and p_status not in ('PENDING', 'APPROVED', 'REJECTED') then raise exception 'Invalid verification status'; end if;
  return query select c.id, r.id, c.captain_id, customer.full_name, captain.full_name, r.pickup_address, r.drop_address,
    c.normal_ride_fare, r.customer_charge_amount, r.customer_charge_type, c.total_company_payable, r.trip_distance_meters, r.travelled_distance_km, r.started_at, r.completed_at, r.pickup_otp_verified_at, r.payment_status, r.payment_method, v.status, v.rejection_reason,
    m.tracking_status, m.tracking_reasons, m.sample_count, m.expected_samples, m.coverage_percent, m.largest_gap_seconds, m.tracked_distance_meters
  from public.captain_compensations c join public.rides r on r.id = c.ride_id join public.captain_ride_verifications v on v.compensation_id = c.id
    cross join lateral private.ride_gps_evidence_metrics(r.id) m
    left join public.profiles customer on customer.id = r.customer_id left join public.profiles captain on captain.id = c.captain_id
  where r.customer_charge_type = 'free' and c.total_company_payable > 0 and (p_status is null or v.status = p_status)
  order by case m.tracking_status when 'suspicious' then 0 when 'incomplete' then 1 else 2 end, r.completed_at asc;
end;
$$;

revoke all on function public.record_active_ride_location(uuid,uuid,bigint,timestamptz,double precision,double precision,double precision,double precision,double precision,double precision,boolean), public.operator_ride_gps_evidence(uuid) from public, anon;
grant execute on function public.record_active_ride_location(uuid,uuid,bigint,timestamptz,double precision,double precision,double precision,double precision,double precision,double precision,boolean), public.operator_ride_gps_evidence(uuid) to authenticated;
revoke all on function public.operator_captain_ride_verification_queue(text) from public, anon;
grant execute on function public.operator_captain_ride_verification_queue(text) to authenticated;
