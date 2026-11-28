-- Operator view of Sawaari's recorded Razorpay attempts; it does not assert bank settlement or Captain payout.
create function public.operator_razorpay_ride_payments()
returns table(ride_id uuid, customer_name text, captain_name text, pickup_address text, drop_address text,
  ride_completed_at timestamptz, fare numeric, customer_charge numeric, amount_paise integer,
  payment_status text, ride_payment_status text, ride_payment_method text, provider_method text, order_id text, payment_id text, created_at timestamptz, verified_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  return query select r.id, customer.full_name, captain.full_name, r.pickup_address, r.drop_address,
    r.completed_at, coalesce(r.final_fare,r.estimated_fare), r.customer_charge_amount, p.amount_paise,
    p.status, r.payment_status, r.payment_method, p.provider_method, p.razorpay_order_id, p.razorpay_payment_id, p.created_at, p.verified_at
  from public.razorpay_ride_payments p join public.rides r on r.id = p.ride_id and r.customer_id = p.customer_id
  left join public.profiles customer on customer.id = r.customer_id
  left join public.profiles captain on captain.id = r.captain_id
  order by p.created_at desc limit 500;
end $$;
revoke all on function public.operator_razorpay_ride_payments() from public, anon;
grant execute on function public.operator_razorpay_ride_payments() to authenticated;
-- Expose only the recorded earning fact. Payout, fee and tax rules are not set.
create function public.operator_razorpay_ride_earning(p_ride_id uuid)
returns table(captain_earning_amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  return query select c.captain_earning_amount
    from public.razorpay_ride_payments p
    join public.rides r on r.id = p.ride_id and r.customer_id = p.customer_id
    left join public.captain_compensations c on c.ride_id = r.id and c.captain_id = r.captain_id
    where r.id = p_ride_id;
end $$;
revoke all on function public.operator_razorpay_ride_earning(uuid) from public, anon;
grant execute on function public.operator_razorpay_ride_earning(uuid) to authenticated;
