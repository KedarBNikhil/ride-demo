-- The previous expression used doubled backslashes in a PostgreSQL standard
-- string literal, so valid ExpoPushToken[...] values were rejected.
create or replace function public.register_push_device(
  p_expo_push_token text,
  p_platform text,
  p_app_variant text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_production_user();
  if p_platform <> 'android' or p_app_variant not in ('customer', 'captain') then
    raise exception 'Unsupported push device';
  end if;
  if p_expo_push_token !~ '^Expo(nent)?PushToken\[[^]]+\]$' then
    raise exception 'Invalid Expo push token';
  end if;
  if exists (
    select 1 from public.push_device_tokens
    where expo_push_token = p_expo_push_token and user_id <> auth.uid()
  ) then
    raise exception 'This device is registered to another account';
  end if;
  insert into public.push_device_tokens (user_id, expo_push_token, platform, app_variant)
  values (auth.uid(), p_expo_push_token, p_platform, p_app_variant)
  on conflict (expo_push_token) do update set
    platform = excluded.platform,
    app_variant = excluded.app_variant,
    last_seen_at = now()
  where public.push_device_tokens.user_id = auth.uid();
end;
$$;

revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;
