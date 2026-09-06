-- Read-only production verification for the active-Captain promo guard.
-- This intentionally creates no Auth users, rides, entitlements, balances, or
-- Captain records.  Run as a service/operator connection:
-- psql "$DATABASE_URL" -f supabase/tests/active_captain_phone_promo_eligibility_checks.sql
\set ON_ERROR_STOP on

\echo '1. Canonical Indian phone normalization rejects formatting bypasses.'
select array_agg(public.normalize_indian_phone(phone) order by phone) = array['+919876543210', '+919876543210', '+919876543210', '+919876543210']::text[] as formatting_is_canonical
from (values ('9876543210'), ('919876543210'), ('+91 98765-43210'), ('+919876543210')) as sample(phone);

\echo '2. The private helper recognizes only the approved, non-deleted Captain lifecycle.'
select (select prosrc from pg_proc where oid = 'private.has_active_captain_for_verified_phone(uuid)'::regprocedure) like '%application.status = ''approved''%'
  and (select prosrc from pg_proc where oid = 'private.has_active_captain_for_verified_phone(uuid)'::regprocedure) like '%captain_profile.deleted_at is null%'
  and (select prosrc from pg_proc where oid = 'private.has_active_captain_for_verified_phone(uuid)'::regprocedure) like '%phone_confirmed_at is not null%'
  as active_lifecycle_is_server_defined;

\echo '3. Allocation and fare finalization re-check the private guard.'
select bool_and((select prosrc from pg_proc where oid = proc) like '%private.has_active_captain_for_verified_phone%'
                or (select prosrc from pg_proc where oid = proc) like '%private.reprice_active_captain_promo_ride%') as every_required_path_rechecks
from unnest(array[
  'public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text)'::regprocedure,
  'public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text)'::regprocedure,
  'public.apply_captain_road_distance(uuid,integer,integer,text)'::regprocedure,
  'public.captain_transition_ride(uuid,text)'::regprocedure,
  'public.issue_customer_pickup_otp(uuid)'::regprocedure,
  'public.captain_start_ride(uuid,text)'::regprocedure,
  'public.customer_promotion_status()'::regprocedure
]) as checks(proc);

\echo '4. No client role can call the private lookup or create/reprice a ride directly.'
select not has_function_privilege('anon', 'private.has_active_captain_for_verified_phone(uuid)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'private.has_active_captain_for_verified_phone(uuid)'::regprocedure, 'execute')
    and not has_function_privilege('authenticated', 'public.create_routed_ride(uuid,text,text,text,numeric,numeric,numeric,numeric,smallint,integer,integer,text)'::regprocedure, 'execute')
    and has_function_privilege('authenticated', 'public.customer_promotion_status()'::regprocedure, 'execute')
  as client_cannot_bypass_or_query_captains;

\echo '5. Existing promotion records remain auditable; only reserved entries can be released.'
select (select prosrc from pg_proc where oid = 'private.reprice_active_captain_promo_ride(public.rides,numeric)'::regprocedure) like '%set state = ''released''%'
  and (select prosrc from pg_proc where oid = 'private.reprice_active_captain_promo_ride(public.rides,numeric)'::regprocedure) not like '%delete from public.customer_promotion_entitlements%'
  as stale_entitlements_are_not_deleted;
