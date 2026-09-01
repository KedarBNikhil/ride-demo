-- Keep this compatibility RPC independently authorized.  The OTP issuer repeats
-- these checks while holding the ride row lock before it creates any secret.
create or replace function public.customer_pickup_pin(p_ride_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('customer');

  if not exists (
    select 1
    from public.rides ride
    where ride.id = p_ride_id
      and ride.customer_id = auth.uid()
      and ride.status = 'arrived'
      and ride.fare_approval_status = 'approved'
  ) then
    raise exception 'Pickup OTP is not available for this ride';
  end if;

  return public.issue_customer_pickup_otp(p_ride_id);
end;
$$;

revoke all on function public.customer_pickup_pin(uuid) from public, anon;
grant execute on function public.customer_pickup_pin(uuid) to authenticated;
