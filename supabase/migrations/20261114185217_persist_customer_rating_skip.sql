alter table public.rides
  add column if not exists customer_rating_skipped_at timestamptz;

create or replace function public.customer_rate_captain(p_ride_id uuid, p_rating smallint, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('customer');
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;

  update public.rides
    set customer_rating = p_rating,
        customer_rating_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_ride_id
      and customer_id = auth.uid()
      and status = 'completed'
      and payment_status in ('confirmed', 'not_required')
      and customer_rating is null
      and customer_rating_skipped_at is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end;
$$;

create or replace function public.customer_skip_captain_rating(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_pilot_user('customer');

  -- The decision is immutable for this completed ride. Treat a repeat Skip
  -- request as success, which makes retries safe on an unreliable network.
  update public.rides
    set customer_rating_skipped_at = now()
    where id = p_ride_id
      and customer_id = auth.uid()
      and status = 'completed'
      and payment_status in ('confirmed', 'not_required')
      and customer_rating is null
      and customer_rating_skipped_at is null;

  if found then return; end if;

  if exists (
    select 1 from public.rides
      where id = p_ride_id
        and customer_id = auth.uid()
        and status = 'completed'
        and payment_status in ('confirmed', 'not_required')
  ) then
    return;
  end if;

  raise exception 'Rating is not available for this ride';
end;
$$;

revoke all on function public.customer_rate_captain(uuid, smallint, text) from public, anon;
revoke all on function public.customer_skip_captain_rating(uuid) from public, anon;
grant execute on function public.customer_rate_captain(uuid, smallint, text) to authenticated;
grant execute on function public.customer_skip_captain_rating(uuid) to authenticated;
