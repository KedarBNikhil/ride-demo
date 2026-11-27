-- Staging: count a bonus once, on its approval date in India, including after cash-out.
create function public.captain_wallet_bonus_daily(p_month_start date)
returns table(day date, bonus_amount numeric)
language sql stable security definer set search_path = '' as $$
  select (c.reviewed_at at time zone 'Asia/Kolkata')::date, sum(c.amount_paise)::numeric / 100
  from public.captain_wallet_credits c
  where auth.uid() is not null and c.captain_id = auth.uid()
    and c.status in ('approved', 'requested', 'paid') and c.reviewed_at is not null
    and c.reviewed_at >= (date_trunc('month', p_month_start::timestamp) at time zone 'Asia/Kolkata')
    and c.reviewed_at < ((date_trunc('month', p_month_start::timestamp) + interval '1 month') at time zone 'Asia/Kolkata')
  group by (c.reviewed_at at time zone 'Asia/Kolkata')::date order by 1;
$$;
revoke all on function public.captain_wallet_bonus_daily(date) from public, anon;
grant execute on function public.captain_wallet_bonus_daily(date) to authenticated;
