-- Applied remotely as version 20260910175046.
-- Customer ride creation and cancellation are mediated exclusively through
-- SECURITY DEFINER RPCs / the ride-maps Edge Function. Direct Data API writes
-- would skip dispatch, cancellation side effects, and authoritative pricing.
drop policy if exists "Customers can create requested rides" on public.rides;
drop policy if exists "Customers can cancel their own active rides" on public.rides;
revoke insert, update, delete on table public.rides from anon, authenticated;

-- Friends-and-family soft launch: promotions are disabled for newly created
-- rides. Historical free rides and their settlement/audit records are kept as
-- issued; this migration never rewrites past financial facts.
update public.ride_pricing_settings
set promotion_enabled = false
where singleton and promotion_enabled;

-- Cash is the only declaration method for newly completed standard rides.
-- The wider historical enum/type remains so existing UPI records still read.
create or replace function public.customer_confirm_payment(p_ride_id uuid, p_method text)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare v_ride public.rides; v_settlement_id uuid;
begin
  perform public.require_pilot_user('customer');
  if p_method <> 'cash' then raise exception 'Cash is the only payment method during this pilot'; end if;
  update public.rides
  set payment_status = 'declared', customer_charge_status = 'declared', payment_method = 'cash', paid_at = null
  where id = p_ride_id
    and customer_id = auth.uid()
    and status = 'completed'
    and customer_charge_type = 'standard'
    and payment_status = 'pending'
  returning * into v_ride;
  if not found then raise exception 'Cash payment is not available for this ride'; end if;
  insert into public.ride_settlements (ride_id, declared_method, amount_due, declared_by)
  values (v_ride.id, 'cash', v_ride.customer_charge_amount, auth.uid())
  returning id into v_settlement_id;
  insert into public.ride_settlement_events (settlement_id, event_type, actor_id, metadata)
  values (v_settlement_id, 'declared', auth.uid(), jsonb_build_object('declared_method', 'cash'));
  return v_ride;
end;
$$;

revoke all on function public.customer_confirm_payment(uuid, text) from public, anon;
grant execute on function public.customer_confirm_payment(uuid, text) to authenticated;

-- GPS evidence remains available to operators for a bounded window. This
-- removes only old samples, not rides or their financial/lifecycle records.
create or replace function private.prune_ride_location_samples()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  delete from public.ride_location_samples
  where received_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.prune_ride_location_samples() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'nandyal-ride-gps-retention';
select cron.schedule(
  'nandyal-ride-gps-retention',
  '15 3 * * *',
  'select private.prune_ride_location_samples();'
);

-- Keep document access and review inside the established operator boundary.
-- The queue exposes only document-change work; it does not grant broad table
-- access to dashboard users.
create or replace function public.operator_captain_document_change_queue()
returns table (
  document_id uuid,
  captain_id uuid,
  captain_name text,
  captain_phone text,
  document_type text,
  verification_status text,
  change_request_status text,
  change_requested_at timestamptz,
  replacement_submitted_at timestamptz,
  review_note text,
  storage_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then raise exception 'Operator authorization is required'; end if;
  return query
  select document.id, document.user_id, profile.full_name, profile.phone,
    document.document_type, document.verification_status, document.change_request_status,
    document.change_requested_at, document.replacement_submitted_at, document.review_note,
    document.storage_path
  from public.captain_onboarding_documents document
  left join public.profiles profile on profile.id = document.user_id
  where document.change_request_status = 'requested'
     or (document.change_request_status = 'approved' and document.verification_status = 'pending')
  order by coalesce(document.replacement_submitted_at, document.change_requested_at) asc;
end;
$$;

revoke all on function public.operator_captain_document_change_queue() from public, anon;
grant execute on function public.operator_captain_document_change_queue() to authenticated;

drop policy if exists "Settlement operators can read pending captain document changes" on storage.objects;
create policy "Settlement operators can read pending captain document changes"
on storage.objects for select to authenticated
using (
  bucket_id = 'captain-documents'
  and public.is_settlement_operator()
  and exists (
    select 1
    from public.captain_onboarding_documents document
    where document.storage_path = name
      and (
        document.change_request_status = 'requested'
        or (document.change_request_status = 'approved' and document.verification_status = 'pending')
      )
  )
);
