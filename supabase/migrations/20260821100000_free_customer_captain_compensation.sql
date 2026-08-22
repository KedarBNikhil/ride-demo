-- Pilot promotion policy: customer pricing is owned by the database, never by
-- a handset. The existing fare engine remains the captain compensation basis.
create table public.ride_pricing_settings (
  singleton boolean primary key default true check (singleton),
  free_customer_rides_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.ride_pricing_settings (singleton) values (true) on conflict (singleton) do nothing;
alter table public.ride_pricing_settings enable row level security;
revoke all on table public.ride_pricing_settings from public, anon, authenticated;

alter table public.rides
  add column if not exists customer_charge_amount numeric(10,2),
  add column if not exists customer_charge_type text,
  add column if not exists customer_charge_status text;

update public.rides
set customer_charge_amount = coalesce(customer_charge_amount, coalesce(final_fare, estimated_fare)),
    customer_charge_type = coalesce(customer_charge_type, 'standard'),
    customer_charge_status = coalesce(customer_charge_status, 'pending')
where customer_charge_amount is null or customer_charge_type is null or customer_charge_status is null;

alter table public.rides
  alter column customer_charge_amount set not null,
  alter column customer_charge_type set not null,
  alter column customer_charge_status set not null;
alter table public.rides drop constraint if exists rides_customer_charge_amount_check;
alter table public.rides drop constraint if exists rides_customer_charge_type_check;
alter table public.rides drop constraint if exists rides_customer_charge_status_check;
alter table public.rides drop constraint if exists rides_payment_status_check;
alter table public.rides drop constraint if exists declared_ride_has_method;
alter table public.rides add constraint rides_customer_charge_amount_check check (customer_charge_amount >= 0);
alter table public.rides add constraint rides_customer_charge_type_check check (customer_charge_type in ('free', 'standard'));
alter table public.rides add constraint rides_customer_charge_status_check check (customer_charge_status in ('pending', 'not_required', 'declared'));
alter table public.rides add constraint rides_payment_status_check check (payment_status in ('pending', 'declared', 'not_required'));
alter table public.rides add constraint rides_customer_charge_payment_consistency check (
  (customer_charge_type = 'free' and customer_charge_amount = 0 and customer_charge_status = 'not_required' and payment_status = 'not_required' and payment_method is null)
  or (customer_charge_type = 'standard' and customer_charge_amount >= 0 and customer_charge_status in ('pending', 'declared') and payment_status in ('pending', 'declared')
      and ((payment_status = 'pending' and payment_method is null) or (payment_status = 'declared' and payment_method in ('cash', 'upi'))))
);
comment on column public.rides.customer_charge_amount is 'Customer-facing charge. It is distinct from the approved captain fare.';
comment on column public.rides.customer_charge_type is 'Database-owned customer pricing policy; free means no customer payment is required.';
comment on column public.rides.customer_charge_status is 'Customer charge lifecycle, not a proof of money received.';

create or replace function public.apply_ride_customer_pricing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_free boolean;
begin
  select free_customer_rides_enabled into v_free from public.ride_pricing_settings where singleton;
  if coalesce(v_free, false) then
    new.customer_charge_amount := 0; new.customer_charge_type := 'free'; new.customer_charge_status := 'not_required';
    new.payment_status := 'not_required'; new.payment_method := null; new.paid_at := null;
  else
    new.customer_charge_amount := coalesce(new.final_fare, new.estimated_fare, 0); new.customer_charge_type := 'standard'; new.customer_charge_status := 'pending';
    new.payment_status := 'pending'; new.payment_method := null; new.paid_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists rides_apply_customer_pricing on public.rides;
create trigger rides_apply_customer_pricing before insert on public.rides for each row execute function public.apply_ride_customer_pricing();

-- Replaces the service-role-only route creation function. It deliberately
-- derives the customer charge from server settings and preserves calculated fare.
create or replace function public.create_routed_ride(
  p_customer_id uuid, p_ride_type text, p_pickup_address text, p_drop_address text,
  p_pickup_latitude numeric, p_pickup_longitude numeric, p_drop_latitude numeric, p_drop_longitude numeric,
  p_passenger_count smallint, p_trip_distance_meters integer, p_trip_duration_seconds integer, p_encoded_polyline text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_base_fare numeric(10,2); v_distance_surcharge numeric(10,2); v_free boolean;
begin
  if p_customer_id is null then raise exception 'Customer is required'; end if;
  if p_ride_type not in ('bike','auto') then raise exception 'Invalid ride type'; end if;
  if (p_ride_type = 'bike' and p_passenger_count <> 1) or (p_ride_type = 'auto' and p_passenger_count not between 1 and 3) then raise exception 'Invalid passenger count'; end if;
  if p_pickup_latitude not between -90 and 90 or p_pickup_longitude not between -180 and 180 or p_drop_latitude not between -90 and 90 or p_drop_longitude not between -180 and 180 then raise exception 'Valid pickup and drop locations are required'; end if;
  if char_length(trim(p_pickup_address)) not between 1 and 280 or char_length(trim(p_drop_address)) not between 1 and 280 then raise exception 'Pickup and destination are required'; end if;
  if p_trip_distance_meters not between 1 and 250000 or p_trip_duration_seconds not between 1 and 86400 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  if exists (select 1 from public.rides where customer_id = p_customer_id and status in ('requested','searching','accepted','arrived','in_progress')) then raise exception 'An active ride already exists'; end if;
  select free_customer_rides_enabled into v_free from public.ride_pricing_settings where singleton;
  v_free := coalesce(v_free, false);
  v_base_fare := case when p_ride_type = 'bike' then 20 else round((25 * power(1.5::numeric, p_passenger_count - 1))::numeric, 2) end;
  v_distance_surcharge := ceil(greatest(0, p_trip_distance_meters - 2000) / 100) * 1;
  insert into public.rides (customer_id, ride_type, status, pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, passenger_count, pricing_rule_version, trip_distance_meters, base_fare, distance_surcharge, pickup_surcharge, estimated_fare, fare_approval_status, customer_charge_amount, customer_charge_type, customer_charge_status, payment_status, payment_method)
  values (p_customer_id, p_ride_type, 'searching', trim(p_pickup_address), trim(p_drop_address), p_pickup_latitude, p_pickup_longitude, p_drop_latitude, p_drop_longitude, p_passenger_count, 'google-routes-2026-08-18', p_trip_distance_meters, v_base_fare, v_distance_surcharge, 0, v_base_fare + v_distance_surcharge, 'estimated', case when v_free then 0 else v_base_fare + v_distance_surcharge end, case when v_free then 'free' else 'standard' end, case when v_free then 'not_required' else 'pending' end, case when v_free then 'not_required' else 'pending' end, null)
  returning id into v_ride_id;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline) values (v_ride_id, 'initial_trip', p_trip_distance_meters, p_trip_duration_seconds, p_encoded_polyline);
  perform public.dispatch_ride_round(v_ride_id);
  return v_ride_id;
end;
$$;

create table public.captain_compensations (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(id) on delete restrict,
  captain_id uuid not null references public.captain_profiles(user_id) on delete restrict,
  customer_charge_amount numeric(10,2) not null check (customer_charge_amount >= 0),
  captain_earning_amount numeric(10,2) not null check (captain_earning_amount >= 0),
  earning_status text not null default 'earned' check (earning_status in ('earned', 'held')),
  created_at timestamptz not null default now(),
  verified_at timestamptz not null default now()
);
comment on table public.captain_compensations is 'Immutable completed-ride earning facts. Payout and dispute state are stored separately.';
create table public.captain_payouts (
  id uuid primary key default gen_random_uuid(),
  compensation_id uuid not null unique references public.captain_compensations(id) on delete restrict,
  status text not null default 'not_started' check (status in ('not_started','initiated','processing','paid','failed','reversed','held')),
  provider text, provider_reference text, initiated_at timestamptz, paid_at timestamptz,
  updated_by uuid references public.profiles(id) on delete restrict, updated_at timestamptz not null default now(),
  check ((status <> 'paid') or paid_at is not null)
);
create table public.captain_payout_disputes (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.captain_payouts(id) on delete restrict,
  status text not null default 'open' check (status in ('open','under_review','resolved','rejected')),
  reason text not null check (char_length(trim(reason)) between 1 and 500), operator_note text,
  opened_by uuid not null references public.profiles(id) on delete restrict, opened_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete restrict, resolved_at timestamptz
);
create table public.captain_payout_events (
  id uuid primary key default gen_random_uuid(), payout_id uuid not null references public.captain_payouts(id) on delete restrict,
  event_type text not null, actor_id uuid references public.profiles(id) on delete restrict, note text,
  metadata jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);
create index captain_compensations_captain_verified_idx on public.captain_compensations(captain_id, verified_at desc);
create index captain_payout_disputes_open_idx on public.captain_payout_disputes(payout_id) where status in ('open', 'under_review');
create unique index captain_payout_events_one_compensation_created_idx on public.captain_payout_events(payout_id)
  where event_type = 'compensation_created';
alter table public.captain_compensations enable row level security;
alter table public.captain_payouts enable row level security;
alter table public.captain_payout_disputes enable row level security;
alter table public.captain_payout_events enable row level security;
revoke all on table public.captain_compensations, public.captain_payouts, public.captain_payout_disputes, public.captain_payout_events from public, anon, authenticated;
grant select, insert, update, delete on table public.captain_compensations, public.captain_payouts, public.captain_payout_disputes, public.captain_payout_events to service_role;

create or replace function public.prevent_captain_compensation_mutation() returns trigger language plpgsql security definer set search_path = '' as $$ begin raise exception 'Captain compensation is immutable'; end; $$;
create trigger captain_compensations_immutable before update or delete on public.captain_compensations for each row execute function public.prevent_captain_compensation_mutation();

create or replace function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_compensation_id uuid; v_payout_id uuid;
begin
  perform public.require_pilot_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status = 'completed' and p_next_status = 'completed' then return v_ride; end if;
  if v_ride.status = 'accepted' and v_ride.customer_charge_type <> 'free' and v_ride.fare_approval_status <> 'approved' then raise exception 'Customer has not approved the final fare'; end if;
  if v_ride.status = 'accepted' and p_next_status = 'arrived' then
    update public.rides set status = 'arrived', arrived_at = now() where id = p_ride_id returning * into v_ride;
  elsif v_ride.status = 'in_progress' and p_next_status = 'completed' then
    update public.rides set status = 'completed', completed_at = now(), final_fare = coalesce(final_fare, estimated_fare) where id = p_ride_id returning * into v_ride;
    insert into public.captain_earnings_ledger(captain_id, ride_id, entry_type, amount, occurred_at, note) values (auth.uid(), v_ride.id, 'ride_earning', coalesce(v_ride.final_fare, v_ride.estimated_fare), v_ride.completed_at, 'Completed ride; not a settlement or payout') on conflict (ride_id, entry_type) do nothing;
    insert into public.captain_compensations(ride_id, captain_id, customer_charge_amount, captain_earning_amount, earning_status, verified_at)
      values (v_ride.id, auth.uid(), v_ride.customer_charge_amount, coalesce(v_ride.final_fare, v_ride.estimated_fare), 'earned', v_ride.completed_at)
      on conflict (ride_id) do nothing returning id into v_compensation_id;
    if v_compensation_id is null then select id into v_compensation_id from public.captain_compensations where ride_id = v_ride.id; end if;
    insert into public.captain_payouts(compensation_id) values (v_compensation_id)
      on conflict (compensation_id) do nothing returning id into v_payout_id;
    if v_payout_id is null then select id into v_payout_id from public.captain_payouts where compensation_id = v_compensation_id; end if;
    insert into public.captain_payout_events(payout_id, event_type, actor_id, note)
      values (v_payout_id, 'compensation_created', auth.uid(), 'Completed ride compensation created') on conflict do nothing;
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = auth.uid();
  else raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history(ride_id, status, actor_type) values (v_ride.id, v_ride.status, 'captain');
  return v_ride;
end;
$$;

create or replace function public.customer_confirm_payment(p_ride_id uuid, p_method text) returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_settlement_id uuid;
begin
  perform public.require_production_user('customer');
  if p_method not in ('cash', 'upi') then raise exception 'Invalid payment method'; end if;
  update public.rides set payment_status = 'declared', customer_charge_status = 'declared', payment_method = p_method, paid_at = null
    where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and customer_charge_type = 'standard' and payment_status = 'pending' returning * into v_ride;
  if not found then raise exception 'Payment method is not available for this ride'; end if;
  insert into public.ride_settlements (ride_id, declared_method, amount_due, declared_by) values (v_ride.id, p_method, v_ride.customer_charge_amount, auth.uid()) returning id into v_settlement_id;
  insert into public.ride_settlement_events (settlement_id, event_type, actor_id, metadata) values (v_settlement_id, 'declared', auth.uid(), jsonb_build_object('declared_method', p_method));
  return v_ride;
end; $$;

-- Keep the future paid path aligned with the same backend-calculated final fare.
create or replace function public.apply_captain_road_distance(p_ride_id uuid, p_pickup_distance_meters integer, p_duration_seconds integer, p_encoded_polyline text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_pickup_surcharge numeric(10,2);
begin
  if p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000 then raise exception 'Invalid Google route'; end if;
  select * into v_ride from public.rides where id = p_ride_id and status = 'accepted' for update;
  if not found then raise exception 'Ride is not awaiting captain route'; end if;
  v_pickup_surcharge := case when v_ride.ride_type = 'auto' then ceil(greatest(0, p_pickup_distance_meters - 600) / 100) * 1 else ceil(greatest(0, p_pickup_distance_meters - 800) / 100) * 2 end;
  update public.rides set pickup_distance_meters = p_pickup_distance_meters, pickup_surcharge = v_pickup_surcharge,
    final_fare = estimated_fare + v_pickup_surcharge, customer_charge_amount = case when customer_charge_type = 'free' then 0 else estimated_fare + v_pickup_surcharge end,
    fare_approval_status = case when customer_charge_type = 'free' then 'approved' when v_pickup_surcharge > 0 then 'pending' else 'approved' end where id = p_ride_id returning * into v_ride;
  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline) values (p_ride_id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
    on conflict (ride_id, route_kind) do update set distance_meters = excluded.distance_meters, duration_seconds = excluded.duration_seconds, encoded_polyline = excluded.encoded_polyline, created_at = now();
  return v_ride;
end; $$;

create or replace function public.customer_rate_captain(p_ride_id uuid, p_rating smallint, p_note text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_production_user('customer');
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  update public.rides set customer_rating = p_rating, customer_rating_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and payment_status in ('declared', 'not_required') and customer_rating is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end; $$;

create or replace function public.captain_compensation_monthly(p_month_start date)
returns table (day date, ride_earnings numeric, ride_count integer, held_earnings numeric, payout_status text)
language sql security definer set search_path = '' as $$
  with bounds as (select date_trunc('month', p_month_start)::timestamptz starts_at, (date_trunc('month', p_month_start) + interval '1 month')::timestamptz ends_at),
  days as (select generate_series((select starts_at::date from bounds), ((select ends_at from bounds) - interval '1 day')::date, interval '1 day')::date as ride_day),
  c as (select compensation.verified_at::date as ride_day, compensation.captain_earning_amount, payout.status from public.captain_compensations compensation join public.captain_payouts payout on payout.compensation_id = compensation.id, bounds where compensation.captain_id = auth.uid() and compensation.verified_at >= starts_at and compensation.verified_at < ends_at)
  select days.ride_day, coalesce(sum(c.captain_earning_amount), 0), count(c.captain_earning_amount)::integer, coalesce(sum(c.captain_earning_amount) filter (where c.status = 'held'), 0), coalesce((array_agg(c.status order by c.status))[1], 'not_started') from days left join c on c.ride_day = days.ride_day group by days.ride_day order by days.ride_day;
$$;
create or replace function public.captain_ride_payout(p_ride_id uuid)
returns table (captain_earning_amount numeric, payout_status text, is_held boolean)
language sql security definer set search_path = '' as $$ select compensation.captain_earning_amount, payout.status, payout.status = 'held' from public.captain_compensations compensation join public.captain_payouts payout on payout.compensation_id = compensation.id where compensation.ride_id = p_ride_id and compensation.captain_id = auth.uid(); $$;

create or replace function public.operator_update_captain_payout(p_payout_id uuid, p_status text, p_note text, p_provider text default null, p_provider_reference text default null)
returns public.captain_payouts language plpgsql security definer set search_path = '' as $$
declare v_payout public.captain_payouts;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status not in ('not_started','initiated','processing','paid','failed','reversed','held') then raise exception 'Invalid payout status'; end if;
  if char_length(trim(coalesce(p_note, ''))) not between 1 and 500 then raise exception 'An operator note between 1 and 500 characters is required'; end if;
  if p_status = 'paid' and char_length(trim(coalesce(p_provider_reference, ''))) not between 1 and 500 then
    raise exception 'A provider reference or manual-payout reference is required before marking a payout paid';
  end if;
  select * into v_payout from public.captain_payouts where id = p_payout_id for update;
  if not found then raise exception 'Payout not found'; end if;
  if v_payout.status = 'held' and p_status = 'paid' then raise exception 'Resolve the hold before marking a payout paid'; end if;
  if exists (select 1 from public.captain_payout_disputes where payout_id = p_payout_id and status in ('open','under_review')) and p_status = 'paid' then raise exception 'An open dispute blocks payout'; end if;
  update public.captain_payouts set status = p_status, provider = coalesce(nullif(trim(p_provider), ''), case when p_status = 'paid' then 'manual' else provider end), provider_reference = coalesce(nullif(trim(p_provider_reference), ''), provider_reference), initiated_at = case when p_status in ('initiated','processing') then coalesce(initiated_at, now()) else initiated_at end, paid_at = case when p_status = 'paid' then now() else paid_at end, updated_by = auth.uid(), updated_at = now() where id = p_payout_id returning * into v_payout;
  insert into public.captain_payout_events(payout_id, event_type, actor_id, note, metadata) values (v_payout.id, 'status_changed', auth.uid(), trim(p_note), jsonb_build_object('status', p_status, 'provider', v_payout.provider, 'provider_reference', v_payout.provider_reference));
  return v_payout;
end; $$;
create or replace function public.operator_hold_captain_payout(p_payout_id uuid, p_reason text, p_note text)
returns public.captain_payout_disputes language plpgsql security definer set search_path = '' as $$
declare v_dispute public.captain_payout_disputes;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 1 and 500 or char_length(trim(coalesce(p_note, ''))) not between 1 and 500 then raise exception 'A dispute reason and operator note are required'; end if;
  update public.captain_payouts set status = 'held', updated_by = auth.uid(), updated_at = now() where id = p_payout_id and status <> 'paid';
  if not found then raise exception 'Paid payouts cannot be held'; end if;
  insert into public.captain_payout_disputes(payout_id, status, reason, operator_note, opened_by) values (p_payout_id, 'open', trim(p_reason), trim(p_note), auth.uid()) returning * into v_dispute;
  insert into public.captain_payout_events(payout_id, event_type, actor_id, note, metadata) values (p_payout_id, 'held', auth.uid(), trim(p_note), jsonb_build_object('reason', trim(p_reason)));
  return v_dispute;
end; $$;
create or replace function public.operator_captain_payout_queue(p_status text default null)
returns table (payout_id uuid, ride_id uuid, captain_id uuid, captain_earning_amount numeric, customer_charge_amount numeric, payout_status text, provider text, provider_reference text, dispute_status text, dispute_reason text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status is not null and p_status not in ('not_started','initiated','processing','paid','failed','reversed','held') then raise exception 'Invalid payout status'; end if;
  return query select payout.id, compensation.ride_id, compensation.captain_id, compensation.captain_earning_amount, compensation.customer_charge_amount, payout.status, payout.provider, payout.provider_reference, dispute.status, dispute.reason
    from public.captain_payouts payout join public.captain_compensations compensation on compensation.id = payout.compensation_id
    left join lateral (select status, reason from public.captain_payout_disputes where payout_id = payout.id and status in ('open','under_review') order by opened_at desc limit 1) dispute on true
    where p_status is null or payout.status = p_status order by payout.updated_at asc;
end; $$;
create or replace function public.operator_resolve_captain_payout_dispute(p_dispute_id uuid, p_status text, p_note text)
returns public.captain_payout_disputes language plpgsql security definer set search_path = '' as $$
declare v_dispute public.captain_payout_disputes;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status not in ('resolved','rejected') or char_length(trim(coalesce(p_note, ''))) not between 1 and 500 then raise exception 'A resolution status and operator note are required'; end if;
  update public.captain_payout_disputes set status = p_status, operator_note = trim(p_note), resolved_by = auth.uid(), resolved_at = now() where id = p_dispute_id and status in ('open','under_review') returning * into v_dispute;
  if not found then raise exception 'Dispute is not open'; end if;
  insert into public.captain_payout_events(payout_id, event_type, actor_id, note, metadata) values (v_dispute.payout_id, 'dispute_' || p_status, auth.uid(), trim(p_note), '{}'::jsonb);
  return v_dispute;
end; $$;

revoke all on function public.prevent_captain_compensation_mutation(), public.apply_ride_customer_pricing() from public, anon, authenticated;
revoke all on function public.captain_compensation_monthly(date), public.captain_ride_payout(uuid), public.operator_update_captain_payout(uuid,text,text,text,text), public.operator_hold_captain_payout(uuid,text,text), public.operator_captain_payout_queue(text), public.operator_resolve_captain_payout_dispute(uuid,text,text) from public, anon;
grant execute on function public.captain_compensation_monthly(date), public.captain_ride_payout(uuid), public.customer_confirm_payment(uuid,text), public.customer_rate_captain(uuid,smallint,text), public.captain_transition_ride(uuid,text) to authenticated;
grant execute on function public.operator_update_captain_payout(uuid,text,text,text,text), public.operator_hold_captain_payout(uuid,text,text), public.operator_captain_payout_queue(text), public.operator_resolve_captain_payout_dispute(uuid,text,text) to authenticated;

-- Deployment verification queries (run with authenticated test identities):
-- 1) free ride: customer_charge_amount = 0, payment_status = 'not_required';
-- 2) compensation: captain_earning_amount = coalesce(rides.final_fare, rides.estimated_fare);
-- 3) repeat captain_transition_ride(...,'completed') leaves one compensation row;
-- 4) customer_confirm_payment rejects free rides; customer_rate_captain accepts them;
-- 5) captain_ride_payout only returns rows where compensation.captain_id = auth.uid();
-- 6) open/held dispute rejects paid transition; operator events record every transition.
