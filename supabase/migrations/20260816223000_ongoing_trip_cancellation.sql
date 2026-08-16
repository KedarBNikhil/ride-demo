-- Preserve historical lifecycle timestamps when an active trip is cancelled.
alter table public.rides drop constraint ride_lifecycle_times_match_status;
alter table public.rides add constraint ride_lifecycle_times_match_status check (
  (arrived_at is null or status in ('arrived', 'in_progress', 'completed', 'cancelled'))
  and (started_at is null or status in ('in_progress', 'completed', 'cancelled'))
);
alter table public.rides
  add column travelled_distance_km numeric(10, 3) not null default 0 check (travelled_distance_km >= 0),
  add column cancellation_charge numeric(10, 2) not null default 0 check (cancellation_charge >= 0);

create or replace function public.captain_update_ride_location(p_ride_id uuid, p_latitude numeric, p_longitude numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_previous_latitude numeric; v_previous_longitude numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Invalid location'; end if;
  select captain_latitude, captain_longitude into v_previous_latitude, v_previous_longitude
  from public.rides where id = p_ride_id and captain_id = auth.uid() and status = 'in_progress' for update;
  if not found then raise exception 'Active ride not found'; end if;
  update public.rides set
    captain_latitude = p_latitude, captain_longitude = p_longitude,
    travelled_distance_km = travelled_distance_km + case when v_previous_latitude is null then 0 else
      sqrt(power((p_latitude - v_previous_latitude) * 111.32, 2) + power((p_longitude - v_previous_longitude) * 111.32 * cos(radians(p_latitude)), 2))
    end
  where id = p_ride_id;
end;
$$;

create function public.customer_cancel_ride(p_ride_id uuid, p_reason_code text, p_reason_detail text default null)
returns public.rides language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides; v_charge numeric(10, 2) := 0; v_minutes numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_reason_code not in ('change_plans', 'another_ride', 'wait_time', 'fare_concern', 'captain_unreachable', 'other') then raise exception 'Invalid cancellation reason'; end if;
  if p_reason_code = 'other' and char_length(trim(coalesce(p_reason_detail, ''))) not between 1 and 180 then raise exception 'Cancellation detail is required'; end if;
  select * into v_ride from public.rides
  where id = p_ride_id and customer_id = auth.uid()
    and status in ('requested', 'searching', 'accepted', 'in_progress')
  for update;
  if not found then raise exception 'Ride can no longer be cancelled'; end if;
  if v_ride.status = 'in_progress' then
    v_minutes := greatest(0, extract(epoch from now() - v_ride.started_at) / 60);
    v_charge := least(v_ride.estimated_fare, greatest(15::numeric, round(10 + coalesce(v_ride.travelled_distance_km, 0) * 12 + v_minutes * 1.5, 2)));
  end if;
  update public.rides set
    status = 'cancelled', cancellation_reason_code = p_reason_code,
    cancellation_reason_detail = case when p_reason_code = 'other' then trim(p_reason_detail) else null end,
    cancellation_charge = v_charge, final_fare = case when v_charge > 0 then v_charge else null end
  where id = v_ride.id returning * into v_ride;
  update public.ride_offers set status = 'cancelled', responded_at = null
  where ride_id = v_ride.id and status in ('offered', 'accepted');
  return v_ride;
end;
$$;

revoke all on function public.customer_cancel_ride(uuid, text, text) from public, anon;
grant execute on function public.customer_cancel_ride(uuid, text, text) to authenticated;
