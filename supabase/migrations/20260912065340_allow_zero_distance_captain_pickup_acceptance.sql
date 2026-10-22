-- Google deliberately omits duration and geometry for a Captain already at
-- the pickup. Persist that verified zero-distance result explicitly without
-- relaxing validation for any other route kind or non-zero pickup route.
alter table public.ride_route_results
  drop constraint ride_route_results_distance_meters_check,
  drop constraint ride_route_results_duration_seconds_check,
  drop constraint ride_route_results_encoded_polyline_check;

alter table public.ride_route_results
  add constraint ride_route_results_valid_route_check check (
    (distance_meters > 0 and duration_seconds > 0 and char_length(encoded_polyline) between 1 and 200000)
    or (route_kind = 'captain_to_pickup' and distance_meters = 0 and duration_seconds = 0 and encoded_polyline = 'AT_PICKUP')
  );

create or replace function public.accept_ride_offer_with_pickup_route(
  p_offer_id uuid, p_captain_id uuid, p_pickup_distance_meters integer,
  p_duration_seconds integer, p_encoded_polyline text
)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.ride_offers;
  v_ride public.rides;
  v_final_fare numeric(10,0);
  v_at_pickup boolean;
begin
  if p_captain_id is null then raise exception 'Captain is required'; end if;
  v_at_pickup := p_pickup_distance_meters = 0 and p_duration_seconds = 0 and p_encoded_polyline = 'AT_PICKUP';
  if not v_at_pickup and (p_pickup_distance_meters not between 1 and 100000 or p_duration_seconds not between 1 and 43200 or char_length(p_encoded_polyline) not between 1 and 200000) then
    raise exception 'Invalid Google route';
  end if;
  select * into v_offer from public.ride_offers where id = p_offer_id for update;
  if not found or v_offer.captain_id <> p_captain_id or v_offer.status <> 'offered' or v_offer.expires_at <= now() then raise exception 'Offer is no longer available'; end if;
  select * into v_ride from public.rides where id = v_offer.ride_id and status = 'searching' and captain_id is null for update;
  if not found then raise exception 'Ride was already accepted or cancelled'; end if;

  v_final_fare := private.round_fare_half_down(v_ride.estimated_fare);
  update public.rides
  set captain_id = p_captain_id, status = 'accepted', accepted_at = now(), pickup_distance_meters = p_pickup_distance_meters,
      pickup_surcharge = 0, final_fare = v_final_fare, updated_at = now()
  where id = v_ride.id
  returning * into v_ride;

  perform private.reprice_active_captain_promo_ride(v_ride, v_final_fare);
  select * into v_ride from public.rides where id = v_ride.id;
  update public.rides
  set customer_charge_amount = case when v_ride.customer_charge_type = 'free' then 0 else v_final_fare end,
      fare_approval_status = 'approved', updated_at = now()
  where id = v_ride.id
  returning * into v_ride;

  insert into public.ride_route_results (ride_id, route_kind, distance_meters, duration_seconds, encoded_polyline)
  values (v_ride.id, 'captain_to_pickup', p_pickup_distance_meters, p_duration_seconds, p_encoded_polyline)
  on conflict (ride_id, route_kind) do update set distance_meters = excluded.distance_meters, duration_seconds = excluded.duration_seconds, encoded_polyline = excluded.encoded_polyline, created_at = now();
  update public.ride_offers set status = case when id = v_offer.id then 'accepted' else 'cancelled' end, responded_at = case when id = v_offer.id then now() else null end where ride_id = v_ride.id and status = 'offered';
  update public.captain_availability set is_online = false, updated_at = now() where captain_id = p_captain_id;
  insert into public.ride_status_history (ride_id, status, actor_type) values (v_ride.id, 'accepted', 'captain');
  return v_ride;
end;
$$;

revoke all on function public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text) from public, anon, authenticated;
grant execute on function public.accept_ride_offer_with_pickup_route(uuid,uuid,integer,integer,text) to service_role;
