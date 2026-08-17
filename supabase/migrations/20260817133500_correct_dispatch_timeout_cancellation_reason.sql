-- Keep automatic no-captain expiry compatible with the customer cancellation
-- reason constraint while retaining an explicit system-generated explanation.
create or replace function public.process_dispatch_timeouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride_id uuid;
  v_processed integer := 0;
begin
  update public.ride_offers
  set status = 'expired', responded_at = null
  where status = 'offered'
    and expires_at <= now();

  with expired_searches as (
    update public.rides
    set status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason_code = 'other',
        cancellation_reason_detail = 'No captain accepted within two minutes.',
        updated_at = now()
    where status = 'searching'
      and captain_id is null
      and requested_at <= now() - interval '2 minutes'
    returning id
  )
  insert into public.ride_status_history (ride_id, status, actor_type)
  select id, 'cancelled', 'system'
  from expired_searches;

  for v_ride_id in
    select id
    from public.rides
    where status = 'searching' and captain_id is null
    order by requested_at
    for update skip locked
  loop
    perform public.dispatch_ride_round(v_ride_id);
    v_processed := v_processed + 1;
  end loop;

  return v_processed;
end;
$$;

revoke all on function public.process_dispatch_timeouts() from public, anon, authenticated;
