-- Captain dues will be surfaced by the future wallet, not through a manual
-- UPI/UTR repayment flow. Keep the ledger and automatic settlement offsets.
drop function if exists public.captain_outstanding_sawaari_balance();

create or replace function public.submit_financial_adjustment_payment(p_adjustment_id uuid, p_amount numeric, p_utr_reference text)
returns public.financial_adjustment_payment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.financial_adjustments;
  r public.financial_adjustment_payment_requests;
  v_utr text;
begin
  v_utr := trim(coalesce(p_utr_reference, ''));
  select * into a
  from public.financial_adjustments
  where id = p_adjustment_id
    and remaining_amount > 0
    and status in ('PENDING', 'PARTIALLY_APPLIED')
  for update;

  if not found or a.account_type <> 'CUSTOMER' or a.customer_id <> auth.uid() then
    raise exception 'Customer outstanding balance not found';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > a.remaining_amount or char_length(v_utr) not between 6 and 120 then
    raise exception 'A valid UTR and amount due are required';
  end if;

  insert into public.financial_adjustment_payment_requests(
    adjustment_id, account_type, customer_id, captain_id, amount, utr_reference
  ) values (
    a.id, 'CUSTOMER', a.customer_id, null, p_amount, v_utr
  )
  on conflict (adjustment_id, utr_reference) do update set utr_reference = excluded.utr_reference
  returning * into r;
  return r;
end;
$$;

revoke all on function public.submit_financial_adjustment_payment(uuid, numeric, text) from public, anon;
grant execute on function public.submit_financial_adjustment_payment(uuid, numeric, text) to authenticated;
