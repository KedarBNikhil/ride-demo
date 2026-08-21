-- A customer declaring Cash/UPI is not proof of receipt. Keep the explicit
-- captain confirmation on the authoritative ride row so existing ride Realtime
-- subscriptions update both apps without a parallel state store.
alter table public.rides drop constraint if exists rides_payment_status_check;
alter table public.rides drop constraint if exists rides_customer_charge_status_check;
alter table public.rides drop constraint if exists rides_customer_charge_payment_consistency;
alter table public.rides add constraint rides_customer_charge_status_check check (customer_charge_status in ('pending', 'not_required', 'declared', 'confirmed'));
alter table public.rides add constraint rides_payment_status_check check (payment_status in ('pending', 'declared', 'confirmed', 'not_required'));
alter table public.rides add constraint rides_customer_charge_payment_consistency check (
  (customer_charge_type = 'free' and customer_charge_amount = 0 and customer_charge_status = 'not_required' and payment_status = 'not_required' and payment_method is null)
  or (customer_charge_type = 'standard' and customer_charge_amount >= 0 and customer_charge_status in ('pending', 'declared', 'confirmed') and payment_status in ('pending', 'declared', 'confirmed')
    and ((payment_status = 'pending' and payment_method is null) or (payment_status in ('declared', 'confirmed') and payment_method in ('cash', 'upi'))))
);

create or replace function public.captain_confirm_payment_received(p_ride_id uuid) returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_settlement_id uuid;
begin
  perform public.require_pilot_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found or v_ride.status <> 'completed' or v_ride.customer_charge_type <> 'standard' then raise exception 'Payment is not available for this ride'; end if;
  if v_ride.payment_status = 'confirmed' then return v_ride; end if;
  if v_ride.payment_status <> 'declared' or v_ride.payment_method not in ('cash', 'upi') then raise exception 'Customer has not selected a payment method'; end if;
  update public.rides set payment_status = 'confirmed', customer_charge_status = 'confirmed', paid_at = now() where id = v_ride.id returning * into v_ride;
  select id into v_settlement_id from public.ride_settlements where ride_id = v_ride.id;
  if v_settlement_id is not null then insert into public.ride_settlement_events(settlement_id, event_type, actor_id, metadata) values (v_settlement_id, 'confirmed', auth.uid(), jsonb_build_object('payment_method', v_ride.payment_method, 'confirmed_by', 'captain')) on conflict do nothing; end if;
  return v_ride;
end; $$;
revoke all on function public.captain_confirm_payment_received(uuid) from public, anon;
grant execute on function public.captain_confirm_payment_received(uuid) to authenticated;

create or replace function public.captain_raise_payment_issue(p_ride_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_pilot_user('captain');
  if p_reason not in ('customer_did_not_pay', 'payment_method_mismatch', 'upi_not_received', 'cash_not_received', 'other') then raise exception 'Invalid payment issue'; end if;
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found or v_ride.status <> 'completed' or v_ride.customer_charge_type <> 'standard' or v_ride.payment_status not in ('pending', 'declared') then raise exception 'Payment issue is not available for this ride'; end if;
  insert into public.captain_payment_issues(ride_id, captain_id, reason) values (v_ride.id, auth.uid(), p_reason) on conflict (ride_id) do nothing;
end; $$;

create or replace function public.customer_rate_captain(p_ride_id uuid, p_rating smallint, p_note text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  update public.rides set customer_rating = p_rating, customer_rating_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and payment_status in ('confirmed', 'not_required') and customer_rating is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end; $$;
revoke all on function public.customer_rate_captain(uuid, smallint, text) from public, anon;
grant execute on function public.customer_rate_captain(uuid, smallint, text) to authenticated;

create function public.customer_assigned_captain_contact(p_ride_id uuid) returns table(full_name text, vehicle_type text, phone text) language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  return query select profile.full_name, captain.vehicle_type, nullif(trim(profile.phone), '') from public.rides ride join public.profiles profile on profile.id = ride.captain_id join public.captain_profiles captain on captain.user_id = ride.captain_id where ride.id = p_ride_id and ride.customer_id = auth.uid() and ride.captain_id is not null;
end; $$;
revoke all on function public.customer_assigned_captain_contact(uuid) from public, anon;
grant execute on function public.customer_assigned_captain_contact(uuid) to authenticated;

create table public.ride_messages (id uuid primary key default gen_random_uuid(), ride_id uuid not null references public.rides(id) on delete restrict, sender_id uuid not null references public.profiles(id) on delete restrict, body text not null check (char_length(trim(body)) between 1 and 500), created_at timestamptz not null default now());
create index ride_messages_ride_created_idx on public.ride_messages(ride_id, created_at);
alter table public.ride_messages enable row level security;
revoke all on table public.ride_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.ride_messages to service_role;
alter publication supabase_realtime add table public.ride_messages;

create function public.ride_messages_for_ride(p_ride_id uuid) returns table(id uuid, sender_id uuid, body text, created_at timestamptz) language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user();
  if not exists (select 1 from public.rides where id = p_ride_id and auth.uid() in (customer_id, captain_id)) then raise exception 'Ride messages are not available'; end if;
  return query select message.id, message.sender_id, message.body, message.created_at from public.ride_messages message where message.ride_id = p_ride_id order by message.created_at;
end; $$;
create function public.send_ride_message(p_ride_id uuid, p_body text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user();
  if not exists (select 1 from public.rides where id = p_ride_id and auth.uid() in (customer_id, captain_id)) then raise exception 'Ride messages are not available'; end if;
  insert into public.ride_messages(ride_id, sender_id, body) values (p_ride_id, auth.uid(), trim(p_body));
end; $$;
revoke all on function public.ride_messages_for_ride(uuid), public.send_ride_message(uuid, text) from public, anon;
grant execute on function public.ride_messages_for_ride(uuid), public.send_ride_message(uuid, text) to authenticated;

create table public.customer_payment_issues (id uuid primary key default gen_random_uuid(), ride_id uuid not null unique references public.rides(id) on delete restrict, customer_id uuid not null references public.profiles(id) on delete restrict, reason text not null check (reason in ('paid_but_not_received', 'incorrect_fare', 'upi_problem', 'cash_dispute', 'other')), opened_at timestamptz not null default now());
alter table public.customer_payment_issues enable row level security;
revoke all on table public.customer_payment_issues from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_payment_issues to service_role;
create function public.customer_raise_payment_issue(p_ride_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  if p_reason not in ('paid_but_not_received', 'incorrect_fare', 'upi_problem', 'cash_dispute', 'other') then raise exception 'Invalid payment issue'; end if;
  if not exists (select 1 from public.rides where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and customer_charge_type = 'standard') then raise exception 'Payment issue is not available for this ride'; end if;
  insert into public.customer_payment_issues(ride_id, customer_id, reason) values (p_ride_id, auth.uid(), p_reason) on conflict (ride_id) do update set reason = excluded.reason, opened_at = now();
end; $$;
revoke all on function public.customer_raise_payment_issue(uuid, text) from public, anon;
grant execute on function public.customer_raise_payment_issue(uuid, text) to authenticated;
