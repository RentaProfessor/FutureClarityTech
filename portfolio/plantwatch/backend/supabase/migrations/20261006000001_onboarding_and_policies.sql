-- ─────────────────────────────────────────────────────────────
-- Tighter row-level security, an atomic onboarding function, and
-- per-gateway forecast locations.
--
-- Additive: no table or column is dropped, and the requests the existing
-- iOS client makes (4-step onboarding, profile PATCH) keep working.
-- ─────────────────────────────────────────────────────────────

-- ── 1. profiles: users cannot grant themselves admin ─────────
-- The original owner_all policy allowed INSERT/UPDATE/DELETE of the caller's
-- own row with no column restrictions, so a client could set is_admin = true.
-- Clients may now read their row and update only `onboarded`; rows are created
-- by the auth.users trigger and admin is granted with the service role or SQL.

drop policy if exists owner_all on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (onboarded) on public.profiles to authenticated;

-- Defence in depth: even if table-wide UPDATE is granted again later, client
-- roles still cannot change the flag.
create or replace function public.protect_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_admin is distinct from old.is_admin
     and current_user in ('anon', 'authenticated') then
    raise exception 'is_admin can only be changed by an administrator'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_protect_admin_flag on public.profiles;
create trigger profiles_protect_admin_flag
  before update on public.profiles
  for each row execute function public.protect_admin_flag();

-- Same behaviour as before; search_path pinned to '' as Supabase's linter
-- recommends for SECURITY DEFINER functions.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.user_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end
$$;

-- ── 2. plants may only point at the caller's gateways and zones ──
-- owner_all checked user_id but not gateway_id / zone_id, so a user could
-- attach plants to another user's gateway and, because (gateway_id, channel)
-- is unique, block that user from configuring those channels.

drop policy if exists owner_all on public.plants;
drop policy if exists plants_select_own on public.plants;
drop policy if exists plants_insert_own on public.plants;
drop policy if exists plants_update_own on public.plants;
drop policy if exists plants_delete_own on public.plants;

create policy plants_select_own on public.plants
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy plants_insert_own on public.plants
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.gateways g
      where g.id = plants.gateway_id and g.user_id = (select auth.uid())
    )
    and (
      plants.zone_id is null
      or exists (
        select 1 from public.zones z
        where z.id = plants.zone_id and z.user_id = (select auth.uid())
      )
    )
  );

create policy plants_update_own on public.plants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.gateways g
      where g.id = plants.gateway_id and g.user_id = (select auth.uid())
    )
    and (
      plants.zone_id is null
      or exists (
        select 1 from public.zones z
        where z.id = plants.zone_id and z.user_id = (select auth.uid())
      )
    )
  );

create policy plants_delete_own on public.plants
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Per-plant ranges are now edited from the clients. NOT VALID: enforced for
-- new writes without re-checking rows written before this migration.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plants_ideal_range_check') then
    alter table public.plants add constraint plants_ideal_range_check check (
      (ideal_low is null or ideal_low between 0 and 100)
      and (ideal_high is null or ideal_high between 0 and 100)
      and (ideal_low is null or ideal_high is null or ideal_low < ideal_high)
    ) not valid;
  end if;
end
$$;

-- ── 3. zone names are unique per user ────────────────────────
-- Retried onboarding used to insert the same zone names again. Merge any such
-- duplicates (keeping the oldest row and re-pointing its plants) so that
-- onboarding can upsert zones by name.

with ranked as (
  select id, first_value(id) over (partition by user_id, name order by id) as keep_id
  from public.zones
)
update public.plants p
set zone_id = r.keep_id
from ranked r
where p.zone_id = r.id and r.id <> r.keep_id;

with ranked as (
  select id, first_value(id) over (partition by user_id, name order by id) as keep_id
  from public.zones
)
delete from public.zones z
using ranked r
where z.id = r.id and r.id <> r.keep_id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'zones_user_id_name_key') then
    alter table public.zones add constraint zones_user_id_name_key unique (user_id, name);
  end if;
end
$$;

-- ── 4. gateway location, for the forecast ────────────────────
-- Filled from Ecowitt's device list during onboarding. report-v2 uses
-- user_prefs.weather_lat/lon when set, otherwise the first gateway with
-- coordinates, and rounds them to 0.01 degrees before calling Open-Meteo.

alter table public.gateways
  add column if not exists latitude double precision
    check (latitude between -90 and 90),
  add column if not exists longitude double precision
    check (longitude between -180 and 180),
  add column if not exists timezone text;

-- ── 5. atomic, idempotent onboarding ─────────────────────────
-- Replaces four separate client-side writes (zones, gateways, plants, profile)
-- that could fail half-way and, on retry, duplicated zones or hit 409s.
--
--   select public.complete_onboarding(
--     '[{"mac": "00:00:5E:00:53:01", "name": "Garden hub", "station_type": "GW1100A",
--        "latitude": 51.5, "longitude": -0.12, "timezone": "Europe/London"}]',
--     '[{"mac": "00:00:5E:00:53:01", "channel": 1, "name": "Lemon tree",
--        "species": "citrus", "zone": "Orchard"}]'
--   );
--
-- Everything runs in one transaction. Re-running it with the same input
-- changes nothing; with edited input it updates names, species and zones.

create or replace function public.complete_onboarding(p_gateways jsonb, p_plants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_gateways int;
  v_zones int;
  v_plants int;
  v_sort_base int;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(p_gateways) is distinct from 'array'
     or jsonb_array_length(p_gateways) not between 1 and 20 then
    raise exception 'p_gateways must be an array of 1 to 20 gateways' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plants) is distinct from 'array'
     or jsonb_array_length(p_plants) > 20 * 16 then
    raise exception 'p_plants must be an array of at most 320 plants' using errcode = '22023';
  end if;

  -- One onboarding at a time per user (double submits, retries).
  perform pg_advisory_xact_lock(hashtextextended('complete_onboarding:' || v_uid::text, 0));

  -- Gateways --------------------------------------------------
  if exists (
    select 1 from jsonb_to_recordset(p_gateways) as g(mac text)
    where coalesce(trim(g.mac), '') = '' or length(trim(g.mac)) > 64
  ) then
    raise exception 'Every gateway needs a MAC address' using errcode = '22023';
  end if;

  insert into public.gateways as gw (user_id, mac, name, station_type, latitude, longitude, timezone)
  select distinct on (trim(g.mac))
         v_uid,
         trim(g.mac),
         left(coalesce(nullif(trim(g.name), ''), trim(g.mac)), 80),
         nullif(trim(g.station_type), ''),
         case when g.latitude between -90 and 90 then g.latitude end,
         case when g.longitude between -180 and 180 then g.longitude end,
         nullif(trim(g.timezone), '')
  from jsonb_to_recordset(p_gateways) as g(
    mac text, name text, station_type text,
    latitude double precision, longitude double precision, timezone text
  )
  order by trim(g.mac)
  on conflict (user_id, mac) do update
    set name = excluded.name,
        station_type = coalesce(excluded.station_type, gw.station_type),
        latitude = coalesce(excluded.latitude, gw.latitude),
        longitude = coalesce(excluded.longitude, gw.longitude),
        timezone = coalesce(excluded.timezone, gw.timezone);
  get diagnostics v_gateways = row_count;

  -- Plants: validate the whole list before writing zones or plants. Any error
  -- aborts the transaction, which also undoes the gateway upsert above.
  -- (pg_temp is schema-qualified because search_path is empty.)
  drop table if exists pg_temp.onboarding_plants;
  create temporary table pg_temp.onboarding_plants on commit drop as
  select e.ord::int as ord,
         trim(p.mac) as mac,
         p.channel,
         left(coalesce(nullif(trim(p.name), ''), 'Channel ' || p.channel), 80) as name,
         coalesce(nullif(trim(p.species), ''), 'unknown') as species,
         left(nullif(trim(p.zone), ''), 80) as zone
  from jsonb_array_elements(p_plants) with ordinality as e(item, ord)
  cross join lateral jsonb_to_record(e.item) as p(
    mac text, channel int, name text, species text, zone text
  );

  if exists (select 1 from pg_temp.onboarding_plants where channel is null or channel not between 1 and 16) then
    raise exception 'Plant channels must be between 1 and 16' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp.onboarding_plants where species !~ '^[a-z_]{1,32}$') then
    raise exception 'Invalid species key' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_temp.onboarding_plants op
    where not exists (
      select 1 from public.gateways g where g.user_id = v_uid and g.mac = op.mac
    )
  ) then
    raise exception 'Every plant must belong to one of your gateways' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_temp.onboarding_plants group by mac, channel having count(*) > 1
  ) then
    raise exception 'Each gateway channel can only be one plant' using errcode = '22023';
  end if;

  -- Zones, in order of first appearance, after any existing ones --------
  select coalesce(max(sort) + 1, 0) into v_sort_base from public.zones where user_id = v_uid;

  insert into public.zones (user_id, name, sort)
  select v_uid, z.zone, v_sort_base + (row_number() over (order by z.first_ord))::int - 1
  from (
    select zone, min(ord) as first_ord
    from pg_temp.onboarding_plants
    where zone is not null
    group by zone
  ) z
  on conflict (user_id, name) do nothing;
  get diagnostics v_zones = row_count;

  -- Plants ----------------------------------------------------
  insert into public.plants as pl
    (user_id, gateway_id, channel, name, species, zone_id, display_order, hidden)
  select v_uid, g.id, op.channel, op.name, op.species, z.id, op.ord, false
  from pg_temp.onboarding_plants op
  join public.gateways g on g.user_id = v_uid and g.mac = op.mac
  left join public.zones z on z.user_id = v_uid and z.name = op.zone
  on conflict (gateway_id, channel) do update
    set user_id = excluded.user_id,
        name = excluded.name,
        species = excluded.species,
        zone_id = excluded.zone_id,
        display_order = excluded.display_order,
        hidden = false;
  get diagnostics v_plants = row_count;

  -- Profile and preferences (created by the signup trigger; upsert in case the
  -- account predates it).
  insert into public.profiles (id, email, onboarded)
  values (v_uid, (select u.email from auth.users u where u.id = v_uid), true)
  on conflict (id) do update set onboarded = true;
  insert into public.user_prefs (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  return jsonb_build_object('gateways', v_gateways, 'zones_created', v_zones, 'plants', v_plants);
end
$$;

revoke all on function public.complete_onboarding(jsonb, jsonb) from public, anon;
grant execute on function public.complete_onboarding(jsonb, jsonb) to authenticated;

-- ── 6. reorder plants in one call ────────────────────────────
-- SECURITY INVOKER: runs under the caller's RLS, so ids belonging to other
-- users are silently ignored.

create or replace function public.set_plant_order(p_plant_ids bigint[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.plants p
  set display_order = o.ord::int
  from unnest(p_plant_ids) with ordinality as o(id, ord)
  where p.id = o.id;
$$;

revoke all on function public.set_plant_order(bigint[]) from public, anon;
grant execute on function public.set_plant_order(bigint[]) to authenticated;
