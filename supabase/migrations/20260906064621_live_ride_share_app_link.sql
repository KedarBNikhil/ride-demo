create table public.ride_live_share_tokens (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create index ride_live_share_tokens_active_lookup_idx on public.ride_live_share_tokens (token_hash) where revoked_at is null;
alter table public.ride_live_share_tokens enable row level security;
revoke all on public.ride_live_share_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.ride_live_share_tokens to service_role;

create function public.create_live_ride_share_token(p_ride_id uuid)
returns table(token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_token text; v_expires_at timestamptz := now() + interval '8 hours';
begin
  perform public.require_pilot_user('customer');
  if not exists (select 1 from public.rides where id = p_ride_id and customer_id = auth.uid() and status = 'in_progress') then
    raise exception 'Live ride sharing is available only while your ride is in progress';
  end if;
  update public.ride_live_share_tokens set revoked_at = now() where ride_id = p_ride_id and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.ride_live_share_tokens (ride_id, customer_id, token_hash, expires_at)
  values (p_ride_id, auth.uid(), extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), v_expires_at);
  return query select v_token, v_expires_at;
end;
$$;

create function public.public_live_ride_tracking(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'inactive'); end if;
  select ride.* into v_ride from public.ride_live_share_tokens share join public.rides ride on ride.id = share.ride_id
    where share.token_hash = extensions.digest(convert_to(p_token, 'utf8'), 'sha256') and share.revoked_at is null and share.expires_at > now() limit 1;
  if not found then return jsonb_build_object('state', 'inactive'); end if;
  if v_ride.status = 'completed' then return jsonb_build_object('state', 'completed'); end if;
  if v_ride.status = 'cancelled' then return jsonb_build_object('state', 'cancelled'); end if;
  if v_ride.status <> 'in_progress' then return jsonb_build_object('state', 'inactive'); end if;
  return jsonb_build_object('state', 'in_progress', 'pickup_address', v_ride.pickup_address, 'drop_address', v_ride.drop_address, 'location', case when v_ride.captain_latitude is null or v_ride.captain_longitude is null then null else jsonb_build_object('latitude', v_ride.captain_latitude, 'longitude', v_ride.captain_longitude) end, 'last_updated_at', v_ride.updated_at);
end;
$$;

revoke all on function public.create_live_ride_share_token(uuid) from public, anon;
grant execute on function public.create_live_ride_share_token(uuid) to authenticated;
revoke all on function public.public_live_ride_tracking(text) from public, authenticated;
grant execute on function public.public_live_ride_tracking(text) to anon;
