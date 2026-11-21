-- PostgreSQL's regex engine rejects the previous {32,4096} repetition range,
-- so every otherwise valid FCM registration returned HTTP 400. Keep character
-- and length validation, but express the length bound separately.
create or replace function public.register_captain_fcm_device(p_fcm_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_production_user();
  if char_length(p_fcm_token) not between 32 and 4096
    or p_fcm_token !~ '^[A-Za-z0-9_:-]+$' then
    raise exception 'Invalid FCM token';
  end if;

  if exists (
    select 1 from public.captain_fcm_device_tokens
    where fcm_token = p_fcm_token and user_id <> auth.uid()
  ) then
    raise exception 'This device is registered to another account';
  end if;

  insert into public.captain_fcm_device_tokens (user_id, fcm_token)
  values (auth.uid(), p_fcm_token)
  on conflict (fcm_token) do update set last_seen_at = now()
  where public.captain_fcm_device_tokens.user_id = auth.uid();
end;
$$;

revoke all on function public.register_captain_fcm_device(text) from public, anon;
grant execute on function public.register_captain_fcm_device(text) to authenticated;
