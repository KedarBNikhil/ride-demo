alter table public.rides add column if not exists captain_rating smallint check (captain_rating between 1 and 5), add column if not exists captain_rating_note text;
alter table public.rides add constraint captain_rating_note_length check (char_length(coalesce(captain_rating_note, '')) <= 140);

create or replace function public.captain_rate_customer(p_ride_id uuid, p_rating smallint, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('captain');
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  update public.rides set captain_rating = p_rating, captain_rating_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_ride_id and captain_id = auth.uid() and status = 'completed' and captain_rating is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end;
$$;

create or replace function public.captain_ride_history(p_before timestamptz default null, p_limit integer default 20)
returns setof public.rides language sql security definer set search_path = '' as $$
  select ride.* from public.rides ride
  where ride.captain_id = auth.uid() and (p_before is null or ride.requested_at < p_before)
  order by ride.requested_at desc limit least(greatest(p_limit, 1), 50);
$$;
revoke all on function public.captain_rate_customer(uuid, smallint, text), public.captain_ride_history(timestamptz, integer) from public, anon;
grant execute on function public.captain_rate_customer(uuid, smallint, text), public.captain_ride_history(timestamptz, integer) to authenticated;
