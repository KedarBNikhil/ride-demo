-- A Captain can report any problem on a completed ride, not only an unpaid
-- standard-fare ride.  Keep the existing table name so the operator dashboard
-- and existing payment issue records remain compatible.
alter table public.captain_payment_issues
  add column if not exists category text,
  add column if not exists captain_note text,
  add column if not exists support_requested_at timestamptz;

alter table public.captain_payment_issues
  drop constraint if exists captain_payment_issues_reason_check,
  drop constraint if exists captain_payment_issues_ride_id_key;

alter table public.captain_payment_issues
  add constraint captain_payment_issues_reason_check check (reason in (
    'customer_did_not_pay', 'received_less_than_fare', 'upi_not_received',
    'payment_method_mismatch', 'incentive_missing',
    'customer_rude', 'unsafe_or_illegal_route', 'customer_details_mismatch',
    'vehicle_damage_or_mess', 'route_waiting_or_cancellation_dispute',
    'felt_unsafe', 'harassment', 'accident_or_injury', 'emergency_assistance',
    'customer_left_item', 'found_item_after_ride', 'false_missing_item_claim',
    'could_not_start_or_end', 'gps_or_route_incorrect', 'payment_screen_error',
    'network_issue', 'other',
    -- Reasons created by previous app versions remain valid.
    'cash_not_received'
  ));

alter table public.captain_payment_issues
  add constraint captain_payment_issues_category_check check (category is null or category in (
    'payment_or_earnings', 'customer_or_ride', 'safety', 'lost_item', 'app_or_technical', 'other'
  )),
  add constraint captain_payment_issues_note_check check (captain_note is null or char_length(trim(captain_note)) between 1 and 1000);

update public.captain_payment_issues
set category = 'payment_or_earnings'
where category is null;

alter table public.captain_payment_issues
  alter column category set not null;

create index if not exists captain_payment_issues_captain_opened_idx
  on public.captain_payment_issues(captain_id, opened_at desc);

create or replace function public.captain_raise_ride_issue(
  p_ride_id uuid,
  p_category text,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform public.require_pilot_user('captain');
  if p_category not in ('payment_or_earnings', 'customer_or_ride', 'safety', 'lost_item', 'app_or_technical', 'other') then
    raise exception 'Invalid issue category';
  end if;
  if p_reason not in (
    'customer_did_not_pay', 'received_less_than_fare', 'upi_not_received',
    'payment_method_mismatch', 'incentive_missing',
    'customer_rude', 'unsafe_or_illegal_route', 'customer_details_mismatch',
    'vehicle_damage_or_mess', 'route_waiting_or_cancellation_dispute',
    'felt_unsafe', 'harassment', 'accident_or_injury', 'emergency_assistance',
    'customer_left_item', 'found_item_after_ride', 'false_missing_item_claim',
    'could_not_start_or_end', 'gps_or_route_incorrect', 'payment_screen_error',
    'network_issue', 'other'
  ) then
    raise exception 'Invalid issue reason';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'Please describe the issue';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Issue description must be 1000 characters or fewer';
  end if;
  if not exists (
    select 1 from public.rides
    where id = p_ride_id and captain_id = auth.uid() and status = 'completed'
  ) then
    raise exception 'Issue is not available for this ride';
  end if;
  insert into public.captain_payment_issues(ride_id, captain_id, category, reason, captain_note, support_requested_at)
  values (p_ride_id, auth.uid(), p_category, p_reason, v_note,
    case when p_category = 'safety' then now() else null end)
  returning id into v_issue_id;
  return v_issue_id;
end;
$$;

create or replace function public.captain_raise_payment_issue(p_ride_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.captain_raise_ride_issue(p_ride_id, 'payment_or_earnings', p_reason, null);
end;
$$;

drop function if exists public.captain_payment_issue_for_ride(uuid);

create function public.captain_payment_issue_for_ride(p_ride_id uuid)
returns table (id uuid, category text, reason text, captain_note text, status text, opened_at timestamptz, resolved_at timestamptz, support_requested_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('captain');
  return query
  select issue.id, issue.category, issue.reason, issue.captain_note, issue.status, issue.opened_at, issue.resolved_at, issue.support_requested_at
  from public.captain_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.captain_id = auth.uid()
  order by issue.opened_at desc
  limit 1;
end;
$$;

-- Keep the existing ride-scoped support endpoints. They now consistently use
-- the newest issue for that ride.
create or replace function public.captain_payment_issue_messages(p_ride_id uuid)
returns table (id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare v_issue_id uuid;
begin
  perform public.require_pilot_user('captain');
  select issue.id into v_issue_id from public.captain_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.captain_id = auth.uid()
  order by issue.opened_at desc limit 1;
  return query select message.id, message.sender_type, message.body, message.created_at
  from public.captain_payment_issue_messages message where message.issue_id = v_issue_id order by message.created_at;
end;
$$;

create or replace function public.captain_send_payment_issue_message(p_ride_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_issue_id uuid;
begin
  perform public.require_pilot_user('captain');
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 500 then
    raise exception 'Support message must be between 1 and 500 characters';
  end if;
  select issue.id into v_issue_id from public.captain_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and issue.status = 'open' and ride.captain_id = auth.uid()
  order by issue.opened_at desc limit 1 for update of issue;
  if v_issue_id is null then raise exception 'Open issue not found'; end if;
  update public.captain_payment_issues set support_requested_at = coalesce(support_requested_at, now()) where id = v_issue_id;
  insert into public.captain_payment_issue_messages(issue_id, sender_type, sender_id, body)
  values (v_issue_id, 'captain', auth.uid(), trim(p_body));
end;
$$;

revoke all on function public.captain_raise_ride_issue(uuid, text, text, text) from public, anon;
grant execute on function public.captain_raise_ride_issue(uuid, text, text, text) to authenticated;
