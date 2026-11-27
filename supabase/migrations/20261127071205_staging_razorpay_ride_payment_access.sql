-- Staging checkout can record the result of a verified payment on the ride.
grant update (payment_status, customer_charge_status, payment_method, paid_at) on public.rides to service_role;
