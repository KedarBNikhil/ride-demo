-- The surcharge decision is a short, authoritative backend deadline.
create or replace function public.customer_approve_fare_quote(p_ride_id uuid, p_accept boolean)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_expired boolean;
begin
  perform public.require_production_user();
  select * into v_ride from public.rides
  where id = p_ride_id and customer_id = auth.uid() and status = 'accepted' and fare_approval_status = 'pending'
  for update;
  if not found then raise exception 'Fare quote is not available'; end if;
  v_expired := v_ride.accepted_at <= now() - interval '30 seconds';
  if p_accept and not v_expired then
    update public.rides set fare_approval_status = 'approved' where id = v_ride.id returning * into v_ride;
    return v_ride;
  end if;
  update public.ride_offers set status = 'cancelled', responded_at = now() where ride_id = v_ride.id and status = 'accepted';
  update public.captain_availability set is_online = true, updated_at = now() where captain_id = v_ride.captain_id;
  update public.rides set status = 'cancelled', cancelled_at = now(), fare_approval_status = 'declined',
    cancellation_reason_code = 'other',
    cancellation_reason_detail = case when v_expired then 'Customer did not confirm updated captain-distance fare within 30 seconds' else 'Customer declined updated captain-distance fare' end,
    cancellation_charge = 0, final_fare = null
  where id = v_ride.id returning * into v_ride;
  return v_ride;
end;
$$;

create or replace function public.process_dispatch_timeouts()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_captain_id uuid; v_processed integer := 0;
begin
  update public.ride_offers set status = 'expired', responded_at = null
  where status = 'offered' and expires_at <= now();

  for v_ride_id, v_captain_id in
    select id, captain_id from public.rides
    where status = 'accepted' and fare_approval_status = 'pending' and accepted_at <= now() - interval '30 seconds'
    for update skip locked
  loop
    update public.ride_offers set status = 'cancelled', responded_at = now() where ride_id = v_ride_id and status = 'accepted';
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = v_captain_id;
    update public.rides set status = 'cancelled', cancelled_at = now(), fare_approval_status = 'declined',
      cancellation_reason_code = 'other', cancellation_reason_detail = 'Customer did not confirm updated captain-distance fare within 30 seconds',
      cancellation_charge = 0, final_fare = null, updated_at = now()
    where id = v_ride_id;
    v_processed := v_processed + 1;
  end loop;

  with expired_searches as (
    update public.rides set status = 'cancelled', cancelled_at = now(), cancellation_reason_code = 'other',
      cancellation_reason_detail = 'No captain accepted within two minutes.', updated_at = now()
    where status = 'searching' and captain_id is null and requested_at <= now() - interval '2 minutes'
    returning id
  ) insert into public.ride_status_history (ride_id, status, actor_type)
  select id, 'cancelled', 'system' from expired_searches;

  for v_ride_id in select id from public.rides where status = 'searching' and captain_id is null order by requested_at for update skip locked loop
    perform public.dispatch_ride_round(v_ride_id);
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$$;
