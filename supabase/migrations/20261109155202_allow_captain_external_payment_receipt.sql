-- A captain may attest that an offline payment was received even when the
-- customer did not open the in-app payment screen. Keep that distinct from a
-- customer-declared Cash/UPI method and from Razorpay-verified payments.
alter table public.rides
  drop constraint if exists rides_customer_charge_payment_consistency;

alter table public.rides add constraint rides_customer_charge_payment_consistency check (
  (customer_charge_type = 'free' and customer_charge_amount = 0 and customer_charge_status = 'not_required' and payment_status = 'not_required' and payment_method is null)
  or (customer_charge_type = 'standard' and customer_charge_amount >= 0 and customer_charge_status in ('pending', 'declared', 'confirmed') and payment_status in ('pending', 'declared', 'confirmed')
    and ((payment_status = 'pending' and payment_method is null) or (payment_status in ('declared', 'confirmed') and payment_method in ('cash', 'upi', 'razorpay', 'external')))
);

create or replace function public.captain_confirm_payment_received(p_ride_id uuid)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_settlement_id uuid;
begin
  perform public.require_pilot_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found or v_ride.status <> 'completed' or v_ride.customer_charge_type <> 'standard' then raise exception 'Payment is not available for this ride'; end if;
  if v_ride.payment_status = 'confirmed' then return v_ride; end if;

  update public.rides
  set payment_status = 'confirmed', customer_charge_status = 'confirmed',
      payment_method = case when v_ride.payment_status = 'pending' then 'external' else v_ride.payment_method end,
      paid_at = now()
  where id = v_ride.id returning * into v_ride;

  select id into v_settlement_id from public.ride_settlements where ride_id = v_ride.id;
  if v_settlement_id is not null then
    insert into public.ride_settlement_events(settlement_id, event_type, actor_id, metadata)
    values (v_settlement_id, 'confirmed', auth.uid(), jsonb_build_object('payment_method', v_ride.payment_method, 'confirmed_by', 'captain')) on conflict do nothing;
  end if;
  return v_ride;
end;
$$;

revoke all on function public.captain_confirm_payment_received(uuid) from public, anon;
grant execute on function public.captain_confirm_payment_received(uuid) to authenticated;
