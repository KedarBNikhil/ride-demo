-- Captain payment issues are private operational records. Captains can see
-- only their own issue and its support conversation; operators use the
-- existing settlement-operator authorization to reply.
create table public.captain_payment_issue_messages (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.captain_payment_issues(id) on delete restrict,
  sender_type text not null check (sender_type in ('captain', 'support')),
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index captain_payment_issue_messages_issue_created_idx
  on public.captain_payment_issue_messages(issue_id, created_at);

alter table public.captain_payment_issue_messages enable row level security;
revoke all on table public.captain_payment_issue_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.captain_payment_issue_messages to service_role;

create or replace function public.captain_payment_issue_for_ride(p_ride_id uuid)
returns table (id uuid, reason text, status text, opened_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('captain');
  return query
  select issue.id, issue.reason, issue.status, issue.opened_at
  from public.captain_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.captain_id = auth.uid();
end;
$$;

create or replace function public.captain_payment_issue_messages(p_ride_id uuid)
returns table (id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('captain');
  return query
  select message.id, message.sender_type, message.body, message.created_at
  from public.captain_payment_issue_messages message
  join public.captain_payment_issues issue on issue.id = message.issue_id
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.captain_id = auth.uid()
  order by message.created_at;
end;
$$;

create or replace function public.captain_send_payment_issue_message(p_ride_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue_id uuid;
begin
  perform public.require_pilot_user('captain');
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 500 then
    raise exception 'Support message must be between 1 and 500 characters';
  end if;
  select issue.id into v_issue_id
  from public.captain_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and issue.status = 'open' and ride.captain_id = auth.uid()
  for update of issue;
  if v_issue_id is null then raise exception 'Open payment issue not found'; end if;
insert into public.captain_payment_issue_messages(issue_id, sender_type, sender_id, body)
values (v_issue_id, 'captain', auth.uid(), trim(p_body));
end;
$$;

create or replace function public.operator_captain_payment_issue_messages(p_issue_id uuid)
returns table (id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  return query select message.id, message.sender_type, message.body, message.created_at
  from public.captain_payment_issue_messages message where message.issue_id = p_issue_id order by message.created_at;
end;
$$;

create or replace function public.operator_send_captain_payment_issue_message(p_issue_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_issue_id uuid;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 500 then raise exception 'Support message must be between 1 and 500 characters'; end if;
  select id into v_issue_id from public.captain_payment_issues where id = p_issue_id and status = 'open' for update;
  if v_issue_id is null then raise exception 'Open payment issue not found'; end if;
  insert into public.captain_payment_issue_messages(issue_id, sender_type, sender_id, body)
  values (v_issue_id, 'support', auth.uid(), trim(p_body));
end;
$$;

revoke all on function public.captain_payment_issue_for_ride(uuid), public.captain_payment_issue_messages(uuid), public.captain_send_payment_issue_message(uuid, text), public.operator_captain_payment_issue_messages(uuid), public.operator_send_captain_payment_issue_message(uuid, text) from public, anon;
grant execute on function public.captain_payment_issue_for_ride(uuid), public.captain_payment_issue_messages(uuid), public.captain_send_payment_issue_message(uuid, text), public.operator_captain_payment_issue_messages(uuid), public.operator_send_captain_payment_issue_message(uuid, text) to authenticated;
