-- A declared cash/UPI method is not evidence that money was received.  This
-- migration adds an operator-reviewed, append-only settlement audit trail and
-- deliberately does not initiate charges, transfers, or refunds.

alter table public.rides drop constraint if exists rides_payment_status_check;
alter table public.rides drop constraint if exists paid_ride_has_method_and_timestamp;
alter table public.rides add constraint rides_payment_status_check
  check (payment_status in ('pending', 'paid', 'declared'));
comment on column public.rides.payment_status is
  'Customer payment-method declaration state only; never proof of money received.';
comment on column public.rides.paid_at is
  'Deprecated legacy field. Do not use as settlement evidence.';

update public.rides
set payment_status = 'declared'
where payment_status = 'paid';

alter table public.rides drop constraint rides_payment_status_check;
alter table public.rides add constraint rides_payment_status_check
  check (payment_status in ('pending', 'declared'));
alter table public.rides add constraint declared_ride_has_method
  check ((payment_status = 'pending') = (payment_method is null));

create table public.settlement_operators (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint settlement_operators_disabled_state_check
    check ((enabled and disabled_at is null) or (not enabled))
);

comment on table public.settlement_operators is
  'Service-managed allow-list for supervised-pilot reconciliation operators.';

create table public.ride_settlements (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(id) on delete restrict,
  declared_method text not null check (declared_method in ('cash', 'upi')),
  amount_due numeric(10,2) not null check (amount_due >= 0),
  status text not null default 'awaiting_review'
    check (status in ('awaiting_review', 'confirmed', 'flagged')),
  declared_by uuid not null references public.profiles(id) on delete restrict,
  declared_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_settlements_review_state_check check (
    (status = 'awaiting_review' and reviewed_by is null and reviewed_at is null and review_note is null)
    or (status = 'confirmed' and reviewed_by is not null and reviewed_at is not null)
    or (status = 'flagged' and reviewed_by is not null and reviewed_at is not null and char_length(trim(coalesce(review_note, ''))) between 1 and 500)
  )
);

comment on table public.ride_settlements is
  'One settlement record per completed ride. Status is an operator reconciliation outcome, not a payment rail event.';

create table public.ride_settlement_events (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.ride_settlements(id) on delete restrict,
  event_type text not null check (event_type in ('declared', 'legacy_declared', 'confirmed', 'flagged')),
  actor_id uuid references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  note text,
  metadata jsonb not null default '{}'::jsonb
);

comment on table public.ride_settlement_events is
  'Append-only settlement audit events. Suitable as the fact table for future reconciliation analytics.';

create index ride_settlements_review_queue_idx
  on public.ride_settlements (status, declared_at desc);
create index ride_settlements_reviewed_at_idx
  on public.ride_settlements (reviewed_at desc)
  where reviewed_at is not null;
create index ride_settlement_events_settlement_occurred_idx
  on public.ride_settlement_events (settlement_id, occurred_at);

alter table public.settlement_operators enable row level security;
alter table public.ride_settlements enable row level security;
alter table public.ride_settlement_events enable row level security;

revoke all on table public.settlement_operators, public.ride_settlements, public.ride_settlement_events from anon, authenticated;
grant select, insert, update, delete on table public.settlement_operators, public.ride_settlements, public.ride_settlement_events to service_role;

create or replace function public.is_settlement_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.settlement_operators operator_account
      where operator_account.user_id = auth.uid()
        and operator_account.enabled
    );
$$;

create or replace function public.customer_confirm_payment(p_ride_id uuid, p_method text)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_settlement_id uuid;
begin
  perform public.require_production_user();
  if p_method not in ('cash', 'upi') then raise exception 'Invalid payment method'; end if;

  update public.rides
  set payment_status = 'declared', payment_method = p_method, paid_at = null
  where id = p_ride_id
    and customer_id = auth.uid()
    and status = 'completed'
    and payment_status = 'pending'
  returning * into v_ride;
  if not found then raise exception 'Payment method is not available for this ride'; end if;

  insert into public.ride_settlements (ride_id, declared_method, amount_due, declared_by)
  values (v_ride.id, p_method, coalesce(v_ride.final_fare, v_ride.estimated_fare), auth.uid())
  returning id into v_settlement_id;

  insert into public.ride_settlement_events (settlement_id, event_type, actor_id, metadata)
  values (v_settlement_id, 'declared', auth.uid(), jsonb_build_object('declared_method', p_method));
  return v_ride;
end;
$$;

create or replace function public.customer_rate_captain(p_ride_id uuid, p_rating smallint, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_production_user();
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  update public.rides
  set customer_rating = p_rating, customer_rating_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_ride_id and customer_id = auth.uid() and status = 'completed'
    and payment_status = 'declared' and customer_rating is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end;
$$;

-- Preserve historic UI records as explicitly unverified declarations; do not
-- infer operator confirmation from the old customer-controlled paid flag.
insert into public.ride_settlements (ride_id, declared_method, amount_due, declared_by, declared_at)
select ride.id, ride.payment_method, coalesce(ride.final_fare, ride.estimated_fare), ride.customer_id,
  coalesce(ride.paid_at, ride.completed_at, now())
from public.rides ride
where ride.status = 'completed'
  and ride.payment_status = 'declared'
  and ride.payment_method is not null
on conflict (ride_id) do nothing;

insert into public.ride_settlement_events (settlement_id, event_type, actor_id, occurred_at, metadata)
select settlement.id, 'legacy_declared', settlement.declared_by, settlement.declared_at,
  jsonb_build_object('source', 'legacy_customer_paid_flag')
from public.ride_settlements settlement
where not exists (
  select 1 from public.ride_settlement_events event where event.settlement_id = settlement.id
);

create or replace function public.operator_settlement_queue(p_status text default null)
returns table (
  settlement_id uuid,
  ride_id uuid,
  declared_method text,
  amount_due numeric,
  settlement_status text,
  declared_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  pickup_address text,
  drop_address text,
  customer_name text,
  captain_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status is not null and p_status not in ('awaiting_review', 'confirmed', 'flagged') then raise exception 'Invalid settlement status'; end if;
  return query
  select settlement.id, ride.id, settlement.declared_method, settlement.amount_due, settlement.status,
    settlement.declared_at, settlement.reviewed_at, settlement.review_note,
    ride.pickup_address, ride.drop_address,
    coalesce(customer.full_name, 'Customer'), coalesce(captain.full_name, 'Unassigned')
  from public.ride_settlements settlement
  join public.rides ride on ride.id = settlement.ride_id
  join public.profiles customer on customer.id = ride.customer_id
  left join public.profiles captain on captain.id = ride.captain_id
  where p_status is null or settlement.status = p_status
  order by case when settlement.status = 'awaiting_review' then 0 else 1 end, settlement.declared_at asc;
end;
$$;

create or replace function public.operator_review_settlement(p_settlement_id uuid, p_action text, p_note text default null)
returns public.ride_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare v_settlement public.ride_settlements;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_action not in ('confirmed', 'flagged') then raise exception 'Invalid settlement action'; end if;
  if p_action = 'flagged' and char_length(trim(coalesce(p_note, ''))) not between 1 and 500 then
    raise exception 'A flag note between 1 and 500 characters is required';
  end if;

  update public.ride_settlements
  set status = p_action,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = p_settlement_id and status = 'awaiting_review'
  returning * into v_settlement;
  if not found then raise exception 'Settlement is no longer awaiting review'; end if;

  insert into public.ride_settlement_events (settlement_id, event_type, actor_id, note)
  values (v_settlement.id, p_action, auth.uid(), v_settlement.review_note);
  return v_settlement;
end;
$$;

revoke all on function public.is_settlement_operator() from public, anon, authenticated;
revoke all on function public.operator_settlement_queue(text) from public, anon;
revoke all on function public.operator_review_settlement(uuid, text, text) from public, anon;
revoke all on function public.customer_confirm_payment(uuid, text) from public, anon;
revoke all on function public.customer_rate_captain(uuid, smallint, text) from public, anon;
grant execute on function public.operator_settlement_queue(text), public.operator_review_settlement(uuid, text, text) to authenticated;
grant execute on function public.customer_confirm_payment(uuid, text), public.customer_rate_captain(uuid, smallint, text) to authenticated;
