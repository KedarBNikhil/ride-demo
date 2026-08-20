-- Kept separate from the captain earnings work so the deployed app can restore
-- its availability control without waiting for the broader dashboard migration.
create or replace function public.captain_set_availability(p_is_online boolean, p_latitude numeric default null, p_longitude numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('captain');

  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Availability location must include both latitude and longitude';
  end if;

  if p_latitude is not null and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception 'Invalid availability location';
  end if;

  insert into public.captain_availability(captain_id, is_online, latitude, longitude, updated_at)
  values (auth.uid(), p_is_online, p_latitude, p_longitude, now())
  on conflict (captain_id) do update
    set is_online = excluded.is_online,
        latitude = coalesce(excluded.latitude, public.captain_availability.latitude),
        longitude = coalesce(excluded.longitude, public.captain_availability.longitude),
        updated_at = now();
end;
$$;

revoke all on function public.captain_set_availability(boolean, numeric, numeric) from public, anon;
grant execute on function public.captain_set_availability(boolean, numeric, numeric) to authenticated;
