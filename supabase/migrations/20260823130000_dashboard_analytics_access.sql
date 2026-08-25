-- Operator dashboard analytics access.
--
-- The admin web dashboard signs in with the same Supabase Auth as the mobile
-- apps. Read access to analytics data is granted exclusively through the
-- existing settlement-operator allow-list (public.settlement_operators), so
-- enabling someone on the dashboard is the same act as enabling them for
-- settlement review: insert their profile id into that table.
--
-- This migration:
--   1. exposes public.is_settlement_operator() to authenticated callers so the
--      dashboard can branch its UI on operator status;
--   2. adds operator-only SELECT policies on every analytics table;
--   3. creates security_invoker aggregate views used by dashboard charts;
--   4. adds the missing operator RPC to resolve captain payment issues.
--
-- No write access is opened on any base table.

-- 1. Operator status check -------------------------------------------------

revoke all on function public.is_settlement_operator() from public, anon;
grant execute on function public.is_settlement_operator() to authenticated;

-- 2. Operator SELECT policies ----------------------------------------------
-- Every table below is otherwise service_role-only or owner-scoped; operators
-- gain read visibility only.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'captain_profiles',
    'captain_onboarding_applications',
    'rides',
    'ride_status_history',
    'ride_offers',
    'captain_availability',
    'captain_online_sessions',
    'captain_earnings_ledger',
    'captain_compensations',
    'captain_payouts',
    'captain_payout_disputes',
    'captain_payout_events',
    'ride_settlements',
    'ride_settlement_events',
    'captain_payment_issues',
    'customer_payment_issues',
    'customer_promotion_entitlements',
    'ride_pricing_settings',
    'push_device_tokens',
    'ride_route_results',
    'google_routes_call_log',
    'google_places_call_log'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'Operators can view for dashboard analytics', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_settlement_operator())',
      'Operators can view for dashboard analytics', t
    );
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- 3. Aggregate views (security invoker: underlying operator policies apply) --

create or replace view public.dashboard_daily_ride_stats
with (security_invoker = true) as
select
  (rides.requested_at at time zone 'Asia/Kolkata')::date as day,
  count(*)::integer as requested_count,
  count(*) filter (where rides.status = 'completed')::integer as completed_count,
  count(*) filter (where rides.status = 'cancelled')::integer as cancelled_count,
  coalesce(sum(rides.final_fare) filter (where rides.status = 'completed'), 0)::numeric as completed_fare_total,
  coalesce(avg(rides.final_fare) filter (where rides.status = 'completed'), 0)::numeric as avg_final_fare,
  count(*) filter (where rides.status = 'completed' and rides.customer_charge_type = 'free')::integer as free_rides,
  coalesce(sum(rides.pricing_distance_meters) filter (where rides.status = 'completed'), 0)::numeric as completed_distance_meters
from public.rides
group by 1;

create or replace view public.dashboard_cancellation_breakdown
with (security_invoker = true) as
select
  (rides.cancelled_at at time zone 'Asia/Kolkata')::date as day,
  rides.cancellation_reason_code as reason_code,
  coalesce(actor.actor_type, 'unknown') as actor_type,
  count(*)::integer as cancellation_count
from public.rides
left join lateral (
  select history.actor_type
  from public.ride_status_history history
  where history.ride_id = rides.id and history.status = 'cancelled'
  order by history.created_at desc
  limit 1
) actor on true
where rides.status = 'cancelled'
group by 1, 2, 3;

create or replace view public.dashboard_customer_rollups
with (security_invoker = true) as
select
  profile.id as customer_id,
  profile.phone,
  profile.full_name,
  profile.created_at as signed_up_at,
  count(rides.id)::integer as rides_requested,
  count(rides.id) filter (where rides.status = 'completed')::integer as rides_completed,
  count(rides.id) filter (where rides.status = 'cancelled')::integer as rides_cancelled,
  coalesce(sum(rides.final_fare) filter (where rides.status = 'completed'), 0)::numeric as total_spend,
  count(rides.id) filter (where rides.customer_charge_type = 'free' and rides.status = 'completed')::integer as free_rides_completed,
  max(rides.requested_at) as last_ride_at,
  (select count(*)::integer from public.customer_payment_issues issue where issue.customer_id = profile.id) as payment_issues_raised,
  (select count(*)::integer from public.captain_payment_issues issue where exists (
      select 1 from public.rides ride where ride.id = issue.ride_id and ride.customer_id = profile.id
  )) as captain_issues_against
from public.profiles profile
left join public.rides on rides.customer_id = profile.id
group by profile.id;

create or replace view public.dashboard_captain_rollups
with (security_invoker = true) as
select
  captain.user_id as captain_id,
  profile.phone,
  profile.full_name,
  profile.created_at as signed_up_at,
  captain.vehicle_type,
  application.status as onboarding_status,
  availability.is_online,
  availability.updated_at as presence_updated_at,
  count(rides.id)::integer as rides_assigned,
  count(rides.id) filter (where rides.status = 'completed')::integer as rides_completed,
  count(rides.id) filter (where rides.status = 'cancelled')::integer as rides_cancelled,
  coalesce((
    select sum(ledger.amount) from public.captain_earnings_ledger ledger where ledger.captain_id = captain.user_id
  ), 0)::numeric as lifetime_earnings,
  coalesce((
    select sum(session.extract(epoch from (coalesce(session.ended_at, now()) - session.started_at)) / 60)
    from public.captain_online_sessions session where session.captain_id = captain.user_id
  ), 0)::numeric as online_minutes,
  (select count(*)::integer from public.ride_offers offer where offer.captain_id = captain.user_id) as offers_received,
  (select count(*)::integer from public.ride_offers offer where offer.captain_id = captain.user_id and offer.status = 'accepted') as offers_accepted,
  max(rides.requested_at) as last_ride_at,
  (select count(*)::integer from public.captain_payment_issues issue where issue.captain_id = profile.id and issue.status = 'open') as open_payment_issues
from public.captain_profiles captain
join public.profiles profile on profile.id = captain.user_id
left join public.captain_onboarding_applications application on application.user_id = captain.user_id
left join public.captain_availability availability on availability.captain_id = captain.user_id
left join public.rides on rides.captain_id = captain.user_id
group by captain.user_id, profile.id, captain.vehicle_type, application.status, availability.is_online, availability.updated_at;

grant select on public.dashboard_daily_ride_stats,
  public.dashboard_cancellation_breakdown,
  public.dashboard_customer_rollups,
  public.dashboard_captain_rollups
  to authenticated;

-- 4. Operator resolution of captain payment issues ---------------------------
-- customer_payment_issues intentionally has no resolution flow; captain issues do.

create or replace function public.operator_resolve_captain_payment_issue(p_issue_id uuid)
returns public.captain_payment_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.captain_payment_issues;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  update public.captain_payment_issues
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where id = p_issue_id and status = 'open'
  returning * into v_issue;
  if not found then raise exception 'Payment issue is not open'; end if;
  return v_issue;
end;
$$;

revoke all on function public.operator_resolve_captain_payment_issue(uuid) from public, anon;
grant execute on function public.operator_resolve_captain_payment_issue(uuid) to authenticated;
