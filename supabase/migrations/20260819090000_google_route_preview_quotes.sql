-- A short-lived, server-owned route quote lets the customer see the actual
-- road polyline before booking without calling Google a second time.
create table public.google_route_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  pickup_latitude numeric not null,
  pickup_longitude numeric not null,
  drop_latitude numeric not null,
  drop_longitude numeric not null,
  distance_meters integer not null check (distance_meters between 1 and 250000),
  duration_seconds integer not null check (duration_seconds between 1 and 86400),
  encoded_polyline text not null check (char_length(encoded_polyline) between 1 and 200000),
  routes_call_id uuid references public.google_routes_call_log(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz
);
create index google_route_quotes_customer_lookup_idx on public.google_route_quotes (customer_id, expires_at desc) where consumed_at is null;
alter table public.google_route_quotes enable row level security;

-- An Edge Function may reuse the exact coordinate pair while the quote is
-- valid. Clients have no table or RPC access to create or consume a quote.
create function public.find_google_route_quote(
  p_customer_id uuid, p_pickup_latitude numeric, p_pickup_longitude numeric,
  p_drop_latitude numeric, p_drop_longitude numeric
)
returns public.google_route_quotes language sql security definer set search_path = '' as $$
  select * from public.google_route_quotes
  where customer_id = p_customer_id and consumed_at is null and expires_at > now()
    and pickup_latitude = p_pickup_latitude and pickup_longitude = p_pickup_longitude
    and drop_latitude = p_drop_latitude and drop_longitude = p_drop_longitude
  order by created_at desc limit 1;
$$;

create function public.consume_google_route_quote(
  p_quote_id uuid, p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text, p_passenger_count smallint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_quote public.google_route_quotes; v_ride_id uuid;
begin
  select * into v_quote from public.google_route_quotes
  where id = p_quote_id and customer_id = p_customer_id and consumed_at is null and expires_at > now() for update;
  if not found then raise exception 'Route quote expired. Please refresh the route.'; end if;
  select public.create_routed_ride(p_customer_id, p_ride_type, p_pickup_address, p_drop_address,
    v_quote.pickup_latitude, v_quote.pickup_longitude, v_quote.drop_latitude, v_quote.drop_longitude,
    p_passenger_count, v_quote.distance_meters, v_quote.duration_seconds, v_quote.encoded_polyline) into v_ride_id;
  update public.google_route_quotes set consumed_at = now() where id = v_quote.id;
  update public.google_routes_call_log set ride_id = v_ride_id where id = v_quote.routes_call_id and ride_id is null;
  return v_ride_id;
end;
$$;

revoke all on table public.google_route_quotes from public, anon, authenticated;
revoke all on function public.find_google_route_quote(uuid,numeric,numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function public.consume_google_route_quote(uuid,uuid,text,text,text,smallint) from public, anon, authenticated;
grant execute on function public.find_google_route_quote(uuid,numeric,numeric,numeric,numeric), public.consume_google_route_quote(uuid,uuid,text,text,text,smallint) to service_role;
