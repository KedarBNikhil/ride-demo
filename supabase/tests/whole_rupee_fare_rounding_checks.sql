-- Focused checks for the authoritative half-down rounding helper.
select value, expected, private.round_fare_half_down(value) as actual,
  private.round_fare_half_down(value) = expected as passed
from (values
  (58.00::numeric, 58::numeric), (58.01, 58), (58.49, 58),
  (58.50, 58), (58.51, 59), (58.99, 59), (59.49, 59),
  (59.50, 59), (59.51, 60), (100.50, 100), (100.51, 101)
) cases(value, expected);
