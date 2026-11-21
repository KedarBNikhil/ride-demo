-- Store the full customer issue-intake path against the existing ride-scoped
-- support record.  The table name is retained for compatibility with the
-- already released Customer and dashboard bundles.
alter table public.customer_payment_issues
  add column if not exists issue_category text,
  add column if not exists support_requested_at timestamptz;

alter table public.customer_payment_issues
  drop constraint if exists customer_payment_issues_reason_check;
alter table public.customer_payment_issues
  add constraint customer_payment_issues_reason_check check (reason in (
    'paid_but_not_received', 'incorrect_fare', 'upi_problem', 'cash_dispute', 'other',
    'charged_wrong_price', 'promo_not_applied', 'unable_to_pay_online',
    'fare_mismatch', 'captain_charging_extra', 'upi_offline', 'captain_not_accepting_upi',
    'unsafe_driving', 'harassment_or_inappropriate_behaviour', 'felt_threatened',
    'accident_or_crash', 'injury', 'vehicle_or_property_damage',
    'captain_details_do_not_match', 'vehicle_details_do_not_match',
    'captain_rude', 'long_route', 'preferred_payment_not_accepted',
    'lost_phone_or_electronic', 'lost_bag_or_luggage', 'lost_wallet_or_documents',
    'captain_found_item', 'item_may_be_stolen'
  ));
alter table public.customer_payment_issues
  drop constraint if exists customer_payment_issues_category_check;
alter table public.customer_payment_issues
  add constraint customer_payment_issues_category_check check (issue_category is null or issue_category in (
    'fare_or_payment', 'safety', 'captain_or_ride', 'lost_item', 'other'
  ));

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
  ) then raise exception 'Invalid issue reason'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'Issue details must be at most 500 characters'; end if;
  if p_reason = 'other' and v_note is null then raise exception 'Describe the issue'; end if;
  if not exists (
    select 1 from public.rides ride
    where ride.id = p_ride_id and ride.customer_id = auth.uid() and ride.status = 'completed'
  ) then raise exception 'Issue is not available for this ride'; end if;
  insert into public.customer_payment_issues(ride_id, customer_id, issue_category, reason, customer_note)
  values (p_ride_id, auth.uid(), p_category, p_reason, v_note)
  on conflict (ride_id) do update set
    issue_category = excluded.issue_category, reason = excluded.reason,
    customer_note = excluded.customer_note, opened_at = now(), status = 'open',
    resolved_at = null, resolved_by = null, resolution_note = null,
    assigned_support_id = null, support_requested_at = null;
end;
$$;

-- Keep both earlier RPC signatures working while installed bundles receive
-- their OTA.  New clients call the four-argument version above.
create or replace function public.customer_raise_payment_issue(p_ride_id uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.customer_raise_payment_issue(p_ride_id, 'fare_or_payment', p_reason, p_note);
end;
$$;

create or replace function public.customer_request_issue_support(p_ride_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  update public.customer_payment_issues issue
  set support_requested_at = now()
  from public.rides ride
  where issue.ride_id = p_ride_id and ride.id = issue.ride_id
    and ride.customer_id = auth.uid() and issue.status = 'open';
  if not found then raise exception 'Open issue not found'; end if;
end;
$$;

revoke all on function public.customer_raise_payment_issue(uuid, text, text, text), public.customer_request_issue_support(uuid) from public, anon;
grant execute on function public.customer_raise_payment_issue(uuid, text, text, text), public.customer_request_issue_support(uuid) to authenticated;
