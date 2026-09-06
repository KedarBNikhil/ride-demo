-- A standard ride is paid directly by the customer to the Captain. Only a
-- free/promotional ride is a company payout liability. Existing financial
-- records remain immutable; these rules govern future completed rides and
-- future settlement generation.
create or replace function public.captain_transition_ride(p_ride_id uuid, p_next_status text)
returns public.rides
language plpgsql
security definer
set search_path = ''
as $$
declare v_ride public.rides; v_compensation_id uuid; v_payout_id uuid; v_fare numeric(10,2);
begin
  perform public.require_pilot_user('captain');
  select * into v_ride from public.rides where id = p_ride_id and captain_id = auth.uid() for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status = 'completed' and p_next_status = 'completed' then return v_ride; end if;
  if v_ride.status = 'accepted' and v_ride.customer_charge_type <> 'free' and v_ride.fare_approval_status <> 'approved' then raise exception 'Customer has not approved the final fare'; end if;
  if v_ride.status = 'accepted' and p_next_status = 'arrived' then
    update public.rides set status = 'arrived', arrived_at = now() where id = p_ride_id returning * into v_ride;
  elsif v_ride.status = 'in_progress' and p_next_status = 'completed' then
    update public.rides set status = 'completed', completed_at = now(), final_fare = coalesce(final_fare, estimated_fare) where id = p_ride_id returning * into v_ride;
    v_fare := coalesce(v_ride.final_fare, v_ride.estimated_fare);
    insert into public.captain_earnings_ledger(captain_id, ride_id, entry_type, amount, occurred_at, note) values (auth.uid(), v_ride.id, 'ride_earning', v_fare, v_ride.completed_at, 'Completed ride; not a settlement or payout') on conflict (ride_id, entry_type) do nothing;
    insert into public.captain_compensations(ride_id, captain_id, customer_charge_amount, captain_earning_amount, earning_status, verified_at, normal_ride_fare, tip_amount, bonus_amount, adjustment_amount, total_company_payable)
      values (v_ride.id, auth.uid(), v_ride.customer_charge_amount, v_fare, 'earned', v_ride.completed_at, v_fare, 0, 0, 0, case when v_ride.customer_charge_type = 'free' then v_fare else 0 end)
      on conflict (ride_id) do nothing returning id into v_compensation_id;
    if v_compensation_id is null then select id into v_compensation_id from public.captain_compensations where ride_id = v_ride.id; end if;
    insert into public.captain_ride_verifications(compensation_id) values (v_compensation_id) on conflict (compensation_id) do nothing;
    insert into public.captain_payouts(compensation_id) values (v_compensation_id) on conflict (compensation_id) do nothing returning id into v_payout_id;
    if v_payout_id is null then select id into v_payout_id from public.captain_payouts where compensation_id = v_compensation_id; end if;
    insert into public.captain_payout_events(payout_id, event_type, actor_id, note) values (v_payout_id, 'compensation_created', auth.uid(), 'Completed ride compensation created') on conflict do nothing;
    update public.captain_availability set is_online = true, updated_at = now() where captain_id = auth.uid();
  else raise exception 'Invalid ride transition from % to %', v_ride.status, p_next_status;
  end if;
  insert into public.ride_status_history(ride_id, status, actor_type) values (v_ride.id, v_ride.status, 'captain');
  return v_ride;
end;
$$;

create or replace function public.operator_captain_ride_verification_queue(p_status text default 'PENDING')
returns table (compensation_id uuid, ride_id uuid, captain_id uuid, customer_name text, captain_name text, pickup_address text, drop_address text, normal_ride_fare numeric, customer_charge_amount numeric, customer_charge_type text, total_company_payable numeric, trip_distance_meters numeric, travelled_distance_km numeric, started_at timestamptz, completed_at timestamptz, pickup_otp_verified_at timestamptz, payment_status text, payment_method text, verification_status text, rejection_reason text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status is not null and p_status not in ('PENDING', 'APPROVED', 'REJECTED') then raise exception 'Invalid verification status'; end if;
  return query
  select c.id, r.id, c.captain_id, customer.full_name, captain.full_name, r.pickup_address, r.drop_address,
    c.normal_ride_fare, r.customer_charge_amount, r.customer_charge_type, c.total_company_payable,
    r.trip_distance_meters, r.travelled_distance_km, r.started_at, r.completed_at, r.pickup_otp_verified_at,
    r.payment_status, r.payment_method, v.status, v.rejection_reason
  from public.captain_compensations c
  join public.rides r on r.id = c.ride_id
  join public.captain_ride_verifications v on v.compensation_id = c.id
  left join public.profiles customer on customer.id = r.customer_id
  left join public.profiles captain on captain.id = c.captain_id
  where r.customer_charge_type = 'free'
    and c.total_company_payable > 0
    and (p_status is null or v.status = p_status)
  order by r.completed_at asc;
end;
$$;

create or replace function public.operator_generate_captain_settlement(p_settlement_date date)
returns public.settlement_batches
language plpgsql
security definer
set search_path = ''
as $$
declare b public.settlement_batches; s record;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_settlement_date is null or p_settlement_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Settlement date must not be in the future'; end if;
  insert into public.settlement_batches(settlement_date) values (p_settlement_date) on conflict (settlement_date) do nothing;
  select * into b from public.settlement_batches where settlement_date = p_settlement_date for update;
  if b.status <> 'DRAFT' then return b; end if;
  for s in
    select c.captain_id, sum(c.total_company_payable)::numeric as total
    from public.captain_compensations c
    join public.rides r on r.id = c.ride_id
    join public.captain_ride_verifications v on v.compensation_id = c.id
    left join public.captain_settlement_earnings linked on linked.compensation_id = c.id
    where r.customer_charge_type = 'free' and c.total_company_payable > 0
      and v.status = 'APPROVED' and linked.compensation_id is null
      and (c.verified_at at time zone 'Asia/Kolkata')::date = p_settlement_date
    group by c.captain_id
  loop
    insert into public.captain_settlements(batch_id, captain_id, gross_amount, net_amount) values (b.id, s.captain_id, s.total, s.total) on conflict (batch_id, captain_id) do nothing;
    insert into public.captain_settlement_earnings(settlement_id, compensation_id, amount)
      select cs.id, c.id, c.total_company_payable
      from public.captain_compensations c
      join public.rides r on r.id = c.ride_id
      join public.captain_ride_verifications v on v.compensation_id = c.id
      left join public.captain_settlement_earnings linked on linked.compensation_id = c.id
      join public.captain_settlements cs on cs.batch_id = b.id and cs.captain_id = c.captain_id
      where c.captain_id = s.captain_id and r.customer_charge_type = 'free' and c.total_company_payable > 0
        and v.status = 'APPROVED' and linked.compensation_id is null
        and (c.verified_at at time zone 'Asia/Kolkata')::date = p_settlement_date;
  end loop;
  update public.settlement_batches set total_captains = (select count(*) from public.captain_settlements where batch_id = b.id), total_amount = coalesce((select sum(net_amount) from public.captain_settlements where batch_id = b.id), 0) where id = b.id returning * into b;
  return b;
end;
$$;

alter table public.customer_payment_issues
  add column if not exists status text not null default 'open',
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete restrict,
  add column if not exists resolution_note text;
alter table public.customer_payment_issues drop constraint if exists customer_payment_issues_resolution_check;
alter table public.customer_payment_issues add constraint customer_payment_issues_resolution_check check (
  (status = 'open' and resolved_at is null and resolved_by is null and resolution_note is null)
  or (status = 'resolved' and resolved_at is not null and resolved_by is not null and char_length(trim(coalesce(resolution_note, ''))) between 1 and 500)
);
create index if not exists customer_payment_issues_opened_at_idx on public.customer_payment_issues (opened_at desc);

create or replace function public.operator_resolve_customer_payment_issue(p_issue_id uuid, p_resolution_note text)
returns public.customer_payment_issues
language plpgsql
security definer
set search_path = ''
as $$
declare v_issue public.customer_payment_issues; v_note text;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  v_note := trim(coalesce(p_resolution_note, ''));
  if char_length(v_note) not between 1 and 500 then raise exception 'A resolution note between 1 and 500 characters is required'; end if;
  update public.customer_payment_issues
  set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = v_note
  where id = p_issue_id and status = 'open'
  returning * into v_issue;
  if not found then raise exception 'Customer payment issue is not open'; end if;
  return v_issue;
end;
$$;

revoke all on function public.operator_resolve_customer_payment_issue(uuid, text) from public, anon;
grant execute on function public.operator_resolve_customer_payment_issue(uuid, text) to authenticated;
