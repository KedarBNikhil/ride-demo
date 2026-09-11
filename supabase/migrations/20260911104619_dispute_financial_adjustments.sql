-- Immutable, server-owned dispute adjustments.  These are deliberately
-- separate from a completed ride's fare and compensation facts.
create table public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  account_type text not null check (account_type in ('CUSTOMER', 'CAPTAIN')),
  customer_id uuid references public.profiles(id) on delete restrict,
  captain_id uuid references public.profiles(id) on delete restrict,
  source_ride_id uuid not null references public.rides(id) on delete restrict,
  source_dispute_id uuid not null,
  source_dispute_type text not null check (source_dispute_type in ('customer', 'captain')),
  adjustment_type text not null check (adjustment_type in ('DISPUTE_CHARGE', 'DISPUTE_DEDUCTION', 'REFUND', 'GOODWILL_CREDIT', 'MANUAL_ADJUSTMENT')),
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  original_amount numeric(10,2) not null check (original_amount > 0),
  remaining_amount numeric(10,2) not null check (remaining_amount >= 0 and remaining_amount <= original_amount),
  currency text not null default 'INR' check (currency = 'INR'),
  reason_code text not null check (char_length(trim(reason_code)) between 1 and 120),
  operator_notes text,
  status text not null default 'PENDING' check (status in ('PENDING', 'PARTIALLY_APPLIED', 'APPLIED', 'WAIVED', 'REVERSED')),
  created_by_operator uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint financial_adjustments_account_check check ((account_type = 'CUSTOMER' and customer_id is not null and captain_id is null) or (account_type = 'CAPTAIN' and captain_id is not null and customer_id is null)),
  constraint financial_adjustments_completion_check check ((status in ('PENDING', 'PARTIALLY_APPLIED') and completed_at is null) or (status in ('APPLIED', 'WAIVED', 'REVERSED') and completed_at is not null))
);
create unique index financial_adjustments_one_active_dispute_account_idx
  on public.financial_adjustments(source_dispute_id, account_type)
  where status not in ('WAIVED', 'REVERSED');
create index financial_adjustments_customer_pending_idx on public.financial_adjustments(customer_id, created_at) where account_type = 'CUSTOMER' and status in ('PENDING', 'PARTIALLY_APPLIED');
create index financial_adjustments_captain_pending_idx on public.financial_adjustments(captain_id, created_at) where account_type = 'CAPTAIN' and status in ('PENDING', 'PARTIALLY_APPLIED');

create table public.financial_adjustment_applications (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.financial_adjustments(id) on delete restrict,
  ride_id uuid references public.rides(id) on delete restrict,
  settlement_id uuid references public.ride_settlements(id) on delete restrict,
  amount_applied numeric(10,2) not null check (amount_applied > 0),
  created_at timestamptz not null default now(),
  constraint financial_adjustment_applications_target_check check (ride_id is not null or settlement_id is not null),
  unique (adjustment_id, ride_id)
);
create index financial_adjustment_applications_adjustment_idx on public.financial_adjustment_applications(adjustment_id, created_at);

alter table public.financial_adjustments enable row level security;
alter table public.financial_adjustment_applications enable row level security;
revoke all on table public.financial_adjustments, public.financial_adjustment_applications from public, anon, authenticated;
grant select, insert, update, delete on table public.financial_adjustments, public.financial_adjustment_applications to service_role;

create or replace function public.operator_resolve_dispute_with_adjustment(
  p_dispute_source text, p_dispute_id uuid, p_resolution text, p_amount numeric default null,
  p_reason text default null, p_operator_notes text default null
) returns public.financial_adjustments
language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_adjustment public.financial_adjustments; v_account text; v_note text; v_reason text; v_amount numeric(10,2);
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_dispute_source not in ('customer', 'captain') or p_resolution not in ('NO_ACTION', 'CUSTOMER_LIABLE', 'CAPTAIN_LIABLE') then raise exception 'Invalid dispute resolution'; end if;
  v_note := nullif(trim(coalesce(p_operator_notes, '')), ''); v_reason := trim(coalesce(p_reason, ''));
  if p_resolution = 'NO_ACTION' then
    if p_dispute_source = 'customer' then update public.customer_payment_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = coalesce(v_note, 'No financial adjustment') where id = p_dispute_id and status = 'open';
    else update public.captain_payment_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = coalesce(v_note, 'No financial adjustment') where id = p_dispute_id and status = 'open'; end if;
    if not found then raise exception 'Dispute is not open'; end if;
    return null;
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 or p_amount <> round(p_amount, 2) or char_length(v_reason) not between 1 and 120 then raise exception 'A positive amount and reason are required'; end if;
  v_amount := p_amount::numeric(10,2); v_account := case when p_resolution = 'CUSTOMER_LIABLE' then 'CUSTOMER' else 'CAPTAIN' end;
  if p_dispute_source = 'customer' then
    select r.* into v_ride from public.customer_payment_issues i join public.rides r on r.id = i.ride_id where i.id = p_dispute_id for update;
    if not found then raise exception 'Dispute not found'; end if;
    update public.customer_payment_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = coalesce(v_note, v_reason) where id = p_dispute_id and status = 'open';
  else
    select r.* into v_ride from public.captain_payment_issues i join public.rides r on r.id = i.ride_id where i.id = p_dispute_id for update;
    if not found then raise exception 'Dispute not found'; end if;
    update public.captain_payment_issues set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = coalesce(v_note, v_reason) where id = p_dispute_id and status = 'open';
  end if;
  if not found then
    select * into v_adjustment from public.financial_adjustments where source_dispute_id = p_dispute_id and account_type = v_account and status not in ('WAIVED', 'REVERSED');
    if found then return v_adjustment; end if;
    raise exception 'Dispute is not open';
  end if;
  if v_account = 'CUSTOMER' then
    insert into public.financial_adjustments(account_type, customer_id, source_ride_id, source_dispute_id, source_dispute_type, adjustment_type, direction, original_amount, remaining_amount, reason_code, operator_notes, created_by_operator)
    values ('CUSTOMER', v_ride.customer_id, v_ride.id, p_dispute_id, p_dispute_source, 'DISPUTE_CHARGE', 'DEBIT', v_amount, v_amount, v_reason, v_note, auth.uid()) returning * into v_adjustment;
  else
    if v_ride.captain_id is null then raise exception 'Disputed ride has no Captain'; end if;
    insert into public.financial_adjustments(account_type, captain_id, source_ride_id, source_dispute_id, source_dispute_type, adjustment_type, direction, original_amount, remaining_amount, reason_code, operator_notes, created_by_operator)
    values ('CAPTAIN', v_ride.captain_id, v_ride.id, p_dispute_id, p_dispute_source, 'DISPUTE_DEDUCTION', 'DEBIT', v_amount, v_amount, v_reason, v_note, auth.uid()) returning * into v_adjustment;
  end if;
  return v_adjustment;
end;
$$;

-- Captains never receive a negative earnings entry.  The trigger consumes the
-- oldest open liabilities against each new earned compensation exactly once.
create or replace function private.apply_captain_dispute_deductions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.financial_adjustments; v_available numeric(10,2) := new.captain_earning_amount; v_apply numeric(10,2); v_total numeric(10,2) := 0;
begin
  for a in select * from public.financial_adjustments where account_type = 'CAPTAIN' and captain_id = new.captain_id and status in ('PENDING', 'PARTIALLY_APPLIED') order by created_at, id for update loop
    exit when v_available <= 0;
    v_apply := least(a.remaining_amount, v_available);
    insert into public.financial_adjustment_applications(adjustment_id, ride_id, amount_applied) values (a.id, new.ride_id, v_apply) on conflict (adjustment_id, ride_id) do nothing;
    if found then
      update public.financial_adjustments set remaining_amount = remaining_amount - v_apply, status = case when remaining_amount - v_apply = 0 then 'APPLIED' else 'PARTIALLY_APPLIED' end, completed_at = case when remaining_amount - v_apply = 0 then now() else null end where id = a.id;
      v_available := v_available - v_apply; v_total := v_total + v_apply;
    end if;
  end loop;
  if v_total > 0 then insert into public.captain_earnings_ledger(captain_id, ride_id, entry_type, amount, occurred_at, note) values (new.captain_id, new.ride_id, 'adjustment', -v_total, new.verified_at, 'Dispute deduction') on conflict (ride_id, entry_type) do nothing; end if;
  return new;
end;
$$;
create trigger apply_captain_dispute_deductions after insert on public.captain_compensations for each row execute function private.apply_captain_dispute_deductions();

create or replace function public.customer_ride_payment_breakdown(p_ride_id uuid)
returns table (ride_fare numeric, previous_ride_adjustment numeric, total_payable numeric, adjustment_reason text)
language sql security definer set search_path = '' as $$
  select r.customer_charge_amount, case when r.customer_charge_amount > 0 then coalesce(sum(a.remaining_amount), 0) else 0 end,
    r.customer_charge_amount + case when r.customer_charge_amount > 0 then coalesce(sum(a.remaining_amount), 0) else 0 end,
    case when r.customer_charge_amount > 0 then min(a.reason_code) else null end
  from public.rides r left join public.financial_adjustments a on a.customer_id = r.customer_id and a.account_type = 'CUSTOMER' and a.status in ('PENDING','PARTIALLY_APPLIED')
  where r.id = p_ride_id and r.customer_id = auth.uid() and r.status = 'completed'
  group by r.id, r.customer_charge_amount;
$$;

create or replace function public.customer_confirm_payment(p_ride_id uuid, p_method text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_settlement_id uuid; a public.financial_adjustments; v_apply numeric(10,2); v_adjustments numeric(10,2) := 0;
begin
  perform public.require_pilot_user('customer');
  if p_method <> 'cash' then raise exception 'Cash is the only payment method during this pilot'; end if;
  select * into v_ride from public.rides where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and customer_charge_type = 'standard' and payment_status = 'pending' for update;
  if not found then raise exception 'Cash payment is not available for this ride'; end if;
  for a in select * from public.financial_adjustments where account_type = 'CUSTOMER' and customer_id = auth.uid() and status in ('PENDING','PARTIALLY_APPLIED') order by created_at, id for update loop
    v_apply := a.remaining_amount;
    insert into public.financial_adjustment_applications(adjustment_id, ride_id, amount_applied) values (a.id, v_ride.id, v_apply) on conflict (adjustment_id, ride_id) do nothing;
    if found then update public.financial_adjustments set remaining_amount = 0, status = 'APPLIED', completed_at = now() where id = a.id; v_adjustments := v_adjustments + v_apply; end if;
  end loop;
  update public.rides set payment_status = 'declared', customer_charge_status = 'declared', payment_method = 'cash', paid_at = null where id = v_ride.id returning * into v_ride;
  insert into public.ride_settlements (ride_id, declared_method, amount_due, declared_by) values (v_ride.id, 'cash', v_ride.customer_charge_amount + v_adjustments, auth.uid()) returning id into v_settlement_id;
  insert into public.ride_settlement_events (settlement_id, event_type, actor_id, metadata) values (v_settlement_id, 'declared', auth.uid(), jsonb_build_object('declared_method', 'cash', 'ride_fare', v_ride.customer_charge_amount, 'previous_ride_adjustment', v_adjustments));
  return v_ride;
end;
$$;

drop function public.captain_ride_payout(uuid);
create function public.captain_ride_payout(p_ride_id uuid)
returns table (captain_earning_amount numeric, dispute_deduction numeric, net_earning_amount numeric, payout_status text, is_held boolean)
language sql security definer set search_path = '' as $$
  select c.captain_earning_amount, coalesce(-l.amount, 0), greatest(c.captain_earning_amount + coalesce(l.amount, 0), 0), p.status, p.status = 'held'
  from public.captain_compensations c join public.captain_payouts p on p.compensation_id = c.id
  left join public.captain_earnings_ledger l on l.ride_id = c.ride_id and l.entry_type = 'adjustment'
  where c.ride_id = p_ride_id and c.captain_id = auth.uid();
$$;

drop function public.captain_compensation_monthly(date);
create function public.captain_compensation_monthly(p_month_start date)
returns table (day date, ride_earnings numeric, ride_count integer, held_earnings numeric, payout_status text, dispute_deductions numeric, net_earnings numeric)
language sql security definer set search_path = '' as $$
  with bounds as (select date_trunc('month', p_month_start)::timestamptz starts_at, (date_trunc('month', p_month_start) + interval '1 month')::timestamptz ends_at),
  days as (select generate_series((select starts_at::date from bounds), ((select ends_at from bounds) - interval '1 day')::date, interval '1 day')::date as ride_day),
  c as (select compensation.verified_at::date as ride_day, compensation.captain_earning_amount, payout.status, coalesce(-ledger.amount, 0) as deduction from public.captain_compensations compensation join public.captain_payouts payout on payout.compensation_id = compensation.id left join public.captain_earnings_ledger ledger on ledger.ride_id = compensation.ride_id and ledger.entry_type = 'adjustment', bounds where compensation.captain_id = auth.uid() and compensation.verified_at >= starts_at and compensation.verified_at < ends_at)
  select days.ride_day, coalesce(sum(c.captain_earning_amount), 0), count(c.captain_earning_amount)::integer, coalesce(sum(c.captain_earning_amount) filter (where c.status = 'held'), 0), coalesce((array_agg(c.status order by c.status))[1], 'not_started'), coalesce(sum(c.deduction), 0), coalesce(sum(c.captain_earning_amount - c.deduction), 0) from days left join c on c.ride_day = days.ride_day group by days.ride_day order by days.ride_day;
$$;

create or replace function public.operator_generate_captain_settlement(p_settlement_date date)
returns public.settlement_batches
language plpgsql security definer set search_path = '' as $$
declare b public.settlement_batches; s record;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_settlement_date is null or p_settlement_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Settlement date must not be in the future'; end if;
  insert into public.settlement_batches(settlement_date) values (p_settlement_date) on conflict (settlement_date) do nothing;
  select * into b from public.settlement_batches where settlement_date = p_settlement_date for update;
  if b.status <> 'DRAFT' then return b; end if;
  for s in
    select c.captain_id, sum(c.total_company_payable)::numeric as gross, sum(greatest(c.total_company_payable - coalesce(d.deduction, 0), 0))::numeric as net
    from public.captain_compensations c join public.rides r on r.id = c.ride_id join public.captain_ride_verifications v on v.compensation_id = c.id
    left join public.captain_settlement_earnings linked on linked.compensation_id = c.id
    left join lateral (select sum(app.amount_applied) as deduction from public.financial_adjustment_applications app join public.financial_adjustments a on a.id = app.adjustment_id where app.ride_id = c.ride_id and a.account_type = 'CAPTAIN') d on true
    where r.customer_charge_type = 'free' and c.total_company_payable > 0 and v.status = 'APPROVED' and linked.compensation_id is null and (c.verified_at at time zone 'Asia/Kolkata')::date = p_settlement_date group by c.captain_id
  loop
    insert into public.captain_settlements(batch_id, captain_id, gross_amount, net_amount) values (b.id, s.captain_id, s.gross, s.net) on conflict (batch_id, captain_id) do nothing;
    insert into public.captain_settlement_earnings(settlement_id, compensation_id, amount)
      select cs.id, c.id, greatest(c.total_company_payable - coalesce(d.deduction, 0), 0)
      from public.captain_compensations c join public.rides r on r.id = c.ride_id join public.captain_ride_verifications v on v.compensation_id = c.id
      left join public.captain_settlement_earnings linked on linked.compensation_id = c.id
      left join lateral (select sum(app.amount_applied) as deduction from public.financial_adjustment_applications app join public.financial_adjustments a on a.id = app.adjustment_id where app.ride_id = c.ride_id and a.account_type = 'CAPTAIN') d on true
      join public.captain_settlements cs on cs.batch_id = b.id and cs.captain_id = c.captain_id
      where c.captain_id = s.captain_id and r.customer_charge_type = 'free' and c.total_company_payable > 0 and v.status = 'APPROVED' and linked.compensation_id is null and (c.verified_at at time zone 'Asia/Kolkata')::date = p_settlement_date;
  end loop;
  update public.settlement_batches set total_captains = (select count(*) from public.captain_settlements where batch_id = b.id), total_amount = coalesce((select sum(net_amount) from public.captain_settlements where batch_id = b.id), 0) where id = b.id returning * into b;
  return b;
end;
$$;

create or replace function public.operator_dispute_financial_adjustments()
returns table (source_dispute_id uuid, account_type text, original_amount numeric, applied_amount numeric, remaining_amount numeric, status text, source_ride_id uuid, created_at timestamptz, created_by_operator uuid)
language sql security definer set search_path = '' as $$
  select a.source_dispute_id, a.account_type, a.original_amount, a.original_amount - a.remaining_amount, a.remaining_amount, a.status, a.source_ride_id, a.created_at, a.created_by_operator from public.financial_adjustments a where public.is_settlement_operator();
$$;

revoke all on function public.operator_resolve_dispute_with_adjustment(text,uuid,text,numeric,text,text), public.operator_dispute_financial_adjustments(), public.customer_ride_payment_breakdown(uuid), public.captain_ride_payout(uuid), public.captain_compensation_monthly(date) from public, anon;
grant execute on function public.operator_resolve_dispute_with_adjustment(text,uuid,text,numeric,text,text), public.operator_dispute_financial_adjustments(), public.customer_ride_payment_breakdown(uuid), public.captain_ride_payout(uuid), public.captain_compensation_monthly(date) to authenticated;
revoke all on function private.apply_captain_dispute_deductions() from public, anon, authenticated;
