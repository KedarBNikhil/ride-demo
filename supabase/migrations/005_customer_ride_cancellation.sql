-- Phase 2: allow a customer to cancel only their own active ride.
-- The database, rather than the mobile client, owns the cancellation timestamp
-- and the immutable status-history entry.

alter table public.rides
  add column cancellation_reason_code text,
  add column cancellation_reason_detail text,
  add constraint cancellation_reason_code_is_valid
    check (cancellation_reason_code is null or cancellation_reason_code in (
      'change_plans', 'another_ride', 'wait_time', 'fare_concern', 'captain_unreachable', 'other'
    )),
  add constraint cancelled_ride_has_reason
    check (status <> 'cancelled' or cancellation_reason_code is not null),
  add constraint other_cancellation_reason_has_detail
    check (
      cancellation_reason_code <> 'other'
      or char_length(trim(coalesce(cancellation_reason_detail, ''))) between 1 and 180
    ),
  add constraint non_other_cancellation_reason_has_no_detail
    check (
      cancellation_reason_code is null
      or cancellation_reason_code = 'other'
      or cancellation_reason_detail is null
    );

create function public.set_customer_cancellation_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if old.status not in ('requested', 'searching', 'accepted') then
      raise exception 'This ride can no longer be cancelled';
    end if;
    new.cancelled_at = now();
  end if;
  return new;
end;
$$;

create trigger rides_set_customer_cancellation_timestamp
before update of status on public.rides
for each row execute function public.set_customer_cancellation_timestamp();

create function public.add_customer_cancellation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.ride_status_history (ride_id, status, actor_type)
    values (new.id, 'cancelled', 'customer');
  end if;
  return new;
end;
$$;

create trigger rides_add_customer_cancellation_history
after update of status on public.rides
for each row execute function public.add_customer_cancellation_history();

revoke update on table public.rides from authenticated;
grant update (status, cancellation_reason_code, cancellation_reason_detail) on public.rides to authenticated;

create policy "Customers can cancel their own active rides"
on public.rides for update to authenticated
using (
  (select auth.uid()) = customer_id
  and status in ('requested', 'searching', 'accepted')
)
with check (
  (select auth.uid()) = customer_id
  and status = 'cancelled'
  and cancellation_reason_code is not null
  and final_fare is null
  and completed_at is null
);

revoke execute on function public.set_customer_cancellation_timestamp() from public, anon, authenticated;
revoke execute on function public.add_customer_cancellation_history() from public, anon, authenticated;
