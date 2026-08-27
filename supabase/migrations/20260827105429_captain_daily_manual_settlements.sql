-- Daily, provider-independent captain settlement workflow. Existing
-- captain_compensations remain the immutable per-ride earning source.

alter table public.captain_compensations
  add column if not exists normal_ride_fare numeric(10,2) not null default 0 check (normal_ride_fare >= 0),
  add column if not exists tip_amount numeric(10,2) not null default 0 check (tip_amount >= 0),
  add column if not exists bonus_amount numeric(10,2) not null default 0 check (bonus_amount >= 0),
  add column if not exists adjustment_amount numeric(10,2) not null default 0,
  add column if not exists total_company_payable numeric(10,2) not null default 0 check (total_company_payable >= 0);

-- Backfill the immutable snapshot from the compensation amount already created
-- by the completion RPC. There are no persisted tip/bonus/adjustment sources.
alter table public.captain_compensations disable trigger captain_compensations_immutable;
update public.captain_compensations
set normal_ride_fare = captain_earning_amount,
    total_company_payable = captain_earning_amount
where normal_ride_fare = 0 and total_company_payable = 0;
alter table public.captain_compensations enable trigger captain_compensations_immutable;

create table public.captain_ride_verifications (
  id uuid primary key default gen_random_uuid(),
  compensation_id uuid not null unique references public.captain_compensations(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  verified_by uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'PENDING' and verified_by is null and verified_at is null and rejection_reason is null)
    or (status = 'APPROVED' and verified_by is not null and verified_at is not null and rejection_reason is null)
    or (status = 'REJECTED' and verified_by is not null and verified_at is not null and char_length(trim(coalesce(rejection_reason, ''))) between 1 and 500)
  )
);
create table public.captain_ride_verification_events (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.captain_ride_verifications(id) on delete restrict,
  status text not null check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  actor_id uuid references public.profiles(id) on delete restrict,
  reason text,
  occurred_at timestamptz not null default now()
);
create index captain_ride_verifications_status_idx on public.captain_ride_verifications(status, updated_at);

create table public.settlement_batches (
  id uuid primary key default gen_random_uuid(),
  settlement_date date not null unique,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'COMPLETED')),
  total_captains integer not null default 0 check (total_captains >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  check ((status = 'DRAFT' and approved_at is null and approved_by is null and completed_at is null) or (status = 'APPROVED' and approved_at is not null and approved_by is not null and completed_at is null) or (status = 'COMPLETED' and approved_at is not null and approved_by is not null and completed_at is not null))
);
create table public.captain_settlements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.settlement_batches(id) on delete restrict,
  captain_id uuid not null references public.captain_profiles(user_id) on delete restrict,
  gross_amount numeric(12,2) not null check (gross_amount >= 0),
  adjustments numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null check (net_amount >= 0),
  payout_provider text not null default 'MANUAL' check (char_length(trim(payout_provider)) between 1 and 50),
  payout_status text not null default 'PENDING' check (payout_status in ('PENDING', 'APPROVED', 'PAID', 'FAILED', 'REVERSED')),
  external_reference text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, captain_id),
  check (net_amount = gross_amount + adjustments),
  check ((payout_status <> 'PAID') or (char_length(trim(coalesce(external_reference, ''))) between 1 and 500 and paid_at is not null and paid_by is not null)),
  check (char_length(coalesce(notes, '')) <= 500)
);
create table public.captain_settlement_earnings (
  settlement_id uuid not null references public.captain_settlements(id) on delete restrict,
  compensation_id uuid not null unique references public.captain_compensations(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (settlement_id, compensation_id)
);
create index captain_settlements_payout_status_idx on public.captain_settlements(payout_status, created_at);
create index captain_settlement_earnings_compensation_idx on public.captain_settlement_earnings(compensation_id);

alter table public.captain_ride_verifications enable row level security;
alter table public.captain_ride_verification_events enable row level security;
alter table public.settlement_batches enable row level security;
alter table public.captain_settlements enable row level security;
alter table public.captain_settlement_earnings enable row level security;
revoke all on table public.captain_ride_verifications, public.captain_ride_verification_events, public.settlement_batches, public.captain_settlements, public.captain_settlement_earnings from public, anon, authenticated;
grant select, insert, update, delete on table public.captain_ride_verifications, public.captain_ride_verification_events, public.settlement_batches, public.captain_settlements, public.captain_settlement_earnings to service_role;

-- Allow the existing dashboard operator role to read; all mutations remain RPC-only.
create policy "Operators can view captain settlement workflow" on public.captain_ride_verifications for select to authenticated using (public.is_settlement_operator());
create policy "Operators can view captain verification audit" on public.captain_ride_verification_events for select to authenticated using (public.is_settlement_operator());
create policy "Operators can view captain settlement batches" on public.settlement_batches for select to authenticated using (public.is_settlement_operator());
create policy "Operators can view captain settlements" on public.captain_settlements for select to authenticated using (public.is_settlement_operator());
create policy "Operators can view captain settlement earnings" on public.captain_settlement_earnings for select to authenticated using (public.is_settlement_operator());
grant select on table public.captain_ride_verifications, public.captain_ride_verification_events, public.settlement_batches, public.captain_settlements, public.captain_settlement_earnings to authenticated;

-- Existing completed rides are legitimate completion facts. Backfill their
-- immutable earning facts if an earlier deployment predated compensation.
insert into public.captain_earnings_ledger(captain_id, ride_id, entry_type, amount, occurred_at, note)
select r.captain_id, r.id, 'ride_earning', coalesce(r.final_fare, r.estimated_fare), r.completed_at, 'Backfilled completed ride earning; not a payout'
from public.rides r
where r.status = 'completed' and r.captain_id is not null
on conflict (ride_id, entry_type) do nothing;
insert into public.captain_compensations(ride_id, captain_id, customer_charge_amount, captain_earning_amount, earning_status, verified_at, normal_ride_fare, total_company_payable)
select r.id, r.captain_id, r.customer_charge_amount, coalesce(r.final_fare, r.estimated_fare), 'earned', r.completed_at, coalesce(r.final_fare, r.estimated_fare), coalesce(r.final_fare, r.estimated_fare)
from public.rides r
where r.status = 'completed' and r.captain_id is not null
on conflict (ride_id) do nothing;
insert into public.captain_ride_verifications(compensation_id)
select id from public.captain_compensations
on conflict (compensation_id) do nothing;

create or replace function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_compensation_id uuid; v_payout_id uuid; v_fare numeric(10,2);
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
    v_fare := coalesce(v_ride.final_fare, v_ride.estimated_fare);
    insert into public.captain_earnings_ledger(captain_id, ride_id, entry_type, amount, occurred_at, note) values (auth.uid(), v_ride.id, 'ride_earning', v_fare, v_ride.completed_at, 'Completed ride; not a settlement or payout') on conflict (ride_id, entry_type) do nothing;
    insert into public.captain_compensations(ride_id, captain_id, customer_charge_amount, captain_earning_amount, earning_status, verified_at, normal_ride_fare, tip_amount, bonus_amount, adjustment_amount, total_company_payable)
      values (v_ride.id, auth.uid(), v_ride.customer_charge_amount, v_fare, 'earned', v_ride.completed_at, v_fare, 0, 0, 0, v_fare)
      on conflict (ride_id) do nothing returning id into v_compensation_id;
    if v_compensation_id is null then select id into v_compensation_id from public.captain_compensations where ride_id = v_ride.id; end if;
    insert into public.captain_ride_verifications(compensation_id) values (v_compensation_id) on conflict (compensation_id) do nothing;
    insert into public.captain_payouts(compensation_id) values (v_compensation_id) on conflict (compensation_id) do nothing returning id into v_payout_id;
    if v_payout_id is null then select id into v_payout_id from public.captain_payouts where compensation_id = v_compensation_id; end if;
    insert into public.captain_payout_events(payout_id, event_type, actor_id, note) values (v_payout_id, 'compensation_created', auth.uid(), 'Completed ride compensation created') on conflict do nothing;
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = auth.uid();
  else raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history(ride_id, status, actor_type) values (v_ride.id, v_ride.status, 'captain');
  return v_ride;
end;
$$;

create or replace function public.operator_captain_ride_verification_queue(p_status text default 'PENDING')
returns table (compensation_id uuid, ride_id uuid, captain_id uuid, customer_name text, captain_name text, pickup_address text, drop_address text, normal_ride_fare numeric, customer_charge_amount numeric, customer_charge_type text, total_company_payable numeric, trip_distance_meters numeric, travelled_distance_km numeric, started_at timestamptz, completed_at timestamptz, pickup_otp_verified_at timestamptz, payment_status text, payment_method text, verification_status text, rejection_reason text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status is not null and p_status not in ('PENDING', 'APPROVED', 'REJECTED') then raise exception 'Invalid verification status'; end if;
  return query
  select c.id, r.id, c.captain_id, customer.full_name, captain.full_name, r.pickup_address, r.drop_address,
    c.normal_ride_fare, r.customer_charge_amount, r.customer_charge_type, c.total_company_payable,
    r.trip_distance_meters, r.travelled_distance_km, r.started_at, r.completed_at, r.pickup_otp_verified_at,
    r.payment_status, r.payment_method, v.status, v.rejection_reason
  from public.captain_compensations c
  join public.rides r on r.id = c.ride_id
  join public.captain_ride_verifications v on v.compensation_id = c.id
  left join public.profiles customer on customer.id = r.customer_id
  left join public.profiles captain on captain.id = c.captain_id
  where p_status is null or v.status = p_status
  order by r.completed_at asc;
end;
$$;

create or replace function public.operator_verify_captain_ride(p_compensation_id uuid, p_status text, p_rejection_reason text default null)
returns public.captain_ride_verifications language plpgsql security definer set search_path = '' as $$
declare v public.captain_ride_verifications;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status not in ('APPROVED', 'REJECTED') then raise exception 'Invalid verification decision'; end if;
  if p_status = 'REJECTED' and char_length(trim(coalesce(p_rejection_reason, ''))) not between 1 and 500 then raise exception 'A rejection reason between 1 and 500 characters is required'; end if;
  select * into v from public.captain_ride_verifications where compensation_id = p_compensation_id for update;
  if not found then raise exception 'Completed ride earning not found'; end if;
  if v.status <> 'PENDING' then raise exception 'Ride has already been verified'; end if;
  update public.captain_ride_verifications set status = p_status, verified_by = auth.uid(), verified_at = now(), rejection_reason = case when p_status = 'REJECTED' then trim(p_rejection_reason) else null end, updated_at = now()
    where id = v.id returning * into v;
  insert into public.captain_ride_verification_events(verification_id, status, actor_id, reason) values (v.id, v.status, auth.uid(), v.rejection_reason);
  return v;
end;
$$;

create or replace function public.operator_generate_captain_settlement(p_settlement_date date)
returns public.settlement_batches language plpgsql security definer set search_path = '' as $$
declare b public.settlement_batches; s record;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_settlement_date is null or p_settlement_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Settlement date must not be in the future'; end if;
  insert into public.settlement_batches(settlement_date) values (p_settlement_date) on conflict (settlement_date) do nothing;
  select * into b from public.settlement_batches where settlement_date = p_settlement_date for update;
  if b.status <> 'DRAFT' then return b; end if;
  for s in
    select c.captain_id, sum(c.total_company_payable)::numeric as total
    from public.captain_compensations c join public.captain_ride_verifications v on v.compensation_id = c.id
    left join public.captain_settlement_earnings linked on linked.compensation_id = c.id
    where v.status = 'APPROVED' and linked.compensation_id is null and (c.verified_at at time zone 'Asia/Kolkata')::date = p_settlement_date
    group by c.captain_id
  loop
    insert into public.captain_settlements(batch_id, captain_id, gross_amount, net_amount) values (b.id, s.captain_id, s.total, s.total) on conflict (batch_id, captain_id) do nothing;
    insert into public.captain_settlement_earnings(settlement_id, compensation_id, amount)
      select cs.id, c.id, c.total_company_payable from public.captain_compensations c join public.captain_ride_verifications v on v.compensation_id = c.id left join public.captain_settlement_earnings linked on linked.compensation_id = c.id join public.captain_settlements cs on cs.batch_id = b.id and cs.captain_id = c.captain_id
      where c.captain_id = s.captain_id and v.status = 'APPROVED' and linked.compensation_id is null and (c.verified_at at time zone 'Asia/Kolkata')::date = p_settlement_date;
  end loop;
  update public.settlement_batches set total_captains = (select count(*) from public.captain_settlements where batch_id = b.id), total_amount = coalesce((select sum(net_amount) from public.captain_settlements where batch_id = b.id), 0) where id = b.id returning * into b;
  return b;
end;
$$;

create or replace function public.operator_captain_settlement_queue(p_settlement_date date default null)
returns table (batch_id uuid, settlement_date date, batch_status text, settlement_id uuid, captain_id uuid, captain_name text, approved_rides integer, gross_amount numeric, adjustments numeric, net_amount numeric, payout_provider text, payout_status text, external_reference text, paid_at timestamptz, notes text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  return query select b.id, b.settlement_date, b.status, cs.id, cs.captain_id, p.full_name, count(linked.compensation_id)::integer, cs.gross_amount, cs.adjustments, cs.net_amount, cs.payout_provider, cs.payout_status, cs.external_reference, cs.paid_at, cs.notes
  from public.settlement_batches b join public.captain_settlements cs on cs.batch_id = b.id left join public.profiles p on p.id = cs.captain_id left join public.captain_settlement_earnings linked on linked.settlement_id = cs.id
  where p_settlement_date is null or b.settlement_date = p_settlement_date
  group by b.id, cs.id, p.full_name order by b.settlement_date desc, p.full_name nulls last;
end;
$$;

create or replace function public.operator_approve_captain_settlement_batch(p_batch_id uuid)
returns public.settlement_batches language plpgsql security definer set search_path = '' as $$
declare b public.settlement_batches;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  select * into b from public.settlement_batches where id = p_batch_id for update;
  if not found then raise exception 'Settlement batch not found'; end if;
  if b.status = 'APPROVED' or b.status = 'COMPLETED' then return b; end if;
  if not exists (select 1 from public.captain_settlements where batch_id = b.id) then raise exception 'Cannot approve an empty settlement batch'; end if;
  update public.settlement_batches set status = 'APPROVED', approved_by = auth.uid(), approved_at = now() where id = b.id returning * into b;
  update public.captain_settlements set payout_status = 'APPROVED', updated_at = now() where batch_id = b.id and payout_status = 'PENDING';
  return b;
end;
$$;

create or replace function public.operator_record_manual_captain_payment(p_settlement_id uuid, p_reference text, p_notes text default null)
returns public.captain_settlements language plpgsql security definer set search_path = '' as $$
declare s public.captain_settlements; b public.settlement_batches;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if char_length(trim(coalesce(p_reference, ''))) not between 1 and 500 then raise exception 'A non-empty UTR or bank transaction reference is required'; end if;
  if char_length(coalesce(p_notes, '')) > 500 then raise exception 'Notes must be at most 500 characters'; end if;
  select * into s from public.captain_settlements where id = p_settlement_id for update;
  if not found then raise exception 'Captain settlement not found'; end if;
  select * into b from public.settlement_batches where id = s.batch_id for update;
  if b.status <> 'APPROVED' then raise exception 'Approve the settlement batch before recording payment'; end if;
  if s.payout_status = 'PAID' then raise exception 'Captain settlement is already paid'; end if;
  if s.payout_status <> 'APPROVED' then raise exception 'Captain settlement is not approved for payment'; end if;
  update public.captain_settlements set payout_provider = 'MANUAL', payout_status = 'PAID', external_reference = trim(p_reference), notes = nullif(trim(coalesce(p_notes, '')), ''), paid_at = now(), paid_by = auth.uid(), updated_at = now() where id = s.id returning * into s;
  if not exists (select 1 from public.captain_settlements where batch_id = b.id and payout_status <> 'PAID') then update public.settlement_batches set status = 'COMPLETED', completed_at = now() where id = b.id; end if;
  return s;
end;
$$;

-- The legacy per-ride queue remains readable for historical audit, but cannot
-- create new manual payments outside verified daily settlements.
create or replace function public.operator_update_captain_payout(p_payout_id uuid, p_status text, p_note text, p_provider text default null, p_provider_reference text default null)
returns public.captain_payouts language plpgsql security definer set search_path = '' as $$
begin
  if p_status = 'paid' then raise exception 'Use the verified daily captain settlement workflow for manual payments'; end if;
  raise exception 'Legacy per-ride payout updates are disabled; use daily settlements';
end;
$$;

revoke all on function public.operator_captain_ride_verification_queue(text), public.operator_verify_captain_ride(uuid,text,text), public.operator_generate_captain_settlement(date), public.operator_captain_settlement_queue(date), public.operator_approve_captain_settlement_batch(uuid), public.operator_record_manual_captain_payment(uuid,text,text) from public, anon;
grant execute on function public.operator_captain_ride_verification_queue(text), public.operator_verify_captain_ride(uuid,text,text), public.operator_generate_captain_settlement(date), public.operator_captain_settlement_queue(date), public.operator_approve_captain_settlement_batch(uuid), public.operator_record_manual_captain_payment(uuid,text,text) to authenticated;
