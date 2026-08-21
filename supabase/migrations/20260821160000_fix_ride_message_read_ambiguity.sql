-- The RETURNS TABLE output parameter `id` shadows an unqualified rides.id
-- reference. Qualify the ride table so participant message reads work.
create or replace function public.ride_messages_for_ride(p_ride_id uuid)
returns table(id uuid, sender_id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user();
  if not exists (
    select 1 from public.rides ride
    where ride.id = p_ride_id and auth.uid() in (ride.customer_id, ride.captain_id)
  ) then
    raise exception 'Ride messages are not available';
  end if;
  return query
    select message.id, message.sender_id, message.body, message.created_at
    from public.ride_messages message
    where message.ride_id = p_ride_id
    order by message.created_at;
end;
$$;

revoke all on function public.ride_messages_for_ride(uuid) from public, anon;
grant execute on function public.ride_messages_for_ride(uuid) to authenticated;
