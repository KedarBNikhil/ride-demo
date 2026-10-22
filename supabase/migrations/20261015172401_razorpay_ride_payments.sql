-- One Razorpay order per chargeable ride. The customer client never receives
-- the secret key and the payment record remains service-role-only.
create table public.razorpay_ride_payments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.rides(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  razorpay_signature text,
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  provider_method text,
  status text not null default 'created' check (status in ('created', 'verified', 'verification_failed')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index razorpay_ride_payments_customer_created_idx
  on public.razorpay_ride_payments(customer_id, created_at desc);

alter table public.razorpay_ride_payments enable row level security;
revoke all on table public.razorpay_ride_payments from public, anon, authenticated;
grant select, insert, update, delete on table public.razorpay_ride_payments to service_role;

create policy "Service role manages Razorpay ride payments"
  on public.razorpay_ride_payments for all to service_role
  using (true) with check (true);

-- Razorpay Checkout can complete with UPI, cards, or another gateway method;
-- retain the payment rail separately in razorpay_ride_payments and use a
-- truthful, provider-level method on the ride itself.
alter table public.rides
  drop constraint if exists rides_payment_method_check,
  drop constraint if exists rides_customer_charge_payment_consistency;

alter table public.rides add constraint rides_customer_charge_payment_consistency check (
  (customer_charge_type = 'free' and customer_charge_amount = 0 and customer_charge_status = 'not_required' and payment_status = 'not_required' and payment_method is null)
  or (customer_charge_type = 'standard' and customer_charge_amount >= 0 and customer_charge_status in ('pending', 'declared', 'confirmed') and payment_status in ('pending', 'declared', 'confirmed')
    and ((payment_status = 'pending' and payment_method is null) or (payment_status in ('declared', 'confirmed') and payment_method in ('cash', 'upi', 'razorpay'))))
);
