create or replace function public.captain_start_ride(
  p_ride_id uuid,
  p_pickup_otp text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides;
begin
  perform public.require_pilot_user('captain');

  select *
  into v_ride
  from public.rides
  where id = p_ride_id
    and captain_id = auth.uid()
    and status = 'arrived'
  for update;

  if not found
    or p_pickup_otp !~ '^[0-9]{6}$'
    or v_ride.pickup_otp_digest is null
    or v_ride.pickup_otp_expires_at <= now()
    or v_ride.pickup_otp_attempt_count >= 5 then
    raise exception 'Pickup OTP could not be verified';
  end if;

  if v_ride.pickup_otp_digest <> extensions.digest(
    v_ride.pickup_otp_salt || convert_to(p_pickup_otp, 'utf8'),
    'sha256'
  ) then
    update public.rides
    set pickup_otp_attempt_count = pickup_otp_attempt_count + 1
    where id = v_ride.id;

    raise exception 'Pickup OTP could not be verified';
  end if;

  update public.rides
  set
    status = 'in_progress',
    started_at = now(),
    pickup_otp_verified_at = now(),
    pickup_otp_salt = null,
    pickup_otp_digest = null,
    pickup_otp_issued_at = null,
    pickup_otp_expires_at = null
  where id = v_ride.id
  returning * into v_ride;

  insert into public.ride_status_history (ride_id, status, actor_type)
  values (v_ride.id, 'in_progress', 'captain');

  return v_ride;
end;
$$;

revoke all on function public.captain_start_ride(uuid, text) from public, anon;
grant execute on function public.captain_start_ride(uuid, text) to authenticated;
