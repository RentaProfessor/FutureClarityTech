// The data layer: the call list, the hand-off to the pipeline, and the website checker.
//
// Live mode talks to Supabase only through the code-gated functions in supabase/*.sql (the
// publishable key can't touch the tables directly), and to functions/api/prospects.js for website
// checks. Demo mode (no Supabase settings in env.js) keeps everything in this browser and answers
// website checks from canned results. Both have the same interface.
import { LIVE, SUPABASE } from './config.js';
import { demoSites } from './demo-checks.js';

// ------------------------------------------------------------------ this browser's storage

// localStorage, or memory when the browser blocks it (some private windows)
const mem = {};
function get(k) {
  try {
    const v = localStorage.getItem(k);
    if (v !== null) return v;
  } catch {
    // blocked: fall back to memory
  }
  return k in mem ? mem[k] : null;
}
function set(k, v) {
  mem[k] = v;
  try {
    localStorage.setItem(k, v);
  } catch {
    // blocked: memory only
  }
}
function del(k) {
  delete mem[k];
  try {
    localStorage.removeItem(k);
  } catch {
    // blocked: memory only
  }
}
const readList = (k) => {
  try {
    return JSON.parse(get(k) || '[]');
  } catch {
    return [];
  }
};
const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ------------------------------------------------------------------ rows

// The database is snake_case, the page camelCase. Empty dates and numbers go to the database as null.
const camel = (k) => k.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
const snake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const NULLS = new Set(['last_touch', 'follow_up', 'request_id', 'rating', 'reviews', 'audit_date']);
export function toDb(o) {
  const r = {};
  for (const k of Object.keys(o)) {
    if (k === 'id' || k === 'createdAt' || k === 'updatedAt') continue;
    const s = snake(k);
    let v = o[k];
    if (NULLS.has(s) && (v === '' || v === undefined)) v = null;
    r[s] = v;
  }
  return r;
}
export function fromDb(row) {
  const o = {};
  for (const k of Object.keys(row)) {
    let v = row[k];
    if (v === null && k !== 'rating' && k !== 'reviews') v = '';
    if (k === 'rating' && v !== null) v = Number(v); // numeric(2,1) arrives as a string
    o[camel(k)] = v;
  }
  return o;
}

// What a new search may refresh on a business already on the list. Status, notes, follow-up and
// history belong to the team and are never overwritten (prospects_save does the same in Postgres).
const P_FACTS = ['name', 'btype', 'address', 'phone', 'website', 'mapsUrl', 'rating', 'reviews', 'site', 'score', 'signals'];
const P_IF_EMPTY = ['vertical', 'area', 'email'];

// ------------------------------------------------------------------ demo mode

const PKEY = 'lf-demo-prospects', RKEY = 'lf-demo-pipeline';
const pipelineWatchers = [];
const tellPipeline = () => {
  const rows = readList(RKEY);
  pipelineWatchers.forEach((cb) => cb(rows));
};

const demo = {
  live: false,
  // no sign-in in the demo
  onAuth(cb) {
    cb('Demo');
  },
  signIn: () => Promise.resolve({}),
  signOut: () => Promise.resolve(),
  // start over: an empty call list and pipeline
  reset() {
    del(PKEY);
    del(RKEY);
  },
  watch(cb) {
    pipelineWatchers.push(cb);
    cb(readList(RKEY));
    if (pipelineWatchers.length === 1) {
      window.addEventListener('storage', (e) => {
        if (e.key === RKEY) tellPipeline(); // another tab changed it
      });
    }
  },
  add(row) {
    const now = new Date().toISOString(), all = readList(RKEY);
    const n = { ...row, id: newId('r'), createdAt: now, updatedAt: now };
    all.push(n);
    set(RKEY, JSON.stringify(all));
    tellPipeline();
    return Promise.resolve(n);
  },
  prospects: {
    list: () => Promise.resolve(readList(PKEY)),
    save(list) {
      const all = readList(PKEY), now = new Date().toISOString(), out = [];
      list.forEach((n) => {
        if (!n.placeId) return;
        let x = all.find((q) => q.placeId === n.placeId);
        if (x) {
          P_FACTS.forEach((k) => {
            if (k in n) x[k] = n[k];
          });
          P_IF_EMPTY.forEach((k) => {
            if (!x[k] && n[k]) x[k] = n[k];
          });
          x.updatedAt = now;
        } else {
          x = { status: 'To contact', touches: 0, notes: '', log: [], email: '', lastTouch: '', followUp: '', requestId: '', site: {}, signals: [], ...n, id: newId('p'), createdAt: now, updatedAt: now };
          all.push(x);
        }
        out.push(JSON.parse(JSON.stringify(x)));
      });
      set(PKEY, JSON.stringify(all));
      return Promise.resolve(out);
    },
    update(id, patch) {
      const all = readList(PKEY), x = all.find((q) => q.id === id);
      if (!x) return Promise.reject(new Error('not found'));
      Object.assign(x, patch, { updatedAt: new Date().toISOString() });
      set(PKEY, JSON.stringify(all));
      return Promise.resolve();
    },
    remove(id) {
      set(PKEY, JSON.stringify(readList(PKEY).filter((q) => q.id !== id)));
      return Promise.resolve();
    },
  },
  leads: (body) => demoSites(body),
};

// ------------------------------------------------------------------ live mode (Supabase)

// The Lead Finder opens with the team's code, checked by the database (supabase/dashboard_code.sql).
// This device remembers it until "Sign out".
const HEADERS = { apikey: SUPABASE.key, Authorization: 'Bearer ' + SUPABASE.key, 'Content-Type': 'application/json' };
const CKEY = 'lf-dashboard-code';
const getCode = () => get(CKEY);
function rpc(fn, args) {
  return fetch(`${SUPABASE.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) }).then((r) => {
    if (!r.ok) throw Object.assign(new Error(`Request failed (${r.status})`), { status: r.status });
    return r.text().then((t) => (t ? JSON.parse(t) : null));
  });
}
const authWatchers = [];
const tellAuth = (who) => authWatchers.forEach((cb) => cb(who));
const TEAM = 'Team';

const live = {
  live: true,
  onAuth(cb) {
    authWatchers.push(cb);
    const c = getCode();
    if (!c) return cb(null);
    rpc('dashboard_check', { code: c }).then(
      (ok) => {
        if (!ok) del(CKEY);
        cb(ok ? TEAM : null);
      },
      () => cb(null),
    );
  },
  // "Sign in" = check the code; on success this device remembers it.
  signIn(code) {
    return rpc('dashboard_check', { code }).then((ok) => {
      if (!ok) throw new Error('wrong code');
      set(CKEY, code);
      tellAuth(TEAM);
      return {};
    });
  },
  signOut() {
    del(CKEY);
    tellAuth(null);
    return Promise.resolve();
  },
  // The pipeline, every 10 seconds, to flag businesses that are already in it.
  watch(cb, onErr) {
    const load = () => {
      const c = getCode();
      if (!c) return;
      rpc('dashboard_rows', { code: c }).then(
        (rows) => cb((rows || []).map(fromDb)),
        (e) => {
          if (e.status === 401 || e.status === 403) return live.signOut(); // the code was changed
          if (onErr) onErr(e);
        },
      );
    };
    load();
    setInterval(load, 10000);
  },
  add: (row) => rpc('dashboard_add', { code: getCode(), new_row: toDb(row) }).then(fromDb),
  // The call list (supabase/prospects.sql). A 404 means that file hasn't been run yet.
  prospects: {
    list: () => rpc('prospects_rows', { code: getCode() }).then((r) => (r || []).map(fromDb)),
    save: (list) => rpc('prospects_save', { code: getCode(), new_rows: list.map(toDb) }).then((r) => (r || []).map(fromDb)),
    update: (id, patch) => rpc('prospects_update', { code: getCode(), row_id: id, patch: toDb(patch) }),
    remove: (id) => rpc('prospects_delete', { code: getCode(), row_id: id }),
  },
  // Website checks run in functions/api/prospects.js: a browser can't read other websites itself.
  leads(body) {
    return fetch('/api/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, code: getCode() }) }).then((r) =>
      r.json().catch(() => ({})).then((j) => {
        if (r.ok) return j;
        throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status, error: j.error || '' });
      }),
    );
  },
};

export const store = LIVE ? live : demo;
