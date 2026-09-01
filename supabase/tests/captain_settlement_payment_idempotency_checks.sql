-- Operator-run settlement idempotency checks. Run as an authorized settlement
-- operator against a disposable approved settlement after migration
-- 20260901045519 is applied. The first payment call records a real external
-- payment; never use a production settlement unless the transfer is complete.
-- psql "$DATABASE_URL" -v compensation_id='UUID' -v settlement_id='UUID' \
--   -v reference='UTR_OR_BANK_REFERENCE' -f supabase/tests/captain_settlement_payment_idempotency_checks.sql

\set ON_ERROR_STOP on

\echo '1. Repeating the same verification decision returns the same row and creates one event.'
-- select public.operator_verify_captain_ride(:'compensation_id', 'APPROVED', null);
-- select public.operator_verify_captain_ride(:'compensation_id', 'APPROVED', null);
select verification.status = 'APPROVED' as approved_once,
  count(event.*) = 1 as one_verification_event
from public.captain_ride_verifications verification
left join public.captain_ride_verification_events event on event.verification_id = verification.id
where verification.compensation_id = :'compensation_id'
group by verification.status;

\echo '2. Generate and approve are safe to repeat; settlement membership remains unique.'
-- select public.operator_generate_captain_settlement((now() at time zone 'Asia/Kolkata')::date);
-- select public.operator_generate_captain_settlement((now() at time zone 'Asia/Kolkata')::date);
-- select public.operator_approve_captain_settlement_batch('BATCH_UUID');
-- select public.operator_approve_captain_settlement_batch('BATCH_UUID');
select settlement_id, count(*) = 1 as one_receipt_per_settlement
from public.captain_settlement_payment_events
where settlement_id = :'settlement_id'
group by settlement_id;

\echo '3. The same manual reference is an idempotent retry; a different reference must fail.'
-- select public.operator_record_manual_captain_payment(:'settlement_id', :'reference', 'manual transfer recorded');
-- select public.operator_record_manual_captain_payment(:'settlement_id', :'reference', 'retry after button/network failure');
-- Expected failure: select public.operator_record_manual_captain_payment(:'settlement_id', 'DIFFERENT_REFERENCE', null);
select settlement.payout_status = 'PAID' as paid,
  settlement.external_reference = :'reference' as reference_preserved,
  settlement.paid_at is not null and settlement.paid_by is not null as operator_timestamped,
  count(event.*) = 1 as one_immutable_payment_receipt
from public.captain_settlements settlement
left join public.captain_settlement_payment_events event on event.settlement_id = settlement.id
where settlement.id = :'settlement_id'
group by settlement.id;

\echo '4. Paid settlement and receipt mutations must fail.'
-- Expected failure: update public.captain_settlements set notes = 'changed' where id = :'settlement_id';
-- Expected failure: update public.captain_settlement_payment_events set notes = 'changed' where settlement_id = :'settlement_id';
