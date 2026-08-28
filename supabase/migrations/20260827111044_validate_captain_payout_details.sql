-- Format-only protection for the existing onboarding JSONB payout payload.
-- Draft applications may omit payout details; submitted applications may not.
create or replace function public.validate_captain_payout_details()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_account text; v_ifsc text; v_holder text; v_upi text;
begin
  if new.status in ('submitted', 'approved') then
    if new.payout_method = 'bank' then
      v_account := regexp_replace(coalesce(new.payout_details->>'account_number', ''), '\s+', '', 'g');
      v_ifsc := upper(regexp_replace(coalesce(new.payout_details->>'ifsc', ''), '\s+', '', 'g'));
      v_holder := btrim(regexp_replace(coalesce(new.payout_details->>'account_holder', ''), '\s+', ' ', 'g'));
      if v_account !~ '^[0-9]{9,18}$' then raise exception 'Bank account number must contain 9 to 18 digits'; end if;
      if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Invalid IFSC format'; end if;
      if v_holder !~ '^[A-Za-z][A-Za-z .''-]*$' then raise exception 'Invalid account holder name'; end if;
      new.payout_details := jsonb_build_object('account_number', v_account, 'ifsc', v_ifsc, 'account_holder', v_holder);
    elsif new.payout_method = 'upi' then
      v_upi := btrim(coalesce(new.payout_details->>'upi_id', ''));
      if v_upi !~ '^[^@[:space:]]+@[^@[:space:]]+$' then raise exception 'Invalid UPI ID format'; end if;
      new.payout_details := jsonb_build_object('upi_id', v_upi);
    else
      raise exception 'Invalid payout method';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists validate_captain_payout_details_before_write on public.captain_onboarding_applications;
create trigger validate_captain_payout_details_before_write
before insert or update of payout_method, payout_details, status on public.captain_onboarding_applications
for each row execute function public.validate_captain_payout_details();
revoke all on function public.validate_captain_payout_details() from public, anon, authenticated;
