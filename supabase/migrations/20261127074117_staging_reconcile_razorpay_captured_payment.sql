-- Only the trusted checkout service may report a provider-confirmed capture.
create function public.reconcile_razorpay_captured_ride(p_ride_id uuid, p_customer_id uuid, p_order_id text, p_payment_id text, p_amount_paise integer, p_currency text, p_provider_method text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.razorpay_ride_payments; r public.rides;
begin
  select * into p from public.razorpay_ride_payments where ride_id=p_ride_id and customer_id=p_customer_id and razorpay_order_id=p_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  select * into r from public.rides where id=p_ride_id and customer_id=p_customer_id for update;
  if not found or r.status <> 'completed' or r.customer_charge_type <> 'standard' or round(r.customer_charge_amount*100) <> p.amount_paise
     or p.amount_paise <> p_amount_paise or p.currency <> p_currency or coalesce(p_payment_id,'') !~ '^pay_[A-Za-z0-9]+$'
     or p.status not in ('created','verified') or (p.razorpay_payment_id is not null and p.razorpay_payment_id <> p_payment_id)
     or (r.payment_status <> 'pending' and not (r.payment_status='confirmed' and r.payment_method='razorpay')) then
    raise exception 'Payment or ride state requires manual review';
  end if;
  update public.razorpay_ride_payments set status='verified', razorpay_payment_id=p_payment_id, provider_method=nullif(trim(p_provider_method),''), verified_at=coalesce(verified_at,now()) where id=p.id;
  if r.payment_status='pending' then
    update public.rides set payment_status='confirmed',customer_charge_status='confirmed',payment_method='razorpay',paid_at=now() where id=r.id;
  end if;
end $$;
revoke all on function public.reconcile_razorpay_captured_ride(uuid,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_razorpay_captured_ride(uuid,uuid,text,text,integer,text,text) to service_role;
