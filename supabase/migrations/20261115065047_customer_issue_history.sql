-- Issues are tickets, not a mutable ride attribute.  A customer can therefore
-- return to every report they made for a ride after it has been resolved.
alter table public.customer_payment_issues
  drop constraint if exists customer_payment_issues_ride_id_key;

create index if not exists customer_payment_issues_customer_opened_idx
  on public.customer_payment_issues(customer_id, opened_at desc);
create index if not exists customer_payment_issues_ride_opened_idx
  on public.customer_payment_issues(ride_id, opened_at desc);

-- New reports always create a new ticket.  The three-argument overload keeps
-- installed Customer bundles working while the OTA is adopted.
create or replace function public.customer_raise_payment_issue(
  p_ride_id uuid,
  p_category text,
  p_reason text,
  p_note text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_note text;
begin
  perform public.require_pilot_user('customer');
  if p_category not in ('fare_or_payment', 'safety', 'captain_or_ride', 'lost_item', 'other') then
    raise exception 'Invalid issue category';
  end if;
  if p_reason not in (
    'charged_wrong_price', 'promo_not_applied', 'unable_to_pay_online',
    'fare_mismatch', 'captain_charging_extra', 'upi_offline', 'captain_not_accepting_upi',
    'unsafe_driving', 'harassment_or_inappropriate_behaviour', 'felt_threatened',
    'accident_or_crash', 'injury', 'vehicle_or_property_damage',
    'captain_details_do_not_match', 'vehicle_details_do_not_match',
    'captain_rude', 'long_route', 'preferred_payment_not_accepted',
    'lost_phone_or_electronic', 'lost_bag_or_luggage', 'lost_wallet_or_documents',
    'captain_found_item', 'item_may_be_stolen', 'other',
    'paid_but_not_received', 'incorrect_fare', 'upi_problem', 'cash_dispute'
  ) then
    raise exception 'Invalid issue reason';
  end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'Issue details must be at most 500 characters'; end if;
  if p_reason = 'other' and v_note is null then raise exception 'Describe the issue'; end if;
  if not exists (
    select 1 from public.rides ride
    where ride.id = p_ride_id and ride.customer_id = auth.uid() and ride.status = 'completed'
  ) then
    raise exception 'Issue is not available for this ride';
  end if;
  insert into public.customer_payment_issues(ride_id, customer_id, issue_category, reason, customer_note)
  values (p_ride_id, auth.uid(), p_category, p_reason, v_note);
end;
$$;

create or replace function public.customer_payment_issue_for_ride(p_ride_id uuid)
returns table (id uuid, reason text, customer_note text, status text, opened_at timestamptz, assigned_support_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  return query
  select issue.id, issue.reason, issue.customer_note, issue.status, issue.opened_at, issue.assigned_support_id
  from public.customer_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.customer_id = auth.uid()
  order by issue.opened_at desc
  limit 1;
end;
$$;

create or replace function public.customer_payment_issue_messages(p_ride_id uuid)
returns table (id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  return query
  select message.id, message.sender_type, message.body, message.created_at
  from public.customer_payment_issue_messages message
  where message.issue_id = (
    select issue.id from public.customer_payment_issues issue
    join public.rides ride on ride.id = issue.ride_id
    where issue.ride_id = p_ride_id and ride.customer_id = auth.uid()
    order by issue.opened_at desc limit 1
  )
  order by message.created_at;
end;
$$;

create or replace function public.customer_request_issue_support(p_ride_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_issue_id uuid;
begin
  perform public.require_pilot_user('customer');
  select issue.id into v_issue_id
  from public.customer_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.customer_id = auth.uid() and issue.status = 'open'
  order by issue.opened_at desc limit 1;
  if v_issue_id is null then raise exception 'Open issue not found'; end if;
  update public.customer_payment_issues set support_requested_at = now() where id = v_issue_id;
end;
$$;

create or replace function public.customer_issue_history()
returns table (
  id uuid, ride_id uuid, issue_category text, reason text, customer_note text,
  status text, opened_at timestamptz, resolved_at timestamptz, resolution_note text,
  support_requested_at timestamptz, unread_support_messages integer,
  ride_completed_at timestamptz, customer_charge numeric
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  return query
  select issue.id, issue.ride_id, issue.issue_category, issue.reason, issue.customer_note,
    issue.status, issue.opened_at, issue.resolved_at, issue.resolution_note,
    issue.support_requested_at,
    count(message.id) filter (where message.sender_type = 'support' and message.created_at > coalesce(issue.customer_last_support_read_at, '-infinity'::timestamptz))::integer,
    ride.completed_at, ride.customer_charge_amount
  from public.customer_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  left join public.customer_payment_issue_messages message on message.issue_id = issue.id
  where ride.customer_id = auth.uid()
  group by issue.id, ride.id
  order by issue.opened_at desc;
end;
$$;

create or replace function public.customer_payment_issue_detail(p_issue_id uuid)
returns table (
  id uuid, ride_id uuid, issue_category text, reason text, customer_note text,
  status text, opened_at timestamptz, resolved_at timestamptz, resolution_note text,
  assigned_support_id uuid, support_requested_at timestamptz, unread_support_messages integer,
  ride_completed_at timestamptz, customer_charge numeric
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  return query
  select issue.id, issue.ride_id, issue.issue_category, issue.reason, issue.customer_note,
    issue.status, issue.opened_at, issue.resolved_at, issue.resolution_note,
    issue.assigned_support_id, issue.support_requested_at,
    count(message.id) filter (where message.sender_type = 'support' and message.created_at > coalesce(issue.customer_last_support_read_at, '-infinity'::timestamptz))::integer,
    ride.completed_at, ride.customer_charge_amount
  from public.customer_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  left join public.customer_payment_issue_messages message on message.issue_id = issue.id
  where issue.id = p_issue_id and ride.customer_id = auth.uid()
  group by issue.id, ride.id;
end;
$$;

create or replace function public.customer_payment_issue_messages_by_id(p_issue_id uuid)
returns table (id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  return query
  select message.id, message.sender_type, message.body, message.created_at
  from public.customer_payment_issue_messages message
  join public.customer_payment_issues issue on issue.id = message.issue_id
  join public.rides ride on ride.id = issue.ride_id
  where message.issue_id = p_issue_id and ride.customer_id = auth.uid()
  order by message.created_at;
end;
$$;

create or replace function public.customer_mark_payment_issue_messages_read_by_id(p_issue_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  update public.customer_payment_issues issue
  set customer_last_support_read_at = now()
  from public.rides ride
  where issue.id = p_issue_id and ride.id = issue.ride_id and ride.customer_id = auth.uid();
  if not found then raise exception 'Issue not found'; end if;
end;
$$;

create or replace function public.customer_send_payment_issue_message_by_id(p_issue_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_body text;
begin
  perform public.require_pilot_user('customer');
  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) not between 1 and 500 then raise exception 'Support message must be between 1 and 500 characters'; end if;
  if not exists (
    select 1 from public.customer_payment_issues issue join public.rides ride on ride.id = issue.ride_id
    where issue.id = p_issue_id and issue.status = 'open' and ride.customer_id = auth.uid()
  ) then raise exception 'Open issue not found'; end if;
  insert into public.customer_payment_issue_messages(issue_id, sender_type, sender_id, body)
  values (p_issue_id, 'customer', auth.uid(), v_body);
end;
$$;

create or replace function public.customer_request_issue_support_by_id(p_issue_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  update public.customer_payment_issues issue
  set support_requested_at = now()
  from public.rides ride
  where issue.id = p_issue_id and ride.id = issue.ride_id and ride.customer_id = auth.uid() and issue.status = 'open';
  if not found then raise exception 'Open issue not found'; end if;
end;
$$;

revoke all on function
  public.customer_issue_history(), public.customer_payment_issue_detail(uuid),
  public.customer_payment_issue_messages_by_id(uuid),
  public.customer_mark_payment_issue_messages_read_by_id(uuid),
  public.customer_send_payment_issue_message_by_id(uuid, text),
  public.customer_request_issue_support_by_id(uuid)
from public, anon;
grant execute on function
  public.customer_issue_history(), public.customer_payment_issue_detail(uuid),
  public.customer_payment_issue_messages_by_id(uuid),
  public.customer_mark_payment_issue_messages_read_by_id(uuid),
  public.customer_send_payment_issue_message_by_id(uuid, text),
  public.customer_request_issue_support_by_id(uuid)
to authenticated;
