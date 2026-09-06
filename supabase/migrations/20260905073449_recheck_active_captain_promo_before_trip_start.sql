-- Last redemption boundary: an accepted reservation can become ineligible if
-- the matching Captain is approved after booking.  Convert it to the normal
-- paid fare before arrival/OTP; never let the Captain start it as a free ride.
create or replace function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_compensation_id uuid;
  v_payout_id uuid;
  v_fare numeric(10,2);
  v_repriced boolean := false;
begin
  perform public.require_pilot_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status = 'completed' and p_next_status = 'completed' then return v_ride; end if;

  if v_ride.status = 'accepted' and p_next_status = 'arrived' then
    v_repriced := private.reprice_active_captain_promo_ride(v_ride, coalesce(v_ride.final_fare, v_ride.estimated_fare));
    select * into v_ride from public.rides where id = p_ride_id for update;
  end if;

  if v_ride.status = 'accepted' and v_ride.customer_charge_type <> 'free' and v_ride.fare_approval_status <> 'approved' then
    if v_repriced then
      -- Keep the paid-fare update committed. The Captain cannot progress: a
      -- subsequent start attempt returns no ride until the customer approves.
      return v_ride;
    end if;
    raise exception 'Customer has not approved the final fare';
  end if;
  if v_ride.status = 'accepted' and p_next_status = 'arrived' then
    update public.rides set status = 'arrived', arrived_at = now() where id = p_ride_id returning * into v_ride;
  elsif v_ride.status = 'in_progress' and p_next_status = 'completed' then
    update public.rides set status = 'completed', completed_at = now(), final_fare = coalesce(final_fare, estimated_fare) where id = p_ride_id returning * into v_ride;
    v_fare := coalesce(v_ride.final_fare, v_ride.estimated_fare);
    insert into public.captain_earnings_ledger(captain_id, ride_id, entry_type, amount, occurred_at, note) values (auth.uid(), v_ride.id, 'ride_earning', v_fare, v_ride.completed_at, 'Completed ride; not a settlement or payout') on conflict (ride_id, entry_type) do nothing;
    insert into public.captain_compensations(ride_id, captain_id, customer_charge_amount, captain_earning_amount, earning_status, verified_at, normal_ride_fare, tip_amount, bonus_amount, adjustment_amount, total_company_payable)
      values (v_ride.id, auth.uid(), v_ride.customer_charge_amount, v_fare, 'earned', v_ride.completed_at, v_fare, 0, 0, 0, case when v_ride.customer_charge_type = 'free' then v_fare else 0 end)
      on conflict (ride_id) do nothing returning id into v_compensation_id;
    if v_compensation_id is null then select id into v_compensation_id from public.captain_compensations where ride_id = v_ride.id; end if;
    insert into public.captain_ride_verifications(compensation_id) values (v_compensation_id) on conflict (compensation_id) do nothing;
    insert into public.captain_payouts(compensation_id) values (v_compensation_id) on conflict (compensation_id) do nothing returning id into v_payout_id;
    if v_payout_id is null then select id into v_payout_id from public.captain_payouts where compensation_id = v_compensation_id; end if;
    insert into public.captain_payout_events(payout_id, event_type, actor_id, note) values (v_payout_id, 'compensation_created', auth.uid(), 'Completed ride compensation created') on conflict do nothing;
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = auth.uid();
  else
    raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history(ride_id, status, actor_type) values (v_ride.id, v_ride.status, 'captain');
  return v_ride;
end;
$$;

create or replace function public.issue_customer_pickup_otp(p_ride_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
  v_bytes bytea;
  v_otp text;
  v_salt bytea;
  v_value bigint;
begin
  perform public.require_pilot_user('customer');
  select * into v_ride from public.rides where id = p_ride_id and customer_id = auth.uid()
    and status = 'arrived' and fare_approval_status = 'approved' for update;
  if not found then raise exception 'Pickup OTP is not available for this ride'; end if;

  if v_ride.customer_charge_type = 'free' then
    perform private.reprice_active_captain_promo_ride(v_ride, coalesce(v_ride.final_fare, v_ride.estimated_fare));
    if private.has_active_captain_for_verified_phone(v_ride.customer_id) then
      -- Persist the normal paid-fare update and withhold the OTP.  The caller
      -- receives no OTP, so the Captain cannot start a subsidized ride.
      return null;
    end if;
  end if;

  if v_ride.pickup_otp_issued_at is not null and v_ride.pickup_otp_issued_at > now() - interval '60 seconds' then
    raise exception 'Please wait before generating another pickup OTP';
  end if;
  v_bytes := extensions.gen_random_bytes(4);
  v_value := (((get_byte(v_bytes, 0)::bigint << 24) + (get_byte(v_bytes, 1)::bigint << 16) + (get_byte(v_bytes, 2)::bigint << 8) + get_byte(v_bytes, 3)::bigint) % 1000000);
  v_otp := lpad(v_value::text, 6, '0');
  v_salt := extensions.gen_random_bytes(16);
  update public.rides set pickup_otp_salt = v_salt, pickup_otp_digest = extensions.digest(v_salt || convert_to(v_otp, 'utf8'), 'sha256'),
    pickup_otp_issued_at = now(), pickup_otp_expires_at = now() + interval '30 minutes', pickup_otp_attempt_count = 0, pickup_otp_verified_at = null
  where id = v_ride.id;
  return v_otp;
end;
$$;

create or replace function public.captain_start_ride(p_ride_id uuid, p_pickup_otp text)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
begin
  perform public.require_pilot_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() and status = 'arrived' for update;
  if not found
    or p_pickup_otp !~ '^[0-9]{6}$'
    or v_ride.pickup_otp_digest is null
    or v_ride.pickup_otp_expires_at <= now()
    or v_ride.pickup_otp_attempt_count >= 5 then
    raise exception 'Pickup OTP could not be verified';
  end if;

  if v_ride.customer_charge_type = 'free' then
    perform private.reprice_active_captain_promo_ride(v_ride, coalesce(v_ride.final_fare, v_ride.estimated_fare));
    if private.has_active_captain_for_verified_phone(v_ride.customer_id) then
      -- Persist the reprice but return no ride.  The app treats this exactly
      -- as an unsuccessful OTP, so it cannot navigate to an in-progress trip.
      return null;
    end if;
  end if;

  if v_ride.pickup_otp_digest <> extensions.digest(v_ride.pickup_otp_salt || convert_to(p_pickup_otp, 'utf8'), 'sha256') then
    update public.rides set pickup_otp_attempt_count = pickup_otp_attempt_count + 1 where id = v_ride.id;
    raise exception 'Pickup OTP could not be verified';
  end if;
  update public.rides set status = 'in_progress', started_at = now(), pickup_otp_verified_at = now(), pickup_otp_salt = null, pickup_otp_digest = null,
    pickup_otp_issued_at = null, pickup_otp_expires_at = null where id = v_ride.id returning * into v_ride;
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, 'in_progress', 'captain');
  return v_ride;
end;
$$;

revoke all on function public.captain_transition_ride(uuid,text), public.issue_customer_pickup_otp(uuid), public.captain_start_ride(uuid,text) from public, anon;
grant execute on function public.captain_transition_ride(uuid,text), public.issue_customer_pickup_otp(uuid), public.captain_start_ride(uuid,text) to authenticated;
