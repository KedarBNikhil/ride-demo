-- STAGING ONLY: one test incentive for TestCaptain1. Do not deploy to production.
create table public.captain_wallet_credits (
  id uuid primary key default gen_random_uuid(), captain_id uuid not null references public.profiles(id),
  ride_id uuid not null references public.rides(id), campaign text not null,
  amount_paise integer not null check (amount_paise > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','requested','paid')),
  created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references public.profiles(id), review_note text,
  unique(captain_id,campaign), unique(ride_id,campaign)
);
create table public.captain_wallet_cashouts (
  id uuid primary key default gen_random_uuid(), captain_id uuid not null references public.profiles(id),
  credit_id uuid not null references public.captain_wallet_credits(id), amount_paise integer not null check(amount_paise > 0),
  payout_method text not null check (payout_method in ('upi','bank')), payout_details jsonb not null,
  status text not null default 'requested' check(status in ('requested','paid','rejected')),
  requested_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references public.profiles(id), reference text, note text
);
create unique index captain_wallet_one_open_or_paid_cashout on public.captain_wallet_cashouts(credit_id) where status in ('requested','paid');
alter table public.captain_wallet_credits enable row level security;
alter table public.captain_wallet_cashouts enable row level security;
revoke all on public.captain_wallet_credits, public.captain_wallet_cashouts from public, anon, authenticated;

create function private.staging_wallet_credit_on_ride() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.captain_id = 'ea7e8f35-1db9-429c-8f60-1235c53804b0'::uuid then
    insert into public.captain_wallet_credits(captain_id,ride_id,campaign,amount_paise)
    values(new.captain_id,new.id,'staging_one_ride_20261126',1000) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function private.staging_wallet_credit_on_ride() from public, anon, authenticated;
create trigger staging_wallet_credit_on_ride after update of status on public.rides for each row execute function private.staging_wallet_credit_on_ride();

create function public.captain_wallet_snapshot() returns table(id uuid, ride_id uuid, amount_paise integer, status text, created_at timestamptz, review_note text) language sql stable security definer set search_path='' as $$
  select c.id,c.ride_id,c.amount_paise,c.status,c.created_at,c.review_note from public.captain_wallet_credits c where auth.uid() is not null and c.captain_id=auth.uid() order by c.created_at desc;
$$;
create function public.captain_wallet_request_cashout(p_credit_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.captain_wallet_credits; a public.captain_onboarding_applications; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into c from public.captain_wallet_credits where id=p_credit_id and captain_id=auth.uid() for update;
  if not found or c.status <> 'approved' then raise exception 'Credit is not available for cash out'; end if;
  select * into a from public.captain_onboarding_applications where user_id=auth.uid() and status='approved' order by reviewed_at desc nulls last, created_at desc limit 1;
  if not found or a.payout_method not in ('upi','bank') or a.payout_details is null then raise exception 'Approved payout details required'; end if;
  insert into public.captain_wallet_cashouts(captain_id,credit_id,amount_paise,payout_method,payout_details) values(c.captain_id,c.id,c.amount_paise,a.payout_method,a.payout_details) returning id into v_id;
  update public.captain_wallet_credits set status='requested' where id=c.id;
  return v_id;
end $$;
create function public.operator_wallet_queue() returns table(credit_id uuid,captain_name text,ride_id uuid,amount_paise integer,credit_status text,created_at timestamptz,review_note text,cashout_id uuid,cashout_status text,payout_method text,payout_details jsonb,reference text) language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_settlement_operator() then raise exception 'Operator authorization required'; end if;
  return query select c.id,p.full_name,c.ride_id,c.amount_paise,c.status,c.created_at,c.review_note,w.id,w.status,w.payout_method,w.payout_details,w.reference from public.captain_wallet_credits c join public.profiles p on p.id=c.captain_id left join lateral (select * from public.captain_wallet_cashouts x where x.credit_id=c.id order by x.requested_at desc limit 1) w on true order by c.created_at desc;
end $$;
create function public.operator_wallet_review(p_credit_id uuid,p_decision text,p_note text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_settlement_operator() then raise exception 'Operator authorization required'; end if;
 if p_decision not in ('approved','rejected') or length(trim(coalesce(p_note,'')))=0 then raise exception 'Decision and note required'; end if;
 update public.captain_wallet_credits set status=p_decision,reviewed_at=now(),reviewed_by=auth.uid(),review_note=trim(p_note) where id=p_credit_id and status='pending';
 if not found then raise exception 'Credit is not pending review'; end if;
end $$;
create function public.operator_wallet_resolve_cashout(p_cashout_id uuid,p_decision text,p_reference text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare w public.captain_wallet_cashouts;
begin
 if auth.uid() is null or not public.is_settlement_operator() then raise exception 'Operator authorization required'; end if;
 if p_decision not in ('paid','rejected') or (p_decision='paid' and length(trim(coalesce(p_reference,'')))=0) or (p_decision='rejected' and length(trim(coalesce(p_note,'')))=0) then raise exception 'Payment reference or rejection reason required'; end if;
 select * into w from public.captain_wallet_cashouts where id=p_cashout_id for update;
 if not found or w.status <> 'requested' then raise exception 'Cashout is not pending'; end if;
 update public.captain_wallet_cashouts set status=p_decision,resolved_at=now(),resolved_by=auth.uid(),reference=nullif(trim(coalesce(p_reference,'')),''),note=nullif(trim(coalesce(p_note,'')),'') where id=w.id;
 update public.captain_wallet_credits set status=case when p_decision='paid' then 'paid' else 'approved' end where id=w.credit_id and status='requested';
 if not found then raise exception 'Credit state mismatch'; end if;
end $$;
revoke all on function public.captain_wallet_snapshot(),public.captain_wallet_request_cashout(uuid),public.operator_wallet_queue(),public.operator_wallet_review(uuid,text,text),public.operator_wallet_resolve_cashout(uuid,text,text,text) from public,anon;
grant execute on function public.captain_wallet_snapshot(),public.captain_wallet_request_cashout(uuid),public.operator_wallet_queue(),public.operator_wallet_review(uuid,text,text),public.operator_wallet_resolve_cashout(uuid,text,text,text) to authenticated;
