-- A hard, server-owned stop for billable Google Routes calls. Every attempt is
-- counted before the external request because an upstream timeout/error can
-- still have reached Google and potentially be billable.
create table public.google_routes_call_log (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references public.rides(id) on delete set null,
  route_kind text not null check (route_kind in ('initial_trip', 'captain_to_pickup', 'trip_started_destination', 'manual_refresh')),
  usage_day date not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text not null default 'reserved' check (outcome in ('reserved', 'succeeded', 'failed')),
  http_status integer,
  error_code text check (error_code is null or char_length(error_code) <= 120)
);

create index google_routes_call_log_usage_day_idx
  on public.google_routes_call_log (usage_day, requested_at);

alter table public.google_routes_call_log enable row level security;

-- Only a trusted Edge Function using the service-role key can call these
-- functions. Mobile clients have no table/RPC access to the ledger.
create function public.reserve_google_routes_call(
  p_ride_id uuid,
  p_route_kind text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_call_id uuid;
begin
  if p_route_kind not in ('initial_trip', 'captain_to_pickup', 'trip_started_destination', 'manual_refresh') then
    raise exception 'Invalid route kind';
  end if;

  -- Serialise just this day’s allocation. Without this, concurrent Edge
  -- Function invocations could both observe call 100 and issue call 101.
  perform pg_advisory_xact_lock(hashtextextended('nandyal-ride-google-routes:' || v_usage_day::text, 0));

  if (select count(*) from public.google_routes_call_log where usage_day = v_usage_day) >= 100 then
    raise exception using errcode = 'P0001', message = 'GOOGLE_ROUTES_DAILY_CAP_REACHED';
  end if;

  insert into public.google_routes_call_log (ride_id, route_kind, usage_day)
  values (p_ride_id, p_route_kind, v_usage_day)
  returning id into v_call_id;

  return v_call_id;
end;
$$;

create function public.finish_google_routes_call(
  p_call_id uuid,
  p_succeeded boolean,
  p_http_status integer default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.google_routes_call_log
  set completed_at = now(),
      outcome = case when p_succeeded then 'succeeded' else 'failed' end,
      http_status = p_http_status,
      error_code = case when p_error_code is null then null else left(p_error_code, 120) end
  where id = p_call_id;

  if not found then raise exception 'Unknown Google Routes call'; end if;
end;
$$;

revoke all on table public.google_routes_call_log from public, anon, authenticated;
revoke all on function public.reserve_google_routes_call(uuid, text) from public, anon, authenticated;
revoke all on function public.finish_google_routes_call(uuid, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_google_routes_call(uuid, text) to service_role;
grant execute on function public.finish_google_routes_call(uuid, boolean, integer, text) to service_role;
