alter table public.captain_payment_issues
  add column if not exists resolution_note text;

create or replace function public.operator_resolve_captain_payment_issue(p_issue_id uuid, p_resolution_note text)
returns public.captain_payment_issues
language plpgsql
security definer
set search_path = ''
as $$
declare v_issue public.captain_payment_issues; v_note text;
begin
  if not public.is_settlement_operator() then raise exception 'Settlement operator access is required'; end if;
  v_note := trim(coalesce(p_resolution_note, ''));
  if char_length(v_note) not between 1 and 500 then raise exception 'A resolution note between 1 and 500 characters is required'; end if;
  update public.captain_payment_issues
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution_note = v_note
  where id = p_issue_id and status = 'open'
  returning * into v_issue;
  if not found then raise exception 'Captain payment issue is not open'; end if;
  return v_issue;
end;
$$;

revoke all on function public.operator_resolve_captain_payment_issue(uuid, text) from public, anon;
grant execute on function public.operator_resolve_captain_payment_issue(uuid, text) to authenticated;
