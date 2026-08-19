-- These tables have no client grants. Explicit service-role policies document
-- that only trusted server-side administration may access their raw rows.
create policy "Service role manages settlement operators"
on public.settlement_operators for all to service_role
using (true) with check (true);

create policy "Service role manages ride settlements"
on public.ride_settlements for all to service_role
using (true) with check (true);

create policy "Service role manages settlement audit events"
on public.ride_settlement_events for all to service_role
using (true) with check (true);
