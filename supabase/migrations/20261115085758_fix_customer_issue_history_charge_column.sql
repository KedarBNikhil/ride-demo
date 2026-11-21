-- The original history functions selected a non-existent rides.customer_charge
-- column. The production schema names this customer_charge_amount.
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
