-- `payout_id` is an output-column variable of this RETURNS TABLE function.
-- Qualify the dispute lookup so Postgres never interprets it as that variable.
create or replace function public.operator_captain_payout_queue(p_status text default null)
returns table (
  payout_id uuid,
  ride_id uuid,
  captain_id uuid,
  captain_earning_amount numeric,
  customer_charge_amount numeric,
  payout_status text,
  provider text,
  provider_reference text,
  dispute_status text,
  dispute_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then
    raise exception 'Settlement operator access is required';
  end if;

  if p_status is not null and p_status not in (
    'not_started', 'initiated', 'processing', 'paid', 'failed', 'reversed', 'held'
  ) then
    raise exception 'Invalid payout status';
  end if;

  return query
  select
    payout.id,
    compensation.ride_id,
    compensation.captain_id,
    compensation.captain_earning_amount,
    compensation.customer_charge_amount,
    payout.status,
    payout.provider,
    payout.provider_reference,
    dispute.status,
    dispute.reason
  from public.captain_payouts as payout
  join public.captain_compensations as compensation
    on compensation.id = payout.compensation_id
  left join lateral (
    select payout_dispute.status, payout_dispute.reason
    from public.captain_payout_disputes as payout_dispute
    where payout_dispute.payout_id = payout.id
      and payout_dispute.status in ('open', 'under_review')
    order by payout_dispute.opened_at desc
    limit 1
  ) as dispute on true
  where p_status is null or payout.status = p_status
  order by payout.updated_at asc;
end;
$$;
