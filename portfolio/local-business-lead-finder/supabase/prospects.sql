-- Lead Finder, part 3 of 3: the call list.
-- Run in Supabase > SQL Editor after schema.sql and dashboard_code.sql. Safe to run more than once.
--
-- Same rule as the pipeline: the publishable key cannot read or write this table at all.
-- Everything goes through the prospects_* functions below, which require the dashboard code.

-- ---------------------------------------------------------------- table

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- from the business list and the website check; refreshed when the business turns up in a search again
  place_id text not null unique check (char_length(place_id) between 1 and 300),
  name text not null default '' check (char_length(name) <= 300),
  vertical text not null default '' check (char_length(vertical) <= 100),
  btype text not null default '' check (char_length(btype) <= 200),
  address text not null default '' check (char_length(address) <= 500),
  area text not null default '' check (char_length(area) <= 200),
  phone text not null default '' check (char_length(phone) <= 100),
  website text not null default '' check (char_length(website) <= 1000),
  maps_url text not null default '' check (char_length(maps_url) <= 1000),
  rating numeric(2,1) check (rating is null or rating between 0 and 5),
  reviews int check (reviews is null or reviews >= 0),
  site jsonb not null default '{}'::jsonb,
  score int not null default 0 check (score between 0 and 100),
  signals jsonb not null default '[]'::jsonb,

  -- filled in by the team
  email text not null default '' check (char_length(email) <= 300),
  status text not null default 'To contact'
    check (status in ('To contact', 'No answer', 'Left message', 'Emailed', 'Visited', 'Follow up', 'Interested',
      'Not interested', 'Not a fit', 'In pipeline')),
  touches int not null default 0 check (touches >= 0),
  last_touch date,
  follow_up date,
  notes text not null default '' check (char_length(notes) <= 10000),
  log jsonb not null default '[]'::jsonb,
  request_id uuid references public.requests(id) on delete set null,

  constraint site_is_object check (jsonb_typeof(site) = 'object' and pg_column_size(site) <= 8000),
  constraint signals_is_array check (jsonb_typeof(signals) = 'array' and pg_column_size(signals) <= 8000),
  constraint log_is_array check (jsonb_typeof(log) = 'array' and pg_column_size(log) <= 20000)
);

create index if not exists prospects_follow_up_idx on public.prospects (follow_up);

drop trigger if exists prospects_touch_updated_at on public.prospects;
create trigger prospects_touch_updated_at before update on public.prospects
  for each row execute function public.touch_updated_at();

-- no API access to the table itself
alter table public.prospects enable row level security;
revoke all on public.prospects from anon, authenticated;

-- ---------------------------------------------------------------- functions (all need the code)

create or replace function public.prospects_rows(code text) returns setof public.prospects
language plpgsql security definer set search_path = '' as $$
begin
  if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
  return query select * from public.prospects order by created_at desc;
end $$;

-- Save businesses from a search (1 to 100 at a time). A business already on the list keeps
-- everything the team entered (status, notes, follow-up, history, and the email and area once
-- set); only the facts from the business list and the website check refresh.
create or replace function public.prospects_save(code text, new_rows jsonb) returns setof public.prospects
language plpgsql security definer set search_path = '' as $$
begin
  if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
  if jsonb_typeof(new_rows) <> 'array' or jsonb_array_length(new_rows) > 100 then
    raise exception 'send 1 to 100 rows' using errcode = '22023';
  end if;
  return query
  insert into public.prospects as t (place_id, name, vertical, btype, address, area, phone, website, maps_url, rating, reviews,
    site, score, signals, email, status, notes)
  select distinct on (p.place_id) p.place_id, coalesce(p.name, ''), coalesce(p.vertical, ''), coalesce(p.btype, ''),
    coalesce(p.address, ''), coalesce(p.area, ''), coalesce(p.phone, ''), coalesce(p.website, ''), coalesce(p.maps_url, ''),
    p.rating, p.reviews, coalesce(p.site, '{}'::jsonb), coalesce(p.score, 0), coalesce(p.signals, '[]'::jsonb),
    coalesce(p.email, ''), coalesce(p.status, 'To contact'), coalesce(p.notes, '')
  from jsonb_populate_recordset(null::public.prospects, new_rows) p
  where coalesce(btrim(p.place_id), '') <> ''
  on conflict (place_id) do update set
    name = excluded.name, btype = excluded.btype, address = excluded.address, phone = excluded.phone,
    website = excluded.website, maps_url = excluded.maps_url, rating = excluded.rating, reviews = excluded.reviews,
    site = excluded.site, score = excluded.score, signals = excluded.signals,
    vertical = case when t.vertical = '' then excluded.vertical else t.vertical end,
    area = case when t.area = '' then excluded.area else t.area end,
    email = case when t.email = '' then excluded.email else t.email end
    -- status, notes, touches, last_touch, follow_up, log and request_id are deliberately absent
  returning t.*;
end $$;

-- patch: only the keys present are changed (a key set to null clears a date)
create or replace function public.prospects_update(code text, row_id uuid, patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
  update public.prospects t set
    (name, vertical, btype, address, area, phone, website, maps_url, rating, reviews, site, score, signals, email, status,
      touches, last_touch, follow_up, notes, log, request_id)
    = (select p.name, p.vertical, p.btype, p.address, p.area, p.phone, p.website, p.maps_url, p.rating, p.reviews, p.site,
      p.score, p.signals, p.email, p.status, p.touches, p.last_touch, p.follow_up, p.notes, p.log, p.request_id
      from jsonb_populate_record(t, patch) p)
  where t.id = row_id;
end $$;

create or replace function public.prospects_delete(code text, row_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public._dashboard_ok(code) then raise exception 'wrong dashboard code' using errcode = '28000'; end if;
  delete from public.prospects where id = row_id;
end $$;

revoke all on function public.prospects_rows(text) from public;
revoke all on function public.prospects_save(text, jsonb) from public;
revoke all on function public.prospects_update(text, uuid, jsonb) from public;
revoke all on function public.prospects_delete(text, uuid) from public;
grant execute on function public.prospects_rows(text) to anon, authenticated;
grant execute on function public.prospects_save(text, jsonb) to anon, authenticated;
grant execute on function public.prospects_update(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.prospects_delete(text, uuid) to anon, authenticated;
