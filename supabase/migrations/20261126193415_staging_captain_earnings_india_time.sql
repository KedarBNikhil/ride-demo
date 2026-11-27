-- Staging: report completed rides and compensation by the India calendar day.
create or replace function public.captain_daily_analytics(p_month_start date)
returns table(day date, completed_rides integer, total_earnings numeric, ride_km numeric, pickup_km numeric, last_ride_earnings numeric, last_ride_km numeric)
language sql security definer set search_path = '' as $$
  with bounds as (
    select date_trunc('month', p_month_start::timestamp) at time zone 'Asia/Kolkata' as starts_at,
      (date_trunc('month', p_month_start::timestamp) + interval '1 month') at time zone 'Asia/Kolkata' as ends_at
  ), rides_for_captain as (
    select r.*, coalesce(c.captain_earning_amount, r.final_fare, r.estimated_fare, 0) as earning,
      (coalesce(r.completed_at, r.requested_at) at time zone 'Asia/Kolkata')::date as ride_day
    from public.rides r left join public.captain_compensations c on c.ride_id = r.id cross join bounds b
    where r.captain_id = auth.uid() and r.status = 'completed'
      and coalesce(r.completed_at, r.requested_at) >= b.starts_at and coalesce(r.completed_at, r.requested_at) < b.ends_at
  ), ranked as (
    select *, row_number() over (partition by ride_day order by coalesce(completed_at, requested_at) desc, id desc) as rn from rides_for_captain
  )
  select ride_day, count(*)::integer, sum(earning), sum(coalesce(travelled_distance_km, trip_distance_meters / 1000.0, 0)),
    sum(coalesce(pickup_distance_meters, 0) / 1000.0), max(earning) filter (where rn = 1),
    max(coalesce(travelled_distance_km, trip_distance_meters / 1000.0, 0) + coalesce(pickup_distance_meters, 0) / 1000.0) filter (where rn = 1)
  from ranked group by ride_day order by ride_day;
$$;
create or replace function public.captain_compensation_monthly(p_month_start date)
returns table(day date, ride_earnings numeric, ride_count integer, held_earnings numeric, payout_status text, dispute_deductions numeric, net_earnings numeric)
language sql security definer set search_path = '' as $$
  with bounds as (
    select date_trunc('month', p_month_start::timestamp) as month_start,
      date_trunc('month', p_month_start::timestamp) at time zone 'Asia/Kolkata' as starts_at,
      (date_trunc('month', p_month_start::timestamp) + interval '1 month') at time zone 'Asia/Kolkata' as ends_at
  ), days as (
    select generate_series(month_start, month_start + interval '1 month' - interval '1 day', interval '1 day')::date as ride_day from bounds
  ), c as (
    select (compensation.verified_at at time zone 'Asia/Kolkata')::date as ride_day, compensation.captain_earning_amount,
      payout.status, coalesce(-ledger.amount, 0) as deduction
    from public.captain_compensations compensation join public.captain_payouts payout on payout.compensation_id = compensation.id
    left join public.captain_earnings_ledger ledger on ledger.ride_id = compensation.ride_id and ledger.entry_type = 'adjustment'
    cross join bounds b where compensation.captain_id = auth.uid() and compensation.verified_at >= b.starts_at and compensation.verified_at < b.ends_at
  )
  select days.ride_day, coalesce(sum(c.captain_earning_amount), 0), count(c.captain_earning_amount)::integer,
    coalesce(sum(c.captain_earning_amount) filter (where c.status = 'held'), 0),
    coalesce((array_agg(c.status order by c.status))[1], 'not_started'), coalesce(sum(c.deduction), 0),
    coalesce(sum(c.captain_earning_amount - c.deduction), 0)
  from days left join c on c.ride_day = days.ride_day group by days.ride_day order by days.ride_day;
$$;
