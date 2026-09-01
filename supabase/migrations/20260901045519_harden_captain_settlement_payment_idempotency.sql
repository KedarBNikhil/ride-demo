create table public.captain_settlement_payment_events (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null unique references public.captain_settlements(id) on delete restrict,
  batch_id uuid not null references public.settlement_batches(id) on delete restrict,
  captain_id uuid not null references public.captain_profiles(user_id) on delete restrict,
  amount numeric not null check (amount >= 0),
  payout_provider text not null check (payout_provider = 'MANUAL'),
  external_reference text not null check (char_length(trim(external_reference)) between 1 and 500),
  notes text null check (char_length(coalesce(notes, '')) <= 500),
  paid_at timestamptz not null,
  paid_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

alter table public.captain_settlement_payment_events enable row level security;
revoke all on table public.captain_settlement_payment_events from public, anon, authenticated;

create or replace function public.prevent_captain_settlement_payment_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Captain settlement payment events are immutable';
end;
$$;

create trigger captain_settlement_payment_events_immutable
before update or delete on public.captain_settlement_payment_events
for each row execute function public.prevent_captain_settlement_payment_event_mutation();

create or replace function public.prevent_paid_captain_settlement_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.payout_status = 'PAID' then
    raise exception 'Paid captain settlements are immutable';
  end if;

  if tg_op = 'UPDATE' and old.payout_status = 'PAID' and new is distinct from old then
    raise exception 'Paid captain settlements are immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger captain_settlements_paid_immutable
before update or delete on public.captain_settlements
for each row execute function public.prevent_paid_captain_settlement_mutation();

create unique index captain_settlements_manual_reference_unique
on public.captain_settlements (lower(trim(external_reference)))
where payout_status = 'PAID' and payout_provider = 'MANUAL';

create or replace function public.operator_verify_captain_ride(
  p_compensation_id uuid,
  p_status text,
  p_rejection_reason text default null
)
returns public.captain_ride_verifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.captain_ride_verifications;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  if p_status not in ('APPROVED', 'REJECTED') then raise exception 'Invalid verification decision'; end if;
  if p_status = 'REJECTED' and char_length(trim(coalesce(p_rejection_reason, ''))) not between 1 and 500 then
    raise exception 'A rejection reason between 1 and 500 characters is required';
  end if;

  select * into v
  from public.captain_ride_verifications
  where compensation_id = p_compensation_id
  for update;

  if not found then raise exception 'Completed ride earning not found'; end if;
  if v.status = p_status then return v; end if;
  if v.status <> 'PENDING' then raise exception 'Ride has already been verified'; end if;

  update public.captain_ride_verifications
  set status = p_status,
      verified_by = auth.uid(),
      verified_at = now(),
      rejection_reason = case when p_status = 'REJECTED' then trim(p_rejection_reason) else null end,
      updated_at = now()
  where id = v.id
  returning * into v;

  insert into public.captain_ride_verification_events(verification_id, status, actor_id, reason)
  values (v.id, v.status, auth.uid(), v.rejection_reason);

  return v;
end;
$$;

create or replace function public.operator_record_manual_captain_payment(
  p_settlement_id uuid,
  p_reference text,
  p_notes text default null
)
returns public.captain_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.captain_settlements;
  b public.settlement_batches;
  v_reference text;
  v_notes text;
  v_paid_at timestamptz;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  v_reference := trim(coalesce(p_reference, ''));
  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  if char_length(v_reference) not between 1 and 500 then raise exception 'A non-empty UTR or bank transaction reference is required'; end if;
  if char_length(coalesce(p_notes, '')) > 500 then raise exception 'Notes must be at most 500 characters'; end if;

  select * into s from public.captain_settlements where id = p_settlement_id for update;
  if not found then raise exception 'Captain settlement not found'; end if;

  if s.payout_status = 'PAID' then
    if s.payout_provider = 'MANUAL' and lower(s.external_reference) = lower(v_reference) then
      return s;
    end if;
    raise exception 'Captain settlement is already paid with a different reference';
  end if;

  select * into b from public.settlement_batches where id = s.batch_id for update;
  if b.status <> 'APPROVED' then raise exception 'Approve the settlement batch before recording payment'; end if;
  if s.payout_status <> 'APPROVED' then raise exception 'Captain settlement is not approved for payment'; end if;

  v_paid_at := now();
  update public.captain_settlements
  set payout_provider = 'MANUAL',
      payout_status = 'PAID',
      external_reference = v_reference,
      notes = v_notes,
      paid_at = v_paid_at,
      paid_by = auth.uid(),
      updated_at = v_paid_at
  where id = s.id
  returning * into s;

  insert into public.captain_settlement_payment_events(
    settlement_id, batch_id, captain_id, amount, payout_provider,
    external_reference, notes, paid_at, paid_by
  ) values (
    s.id, s.batch_id, s.captain_id, s.net_amount, 'MANUAL',
    s.external_reference, s.notes, s.paid_at, s.paid_by
  );

  if not exists (
    select 1 from public.captain_settlements
    where batch_id = b.id and payout_status <> 'PAID'
  ) then
    update public.settlement_batches
    set status = 'COMPLETED', completed_at = now()
    where id = b.id;
  end if;

  return s;
end;
$$;

revoke all on function public.prevent_captain_settlement_payment_event_mutation() from public, anon, authenticated;
revoke all on function public.prevent_paid_captain_settlement_mutation() from public, anon, authenticated;
revoke all on function public.operator_verify_captain_ride(uuid, text, text) from public, anon;
revoke all on function public.operator_record_manual_captain_payment(uuid, text, text) from public, anon;
grant execute on function public.operator_verify_captain_ride(uuid, text, text) to authenticated;
grant execute on function public.operator_record_manual_captain_payment(uuid, text, text) to authenticated;
