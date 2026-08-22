-- Demo/Test acceptance runbook for the existing soft-launch promotion.
-- Run with psql as an operator/service-role test connection, for example:
-- psql "$DATABASE_URL" -v customer_id='CUSTOMER_UUID' -v policy_code='demo-free-five-under-2km' \
--   -v first_free_ride_id='RIDE_UUID' -v cancelled_ride_id='RIDE_UUID' \
--   -v sixth_ride_id='RIDE_UUID' -v over_distance_ride_id='RIDE_UUID' \
--   -f supabase/tests/soft_launch_promotion_entitlements_checks.sql
--
-- Prerequisite: enable only the Demo policy. Do not enable it in production.
-- update public.ride_pricing_settings
-- set promotion_enabled = true, promotion_environment = 'demo'
-- where singleton and promotion_environment = 'demo';
--
-- Customer UI path: sign in with 1234567890 / 1234, then use normal route
-- quote/create and captain completion flows. Never insert free rides directly.
-- The customer app must show the status returned by customer_promotion_status():
-- five remaining on a fresh identity, a struck-through fare plus Free · ₹0 for
-- an eligible route, and the normal fare for a route over the configured limit.
-- Manual sequence: (1) confirm the Home/Ride Type offer card shows 5 remaining;
-- (2) quote <=2 km and confirm the struck-through original fare plus Free · ₹0;
-- (3) book it and confirm one server reservation; cancel one such booking and
-- confirm it is released; (4) complete five eligible rides; (5) quote/book a
-- sixth <=2 km ride and a >2 km ride, both of which must show normal fares.

\set ON_ERROR_STOP on

\echo '1. Five completed eligible rides are free; compensation uses the approved fare.'
select count(*) = 5 as five_completed_free_rides,
  array_agg(ride.free_ride_sequence order by ride.free_ride_sequence) = array[1,2,3,4,5]::smallint[] as unique_sequences,
  bool_and(ride.customer_charge_amount = 0 and ride.customer_charge_type = 'free' and ride.payment_status = 'not_required') as free_customer_charge,
  bool_and(compensation.captain_earning_amount = coalesce(ride.final_fare, ride.estimated_fare)) as captain_fare_preserved
from public.rides ride
join public.captain_compensations compensation on compensation.ride_id = ride.id
where ride.customer_id = :'customer_id'
  and ride.pricing_policy_code = :'policy_code'
  and ride.status = 'completed'
  and ride.pricing_distance_meters <= 2000;

\echo '2. Cancellation releases a reservation; only completed rides consume a slot.'
select entitlement.state = 'released' as cancelled_ride_released,
  entitlement.completed_at is null as cancellation_not_consumed
from public.customer_promotion_entitlements entitlement
where entitlement.ride_id = :'cancelled_ride_id';

\echo '3. Sixth eligible ride and over-distance ride are normal customer charges.'
select id, pricing_distance_meters, customer_charge_type, customer_charge_amount,
  (customer_charge_type = 'standard' and customer_charge_amount > 0) as chargeable
from public.rides
where id in (:'sixth_ride_id', :'over_distance_ride_id')
order by pricing_distance_meters, id;

\echo '4. Concurrent normal create_routed_ride requests cannot duplicate a free sequence.'
-- With exactly one slot remaining, submit two normal customer create requests
-- concurrently. One response may be free; the other must be standard. This
-- query must return zero rows.
select sequence, count(*) as active_claims
from public.customer_promotion_entitlements
where customer_id = :'customer_id'
  and policy_code = :'policy_code'
  and state in ('reserved', 'completed')
group by sequence
having count(*) > 1;

\echo '5. Fare adjustments never turn an already free ride into a customer charge.'
select id, customer_charge_amount = 0 and customer_charge_type = 'free' as remains_free,
  payment_status = 'not_required' as no_customer_declaration_required,
  final_fare, estimated_fare
from public.rides
where id = :'first_free_ride_id';

-- Run the following in the authenticated customer session, not this privileged
-- connection. The result is the UI source of truth: completed + reserved are
-- subtracted server-side; no handset counter or client reset is permitted.
-- select * from public.customer_promotion_status();
-- Expected values for a fresh customer before booking: remaining_free_rides=5,
-- completed_free_rides=0, reserved_free_rides=0, promotion_enabled=true.
-- After eligible booking: reserved_free_rides increments. After cancellation it
-- returns to zero. After completion it becomes completed_free_rides instead.

-- 6. Disputed payouts remain held. Run the operator hold flow in
-- free_customer_compensation_checks.sql, then confirm the payout cannot be
-- paid until the dispute is resolved and an operator supplies a provider or
-- manual payout reference:
-- select payout.status = 'held' as payout_held,
--   exists (select 1 from public.captain_payout_disputes dispute
--           where dispute.payout_id = payout.id and dispute.status in ('open', 'under_review')) as open_dispute
-- from public.captain_payouts payout where payout.id = :'payout_id';

-- Fresh test identity only: do not delete or reset entitlement history from a
-- customer app or against a pilot account. In anonymous Demo mode, clear the
-- app's Supabase storage/reinstall on a disposable device, sign in again with
-- 1234567890 / 1234, and use the new auth.uid() as :customer_id. If an operator
-- must retire a disposable identity, do so through the Auth dashboard after
-- verifying it has no active rides; preserve its promotion/ride audit records.
