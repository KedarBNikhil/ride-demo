create or replace function public.captain_daily_analytics(p_month_start date)
returns table(day date, completed_rides integer, total_earnings numeric, ride_km numeric, pickup_km numeric, last_ride_earnings numeric, last_ride_km numeric)
language sql security definer set search_path = '' as $$
  with bounds as (select date_trunc('month', p_month_start)::timestamptz as starts_at, (date_trunc('month', p_month_start) + interval '1 month')::timestamptz as ends_at), rides_for_captain as (
    select r.*, coalesce(c.captain_earning_amount, r.final_fare, r.estimated_fare, 0) as earning
    from public.rides r left join public.captain_compensations c on c.ride_id = r.id, bounds b
    where r.captain_id = auth.uid() and r.status = 'completed' and coalesce(r.completed_at, r.requested_at) >= b.starts_at and coalesce(r.completed_at, r.requested_at) < b.ends_at
  ), ranked as (select *, row_number() over (partition by coalesce(completed_at, requested_at)::date order by coalesce(completed_at, requested_at) desc) as rn from rides_for_captain)
  select coalesce(completed_at, requested_at)::date, count(*)::integer, sum(earning), sum(coalesce(travelled_distance_km, trip_distance_meters / 1000.0, 0)), sum(coalesce(pickup_distance_meters, 0) / 1000.0), max(earning) filter (where rn = 1), max(coalesce(travelled_distance_km, trip_distance_meters / 1000.0, 0) + coalesce(pickup_distance_meters, 0) / 1000.0) filter (where rn = 1)
  from ranked group by coalesce(completed_at, requested_at)::date order by 1;
$$;
revoke all on function public.captain_daily_analytics(date) from public, anon;
grant execute on function public.captain_daily_analytics(date) to authenticated;
