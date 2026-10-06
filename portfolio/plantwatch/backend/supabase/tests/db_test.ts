/**
 * Database tests: the real migration files, run against Postgres compiled to
 * WebAssembly (PGlite), with a minimal stand-in for Supabase's auth schema and
 * API roles. Queries run as the `authenticated` role with a JWT subject set,
 * the way PostgREST runs them, so row-level security is actually enforced.
 */

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { assert, assertEquals, assertRejects } from "@std/assert";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const USER_C = "00000000-0000-4000-8000-00000000000c";

/** Just enough of a Supabase project for the migrations to run as they do there. */
const SUPABASE_STUB = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  -- Supabase grants API roles broad privileges on public by default and relies
  -- on RLS; mirror that so the tests see the same starting point.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

async function migrationFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  return names.sort();
}

async function applyMigrations(db: PGlite, names: string[]): Promise<void> {
  for (const name of names) {
    await db.exec(await Deno.readTextFile(new URL(name, MIGRATIONS_DIR)));
  }
}

/** A fresh database with the stub, optionally only the first N migrations, and three users. */
async function freshDb(migrationCount?: number): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const names = await migrationFiles();
  await applyMigrations(db, names.slice(0, migrationCount ?? names.length));
  await db.query(
    `insert into auth.users (id, email) values
       ($1, 'a@example.com'), ($2, 'b@example.com'), ($3, 'c@example.com')`,
    [USER_A, USER_B, USER_C],
  );
  return db;
}

/** Runs `fn` in a transaction as an API caller: a signed-in user, or anon when uid is null. */
function as<T>(db: PGlite, uid: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
    if (uid) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    return await fn(tx);
  });
}

const GATEWAY = { mac: "00:00:5E:00:53:01", name: "Garden hub", station_type: "GW1100A" };
const PLANTS = [
  { mac: GATEWAY.mac, channel: 1, name: "Lemon tree", species: "citrus", zone: "Orchard" },
  { mac: GATEWAY.mac, channel: 2, name: "Avocado", species: "avocado", zone: "Orchard" },
  { mac: GATEWAY.mac, channel: 3, name: "Tomato bed", species: "unknown", zone: "Kitchen garden" },
];

function onboard(tx: Transaction, gateways: unknown[] = [GATEWAY], plants: unknown[] = PLANTS) {
  return tx.query<{ result: Record<string, number> }>(
    "select public.complete_onboarding($1::jsonb, $2::jsonb) as result",
    [JSON.stringify(gateways), JSON.stringify(plants)],
  );
}

async function rowCounts(tx: Transaction) {
  const { rows } = await tx.query<{ gateways: number; zones: number; plants: number }>(
    `select (select count(*)::int from public.gateways) as gateways,
            (select count(*)::int from public.zones) as zones,
            (select count(*)::int from public.plants) as plants`,
  );
  return rows[0];
}

// ---------------------------------------------------------------------------

Deno.test("migrations apply to an empty database and can be applied again", async () => {
  const db = await freshDb();
  await applyMigrations(db, await migrationFiles());
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from public.profiles where id in ($1, $2, $3)",
    [USER_A, USER_B, USER_C],
  );
  assertEquals(rows[0].n, 3, "signup trigger still creates profiles");
});

Deno.test("complete_onboarding creates gateways, zones and plants in one call", async () => {
  const db = await freshDb();
  await as(db, USER_A, async (tx) => {
    const { rows } = await onboard(tx);
    assertEquals(rows[0].result, { gateways: 1, zones_created: 2, plants: 3 });
    assertEquals(await rowCounts(tx), { gateways: 1, zones: 2, plants: 3 });

    const plants = await tx.query<{ name: string; zone: string; display_order: number }>(
      `select p.name, z.name as zone, p.display_order
       from public.plants p join public.zones z on z.id = p.zone_id order by p.display_order`,
    );
    assertEquals(plants.rows, [
      { name: "Lemon tree", zone: "Orchard", display_order: 1 },
      { name: "Avocado", zone: "Orchard", display_order: 2 },
      { name: "Tomato bed", zone: "Kitchen garden", display_order: 3 },
    ]);
    const zones = await tx.query<{ name: string; sort: number }>(
      "select name, sort from public.zones order by sort",
    );
    assertEquals(zones.rows, [{ name: "Orchard", sort: 0 }, { name: "Kitchen garden", sort: 1 }]);
    const profile = await tx.query<{ onboarded: boolean }>("select onboarded from public.profiles");
    assertEquals(profile.rows, [{ onboarded: true }]);
  });
});

Deno.test("complete_onboarding is idempotent and updates edited plants", async () => {
  const db = await freshDb();
  await as(db, USER_A, (tx) => onboard(tx));
  await as(db, USER_A, async (tx) => {
    const again = await onboard(tx);
    assertEquals(again.rows[0].result.zones_created, 0);
    assertEquals(await rowCounts(tx), { gateways: 1, zones: 2, plants: 3 });

    const renamed = PLANTS.map((p) =>
      p.channel === 3 ? { ...p, name: "Herb planter", zone: "Patio" } : p
    );
    await onboard(tx, [GATEWAY], renamed);
    const { rows } = await tx.query<{ name: string; zone: string }>(
      `select p.name, z.name as zone from public.plants p
       join public.zones z on z.id = p.zone_id where p.channel = 3`,
    );
    assertEquals(rows, [{ name: "Herb planter", zone: "Patio" }]);
    assertEquals((await rowCounts(tx)).plants, 3, "updated in place, not duplicated");
  });
});

Deno.test("complete_onboarding writes nothing when any part of the input is invalid", async () => {
  const db = await freshDb();
  const invalid: Array<[string, unknown[], unknown[]]> = [
    ["channel 17", [GATEWAY], [...PLANTS, { mac: GATEWAY.mac, channel: 17, name: "x" }]],
    ["unknown gateway", [GATEWAY], [{ mac: "00:00:5E:00:53:99", channel: 1, name: "x" }]],
    ["duplicate channel", [GATEWAY], [PLANTS[0], { ...PLANTS[1], channel: 1 }]],
    ["bad species key", [GATEWAY], [{ ...PLANTS[0], species: "'; drop table x; --" }]],
    ["no gateways", [], PLANTS],
    ["gateway without MAC", [{ name: "nameless" }], []],
  ];
  for (const [label, gateways, plants] of invalid) {
    await assertRejects(
      () => as(db, USER_B, (tx) => onboard(tx, gateways, plants)),
      Error,
      undefined,
      label,
    );
  }
  await as(db, USER_B, async (tx) => {
    assertEquals(await rowCounts(tx), { gateways: 0, zones: 0, plants: 0 });
    const profile = await tx.query<{ onboarded: boolean }>("select onboarded from public.profiles");
    assertEquals(profile.rows, [{ onboarded: false }]);
  });
});

Deno.test("complete_onboarding is only callable by signed-in users", async () => {
  const db = await freshDb();
  await assertRejects(() => as(db, null, (tx) => onboard(tx)), Error, "permission denied");
  await assertRejects(
    () =>
      db.transaction(async (tx) => {
        await tx.exec("set local role authenticated"); // no JWT subject
        await onboard(tx);
      }),
    Error,
    "Not signed in",
  );
});

Deno.test("row-level security keeps users' gardens apart", async () => {
  const db = await freshDb();
  await as(db, USER_A, (tx) => onboard(tx));
  await as(db, USER_B, async (tx) => {
    assertEquals(await rowCounts(tx), { gateways: 0, zones: 0, plants: 0 });
    const updated = await tx.query("update public.plants set name = 'mine now'");
    assertEquals(updated.affectedRows, 0);
  });
});

Deno.test("plants cannot point at another user's gateway or zone", async () => {
  const db = await freshDb();
  await as(db, USER_A, (tx) => onboard(tx));
  const ids = await db.query<{ gateway_id: number; zone_id: number }>(
    "select gateway_id, zone_id from public.plants limit 1",
  );
  const { gateway_id: aGateway, zone_id: aZone } = ids.rows[0];

  await as(db, USER_B, (tx) =>
    onboard(tx, [{ ...GATEWAY, mac: "00:00:5E:00:53:02" }], [{
      mac: "00:00:5E:00:53:02",
      channel: 1,
      name: "Rosemary",
      species: "rosemary",
      zone: "Patio",
    }]));

  // Inserting a plant on A's gateway (which would also squat A's channel).
  await assertRejects(
    () =>
      as(db, USER_B, (tx) =>
        tx.query(
          `insert into public.plants (user_id, gateway_id, channel, name)
           values ($1, $2, 9, 'squatter')`,
          [USER_B, aGateway],
        )),
    Error,
    "row-level security",
  );
  // Moving B's own plant into A's zone.
  await assertRejects(
    () => as(db, USER_B, (tx) => tx.query("update public.plants set zone_id = $1", [aZone])),
    Error,
    "row-level security",
  );
  // B's own gateway and zone are fine.
  await as(db, USER_B, async (tx) => {
    const own = await tx.query<{ id: number }>("select id from public.gateways");
    await tx.query(
      `insert into public.plants (user_id, gateway_id, channel, name) values ($1, $2, 2, 'Sage')`,
      [USER_B, own.rows[0].id],
    );
  });
});

Deno.test("users cannot grant themselves admin", async () => {
  const db = await freshDb();
  await assertRejects(
    () => as(db, USER_A, (tx) => tx.query("update public.profiles set is_admin = true")),
    Error,
    "permission denied",
  );
  await assertRejects(
    () => as(db, USER_A, (tx) => tx.query("delete from public.profiles")),
    Error,
    "permission denied",
  );
  await assertRejects(
    () =>
      as(
        db,
        USER_A,
        (tx) => tx.query("insert into public.profiles (id, is_admin) values ($1, true)", [USER_A]),
      ),
    Error,
    "permission denied",
  );
  // Even with table-wide UPDATE granted back, the trigger still refuses.
  await db.exec("grant update on public.profiles to authenticated");
  await assertRejects(
    () => as(db, USER_A, (tx) => tx.query("update public.profiles set is_admin = true")),
    Error,
    "is_admin can only be changed by an administrator",
  );
  // Clients can still mark themselves onboarded (the iOS client does this).
  await as(db, USER_A, async (tx) => {
    const res = await tx.query("update public.profiles set onboarded = true where id = $1", [
      USER_A,
    ]);
    assertEquals(res.affectedRows, 1);
  });
  // Administrators (SQL editor / service role) can grant it.
  await db.query("update public.profiles set is_admin = true where id = $1", [USER_A]);
  const { rows } = await db.query<{ is_admin: boolean }>(
    "select is_admin from public.profiles where id = $1",
    [USER_A],
  );
  assertEquals(rows, [{ is_admin: true }]);
});

Deno.test("set_plant_order reorders only the caller's plants", async () => {
  const db = await freshDb();
  await as(db, USER_A, (tx) => onboard(tx));
  const { rows } = await db.query<{ id: number }>("select id from public.plants order by channel");
  const [p1, p2, p3] = rows.map((r) => r.id);

  await as(
    db,
    USER_A,
    (tx) => tx.query("select public.set_plant_order($1::bigint[])", [[p3, p1, p2]]),
  );
  await as(
    db,
    USER_B,
    (tx) => tx.query("select public.set_plant_order($1::bigint[])", [[p2, p3, p1]]),
  );

  const order = await db.query<{ id: number }>(
    "select id from public.plants order by display_order",
  );
  assertEquals(order.rows.map((r) => r.id), [p3, p1, p2]);
  await assertRejects(
    () => as(db, null, (tx) => tx.query("select public.set_plant_order($1::bigint[])", [[p1]])),
    Error,
    "permission denied",
  );
});

Deno.test("custom ranges must be a valid band", async () => {
  const db = await freshDb();
  await as(db, USER_A, (tx) => onboard(tx));
  await assertRejects(
    () =>
      as(db, USER_A, (tx) => tx.query("update public.plants set ideal_low = 60, ideal_high = 50")),
    Error,
    "plants_ideal_range_check",
  );
  await as(db, USER_A, async (tx) => {
    const res = await tx.query(
      "update public.plants set ideal_low = 30, ideal_high = 50, notify = true",
    );
    assertEquals(res.affectedRows, 3);
  });
});

Deno.test("the iOS client's step-by-step onboarding writes still work", async () => {
  const db = await freshDb();
  await as(db, USER_C, async (tx) => {
    const zone = await tx.query<{ id: number }>(
      "insert into public.zones (user_id, name, sort) values ($1, 'Garden', 0) returning id",
      [USER_C],
    );
    const gateway = await tx.query<{ id: number }>(
      `insert into public.gateways (user_id, mac, name, station_type)
       values ($1, '00:00:5E:00:53:03', 'Hub', 'GW1200B') returning id`,
      [USER_C],
    );
    await tx.query(
      `insert into public.plants (user_id, gateway_id, channel, name, species, zone_id, display_order)
       values ($1, $2, 1, 'Lavender', 'lavender', $3, 1)`,
      [USER_C, gateway.rows[0].id, zone.rows[0].id],
    );
    const profile = await tx.query("update public.profiles set onboarded = true where id = $1", [
      USER_C,
    ]);
    assertEquals(profile.affectedRows, 1);
  });
});

Deno.test("the migration merges duplicate zone names left by earlier retries", async () => {
  const names = await migrationFiles();
  assert(names.length >= 2);
  const db = await freshDb(names.length - 1); // schema as it was before this migration
  const gw = await db.query<{ id: number }>(
    `insert into public.gateways (user_id, mac, name) values ($1, '00:00:5E:00:53:01', 'Hub')
     returning id`,
    [USER_A],
  );
  const zones = await db.query<{ id: number }>(
    `insert into public.zones (user_id, name, sort) values ($1, 'Orchard', 0), ($1, 'Orchard', 0),
       ($2, 'Orchard', 0) returning id`,
    [USER_A, USER_B],
  );
  const [keep, duplicate] = zones.rows.map((r) => r.id);
  await db.query(
    `insert into public.plants (user_id, gateway_id, channel, name, zone_id)
     values ($1, $2, 1, 'Lemon tree', $3)`,
    [USER_A, gw.rows[0].id, duplicate],
  );

  await applyMigrations(db, names.slice(-1));

  const after = await db.query<{ user_id: string; n: number }>(
    "select user_id, count(*)::int as n from public.zones group by user_id order by user_id",
  );
  assertEquals(after.rows, [{ user_id: USER_A, n: 1 }, { user_id: USER_B, n: 1 }]);
  const plant = await db.query<{ zone_id: number }>("select zone_id from public.plants");
  assertEquals(plant.rows, [{ zone_id: keep }]);
  await assertRejects(
    () => db.query("insert into public.zones (user_id, name) values ($1, 'Orchard')", [USER_A]),
    Error,
    "zones_user_id_name_key",
  );
});

Deno.test("baseline: the original policies allowed both attacks fixed above", async () => {
  const db = await freshDb(1); // only 20260530000001_multitenant.sql
  const gateway = await db.query<{ id: number }>(
    "insert into public.gateways (user_id, mac, name) values ($1, 'mac-a', 'Hub') returning id",
    [USER_A],
  );
  const squat = await as(db, USER_B, (tx) =>
    tx.query(
      "insert into public.plants (user_id, gateway_id, channel, name) values ($1, $2, 1, 'squat')",
      [USER_B, gateway.rows[0].id],
    ));
  assertEquals(squat.affectedRows, 1, "B could attach a plant to A's gateway");
  const admin = await as(
    db,
    USER_A,
    (tx) => tx.query("update public.profiles set is_admin = true"),
  );
  assertEquals(admin.affectedRows, 1, "A could make themselves admin");
});
