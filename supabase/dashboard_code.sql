-- FutureClarity: open the dashboard with a code instead of a sign-in.
-- Run in Supabase > SQL Editor AFTER schema.sql. Safe to run more than once.
-- The code itself is NOT in this file (the repo is public). Set it with:
-- insert into public.dashboard_settings (id, code_hash) values (1, extensions.crypt(lower('YOURCODE'), extensions.gen_salt('bf'))) on conflict (id) do update set code_hash = excluded.code_hash;
-- Capitals and spaces in the code are ignored. Change it any time by running that line again.

create extension if not exists pgcrypto with schema extensions;

-- one row: a bcrypt hash of the code. Nobody can read it through the API.
create table if not exists public.dashboard_settings (
id int primary key default 1 check (id = 1),
code_hash text not null
);
alter table public.dashboard_settings enable row level security;
revoke all on public.dashboard_settings from anon, authenticated;

-- true if the code matches. A wrong code waits 1 second, to slow down guessing.
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

create or replace function public.dashboard_check(code text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
return public._dashboard_ok(code);
end $$;

create or replace function public.dashboard_rows(code text) returns setof public.requests
language plpgsql security definer set search_path = '' as $$
begin
if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
return query select * from public.requests order by created_at desc;
end $$;

-- patch: only the keys present are changed (a key set to null clears a date).
create or replace function public.dashboard_update(code text, row_id uuid, patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
update public.requests t set
(name, business, contact, website, app, needs, scope, est_shown, source, status, emailed, emailed_date, audit_date, btype, notes, quote, build_time, hours_saved, findings)
= (select p.name, p.business, p.contact, p.website, p.app, p.needs, p.scope, p.est_shown, p.source, p.status, p.emailed, p.emailed_date, p.audit_date, p.btype, p.notes, p.quote, p.build_time, p.hours_saved, p.findings
from jsonb_populate_record(t, patch) p)
where t.id = row_id;
end $$;

create or replace function public.dashboard_add(code text, new_row jsonb) returns public.requests
language plpgsql security definer set search_path = '' as $$
declare r public.requests;
begin
if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
insert into public.requests (name, business, contact, website, app, needs, scope, est_shown, source, status, emailed, emailed_date, audit_date, btype, notes, quote, build_time, hours_saved, findings)
select coalesce(p.name, ''), coalesce(p.business, ''), coalesce(p.contact, ''), coalesce(p.website, ''), coalesce(p.app, ''), coalesce(p.needs, ''), coalesce(p.scope, '{}'::jsonb), coalesce(p.est_shown, ''), coalesce(p.source, 'Website form'), coalesce(p.status, 'New'), coalesce(p.emailed, false), p.emailed_date, p.audit_date, coalesce(p.btype, ''), coalesce(p.notes, ''), coalesce(p.quote, ''), coalesce(p.build_time, ''), coalesce(p.hours_saved, ''), coalesce(p.findings, '')
from jsonb_populate_record(null::public.requests, new_row) p
returning * into r;
return r;
end $$;

create or replace function public.dashboard_delete(code text, row_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
delete from public.requests where id = row_id;
end $$;

revoke all on function public.dashboard_check(text) from public;
revoke all on function public.dashboard_rows(text) from public;
revoke all on function public.dashboard_update(text, uuid, jsonb) from public;
revoke all on function public.dashboard_add(text, jsonb) from public;
revoke all on function public.dashboard_delete(text, uuid) from public;
grant execute on function public.dashboard_check(text) to anon, authenticated;
grant execute on function public.dashboard_rows(text) to anon, authenticated;
grant execute on function public.dashboard_update(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.dashboard_add(text, jsonb) to anon, authenticated;
grant execute on function public.dashboard_delete(text, uuid) to anon, authenticated;
