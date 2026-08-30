-- An OTP is released to the customer only after the assigned captain marks
-- the ride as arrived. Keep the existing per-ride digest, expiry, and ACLs.
create or replace function public.issue_customer_pickup_otp(p_ride_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_bytes bytea; v_otp text; v_salt bytea; v_value bigint;
begin
  perform public.require_pilot_user('customer');
  select * into v_ride from public.rides where id = p_ride_id and customer_id = auth.uid()
    and status = 'arrived' and fare_approval_status = 'approved' for update;
  if not found then raise exception 'Pickup OTP is not available for this ride'; end if;
  if v_ride.pickup_otp_issued_at is not null and v_ride.pickup_otp_issued_at > now() - interval '60 seconds' then
    raise exception 'Please wait before generating another pickup OTP';
  end if;
  v_bytes := gen_random_bytes(4);
  v_value := ((get_byte(v_bytes, 0)::bigint << 24) + (get_byte(v_bytes, 1)::bigint << 16) + (get_byte(v_bytes, 2)::bigint << 8) + get_byte(v_bytes, 3)::bigint) % 1000000;
  v_otp := lpad(v_value::text, 6, '0');
  v_salt := gen_random_bytes(16);
  update public.rides set pickup_otp_salt = v_salt, pickup_otp_digest = digest(v_salt || convert_to(v_otp, 'utf8'), 'sha256'),
    pickup_otp_issued_at = now(), pickup_otp_expires_at = now() + interval '30 minutes', pickup_otp_attempt_count = 0, pickup_otp_verified_at = null
  where id = v_ride.id;
  return v_otp;
end;
$$;

revoke all on function public.issue_customer_pickup_otp(uuid) from public, anon;
grant execute on function public.issue_customer_pickup_otp(uuid) to authenticated;
