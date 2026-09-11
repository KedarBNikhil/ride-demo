-- An open payment issue is handled through support. It is not a pending
-- customer action, so it must not restore the payment screen or block the
-- customer from creating a later ride.
create or replace function public.customer_ride_has_open_payment_issue(p_ride_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('customer');

  return exists (
    select 1
    from public.rides ride
    where ride.id = p_ride_id
      and ride.customer_id = auth.uid()
      and (
        exists (
          select 1
          from public.customer_payment_issues issue
          where issue.ride_id = ride.id and issue.status = 'open'
        )
        or exists (
          select 1
          from public.captain_payment_issues issue
          where issue.ride_id = ride.id and issue.status = 'open'
        )
      )
  );
end;
$$;

revoke all on function public.customer_ride_has_open_payment_issue(uuid) from public, anon;
grant execute on function public.customer_ride_has_open_payment_issue(uuid) to authenticated;

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
          and not exists (
            select 1 from public.customer_payment_issues issue
            where issue.ride_id = existing_ride.id and issue.status = 'open'
          )
          and not exists (
            select 1 from public.captain_payment_issues issue
            where issue.ride_id = existing_ride.id and issue.status = 'open'
          )
        )
      )
  ) then
    raise exception 'A current ride must be settled before booking again';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_customer_ride_booking_invariant() from public, anon, authenticated;
