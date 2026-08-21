create or replace function public.customer_rate_captain(p_ride_id uuid, p_rating smallint, p_note text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_pilot_user('customer');
  if p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5'; end if;
  update public.rides set customer_rating = p_rating, customer_rating_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_ride_id and customer_id = auth.uid() and status = 'completed' and payment_status in ('declared', 'not_required') and customer_rating is null;
  if not found then raise exception 'Rating is not available for this ride'; end if;
end; $$;
revoke all on function public.customer_rate_captain(uuid, smallint, text) from public, anon;
grant execute on function public.customer_rate_captain(uuid, smallint, text) to authenticated;

create table public.captain_payment_issues (
  id uuid primary key default gen_random_uuid(), ride_id uuid not null unique references public.rides(id) on delete restrict, captain_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (reason in ('customer_did_not_pay', 'payment_method_mismatch', 'upi_not_received', 'cash_not_received', 'other')),
  status text not null default 'open' check (status in ('open', 'resolved')), opened_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references public.profiles(id) on delete restrict,
  check ((status = 'open' and resolved_at is null and resolved_by is null) or (status = 'resolved' and resolved_at is not null and resolved_by is not null))
);
alter table public.captain_payment_issues enable row level security;
revoke all on table public.captain_payment_issues from public, anon, authenticated;
grant select, insert, update, delete on table public.captain_payment_issues to service_role;

create or replace function public.captain_raise_payment_issue(p_ride_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides;
begin
  perform public.require_pilot_user('captain');
  if p_reason not in ('customer_did_not_pay', 'payment_method_mismatch', 'upi_not_received', 'cash_not_received', 'other') then raise exception 'Invalid payment issue'; end if;
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found or v_ride.status <> 'completed' or v_ride.customer_charge_type <> 'standard' or v_ride.payment_status <> 'pending' then raise exception 'Payment issue is not available for this ride'; end if;
  insert into public.captain_payment_issues(ride_id, captain_id, reason) values (v_ride.id, auth.uid(), p_reason) on conflict (ride_id) do nothing;
end; $$;
revoke all on function public.captain_raise_payment_issue(uuid, text) from public, anon;
grant execute on function public.captain_raise_payment_issue(uuid, text) to authenticated;
