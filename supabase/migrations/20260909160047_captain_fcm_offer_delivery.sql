-- Direct FCM is restricted to Captain ride offers. Expo push_device_tokens
-- remains untouched and is the delivery fallback when direct FCM is absent.
create table public.captain_fcm_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  fcm_token text not null unique,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index captain_fcm_device_tokens_user_idx
  on public.captain_fcm_device_tokens (user_id);

create trigger captain_fcm_device_tokens_set_updated_at
before update on public.captain_fcm_device_tokens
for each row execute function public.set_updated_at();

alter table public.captain_fcm_device_tokens enable row level security;
revoke all on table public.captain_fcm_device_tokens from anon, authenticated;

create function public.register_captain_fcm_device(p_fcm_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_production_user();
  if p_fcm_token !~ '^[A-Za-z0-9_:-]{32,4096}$' then
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
