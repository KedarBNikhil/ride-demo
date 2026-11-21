create table public.ride_message_reads (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (ride_id, user_id)
);

alter table public.ride_message_reads enable row level security;
revoke all on table public.ride_message_reads from public, anon, authenticated;

create function public.unread_ride_message_count(p_ride_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user();
  if not exists (select 1 from public.rides ride where ride.id = p_ride_id and auth.uid() in (ride.customer_id, ride.captain_id)) then
    raise exception 'Ride messages are not available';
  end if;
  return (
    select count(*)::integer
    from public.ride_messages message
    where message.ride_id = p_ride_id
      and message.sender_id <> auth.uid()
      and message.created_at > coalesce((select read.last_read_at from public.ride_message_reads read where read.ride_id = p_ride_id and read.user_id = auth.uid()), '-infinity'::timestamptz)
  );
end;
$$;

create function public.mark_ride_messages_read(p_ride_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user();
  if not exists (select 1 from public.rides ride where ride.id = p_ride_id and auth.uid() in (ride.customer_id, ride.captain_id)) then
    raise exception 'Ride messages are not available';
  end if;
  insert into public.ride_message_reads(ride_id, user_id, last_read_at)
  values (p_ride_id, auth.uid(), now())
  on conflict (ride_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.unread_ride_message_count(uuid), public.mark_ride_messages_read(uuid) from public, anon;
grant execute on function public.unread_ride_message_count(uuid), public.mark_ride_messages_read(uuid) to authenticated;
