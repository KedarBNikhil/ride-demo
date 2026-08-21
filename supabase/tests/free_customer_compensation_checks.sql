-- Demo/Test runbook: run after migration 20260821100000 is applied.
-- This is a psql script. Replace IDs, then run the marked sections as the
-- stated authenticated identity; each expected failure proves an access guard.
\set free_ride_id 'REPLACE_FREE_COMPLETED_RIDE_UUID'
\set payout_id 'REPLACE_PAYOUT_UUID'
\set payout_reference 'manual-demo-REPLACE_UNIQUE_REFERENCE'

\echo '1. Customer/any read identity: free charge is ₹0, no declaration, and no fare approval gate'
select customer_charge_amount = 0 and customer_charge_type = 'free'
  and customer_charge_status = 'not_required' and payment_status = 'not_required' and payment_method is null
  and fare_approval_status = 'approved' as free_charge_ok,
  estimated_fare, final_fare
from public.rides where id = :'free_ride_id';

\echo '2. Assigned captain invokes completion twice; privileged Demo/Test verifier then proves idempotency'
-- select public.captain_transition_ride(:'free_ride_id', 'completed');
-- select public.captain_transition_ride(:'free_ride_id', 'completed');
-- The following query is intentionally for the privileged Demo/Test verifier,
-- not a captain client; direct compensation/payout table access must stay denied.
select count(*) = 1 as one_compensation,
  min(compensation.captain_earning_amount) = min(coalesce(ride.final_fare, ride.estimated_fare)) as captain_fare_preserved,
  (select count(*) from public.captain_payouts payout where payout.compensation_id = compensation.id) = 1 as one_payout,
  (select count(*) from public.captain_payout_events event join public.captain_payouts payout on payout.id = event.payout_id where payout.compensation_id = compensation.id and event.event_type = 'compensation_created') = 1 as one_creation_event
from public.captain_compensations compensation join public.rides ride on ride.id = compensation.ride_id
where compensation.ride_id = :'free_ride_id' group by compensation.id;

\echo '3. Authorized operator: hold blocks paid; resolve first, then mark paid with a manual reference'
-- select public.operator_hold_captain_payout(:'payout_id', 'demo dispute', 'operator hold for demo');
-- Expected failure: select public.operator_update_captain_payout(:'payout_id', 'paid', 'must remain blocked', null, :'payout_reference');
-- select public.operator_resolve_captain_payout_dispute('REPLACE_DISPUTE_UUID', 'resolved', 'demo review resolved');
-- select public.operator_update_captain_payout(:'payout_id', 'not_started', 'release hold after review');
-- Expected failure: select public.operator_update_captain_payout(:'payout_id', 'paid', 'missing payout reference', 'manual', null);
select public.operator_update_captain_payout(:'payout_id', 'paid', 'manual payout verified by operator', 'manual', :'payout_reference');
select status, provider, provider_reference, paid_at from public.captain_payouts where id = :'payout_id';

\echo '4. Different authenticated captain: must return zero rows for another captain ride'
-- Run this exact query in the other captain session; output must be empty.
select * from public.captain_ride_payout(:'free_ride_id');
