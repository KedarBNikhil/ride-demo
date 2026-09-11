-- Focused catalog/invariant checks for 20260911104619.  They create no data.
\set ON_ERROR_STOP on

select to_regclass('public.financial_adjustments') is not null
  and to_regclass('public.financial_adjustment_applications') is not null
  and not has_table_privilege('authenticated', 'public.financial_adjustments', 'insert')
  and not has_table_privilege('authenticated', 'public.financial_adjustment_applications', 'update')
  as adjustments_are_server_owned;

select not has_function_privilege('anon', 'public.operator_resolve_dispute_with_adjustment(text,uuid,text,numeric,text,text)'::regprocedure, 'execute')
  and has_function_privilege('authenticated', 'public.operator_resolve_dispute_with_adjustment(text,uuid,text,numeric,text,text)'::regprocedure, 'execute')
  and not has_function_privilege('anon', 'public.customer_ride_payment_breakdown(uuid)'::regprocedure, 'execute')
  as guarded_rpcs_have_no_anon_access;

select exists (select 1 from pg_trigger where tgname = 'apply_captain_dispute_deductions' and not tgisinternal)
  and pg_get_functiondef('public.customer_confirm_payment(uuid,text)'::regprocedure) like '%previous_ride_adjustment%'
  and pg_get_functiondef('public.captain_ride_payout(uuid)'::regprocedure) like '%greatest%'
  as application_is_idempotent_and_captain_net_cannot_be_negative;

select exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'financial_adjustments_one_active_dispute_account_idx')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'financial_adjustment_applications_adjustment_id_ride_id_key')
  as dispute_and_application_duplicates_are_constrained;
