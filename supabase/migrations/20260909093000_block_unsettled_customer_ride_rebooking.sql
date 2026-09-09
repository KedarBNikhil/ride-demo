-- A Captain completing the driving phase does not make a standard ride
-- bookable again.  Serialize every new ride insertion by Customer identity so
-- two client requests cannot both observe an empty active-ride set.
create or replace function private.enforce_customer_ride_booking_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('requested', 'searching', 'accepted', 'arrived', 'in_progress') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text, 0));

  if exists (
    select 1
    from public.rides existing_ride
    where existing_ride.customer_id = new.customer_id
      and (
        existing_ride.status in ('requested', 'searching', 'accepted', 'arrived', 'in_progress')
        or (
          existing_ride.status = 'completed'
          and existing_ride.payment_status in ('pending', 'declared')
        )
      )
  ) then
    raise exception 'A current ride must be settled before booking again';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_customer_ride_booking_invariant() from public, anon, authenticated;

drop trigger if exists enforce_customer_ride_booking_invariant on public.rides;
create trigger enforce_customer_ride_booking_invariant
before insert on public.rides
for each row execute function private.enforce_customer_ride_booking_invariant();
