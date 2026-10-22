-- Direct cash belongs only to the current Captain. Dispute balances are paid
-- to Sawaari and released only by an operator-verified UPI reference.
create table public.financial_adjustment_payment_requests (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.financial_adjustments(id) on delete restrict,
  account_type text not null check (account_type in ('CUSTOMER','CAPTAIN')),
  customer_id uuid references public.profiles(id) on delete restrict,
  captain_id uuid references public.profiles(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  payment_method text not null default 'UPI' check (payment_method = 'UPI'),
  payee_upi_id text not null default '9030279703@ibl' check (payee_upi_id = '9030279703@ibl'),
  utr_reference text not null check (char_length(trim(utr_reference)) between 6 and 120),
  status text not null default 'PENDING_VERIFICATION' check (status in ('PENDING_VERIFICATION','VERIFIED','REJECTED')),
  submitted_at timestamptz not null default now(), verified_at timestamptz, verified_by uuid references public.profiles(id) on delete restrict, rejection_reason text,
  constraint financial_adjustment_payment_request_owner_check check ((account_type = 'CUSTOMER' and customer_id is not null and captain_id is null) or (account_type = 'CAPTAIN' and captain_id is not null and customer_id is null)),
  unique (adjustment_id, utr_reference)
);
alter table public.financial_adjustment_payment_requests enable row level security;
revoke all on public.financial_adjustment_payment_requests from public, anon, authenticated;
grant select, insert, update, delete on public.financial_adjustment_payment_requests to service_role;
alter table public.financial_adjustment_applications drop constraint financial_adjustment_applications_adjustment_id_ride_id_key;
alter table public.financial_adjustment_applications add column payment_request_id uuid references public.financial_adjustment_payment_requests(id) on delete restrict;
alter table public.financial_adjustment_applications add constraint financial_adjustment_applications_adjustment_payment_request_key unique (adjustment_id, payment_request_id);

create or replace function private.block_customer_booking_with_balance() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('requested','searching') and exists (select 1 from public.financial_adjustments a where a.account_type = 'CUSTOMER' and a.customer_id = new.customer_id and a.direction = 'DEBIT' and a.remaining_amount > 0 and a.status in ('PENDING','PARTIALLY_APPLIED')) then
    raise exception 'OUTSTANDING_SAWAARI_BALANCE';
  end if;
  return new;
end;
$$;
create trigger block_customer_booking_with_balance before insert on public.rides for each row execute function private.block_customer_booking_with_balance();

create or replace function public.customer_outstanding_sawaari_balance()
returns table (amount_due numeric, status text, adjustment_id uuid, reason_code text)
language sql security definer set search_path = '' as $$
  select a.remaining_amount, coalesce((select r.status from public.financial_adjustment_payment_requests r where r.adjustment_id = a.id and r.status = 'PENDING_VERIFICATION' order by r.submitted_at desc limit 1), 'PENDING'), a.id, a.reason_code
  from public.financial_adjustments a where a.account_type = 'CUSTOMER' and a.customer_id = auth.uid() and a.remaining_amount > 0 and a.status in ('PENDING','PARTIALLY_APPLIED') order by a.created_at;
$$;
create or replace function public.captain_outstanding_sawaari_balance()
returns table (amount_due numeric, status text, adjustment_id uuid, reason_code text, block_threshold numeric)
language sql security definer set search_path = '' as $$
  select a.remaining_amount, coalesce((select r.status from public.financial_adjustment_payment_requests r where r.adjustment_id = a.id and r.status = 'PENDING_VERIFICATION' order by r.submitted_at desc limit 1), 'PENDING'), a.id, a.reason_code, 200::numeric
  from public.financial_adjustments a where a.account_type = 'CAPTAIN' and a.captain_id = auth.uid() and a.remaining_amount > 0 and a.status in ('PENDING','PARTIALLY_APPLIED') order by a.created_at;
$$;

create or replace function public.submit_financial_adjustment_payment(p_adjustment_id uuid, p_amount numeric, p_utr_reference text)
returns public.financial_adjustment_payment_requests language plpgsql security definer set search_path = '' as $$
declare a public.financial_adjustments; r public.financial_adjustment_payment_requests; v_utr text;
begin
  v_utr := trim(coalesce(p_utr_reference,''));
  select * into a from public.financial_adjustments where id = p_adjustment_id and remaining_amount > 0 and status in ('PENDING','PARTIALLY_APPLIED') for update;
  if not found or (a.account_type = 'CUSTOMER' and a.customer_id <> auth.uid()) or (a.account_type = 'CAPTAIN' and a.captain_id <> auth.uid()) then raise exception 'Outstanding balance not found'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > a.remaining_amount or char_length(v_utr) not between 6 and 120 then raise exception 'A valid UTR and amount due are required'; end if;
  insert into public.financial_adjustment_payment_requests(adjustment_id,account_type,customer_id,captain_id,amount,utr_reference) values (a.id,a.account_type,a.customer_id,a.captain_id,p_amount,v_utr) on conflict (adjustment_id,utr_reference) do update set utr_reference = excluded.utr_reference returning * into r;
  return r;
end;
$$;

create or replace function public.operator_adjustment_payment_requests()
returns table (request_id uuid, account_type text, customer_name text, captain_name text, amount numeric, utr_reference text, status text, adjustment_id uuid, source_ride_id uuid, submitted_at timestamptz, rejection_reason text)
language sql security definer set search_path = '' as $$
  select r.id,r.account_type,customer.full_name,captain.full_name,r.amount,r.utr_reference,r.status,r.adjustment_id,a.source_ride_id,r.submitted_at,r.rejection_reason from public.financial_adjustment_payment_requests r join public.financial_adjustments a on a.id=r.adjustment_id left join public.profiles customer on customer.id=r.customer_id left join public.profiles captain on captain.id=r.captain_id where public.is_settlement_operator() order by r.submitted_at desc;
$$;
create or replace function public.operator_review_adjustment_payment(p_request_id uuid, p_action text, p_note text default null)
returns public.financial_adjustment_payment_requests language plpgsql security definer set search_path = '' as $$
declare r public.financial_adjustment_payment_requests; a public.financial_adjustments;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_action not in ('VERIFIED','REJECTED') then raise exception 'Invalid verification action'; end if;
  select * into r from public.financial_adjustment_payment_requests where id=p_request_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  if r.status <> 'PENDING_VERIFICATION' then return r; end if;
  if p_action = 'REJECTED' then update public.financial_adjustment_payment_requests set status='REJECTED',verified_at=now(),verified_by=auth.uid(),rejection_reason=nullif(trim(coalesce(p_note,'')),'') where id=r.id returning * into r; return r; end if;
  select * into a from public.financial_adjustments where id=r.adjustment_id for update;
  if r.amount > a.remaining_amount then raise exception 'Payment exceeds remaining balance'; end if;
  insert into public.financial_adjustment_applications(adjustment_id,ride_id,payment_request_id,amount_applied) values (a.id,a.source_ride_id,r.id,r.amount);
  update public.financial_adjustments set remaining_amount=remaining_amount-r.amount,status=case when remaining_amount-r.amount=0 then 'APPLIED' else 'PARTIALLY_APPLIED' end,completed_at=case when remaining_amount-r.amount=0 then now() else null end where id=a.id;
  update public.financial_adjustment_payment_requests set status='VERIFIED',verified_at=now(),verified_by=auth.uid(),rejection_reason=null where id=r.id returning * into r;
  return r;
end;
$$;

-- Never apply a dispute adjustment during direct cash collection.
drop trigger if exists apply_captain_dispute_deductions on public.captain_compensations;
create or replace function public.customer_ride_payment_breakdown(p_ride_id uuid)
returns table (ride_fare numeric, previous_ride_adjustment numeric, total_payable numeric, adjustment_reason text)
language sql security definer set search_path = '' as $$ select r.customer_charge_amount, 0::numeric, r.customer_charge_amount, null::text from public.rides r where r.id=p_ride_id and r.customer_id=auth.uid() and r.status='completed'; $$;
create or replace function public.customer_confirm_payment(p_ride_id uuid, p_method text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_settlement_id uuid;
begin
 perform public.require_pilot_user('customer'); if p_method <> 'cash' then raise exception 'Cash is the only payment method during this pilot'; end if;
 update public.rides set payment_status='declared',customer_charge_status='declared',payment_method='cash',paid_at=null where id=p_ride_id and customer_id=auth.uid() and status='completed' and customer_charge_type='standard' and payment_status='pending' returning * into v_ride;
 if not found then raise exception 'Cash payment is not available for this ride'; end if;
 insert into public.ride_settlements(ride_id,declared_method,amount_due,declared_by) values(v_ride.id,'cash',v_ride.customer_charge_amount,auth.uid()) returning id into v_settlement_id;
 insert into public.ride_settlement_events(settlement_id,event_type,actor_id,metadata) values(v_settlement_id,'declared',auth.uid(),jsonb_build_object('declared_method','cash','ride_fare',v_ride.customer_charge_amount)); return v_ride;
end; $$;

create or replace function public.captain_set_availability(p_is_online boolean, p_latitude numeric default null, p_longitude numeric default null) returns void language plpgsql security definer set search_path = '' as $$
begin
 perform public.require_pilot_user('captain');
 if p_is_online and not exists(select 1 from public.rides where captain_id=auth.uid() and status in ('accepted','arrived','in_progress')) and coalesce((select sum(remaining_amount) from public.financial_adjustments where account_type='CAPTAIN' and captain_id=auth.uid() and status in ('PENDING','PARTIALLY_APPLIED')),0) > 200 then raise exception 'OUTSTANDING_SAWAARI_BALANCE'; end if;
 if (p_latitude is null) <> (p_longitude is null) or (p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180)) then raise exception 'Invalid availability location'; end if;
 insert into public.captain_availability(captain_id,is_online,latitude,longitude,updated_at) values(auth.uid(),p_is_online,p_latitude,p_longitude,now()) on conflict(captain_id) do update set is_online=excluded.is_online,latitude=coalesce(excluded.latitude,public.captain_availability.latitude),longitude=coalesce(excluded.longitude,public.captain_availability.longitude),updated_at=now();
end; $$;

revoke all on function public.customer_outstanding_sawaari_balance(),public.captain_outstanding_sawaari_balance(),public.submit_financial_adjustment_payment(uuid,numeric,text),public.operator_adjustment_payment_requests(),public.operator_review_adjustment_payment(uuid,text,text) from public,anon;
grant execute on function public.customer_outstanding_sawaari_balance(),public.captain_outstanding_sawaari_balance(),public.submit_financial_adjustment_payment(uuid,numeric,text),public.operator_adjustment_payment_requests(),public.operator_review_adjustment_payment(uuid,text,text) to authenticated;
