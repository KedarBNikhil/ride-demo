-- Device tokens are scoped to an authenticated account and are only used by
-- trusted server-side notification delivery. Clients cannot read other tokens.
create table public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  expo_push_token text not null unique check (expo_push_token like 'ExponentPushToken[%]' or expo_push_token like 'ExpoPushToken[%]'),
  platform text not null check (platform = 'android'),
  app_variant text not null check (app_variant in ('customer', 'captain')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_device_tokens_user_idx on public.push_device_tokens (user_id, app_variant);
create trigger push_device_tokens_set_updated_at
before update on public.push_device_tokens
for each row execute function public.set_updated_at();

alter table public.push_device_tokens enable row level security;

create function public.register_push_device(
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
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_platform <> 'android' or p_app_variant not in ('customer', 'captain') then
    raise exception 'Unsupported push device';
  end if;
  if p_expo_push_token !~ '^Expo(nent)?PushToken\[[^]]+\]$' then
    raise exception 'Invalid Expo push token';
  end if;

  insert into public.push_device_tokens (user_id, expo_push_token, platform, app_variant)
  values (auth.uid(), p_expo_push_token, p_platform, p_app_variant)
  on conflict (expo_push_token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    app_variant = excluded.app_variant,
    last_seen_at = now();
end;
$$;

revoke all on table public.push_device_tokens from anon, authenticated;
revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;
