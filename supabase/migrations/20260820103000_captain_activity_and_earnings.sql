-- Availability remains the dispatch input; sessions make its history durable.
create table public.captain_online_sessions (
  id uuid primary key default gen_random_uuid(),
  captain_id uuid not null references public.captain_profiles(user_id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('offline', 'accepted_ride', 'system')),
  created_at timestamptz not null default now(),
  constraint captain_online_sessions_end_state check ((ended_at is null and end_reason is null) or (ended_at is not null and end_reason is not null))
);
create unique index captain_one_open_online_session_idx on public.captain_online_sessions(captain_id) where ended_at is null;
create index captain_online_sessions_period_idx on public.captain_online_sessions(captain_id, started_at);

create table public.captain_earnings_ledger (
  id uuid primary key default gen_random_uuid(),
  captain_id uuid not null references public.captain_profiles(user_id) on delete restrict,
  ride_id uuid references public.rides(id) on delete restrict,
  entry_type text not null check (entry_type in ('ride_earning', 'tip', 'bonus', 'adjustment')),
  amount numeric(10,2) not null,
  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  unique (ride_id, entry_type),
  constraint captain_earnings_ledger_note_length check (char_length(coalesce(note, '')) <= 500)
);
comment on table public.captain_earnings_ledger is 'Immutable compensation ledger. Entries are not payment receipt, payout, tip collection, or bonus eligibility proof.';
create index captain_earnings_ledger_month_idx on public.captain_earnings_ledger(captain_id, occurred_at);

alter table public.captain_online_sessions enable row level security;
alter table public.captain_earnings_ledger enable row level security;
revoke all on table public.captain_online_sessions, public.captain_earnings_ledger from anon, authenticated;
grant select, insert, update, delete on table public.captain_online_sessions, public.captain_earnings_ledger to service_role;

create or replace function public.track_captain_availability_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_online and (tg_op = 'INSERT' or not old.is_online) then
    insert into public.captain_online_sessions(captain_id) values (new.captain_id) on conflict (captain_id) where ended_at is null do nothing;
  elsif not new.is_online and old.is_online then
    update public.captain_online_sessions set ended_at = now(), end_reason = 'offline'
      where captain_id = new.captain_id and ended_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists captain_availability_sessions on public.captain_availability;
create trigger captain_availability_sessions after insert or update of is_online on public.captain_availability
for each row execute function public.track_captain_availability_session();

create or replace function public.prevent_captain_ledger_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'Captain earnings ledger is immutable'; end;
$$;
create trigger captain_earnings_ledger_immutable before update or delete on public.captain_earnings_ledger
for each row execute function public.prevent_captain_ledger_mutation();

create or replace function public.captain_set_availability(p_is_online boolean, p_latitude numeric default null, p_longitude numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  if (p_latitude is null) <> (p_longitude is null) or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    if p_latitude is not null or p_longitude is not null then raise exception 'Invalid availability location'; end if;
  end if;
  insert into public.captain_availability(captain_id, is_online, latitude, longitude, updated_at)
  values (auth.uid(), p_is_online, p_latitude, p_longitude, now())
  on conflict (captain_id) do update set is_online = excluded.is_online,
    latitude = coalesce(excluded.latitude, public.captain_availability.latitude),
    longitude = coalesce(excluded.longitude, public.captain_availability.longitude), updated_at = now();
end;
$$;

create or replace function public.captain_monthly_earnings(p_month_start date)
returns table (
  day date, ride_earnings numeric, tips numeric, bonuses numeric, adjustments numeric,
  online_minutes integer, ride_minutes integer, ride_count integer
)
language sql security definer set search_path = '' as $$
  with bounds as (select date_trunc('month', p_month_start)::timestamptz as starts_at, (date_trunc('month', p_month_start) + interval '1 month')::timestamptz as ends_at),
  days as (select generate_series((select starts_at::date from bounds), ((select ends_at from bounds) - interval '1 day')::date, interval '1 day')::date as day),
  ledger as (select occurred_at::date as day, entry_type, amount from public.captain_earnings_ledger, bounds where captain_id = auth.uid() and occurred_at >= starts_at and occurred_at < ends_at),
  rides as (select completed_at::date as day, count(*)::integer as count, sum(greatest(0, extract(epoch from least(completed_at, bounds.ends_at) - greatest(started_at, bounds.starts_at)) / 60))::integer as minutes from public.rides, bounds where captain_id = auth.uid() and status = 'completed' and started_at is not null and completed_at >= bounds.starts_at and completed_at < bounds.ends_at group by completed_at::date),
  sessions as (select greatest(started_at, bounds.starts_at)::date as day, sum(greatest(0, extract(epoch from least(coalesce(ended_at, now()), bounds.ends_at) - greatest(started_at, bounds.starts_at)) / 60))::integer as minutes from public.captain_online_sessions, bounds where captain_id = auth.uid() and started_at < bounds.ends_at and coalesce(ended_at, now()) > bounds.starts_at group by greatest(started_at, bounds.starts_at)::date)
  select days.day, coalesce(sum(ledger.amount) filter (where ledger.entry_type = 'ride_earning'), 0),
    nullif(sum(ledger.amount) filter (where ledger.entry_type = 'tip'), 0), nullif(sum(ledger.amount) filter (where ledger.entry_type = 'bonus'), 0),
    nullif(sum(ledger.amount) filter (where ledger.entry_type = 'adjustment'), 0), coalesce(sessions.minutes, 0), coalesce(rides.minutes, 0), coalesce(rides.count, 0)
  from days left join ledger on ledger.day = days.day left join rides on rides.day = days.day left join sessions on sessions.day = days.day
  group by days.day, sessions.minutes, rides.minutes, rides.count order by days.day;
$$;

create or replace function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_pilot_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status = 'accepted' and v_ride.fare_approval_status <> 'approved' then raise exception 'Customer has not approved the final fare'; end if;
  if v_ride.status = 'accepted' and p_next_status = 'arrived' then
    update public.rides set status = 'arrived', arrived_at = now() where id = p_ride_id returning * into v_ride;
  elsif v_ride.status = 'in_progress' and p_next_status = 'completed' then
    update public.rides set status = 'completed', completed_at = now(), final_fare = coalesce(final_fare, estimated_fare) where id = p_ride_id returning * into v_ride;
    insert into public.captain_earnings_ledger(captain_id, ride_id, entry_type, amount, occurred_at, note)
      values (auth.uid(), v_ride.id, 'ride_earning', coalesce(v_ride.final_fare, v_ride.estimated_fare), v_ride.completed_at, 'Completed ride; not a settlement or payout') on conflict (ride_id, entry_type) do nothing;
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = auth.uid();
  else raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history(ride_id, status, actor_type) values (v_ride.id, v_ride.status, 'captain');
  return v_ride;
end;
$$;

revoke all on function public.track_captain_availability_session(), public.prevent_captain_ledger_mutation() from public, anon, authenticated;
revoke all on function public.captain_set_availability(boolean, numeric, numeric), public.captain_monthly_earnings(date) from public, anon;
grant execute on function public.captain_set_availability(boolean, numeric, numeric), public.captain_monthly_earnings(date) to authenticated;
