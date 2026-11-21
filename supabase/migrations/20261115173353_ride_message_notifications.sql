-- Deliver a push to the other ride participant when a chat message is sent.
-- The webhook secret is read from Vault by the shared enqueue function.
drop trigger if exists ride_messages_enqueue_ride_notification on public.ride_messages;
create trigger ride_messages_enqueue_ride_notification
after insert on public.ride_messages
for each row execute function public.enqueue_ride_notification();
