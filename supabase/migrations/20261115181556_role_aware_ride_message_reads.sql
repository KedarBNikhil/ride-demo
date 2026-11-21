-- Customer and Captain may share one pilot account. Keep their read positions
-- separate and count unread messages by the explicit app role.
alter table public.ride_message_reads
  add column reader_role text not null default 'customer'
  check (reader_role in ('customer', 'captain'));
alter table public.ride_message_reads
  drop constraint ride_message_reads_pkey,
  add primary key (ride_id, user_id, reader_role);

drop function public.unread_ride_message_count(uuid);
create function public.unread_ride_message_count(p_ride_id uuid, p_reader_role text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid; v_captain_id uuid; v_reader_role text;
  v_requested_role text := nullif(trim(coalesce(p_reader_role, '')), '');
begin
  perform public.require_pilot_user();
  select ride.customer_id, ride.captain_id into v_customer_id, v_captain_id from public.rides ride where ride.id = p_ride_id;
  if not found or auth.uid() not in (v_customer_id, v_captain_id) then raise exception 'Ride messages are not available'; end if;
  if v_customer_id = auth.uid() and v_captain_id = auth.uid() then
    if v_requested_role not in ('customer', 'captain') then raise exception 'A reader role is required for this ride'; end if;
    v_reader_role := v_requested_role;
  elsif v_customer_id = auth.uid() then v_reader_role := 'customer'; else v_reader_role := 'captain'; end if;
  if v_requested_role is not null and v_requested_role <> v_reader_role then raise exception 'Reader role does not match this ride participant'; end if;
  return (select count(*)::integer from public.ride_messages message where message.ride_id = p_ride_id
    and ((message.sender_role is not null and message.sender_role <> v_reader_role) or (message.sender_role is null and message.sender_id <> auth.uid()))
    and message.created_at > coalesce((select read.last_read_at from public.ride_message_reads read where read.ride_id = p_ride_id and read.user_id = auth.uid() and read.reader_role = v_reader_role), '-infinity'::timestamptz));
end;
$$;

drop function public.mark_ride_messages_read(uuid);
create function public.mark_ride_messages_read(p_ride_id uuid, p_reader_role text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid; v_captain_id uuid; v_reader_role text;
  v_requested_role text := nullif(trim(coalesce(p_reader_role, '')), '');
begin
  perform public.require_pilot_user();
  select ride.customer_id, ride.captain_id into v_customer_id, v_captain_id from public.rides ride where ride.id = p_ride_id;
  if not found or auth.uid() not in (v_customer_id, v_captain_id) then raise exception 'Ride messages are not available'; end if;
  if v_customer_id = auth.uid() and v_captain_id = auth.uid() then
    if v_requested_role not in ('customer', 'captain') then raise exception 'A reader role is required for this ride'; end if;
    v_reader_role := v_requested_role;
  elsif v_customer_id = auth.uid() then v_reader_role := 'customer'; else v_reader_role := 'captain'; end if;
  if v_requested_role is not null and v_requested_role <> v_reader_role then raise exception 'Reader role does not match this ride participant'; end if;
  insert into public.ride_message_reads(ride_id, user_id, reader_role, last_read_at) values (p_ride_id, auth.uid(), v_reader_role, now())
  on conflict (ride_id, user_id, reader_role) do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.unread_ride_message_count(uuid, text), public.mark_ride_messages_read(uuid, text) from public, anon;
grant execute on function public.unread_ride_message_count(uuid, text), public.mark_ride_messages_read(uuid, text) to authenticated;
