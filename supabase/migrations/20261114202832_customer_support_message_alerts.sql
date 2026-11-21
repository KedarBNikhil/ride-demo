alter table public.customer_payment_issues
  add column if not exists customer_last_support_read_at timestamptz;

create or replace function public.customer_unread_payment_issue_messages(p_ride_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform public.require_pilot_user('customer');
  select count(*)::integer into v_count
  from public.customer_payment_issue_messages message
  join public.customer_payment_issues issue on issue.id = message.issue_id
  join public.rides ride on ride.id = issue.ride_id
  where issue.ride_id = p_ride_id and ride.customer_id = auth.uid()
    and message.sender_type = 'support'
    and message.created_at > coalesce(issue.customer_last_support_read_at, '-infinity'::timestamptz);
  return coalesce(v_count, 0);
end;
$$;

create or replace function public.customer_mark_payment_issue_messages_read(p_ride_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  update public.customer_payment_issues issue
  set customer_last_support_read_at = now()
  from public.rides ride
  where issue.ride_id = p_ride_id and ride.id = issue.ride_id and ride.customer_id = auth.uid();
  if not found then raise exception 'Issue not found'; end if;
end;
$$;

-- The first reply still claims the case, then a support reply becomes unread
-- until the customer opens this ride's support conversation.
create or replace function public.operator_send_customer_payment_issue_message(p_issue_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_issue public.customer_payment_issues; v_body text;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) not between 1 and 500 then raise exception 'Support message must be between 1 and 500 characters'; end if;
  select * into v_issue from public.customer_payment_issues where id = p_issue_id and status = 'open' for update;
  if not found then raise exception 'Open issue not found'; end if;
  if v_issue.assigned_support_id is not null and v_issue.assigned_support_id <> auth.uid() then raise exception 'This issue is assigned to another support operator'; end if;
  update public.customer_payment_issues set assigned_support_id = auth.uid() where id = v_issue.id and assigned_support_id is null;
  insert into public.customer_payment_issue_messages(issue_id, sender_type, sender_id, body)
  values (v_issue.id, 'support', auth.uid(), v_body);
end;
$$;

-- Reuse the secret-protected notification dispatcher for support replies.
drop trigger if exists customer_payment_issue_messages_enqueue_notification on public.customer_payment_issue_messages;
create trigger customer_payment_issue_messages_enqueue_notification
after insert on public.customer_payment_issue_messages
for each row execute function public.enqueue_ride_notification();

revoke all on function public.customer_unread_payment_issue_messages(uuid), public.customer_mark_payment_issue_messages_read(uuid) from public, anon;
grant execute on function public.customer_unread_payment_issue_messages(uuid), public.customer_mark_payment_issue_messages_read(uuid) to authenticated;
