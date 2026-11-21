create or replace function public.captain_issue_history()
returns table (
  id uuid, ride_id uuid, category text, reason text, captain_note text,
  status text, opened_at timestamptz, resolved_at timestamptz,
  resolution_note text, support_requested_at timestamptz, ride_completed_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  return query
  select issue.id, issue.ride_id, issue.category, issue.reason, issue.captain_note,
    issue.status, issue.opened_at, issue.resolved_at, issue.resolution_note,
    issue.support_requested_at, ride.completed_at
  from public.captain_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.captain_id = auth.uid() and ride.captain_id = auth.uid()
  order by issue.opened_at desc;
end;
$$;

create or replace function public.captain_issue_detail(p_issue_id uuid)
returns table (
  id uuid, ride_id uuid, category text, reason text, captain_note text,
  status text, opened_at timestamptz, resolved_at timestamptz,
  resolution_note text, support_requested_at timestamptz, ride_completed_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  return query
  select issue.id, issue.ride_id, issue.category, issue.reason, issue.captain_note,
    issue.status, issue.opened_at, issue.resolved_at, issue.resolution_note,
    issue.support_requested_at, ride.completed_at
  from public.captain_payment_issues issue
  join public.rides ride on ride.id = issue.ride_id
  where issue.id = p_issue_id and issue.captain_id = auth.uid() and ride.captain_id = auth.uid();
end;
$$;

create or replace function public.captain_issue_messages(p_issue_id uuid)
returns table (id uuid, sender_type text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  return query
  select message.id, message.sender_type, message.body, message.created_at
  from public.captain_payment_issue_messages message
  join public.captain_payment_issues issue on issue.id = message.issue_id
  where message.issue_id = p_issue_id and issue.captain_id = auth.uid()
  order by message.created_at;
end;
$$;

create or replace function public.captain_send_issue_message(p_issue_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 500 then raise exception 'Support message must be between 1 and 500 characters'; end if;
  if not exists (select 1 from public.captain_payment_issues where id = p_issue_id and captain_id = auth.uid() and status = 'open') then raise exception 'Open issue not found'; end if;
  update public.captain_payment_issues set support_requested_at = coalesce(support_requested_at, now()) where id = p_issue_id;
  insert into public.captain_payment_issue_messages(issue_id, sender_type, sender_id, body) values (p_issue_id, 'captain', auth.uid(), trim(p_body));
end;
$$;

create or replace function public.captain_request_issue_support(p_issue_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  update public.captain_payment_issues set support_requested_at = coalesce(support_requested_at, now())
  where id = p_issue_id and captain_id = auth.uid() and status = 'open';
  if not found then raise exception 'Open issue not found'; end if;
end;
$$;

revoke all on function public.captain_issue_history(), public.captain_issue_detail(uuid), public.captain_issue_messages(uuid), public.captain_send_issue_message(uuid, text), public.captain_request_issue_support(uuid) from public, anon;
grant execute on function public.captain_issue_history(), public.captain_issue_detail(uuid), public.captain_issue_messages(uuid), public.captain_send_issue_message(uuid, text), public.captain_request_issue_support(uuid) to authenticated;
