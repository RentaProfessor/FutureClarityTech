-- FutureClarity: audit requests (from /plan.html) + team dashboard (/dashboard/).
-- Run in Supabase > SQL Editor. Safe to run more than once.
--
-- Who can do what:
--   Website visitors (anon key)  -> can ADD a request, only the customer fields. Cannot read anything.
--   Team members (signed in, and listed in team_members) -> read, add, edit, delete requests.
--   Anyone else signed in        -> nothing.

-- ---------------------------------------------------------------- tables

create table if not exists public.team_members (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- sent by the website visitor
  name         text  not null default '' check (char_length(name)      <= 200),
  business     text  not null default '' check (char_length(business)  <= 200),
  contact      text  not null default '' check (char_length(contact)   <= 200),
  website      text  not null default '' check (char_length(website)   <= 500),
  app          text  not null default '' check (char_length(app)       <= 200),
  needs        text  not null default '' check (char_length(needs)     <= 5000),
  scope        jsonb not null default '{}'::jsonb,
  est_shown    text  not null default '' check (char_length(est_shown) <= 200),

  -- filled in by the team on the dashboard
  source       text    not null default 'Website form' check (char_length(source) <= 100),
  status       text    not null default 'New'
                 check (status in ('', 'New', 'Contacted', 'Audit booked', 'Quoted', 'Won', 'Lost')),
  emailed      boolean not null default false,
  emailed_date date,
  audit_date   date,
  btype        text not null default '' check (char_length(btype)      <= 200),
  notes        text not null default '' check (char_length(notes)      <= 10000),
  quote        text not null default '' check (char_length(quote)      <= 100),
  build_time   text not null default '' check (char_length(build_time) <= 100),
  hours_saved  text not null default '' check (char_length(hours_saved) <= 50),
  findings     text not null default '' check (char_length(findings)   <= 10000),

  -- scope looks like {"wf": [...up to 5...], "site": "", "app": false, "care": false}
  constraint scope_is_object check (jsonb_typeof(scope) = 'object'),
  constraint scope_max_5_workflows check (
    case when not (scope ? 'wf') then true
         when jsonb_typeof(scope -> 'wf') <> 'array' then false
         else jsonb_array_length(scope -> 'wf') <= 5 end),
  constraint scope_size check (pg_column_size(scope) <= 4000)
);

create index if not exists requests_created_at_idx on public.requests (created_at desc);

-- keep updated_at current on every edit
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists requests_touch_updated_at on public.requests;
create trigger requests_touch_updated_at before update on public.requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- team check

-- security definer so the policies can read team_members, which nobody else can.
create or replace function public.is_team_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members t
    where t.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_team_member() from public, anon;
grant execute on function public.is_team_member() to authenticated;

-- ---------------------------------------------------------------- permissions

alter table public.requests     enable row level security;
alter table public.team_members enable row level security;

-- team_members: no API access at all. Manage it here in the SQL editor / Table editor.
revoke all on public.team_members from anon, authenticated;

-- Website visitors: insert only, and only the customer columns.
-- (status, source, notes, quote, ... can never be set from the website.)
revoke all on public.requests from anon;
grant insert (name, business, contact, website, app, needs, scope, est_shown)
  on public.requests to anon;

drop policy if exists "visitors can submit a request" on public.requests;
create policy "visitors can submit a request" on public.requests
  for insert to anon
  with check (
    char_length(btrim(name)) > 0
    and char_length(btrim(business)) > 0
    and char_length(btrim(contact)) > 0
  );

-- Team: full access, but only if their sign-in email is in team_members.
revoke all on public.requests from authenticated;
grant select, insert, update, delete on public.requests to authenticated;

drop policy if exists "team can read requests"   on public.requests;
drop policy if exists "team can add requests"    on public.requests;
drop policy if exists "team can edit requests"   on public.requests;
drop policy if exists "team can delete requests" on public.requests;

create policy "team can read requests"   on public.requests for select to authenticated using (public.is_team_member());
create policy "team can add requests"    on public.requests for insert to authenticated with check (public.is_team_member());
create policy "team can edit requests"   on public.requests for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team can delete requests" on public.requests for delete to authenticated using (public.is_team_member());

-- ---------------------------------------------------------------- live updates

-- The dashboard refreshes the moment a new request arrives.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'requests'
  ) then
    alter publication supabase_realtime add table public.requests;
  end if;
end $$;

-- ---------------------------------------------------------------- your team

-- Replace with the real sign-in emails (lowercase). Each person must ALSO be
-- invited under Authentication > Users, because new sign-ups are turned off.
insert into public.team_members (email)
select lower(btrim(e)) from (values
  ('change-me-1@futureclaritytechnologies.com'),
  ('change-me-2@futureclaritytechnologies.com')
) as v(e)
on conflict (email) do nothing;
