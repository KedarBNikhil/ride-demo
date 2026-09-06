-- Focused monetary invariants for the post-rounding customer pricing boundary.
with cases(raw_normal_fare, promo_discount, expected_normal_fare, expected_customer_payable, expected_captain_earning) as (
  values
    (20.00::numeric, 20::numeric, 20::numeric, 0::numeric, 20::numeric),
    (58.49, 0, 58, 58, 58),
    (58.50, 0, 58, 58, 58),
    (58.51, 0, 59, 59, 59)
), priced as (
  select *, private.round_fare_half_down(raw_normal_fare) as normal_fare
  from cases
)
select raw_normal_fare, normal_fare, promo_discount,
  greatest(normal_fare - promo_discount, 0) as customer_payable,
  normal_fare as captain_entitled_earning,
  normal_fare = expected_normal_fare
    and greatest(normal_fare - promo_discount, 0) = expected_customer_payable
    and normal_fare = expected_captain_earning as passed
from priced;
