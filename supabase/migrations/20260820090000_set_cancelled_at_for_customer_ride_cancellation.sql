-- The customer client treats a cancellation as durable only when both the
-- terminal status and timestamp are returned. Keep this consistent for every
-- eligible stage, including when the captain has arrived.
create or replace function public.customer_cancel_ride(p_ride_id uuid, p_reason_code text, p_reason_detail text default null)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_production_user();

  if p_reason_code not in ('change_plans','another_ride','wait_time','fare_concern','captain_unreachable','other') then
    raise exception 'Invalid cancellation reason';
  end if;
  if p_reason_code = 'other' and char_length(trim(coalesce(p_reason_detail, ''))) not between 1 and 180 then
    raise exception 'Cancellation detail is required';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
    and customer_id = auth.uid()
    and status in ('requested', 'searching', 'accepted', 'arrived', 'in_progress')
  for update;

  if not found then
    raise exception 'Ride can no longer be cancelled';
  end if;

  update public.rides
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason_code = p_reason_code,
      cancellation_reason_detail = case when p_reason_code = 'other' then trim(p_reason_detail) else null end,
      cancellation_charge = 0,
      final_fare = null
  where id = v_ride.id
  returning * into v_ride;

  update public.ride_offers
  set status = 'cancelled', responded_at = null
  where ride_id = v_ride.id and status in ('offered', 'accepted');

  update public.captain_availability
  set is_online = true, updated_at = now()
  where captain_id = v_ride.captain_id;

  return v_ride;
end;
$$;
