-- Reusable offer catalogue. Operations can add a code and its commercial rules
-- without changing the mobile application.
create table public.customer_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(trim(code)) and char_length(code) between 3 and 32),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 280),
  discount_type text not null check (discount_type in ('flat', 'percent')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  maximum_discount numeric(10,2),
  minimum_fare numeric(10,2) not null default 0 check (minimum_fare >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  maximum_redemptions integer,
  per_customer_limit smallint not null default 1 check (per_customer_limit between 1 and 100),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (maximum_discount is null or maximum_discount > 0),
  check (maximum_redemptions is null or maximum_redemptions > 0)
);
alter table public.customer_coupons enable row level security;
revoke all on public.customer_coupons from public, anon, authenticated;
grant select on public.customer_coupons to authenticated;
create policy "Customers view active coupons" on public.customer_coupons for select to authenticated
using (active and starts_at <= now() and (ends_at is null or ends_at > now()));

create table public.customer_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.customer_coupons(id),
  customer_id uuid not null references auth.users(id),
  ride_id uuid unique references public.rides(id),
  code text not null,
  discount_amount numeric(10,2) not null check (discount_amount >= 0),
  created_at timestamptz not null default now()
);
alter table public.customer_coupon_redemptions enable row level security;
revoke all on public.customer_coupon_redemptions from public, anon, authenticated;
create index customer_coupon_redemptions_customer_coupon_idx on public.customer_coupon_redemptions(customer_id, coupon_id);

create or replace function public.customer_available_coupons()
returns table (code text, title text, description text, discount_type text, discount_value numeric, maximum_discount numeric, minimum_fare numeric)
language sql stable security invoker set search_path = '' as $$
  select coupon.code, coupon.title, coupon.description, coupon.discount_type, coupon.discount_value, coupon.maximum_discount, coupon.minimum_fare
  from public.customer_coupons coupon
  where coupon.active and coupon.starts_at <= now() and (coupon.ends_at is null or coupon.ends_at > now())
    and (coupon.maximum_redemptions is null or (select count(*) from public.customer_coupon_redemptions redemption where redemption.coupon_id = coupon.id) < coupon.maximum_redemptions)
    and (select count(*) from public.customer_coupon_redemptions redemption where redemption.coupon_id = coupon.id and redemption.customer_id = auth.uid()) < coupon.per_customer_limit
  order by coupon.created_at desc;
$$;
revoke all on function public.customer_available_coupons() from public, anon;
grant execute on function public.customer_available_coupons() to authenticated;
