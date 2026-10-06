-- Lead Finder, part 1 of 3: the team's sales pipeline.
-- Run in Supabase > SQL Editor, then dashboard_code.sql, then prospects.sql. Safe to run more than once.
--
-- requests is where a lead goes when it becomes a real conversation. Two things write to it:
--   * the company website's request form, with the publishable key (role anon). Postgres lets that
--     key insert a row and nothing else: only the customer columns, and it can never read a row back;
--   * the Lead Finder's "Add to pipeline" button, through dashboard_add (dashboard_code.sql), which
--     needs the team's dashboard code.

-- ---------------------------------------------------------------- table

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- sent by the website visitor: the only columns the publishable key can write
  name text not null default '' check (char_length(name) <= 200),
  business text not null default '' check (char_length(business) <= 200),
  contact text not null default '' check (char_length(contact) <= 200),
  website text not null default '' check (char_length(website) <= 500),
  needs text not null default '' check (char_length(needs) <= 5000),

  -- filled in by the team
  source text not null default 'Website form' check (char_length(source) <= 100),
  status text not null default 'New'
    check (status in ('New', 'Contacted', 'Audit booked', 'Quoted', 'Won', 'Lost')),
  audit_date date,
  btype text not null default '' check (char_length(btype) <= 200),
  notes text not null default '' check (char_length(notes) <= 10000),
  findings text not null default '' check (char_length(findings) <= 10000)
);

create index if not exists requests_created_at_idx on public.requests (created_at desc);

-- keep updated_at current on every edit (prospects.sql uses it too)
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists requests_touch_updated_at on public.requests;
create trigger requests_touch_updated_at before update on public.requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- permissions

alter table public.requests enable row level security;

-- Nobody gets the table through the API except as below. The team works through the
-- dashboard_* functions, which check the code and then run as the table's owner.
revoke all on public.requests from anon, authenticated;

-- Website visitors: insert only, and only the customer columns. status, source, notes and
-- findings can never be set from the website, and with no select grant the key can't read
-- anything back, not even the row it just added (the form sends Prefer: return=minimal).
grant insert (name, business, contact, website, needs) on public.requests to anon;

drop policy if exists "visitors can submit a request" on public.requests;
create policy "visitors can submit a request" on public.requests
  for insert to anon
  with check (
    char_length(btrim(name)) > 0
    and char_length(btrim(business)) > 0
    and char_length(btrim(contact)) > 0
  );
