-- Focused format checks for the client/server contract.
do $$
begin
  if '12345678' !~ '^[0-9]{9,18}$' or '123456789012345678' !~ '^[0-9]{9,18}$' or '1234567890123456789' ~ '^[0-9]{9,18}$' or '1234ABCD' ~ '^[0-9]{9,18}$' then raise exception 'bank account validation regression'; end if;
  if 'SBIN0001234' !~ '^[A-Z]{4}0[A-Z0-9]{6}$' or 'sbin0001234' ~ '^[A-Z]{4}0[A-Z0-9]{6}$' or 'SBIN1234567' ~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'IFSC validation regression'; end if;
  if '9876543210@upi' !~ '^[^@[:space:]]+@[^@[:space:]]+$' or 'kedar' ~ '^[^@[:space:]]+@[^@[:space:]]+$' or 'kedar@@upi' ~ '^[^@[:space:]]+@[^@[:space:]]+$' or 'kedar @upi' ~ '^[^@[:space:]]+@[^@[:space:]]+$' then raise exception 'UPI validation regression'; end if;
end;
$$;
