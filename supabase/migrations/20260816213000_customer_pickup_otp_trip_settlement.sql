-- A single pickup PIN is generated when a customer profile is created and is
-- reused for that customer's rides. It is never exposed to captains.
alter table public.profiles
  add column customer_pickup_otp text not null
    default lpad(floor(random() * 10000)::integer::text, 4, '0')
    check (customer_pickup_otp ~ '^[0-9]{4}$');

-- Replace the development-only per-ride code with the customer-owned PIN.
alter table public.rides drop column pickup_otp;
alter table public.rides
  add column captain_latitude numeric(9, 6),
  add column captain_longitude numeric(9, 6),
  add column payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid')),
  add column payment_method text
    check (payment_method is null or payment_method in ('cash', 'upi')),
  add column paid_at timestamptz,
  add column customer_rating smallint check (customer_rating between 1 and 5),
  add column customer_rating_note text check (customer_rating_note is null or char_length(customer_rating_note) <= 280),
  add constraint ride_captain_coordinates_complete
    check ((captain_latitude is null and captain_longitude is null) or (captain_latitude is not null and captain_longitude is not null)),
  add constraint paid_ride_has_method_and_timestamp
    check ((payment_status = 'paid') = (payment_method is not null and paid_at is not null));

create function public.customer_pickup_pin(p_ride_id uuid)
returns text language sql security definer set search_path = '' as $$
  select profile.customer_pickup_otp
  from public.rides ride
  join public.profiles profile on profile.id = ride.customer_id
  where ride.id = p_ride_id
    and ride.customer_id = auth.uid()
    and ride.status in ('accepted', 'arrived');
$$;

create function public.captain_start_ride(p_ride_id uuid, p_pickup_otp text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_pickup_otp !~ '^[0-9]{4}$' then raise exception 'Invalid pickup OTP'; end if;
  select ride.* into v_ride
  from public.rides ride
  join public.profiles customer on customer.id = ride.customer_id
  where ride.id = p_ride_id
    and ride.captain_id = auth.uid()
    and ride.status = 'arrived'
    and customer.customer_pickup_otp = p_pickup_otp
  for update of ride;
  if not found then raise exception 'Pickup OTP does not match'; end if;
  update public.rides
  set status = 'in_progress', started_at = now()
  where id = p_ride_id
  returning * into v_ride;
  insert into public.ride_status_history (ride_id, status, actor_type)
  values (v_ride.id, 'in_progress', 'captain');
  return v_ride;
end;
$$;

create function public.captain_update_ride_location(p_ride_id uuid, p_latitude numeric, p_longitude numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Invalid location'; end if;
  update public.rides
  set captain_latitude = p_latitude, captain_longitude = p_longitude
  where id = p_ride_id and captain_id = auth.uid() and status = 'in_progress';
  if not found then raise exception 'Active ride not found'; end if;
end;
$$;

create function public.customer_confirm_payment(p_ride_id uuid, p_method text)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_method not in ('cash', 'upi') then raise exception 'Invalid payment method'; end if;
  update public.rides
  set payment_status = 'paid', payment_method = p_method, paid_at = now()
  where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and payment_status = 'pending'
  returning * into v_ride;
  if not found then raise exception 'Payment is not available for this ride'; end if;
  return v_ride;
end;
$$;

create function public.customer_rate_captain(p_ride_id uuid, p_rating smallint, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  update public.rides
  set customer_rating = p_rating, customer_rating_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and payment_status = 'paid' and customer_rating is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end;
$$;

-- A ride can also be cancelled after it starts, from the customer safety flow.
create or replace function public.set_customer_cancellation_timestamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if old.status not in ('requested', 'searching', 'accepted', 'in_progress') then
      raise exception 'This ride can no longer be cancelled';
    end if;
    new.cancelled_at = now();
  end if;
  return new;
end;
$$;

drop policy "Customers can cancel their own active rides" on public.rides;
create policy "Customers can cancel their own active rides"
on public.rides for update to authenticated
using ((select auth.uid()) = customer_id and status in ('requested', 'searching', 'accepted', 'in_progress'))
with check (
  (select auth.uid()) = customer_id and status = 'cancelled'
  and cancellation_reason_code is not null and final_fare is null and completed_at is null
);

revoke all on function public.customer_pickup_pin(uuid) from public, anon;
revoke all on function public.captain_start_ride(uuid, text) from public, anon;
revoke all on function public.captain_update_ride_location(uuid, numeric, numeric) from public, anon;
revoke all on function public.customer_confirm_payment(uuid, text) from public, anon;
revoke all on function public.customer_rate_captain(uuid, smallint, text) from public, anon;
grant execute on function public.customer_pickup_pin(uuid) to authenticated;
grant execute on function public.captain_start_ride(uuid, text) to authenticated;
grant execute on function public.captain_update_ride_location(uuid, numeric, numeric) to authenticated;
grant execute on function public.customer_confirm_payment(uuid, text) to authenticated;
grant execute on function public.customer_rate_captain(uuid, smallint, text) to authenticated;
