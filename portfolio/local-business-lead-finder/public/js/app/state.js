// What the Lead Finder page knows right now, shared by its views (find.js, call-list.js,
// business.js): the search, the call list, the website checks, and saving.
import { BRAND } from '../config.js';
import { $, digits, norm, placesOf, today } from '../shared.js';
import { vOf } from '../verticals.js';
import { store } from '../store.js';
import { assess, slim } from '../score.js';

// ---------------------------------------------------------------- this device: your details and filters

const PREF = 'lf-prefs';
export const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem(PREF) || '{}') || {};
  } catch {
    return {};
  }
})();
export function savePrefs() {
  try {
    localStorage.setItem(PREF, JSON.stringify(prefs));
  } catch {
    // blocked: the choices last until the page closes
  }
}
// The sign-off printed at the end of each audit: what "Your details" says, else your name and the brand.
export const defaultSignoff = () => [(prefs.me || '').trim(), BRAND.name, [BRAND.phone, BRAND.site].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
export const signoff = () => (prefs.sign || '').trim() || defaultSignoff();

// ---------------------------------------------------------------- state

export const PAGE = 150; // results shown at a time
export const state = {
  V: vOf(prefs.v), // the kind of business picked
  results: [], // the last search
  lastQ: null, // what it was: { v, area, radius, what, edge }
  searching: false,
  shown: PAGE,
  plist: [], // the call list
  listLoaded: false,
  listMissing: false, // the database has no call list yet (supabase/prospects.sql not run)
  reqs: [], // the pipeline
  view: 'find', // or 'list'
  lfilter: '', // the call list's picked box
  openKey: null, // the business open in the panel (its placeId)
};
export const byPlace = new Map(); // placeId → saved business
export const siteCache = new Map(); // url → website check (null while it runs)
export const score = (p) => assess(p, siteCache);

// The views register their renderers here (main.js), so anything can redraw what's on screen.
export const views = { results() {}, list() {}, panel() {} };
// Don't redraw the open business while someone is typing in it.
export function editing() {
  const a = document.activeElement;
  return a && /TEXTAREA|INPUT|SELECT/.test(a.tagName) && a.closest('#pLayer');
}
export function redraw() {
  if (state.view === 'find') views.results();
  else views.list();
  if (state.openKey && !editing()) views.panel();
}

export function setSave(t, err) {
  const el = $('save');
  el.textContent = t;
  el.classList.toggle('err', !!err);
}

// ---------------------------------------------------------------- the call list and the pipeline

const CLOSED = ['Not interested', 'Not a fit', 'In pipeline'];
export const isOpen = (p) => !CLOSED.includes(p.status);
export function reindex() {
  byPlace.clear();
  state.plist.forEach((p) => byPlace.set(p.placeId, p));
  $('listCount').textContent = state.plist.filter(isOpen).length;
}
// Already in the pipeline: the same phone number or the same name.
let pipePhones = new Set(), pipeNames = new Set();
export function reindexPipe() {
  pipePhones = new Set(state.reqs.map((r) => digits(r.contact)).filter((d) => d.length === 10));
  pipeNames = new Set(state.reqs.map((r) => norm(r.business)).filter(Boolean));
}
export const inPipeline = (p) => (digits(p.phone).length === 10 && pipePhones.has(digits(p.phone))) || pipeNames.has(norm(p.name));

// ---------------------------------------------------------------- website checks: 3 per call, 2 calls at a time

// Each check also looks for the business's own name, area and phone on its page.
const siteHints = new Map(); // url → { name, places, phone }
const hintFor = (p) => ({ name: p.name || '', places: placesOf(p), phone: p.phone || '' });
const siteQueue = [];
let siteBusy = 0;
export function queueSites(list) {
  list.forEach((p) => {
    const u = p.website;
    if (!u) return;
    siteHints.set(u, hintFor(p));
    if (!siteCache.has(u) && !siteQueue.includes(u)) siteQueue.push(u);
  });
  pumpSites();
}
function pumpSites() {
  while (siteBusy < 2 && siteQueue.length) {
    const batch = siteQueue.splice(0, 3);
    siteBusy++;
    batch.forEach((u) => siteCache.set(u, null));
    store
      .leads({ action: 'sites', urls: batch, hints: batch.map((u) => siteHints.get(u) || null) })
      .then((r) => (r.results || []).forEach((x) => siteCache.set(x.url, { ...x, at: today() })))
      .catch((e) => {
        if (e.status === 401) store.signOut();
      })
      .then(() => {
        batch.forEach((u) => {
          if (!siteCache.get(u)) siteCache.set(u, { url: u, kind: 'error', error: 'check failed' });
        });
        siteBusy--;
        sitesDone(batch);
        pumpSites();
      });
  }
}
// A saved business whose website check just finished: store the result on it.
function sitesDone(batch) {
  state.plist.filter((p) => batch.includes(p.website) && !(p.site && p.site.kind) && siteCache.get(p.website)).forEach((p) => storeCheck(p));
  redraw();
}
function storeCheck(p) {
  const site = siteCache.get(p.website), a = assess({ ...p, site });
  writeP(p.id, { site, score: a.score, signals: slim(a), ...(!p.email && site.emails && site.emails[0] ? { email: site.emails[0] } : {}) });
}
// Check websites again right before an audit, so it never repeats something they've since fixed.
// Results are stored on the business like any other check.
export async function recheck(list) {
  list.forEach((p) => {
    if (p.website) siteHints.set(p.website, hintFor(p));
  });
  const urls = [...new Set(list.map((p) => p.website).filter(Boolean))];
  const run = async () => {
    while (urls.length) {
      const batch = urls.splice(0, 3);
      const r = await store.leads({ action: 'sites', urls: batch, hints: batch.map((u) => siteHints.get(u) || null) }).catch((e) => {
        if (e.status === 401) store.signOut();
        return {};
      });
      (r.results || []).filter((x) => x.kind !== 'error').forEach((x) => siteCache.set(x.url, { ...x, at: today() }));
    }
  };
  await Promise.all([run(), run()]);
  list.forEach((p) => {
    const site = siteCache.get(p.website);
    if (site && site.at === today() && state.plist.includes(p)) storeCheck(p);
  });
}

// ---------------------------------------------------------------- saving

// Writes to one business go out one after another, so a slow save can't land after a newer one.
const pending = new Map();
export function writeP(id, patch) {
  const p = state.plist.find((x) => x.id === id);
  if (!p) return Promise.resolve();
  Object.assign(p, patch);
  setSave('Saving…');
  const prev = pending.get(id) || Promise.resolve();
  const next = prev
    .then(() => store.prospects.update(id, patch))
    .then(() => {
      if (pending.get(id) === next) {
        pending.delete(id);
        setSave('All changes saved');
      }
    })
    .catch(() => {
      pending.delete(id);
      setSave('Could not save. Check your connection and try again.', true);
    });
  pending.set(id, next);
  reindex();
  return next;
}
function toRow(p, extra) {
  const a = score(p), site = p.website ? siteCache.get(p.website) || p.site || {} : {};
  return {
    placeId: p.placeId, name: p.name || '', vertical: p.vertical || state.V.k, btype: p.btype || '', address: p.address || '', area: p.area || '',
    phone: p.phone || '', website: p.website || '', mapsUrl: p.mapsUrl || '', rating: p.rating ?? '', reviews: p.reviews ?? '',
    site: site || {}, score: a.score, signals: slim(a), email: p.email || (site && site.emails && site.emails[0]) || '', ...(extra || {}),
  };
}
// Save search results to the call list (100 per call). extra: fields to set on new ones, like a status.
export async function saveResults(list, extra) {
  if (state.listMissing) {
    setSave('Turn on the call list first (see the Call list tab).', true);
    return [];
  }
  setSave('Saving…');
  try {
    const saved = [];
    for (let i = 0; i < list.length; i += 100) saved.push(...(await store.prospects.save(list.slice(i, i + 100).map((p) => toRow(p, extra)))));
    saved.forEach((s) => {
      const i = state.plist.findIndex((x) => x.id === s.id || x.placeId === s.placeId);
      if (i >= 0) state.plist[i] = { ...state.plist[i], ...s };
      else state.plist.unshift(s);
    });
    reindex();
    setSave(saved.length === 1 ? 'Saved to your call list' : saved.length + ' saved to your call list');
    return saved;
  } catch (e) {
    if (e.status === 404) {
      state.listMissing = true;
      views.list();
    }
    setSave('Could not save. ' + (e.status === 404 ? "The call list isn't set up yet." : 'Try again.'), true);
    return [];
  }
}
