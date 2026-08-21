-- The current demo sessions are authenticated anonymous users while pilot auth
-- enforcement is off. This must match the guard used by the surrounding ride
-- lifecycle, otherwise selecting Cash/UPI always fails before the update.
create or replace function public.customer_confirm_payment(p_ride_id uuid, p_method text) returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_settlement_id uuid;
begin
  perform public.require_pilot_user('customer');
  if p_method not in ('cash', 'upi') then raise exception 'Invalid payment method'; end if;
  update public.rides set payment_status = 'declared', customer_charge_status = 'declared', payment_method = p_method, paid_at = null
    where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and customer_charge_type = 'standard' and payment_status = 'pending' returning * into v_ride;
  if not found then raise exception 'Payment method is not available for this ride'; end if;
  insert into public.ride_settlements (ride_id, declared_method, amount_due, declared_by) values (v_ride.id, p_method, v_ride.customer_charge_amount, auth.uid()) returning id into v_settlement_id;
  insert into public.ride_settlement_events (settlement_id, event_type, actor_id, metadata) values (v_settlement_id, 'declared', auth.uid(), jsonb_build_object('declared_method', p_method));
  return v_ride;
end; $$;
revoke all on function public.customer_confirm_payment(uuid, text) from public, anon;
grant execute on function public.customer_confirm_payment(uuid, text) to authenticated;

-- Realtime evaluates SELECT access, so grant only ride participants direct read
-- access to the messages they are already authorized to retrieve through RPC.
grant select on public.ride_messages to authenticated;
create policy "Ride participants read messages" on public.ride_messages for select to authenticated using (
  exists (select 1 from public.rides ride where ride.id = ride_messages.ride_id and auth.uid() in (ride.customer_id, ride.captain_id))
);
