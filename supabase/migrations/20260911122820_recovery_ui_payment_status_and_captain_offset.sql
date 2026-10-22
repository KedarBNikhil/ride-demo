-- Expose only the caller's latest verification state; operator notes remain private.
drop function public.customer_outstanding_sawaari_balance();
create function public.customer_outstanding_sawaari_balance()
returns table (amount_due numeric, status text, adjustment_id uuid, reason_code text, rejection_reason text)
language sql security definer set search_path = '' as $$
  select a.remaining_amount, coalesce(r.status, 'PENDING'), a.id, a.reason_code, r.rejection_reason
  from public.financial_adjustments a left join lateral (select status,rejection_reason from public.financial_adjustment_payment_requests where adjustment_id=a.id order by submitted_at desc limit 1) r on true
  where a.account_type='CUSTOMER' and a.customer_id=auth.uid() and a.remaining_amount>0 and a.status in ('PENDING','PARTIALLY_APPLIED') order by a.created_at;
$$;
drop function public.captain_outstanding_sawaari_balance();
create function public.captain_outstanding_sawaari_balance()
returns table (amount_due numeric, status text, adjustment_id uuid, reason_code text, block_threshold numeric, rejection_reason text)
language sql security definer set search_path = '' as $$
  select a.remaining_amount, coalesce(r.status, 'PENDING'), a.id, a.reason_code, 200::numeric, r.rejection_reason
  from public.financial_adjustments a left join lateral (select status,rejection_reason from public.financial_adjustment_payment_requests where adjustment_id=a.id order by submitted_at desc limit 1) r on true
  where a.account_type='CAPTAIN' and a.captain_id=auth.uid() and a.remaining_amount>0 and a.status in ('PENDING','PARTIALLY_APPLIED') order by a.created_at;
$$;

-- Only Sawaari-controlled settlement amounts can offset Captain debt. Cash rides never enter this trigger.
create or replace function private.offset_captain_debt_from_settlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.financial_adjustments; v_available numeric(10,2) := new.net_amount; v_apply numeric(10,2); v_total numeric(10,2) := 0;
begin
  for a in select * from public.financial_adjustments where account_type='CAPTAIN' and captain_id=new.captain_id and remaining_amount>0 and status in ('PENDING','PARTIALLY_APPLIED') order by created_at,id for update loop
    exit when v_available <= 0;
    v_apply := least(a.remaining_amount,v_available);
    insert into public.financial_adjustment_applications(adjustment_id,settlement_id,amount_applied) values(a.id,new.id,v_apply);
    update public.financial_adjustments set remaining_amount=remaining_amount-v_apply,status=case when remaining_amount-v_apply=0 then 'APPLIED' else 'PARTIALLY_APPLIED' end,completed_at=case when remaining_amount-v_apply=0 then now() else null end where id=a.id;
    v_available:=v_available-v_apply; v_total:=v_total+v_apply;
  end loop;
  if v_total>0 then update public.captain_settlements set net_amount=greatest(net_amount-v_total,0) where id=new.id; end if;
  return new;
end;
$$;
create trigger offset_captain_debt_from_settlement after insert on public.captain_settlements for each row execute function private.offset_captain_debt_from_settlement();
revoke all on function private.offset_captain_debt_from_settlement() from public,anon,authenticated;
