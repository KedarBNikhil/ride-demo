-- Customer payment issues stay ride-scoped and are the authoritative support
-- record. The first operator reply claims the conversation, so a customer is
-- always speaking with one assigned support person rather than a shared room.
alter table public.customer_payment_issues
  add column if not exists customer_note text,
  add column if not exists assigned_support_id uuid references public.profiles(id) on delete restrict;

alter table public.customer_payment_issues
  drop constraint if exists customer_payment_issues_customer_note_check;
alter table public.customer_payment_issues
  add constraint customer_payment_issues_customer_note_check
  check (customer_note is null or char_length(trim(customer_note)) between 1 and 500);

create table public.customer_payment_issue_messages (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.customer_payment_issues(id) on delete restrict,
  sender_type text not null check (sender_type in ('customer', 'support')),
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index customer_payment_issue_messages_issue_created_idx
  on public.customer_payment_issue_messages(issue_id, created_at);
alter table public.customer_payment_issue_messages enable row level security;
revoke all on table public.customer_payment_issue_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_payment_issue_messages to service_role;

create or replace function public.customer_raise_payment_issue(p_ride_id uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_note text;
begin
  perform public.require_pilot_user('customer');
  if p_reason not in ('paid_but_not_received', 'incorrect_fare', 'upi_problem', 'cash_dispute', 'other') then raise exception 'Invalid payment issue'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'Issue details must be at most 500 characters'; end if;
  if p_reason = 'other' and v_note is null then raise exception 'Describe the other payment issue'; end if;
  if not exists (select 1 from public.rides ride where ride.id = p_ride_id and ride.customer_id = auth.uid() and ride.status = 'completed' and ride.customer_charge_type = 'standard') then raise exception 'Payment issue is not available for this ride'; end if;
  insert into public.customer_payment_issues(ride_id, customer_id, reason, customer_note)
  values (p_ride_id, auth.uid(), p_reason, v_note)
  on conflict (ride_id) do update set reason = excluded.reason, customer_note = excluded.customer_note,
    opened_at = now(), status = 'open', resolved_at = null, resolved_by = null, resolution_note = null;
end;
$$;

-- Keep already-published Customer bundles functional while the OTA rolls out.
create or replace function public.customer_raise_payment_issue(p_ride_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.customer_raise_payment_issue(p_ride_id, p_reason, null);
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
  where issue.ride_id = p_ride_id and ride.customer_id = auth.uid();
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
  join public.customer_payment_issues issue on issue.id = message.issue_id
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.customer_id = auth.uid()
  order by message.created_at;
end;
$$;

create or replace function public.customer_send_payment_issue_message(p_ride_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_issue_id uuid; v_body text;
begin
  perform public.require_pilot_user('customer');
  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) not between 1 and 500 then raise exception 'Support message must be between 1 and 500 characters'; end if;
  select issue.id into v_issue_id from public.customer_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and issue.status = 'open' and ride.customer_id = auth.uid() for update of issue;
  if v_issue_id is null then raise exception 'Open payment issue not found'; end if;
  insert into public.customer_payment_issue_messages(issue_id, sender_type, sender_id, body)
  values (v_issue_id, 'customer', auth.uid(), v_body);
end;
$$;

create or replace function public.operator_customer_payment_issue_messages(p_issue_id uuid)
returns table (id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  return query select message.id, message.sender_type, message.body, message.created_at
  from public.customer_payment_issue_messages message where message.issue_id = p_issue_id order by message.created_at;
end;
$$;

create or replace function public.operator_send_customer_payment_issue_message(p_issue_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_issue public.customer_payment_issues; v_body text;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) not between 1 and 500 then raise exception 'Support message must be between 1 and 500 characters'; end if;
  select * into v_issue from public.customer_payment_issues where id = p_issue_id and status = 'open' for update;
  if not found then raise exception 'Open payment issue not found'; end if;
  if v_issue.assigned_support_id is not null and v_issue.assigned_support_id <> auth.uid() then raise exception 'This issue is assigned to another support operator'; end if;
  update public.customer_payment_issues set assigned_support_id = auth.uid() where id = v_issue.id and assigned_support_id is null;
  insert into public.customer_payment_issue_messages(issue_id, sender_type, sender_id, body)
  values (v_issue.id, 'support', auth.uid(), v_body);
end;
$$;

revoke all on function public.customer_raise_payment_issue(uuid, text), public.customer_raise_payment_issue(uuid, text, text), public.customer_payment_issue_for_ride(uuid), public.customer_payment_issue_messages(uuid), public.customer_send_payment_issue_message(uuid, text), public.operator_customer_payment_issue_messages(uuid), public.operator_send_customer_payment_issue_message(uuid, text) from public, anon;
grant execute on function public.customer_raise_payment_issue(uuid, text), public.customer_raise_payment_issue(uuid, text, text), public.customer_payment_issue_for_ride(uuid), public.customer_payment_issue_messages(uuid), public.customer_send_payment_issue_message(uuid, text), public.operator_customer_payment_issue_messages(uuid), public.operator_send_customer_payment_issue_message(uuid, text) to authenticated;
