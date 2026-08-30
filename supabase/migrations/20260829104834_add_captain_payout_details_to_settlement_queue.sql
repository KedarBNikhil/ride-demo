drop function if exists public.operator_captain_settlement_queue(date);

create function public.operator_captain_settlement_queue(p_settlement_date date default null)
returns table (
  batch_id uuid,
  settlement_date date,
  batch_status text,
  settlement_id uuid,
  captain_id uuid,
  captain_name text,
  payout_method text,
  payout_details jsonb,
  approved_rides integer,
  gross_amount numeric,
  adjustments numeric,
  net_amount numeric,
  payout_provider text,
  payout_status text,
  external_reference text,
  paid_at timestamptz,
  notes text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then
    raise exception 'Settlement operator access is required';
  end if;

  return query
  select
    batch.id,
    batch.settlement_date,
    batch.status,
    settlement.id,
    settlement.captain_id,
    profile.full_name,
    application.payout_method,
    application.payout_details,
    count(linked.compensation_id)::integer,
    settlement.gross_amount,
    settlement.adjustments,
    settlement.net_amount,
    settlement.payout_provider,
    settlement.payout_status,
    settlement.external_reference,
    settlement.paid_at,
    settlement.notes
  from public.settlement_batches batch
  join public.captain_settlements settlement on settlement.batch_id = batch.id
  left join public.profiles profile on profile.id = settlement.captain_id
  left join public.captain_onboarding_applications application on application.user_id = settlement.captain_id
  left join public.captain_settlement_earnings linked on linked.settlement_id = settlement.id
  where p_settlement_date is null or batch.settlement_date = p_settlement_date
  group by batch.id, settlement.id, profile.full_name, application.payout_method, application.payout_details
  order by batch.settlement_date desc, profile.full_name nulls last;
end;
$$;

revoke all on function public.operator_captain_settlement_queue(date) from public, anon;
grant execute on function public.operator_captain_settlement_queue(date) to authenticated;
