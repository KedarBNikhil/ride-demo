-- Test-mode Razorpay payments are deliberately independent from rides and
-- settlements. They let authenticated Customers exercise the gateway without
-- changing production payment state.
create table public.razorpay_test_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  razorpay_signature text,
  amount_paise integer not null default 100 check (amount_paise = 100),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created' check (status in ('created', 'verified', 'verification_failed')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index razorpay_test_payments_customer_created_idx
  on public.razorpay_test_payments(customer_id, created_at desc);

alter table public.razorpay_test_payments enable row level security;
revoke all on table public.razorpay_test_payments from public, anon, authenticated;
grant select, insert, update, delete on table public.razorpay_test_payments to service_role;
