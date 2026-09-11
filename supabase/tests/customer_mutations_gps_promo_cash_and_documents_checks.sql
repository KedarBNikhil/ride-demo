-- Run against the linked project after the matching migration. These are
-- catalog/invariant checks: they create no rider, captain, payment, or GPS data.
\echo '1. Customer direct rides writes are impossible through RLS and grants.'
select not exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'rides'
    and policyname in ('Customers can create requested rides', 'Customers can cancel their own active rides')
) as no_customer_direct_ride_write_policies;

select not has_table_privilege('authenticated', 'public.rides', 'insert')
   and not has_table_privilege('authenticated', 'public.rides', 'update')
   and not has_table_privilege('authenticated', 'public.rides', 'delete')
   and has_function_privilege('authenticated', 'public.customer_cancel_ride(uuid,text,text)'::regprocedure, 'execute')
  as only_the_authoritative_cancellation_path_is_client_callable;

\echo '2. Soft-launch rides are paid cash rides, never new free promotions.'
select not promotion_enabled as free_promotions_disabled
from public.ride_pricing_settings where singleton;

select pg_get_functiondef('public.customer_confirm_payment(uuid,text)'::regprocedure) like '%p_method <> ''cash''%'
  as payment_declaration_rejects_upi;

\echo '3. GPS evidence remains private and is retained for a bounded period.'
select c.relrowsecurity
  and not has_table_privilege('authenticated', 'public.ride_location_samples', 'insert')
  and has_function_privilege('authenticated', 'public.record_active_ride_location(uuid,uuid,bigint,timestamptz,double precision,double precision,double precision,double precision,double precision,double precision,boolean)'::regprocedure, 'execute')
  as gps_samples_require_the_guarded_rpc
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'ride_location_samples';

select exists (select 1 from cron.job where jobname = 'nandyal-ride-gps-retention')
  and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'prune_ride_location_samples')
  as gps_retention_job_is_configured;

\echo '4. Only authenticated operators can queue/review document changes.'
select not has_function_privilege('anon', 'public.operator_captain_document_change_queue()'::regprocedure, 'execute')
   and has_function_privilege('authenticated', 'public.operator_captain_document_change_queue()'::regprocedure, 'execute')
   and has_function_privilege('authenticated', 'public.operator_review_captain_document_change(uuid,boolean,text)'::regprocedure, 'execute')
   and has_function_privilege('authenticated', 'public.operator_verify_captain_document(uuid,boolean,text)'::regprocedure, 'execute')
  as document_review_rpcs_are_authenticated_only;
