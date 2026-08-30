-- Backend-owned wake-up notifications. Set these Vault secrets before applying:
--   project_url: https://<project-ref>.supabase.co
--   dispatch_webhook_secret: must match the Edge Function's DISPATCH_WEBHOOK_SECRET
-- The secret is never exposed to mobile clients or stored in this migration.
create or replace function public.enqueue_ride_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_url text;
  v_webhook_secret text;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_webhook_secret
  from vault.decrypted_secrets where name = 'dispatch_webhook_secret';

  if v_project_url is null or v_webhook_secret is null then
    raise warning 'Ride push skipped: project_url or dispatch_webhook_secret is not configured in Vault';
    return new;
  end if;

  perform net.http_post(
    url := v_project_url || '/functions/v1/send-ride-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-webhook-secret', v_webhook_secret
    ),
    body := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'type', TG_OP,
      'record', case when TG_OP = 'DELETE' then null else to_jsonb(new) end,
      'old_record', case when TG_OP = 'INSERT' then null else to_jsonb(old) end
    )
  );
  return new;
end;
$$;

-- Replace the dashboard-created webhooks. They covered only two paths and
-- embedded the webhook secret in trigger metadata, so leaving them enabled
-- would both duplicate sends and retain a plaintext secret.
drop trigger if exists "notify-customer-ride-status" on public.rides;
drop trigger if exists rides_enqueue_ride_notification on public.rides;
create trigger rides_enqueue_ride_notification
after insert or update of status, payment_status on public.rides
for each row execute function public.enqueue_ride_notification();

drop trigger if exists "notify-captain-new-ride-offer" on public.ride_offers;
drop trigger if exists ride_offers_enqueue_ride_notification on public.ride_offers;
create trigger ride_offers_enqueue_ride_notification
after insert on public.ride_offers
for each row execute function public.enqueue_ride_notification();

revoke all on function public.enqueue_ride_notification() from public, anon, authenticated;
