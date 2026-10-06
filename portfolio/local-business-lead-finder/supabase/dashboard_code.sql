-- Lead Finder, part 2 of 3: the team's dashboard code.
-- Run in Supabase > SQL Editor after schema.sql. Safe to run more than once.
--
-- The team opens the Lead Finder with one shared code instead of individual sign-ins. The code is
-- never in this repository or in the page: only a bcrypt hash of it, in a table no API key can
-- read. Set it (or change it) in the SQL Editor with:
--
--   insert into public.dashboard_settings (id, code_hash)
--   values (1, extensions.crypt(lower(regexp_replace('YOUR CODE', '\s', '', 'g')), extensions.gen_salt('bf')))
--   on conflict (id) do update set code_hash = excluded.code_hash;
--
-- Capitals and spaces in the code are ignored, both here and when it's checked.

create extension if not exists pgcrypto with schema extensions;

-- one row: a bcrypt hash of the code. Nobody can read it through the API.
create table if not exists public.dashboard_settings (
  id int primary key default 1 check (id = 1),
  code_hash text not null
);
alter table public.dashboard_settings enable row level security;
revoke all on public.dashboard_settings from anon, authenticated;

-- true if the code matches. A wrong code waits 1 second, to slow down guessing.
-- Only the functions below can call this one.
create or replace function public._dashboard_ok(code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select s.code_hash into h from public.dashboard_settings s where s.id = 1;
  if h is not null and h = extensions.crypt(lower(regexp_replace(coalesce(code, ''), '\s', '', 'g')), h) then
    return true;
  end if;
  perform pg_sleep(1);
  return false;
end $$;
revoke all on function public._dashboard_ok(text) from public, anon, authenticated;

-- Each function below is security definer (it runs as its owner, so it can reach tables the
-- caller can't) with an empty search_path (every name is schema-qualified, so a caller can't
-- slip in a look-alike table or function). Each one checks the code first.

-- Sign-in: does this code work? (The website checker, functions/api/prospects.js, asks the same.)
create or replace function public.dashboard_check(code text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  return public._dashboard_ok(code);
end $$;

-- The whole pipeline, newest first. The Lead Finder uses it to flag businesses already in it.
create or replace function public.dashboard_rows(code text) returns setof public.requests
language plpgsql security definer set search_path = '' as $$
begin
  if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
  return query select * from public.requests order by created_at desc;
end $$;

-- Add a lead to the pipeline (the Lead Finder's "Add to pipeline"). Unknown keys are ignored.
create or replace function public.dashboard_add(code text, new_row jsonb) returns public.requests
language plpgsql security definer set search_path = '' as $$
declare r public.requests;
begin
  if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
  insert into public.requests (name, business, contact, website, needs, source, status, audit_date, btype, notes, findings)
  select coalesce(p.name, ''), coalesce(p.business, ''), coalesce(p.contact, ''), coalesce(p.website, ''), coalesce(p.needs, ''),
    coalesce(p.source, 'Website form'), coalesce(p.status, 'New'), p.audit_date, coalesce(p.btype, ''), coalesce(p.notes, ''),
    coalesce(p.findings, '')
  from jsonb_populate_record(null::public.requests, new_row) p
  returning * into r;
  return r;
end $$;

revoke all on function public.dashboard_check(text) from public;
revoke all on function public.dashboard_rows(text) from public;
revoke all on function public.dashboard_add(text, jsonb) from public;
grant execute on function public.dashboard_check(text) to anon, authenticated;
grant execute on function public.dashboard_rows(text) to anon, authenticated;
grant execute on function public.dashboard_add(text, jsonb) to anon, authenticated;
