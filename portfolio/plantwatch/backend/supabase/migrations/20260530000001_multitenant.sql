-- ─────────────────────────────────────────────────────────────
-- PlantWatch multi-tenant schema
-- Each user owns their gateways/zones/plants/prefs; RLS enforces isolation.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- 1:1 with auth.users — onboarding state
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  is_admin    boolean not null default false,
  onboarded   boolean not null default false,   -- has entered Ecowitt creds + set up plants
  created_at  timestamptz not null default now()
);

-- Ecowitt API credentials (one set per user; the installer-provided keys)
create table if not exists public.ecowitt_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  app_key     text not null,
  api_key     text not null,
  updated_at  timestamptz not null default now()
);

-- Physical zones the user organizes devices into
create table if not exists public.zones (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Gateways (hubs) registered to a user
create table if not exists public.gateways (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  mac           text not null,
  name          text not null,
  station_type  text,
  created_at    timestamptz not null default now(),
  unique (user_id, mac)
);

-- Plants: a soil channel on a gateway, mapped to a species + zone
create table if not exists public.plants (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  gateway_id    bigint not null references public.gateways(id) on delete cascade,
  channel       int not null check (channel between 1 and 16),
  name          text not null,
  species       text not null default 'unknown',
  zone_id       bigint references public.zones(id) on delete set null,
  ideal_low     int,                 -- null → use species default
  ideal_high    int,
  display_order int not null default 0,
  notify        boolean not null default false,
  hidden        boolean not null default false,   -- retired/ignored sensor
  created_at    timestamptz not null default now(),
  unique (gateway_id, channel)
);

-- Per-user app preferences
create table if not exists public.user_prefs (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  notify_mode    text not null default 'off',     -- off | dry | wet | both
  notify_offline boolean not null default false,
  weather_lat    numeric,
  weather_lon    numeric,
  layout         text not null default 'grid',
  updated_at     timestamptz not null default now()
);

-- ── Row-level security ───────────────────────────────────────
alter table public.profiles        enable row level security;
alter table public.ecowitt_accounts enable row level security;
alter table public.zones           enable row level security;
alter table public.gateways        enable row level security;
alter table public.plants          enable row level security;
alter table public.user_prefs      enable row level security;

-- Helper: a single policy per table granting full access to the owner.
do $$
declare t text;
begin
  foreach t in array array['profiles','ecowitt_accounts','zones','gateways','plants','user_prefs']
  loop
    execute format('drop policy if exists owner_all on public.%I', t);
    if t = 'profiles' then
      execute 'create policy owner_all on public.profiles using (id = auth.uid()) with check (id = auth.uid())';
    elsif t = 'ecowitt_accounts' or t = 'user_prefs' then
      execute format('create policy owner_all on public.%I using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    else
      execute format('create policy owner_all on public.%I using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;

-- Auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.user_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
