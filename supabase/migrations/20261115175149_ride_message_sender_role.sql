-- Some pilot devices use the same authenticated profile in both apps. Record
-- the app role alongside the sender ID so those conversations still render as
-- a two-sided thread.
alter table public.ride_messages
  add column sender_role text check (sender_role in ('customer', 'captain'));

drop function public.ride_messages_for_ride(uuid);
create function public.ride_messages_for_ride(p_ride_id uuid)
returns table(id uuid, sender_id uuid, sender_role text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user();
  if not exists (
    select 1 from public.rides
    where id = p_ride_id and auth.uid() in (customer_id, captain_id)
  ) then
    raise exception 'Ride messages are not available';
  end if;
  return query
    select message.id, message.sender_id, message.sender_role, message.body, message.created_at
    from public.ride_messages message
    where message.ride_id = p_ride_id
    order by message.created_at;
end;
$$;

drop function public.send_ride_message(uuid, text);
create function public.send_ride_message(p_ride_id uuid, p_body text, p_sender_role text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_customer_id uuid;
  v_captain_id uuid;
  v_sender_role text;
  v_requested_role text := nullif(trim(coalesce(p_sender_role, '')), '');
begin
  perform public.require_pilot_user();
  select customer_id, captain_id into v_customer_id, v_captain_id
  from public.rides where id = p_ride_id;
  if not found or auth.uid() not in (v_customer_id, v_captain_id) then
    raise exception 'Ride messages are not available';
  end if;

  if v_customer_id = auth.uid() and v_captain_id = auth.uid() then
    if v_requested_role not in ('customer', 'captain') then
      raise exception 'A sender role is required for this ride';
    end if;
    v_sender_role := v_requested_role;
  elsif v_customer_id = auth.uid() then
    v_sender_role := 'customer';
  else
    v_sender_role := 'captain';
  end if;
  if v_requested_role is not null and v_requested_role <> v_sender_role then
    raise exception 'Sender role does not match this ride participant';
  end if;

  if char_length(trim(coalesce(p_body, ''))) not between 1 and 500 then
    raise exception 'Ride message must be between 1 and 500 characters';
  end if;
  insert into public.ride_messages(ride_id, sender_id, sender_role, body)
  values (p_ride_id, auth.uid(), v_sender_role, trim(p_body));
end;
$$;

revoke all on function public.ride_messages_for_ride(uuid), public.send_ride_message(uuid, text, text) from public, anon;
grant execute on function public.ride_messages_for_ride(uuid), public.send_ride_message(uuid, text, text) to authenticated;
