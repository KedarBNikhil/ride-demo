-- Functions have PUBLIC execute by default. Explicitly remove it from anon so
-- only authenticated sessions can reach these narrowly-authorized RPCs.
revoke all on function public.request_ride(text, text, text, numeric, numeric, numeric, numeric) from anon;
revoke all on function public.respond_to_ride_offer(uuid, boolean) from anon;
revoke all on function public.captain_transition_ride(uuid, text) from anon;
