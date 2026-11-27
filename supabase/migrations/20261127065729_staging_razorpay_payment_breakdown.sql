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
