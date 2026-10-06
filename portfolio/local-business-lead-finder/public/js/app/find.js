// The Find view: pick a kind of business, a place and a distance; see every business there,
// scored, best leads first, with their websites checked as they come into view.
import { DEFAULT_RADIUS, RADII, REGION } from '../config.js';
import { $, digits, esc, hostOf, safeUrl } from '../shared.js';
import { VERTICALS, vOf } from '../verticals.js';
import { customMatcher, loadJSON, locate, nearby } from '../places.js';
import { inBox, reachesPast } from '../geo.js';
import { PAGE, byPlace, inPipeline, isOpen, prefs, queueSites, savePrefs, score, state } from './state.js';

const withState = (a) => `${a}, ${REGION.state}`;

export function renderSearch() {
  const { V } = state;
  $('vchips').innerHTML = VERTICALS.map((v) => `<button type="button" data-v="${esc(v.k)}" class="${v.k === V.k ? 'on' : ''}" aria-pressed="${v.k === V.k}">${esc(v.label)}</button>`).join('');
  $('vwhy').hidden = !V.hint;
  $('vwhy').textContent = V.hint || '';
  $('customQ').hidden = V.k !== 'custom';
  $('areas').innerHTML = REGION.areas.map(([a]) => `<button type="button" data-area="${esc(withState(a))}" class="${$('area').value === withState(a) ? 'on' : ''}">${esc(a)}</button>`).join('');
  const mi = prefs.radius || DEFAULT_RADIUS;
  $('radius').innerHTML = 'Within ' + RADII.map((r) => `<button type="button" data-radius="${r}" class="${r === mi ? 'on' : ''}" aria-pressed="${r === mi}">${r} mi</button>`).join('');
}

// Suggestions for the place box, and the list's credit line, from meta.json.
export function fillAreaList() {
  loadJSON('meta').then((m) => {
    const names = [...new Set([...REGION.areas.map((a) => a[0]), ...m.areas.map((a) => a[0])])].sort();
    $('areaList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('') + m.zips.map((z) => `<option value="${esc(z[0])}">`).join('');
    if (m.synthetic) $('attrib').textContent = 'Sample data: every business here is fictional, generated for this demo by scripts/build-demo-data.mjs. Its phone numbers are in the 555-01xx range reserved for fiction, and its websites are on the reserved .test domain.';
    else $('attrib').insertAdjacentHTML('beforeend', ` List updated from Overture's ${esc(String(m.release).slice(0, 7))} release.`);
  }, () => {});
}

export async function runSearch() {
  if (state.searching) return;
  const { V } = state;
  const area = $('area').value.trim() || withState(REGION.defaultArea);
  const custom = $('customQ').value.trim();
  const match = V.k === 'custom' ? customMatcher(custom) : null;
  if (V.k === 'custom' && !match) {
    $('findNotice').innerHTML = '<div class="notice"><h3>What kind of business?</h3><p class="hint">Type it in the box under "Something else", like "HVAC", "florist" or "nail salon".</p></div>';
    $('customQ').focus();
    return;
  }
  const radius = prefs.radius || DEFAULT_RADIUS;
  prefs.area = area;
  prefs.v = V.k;
  savePrefs();
  Object.assign(state, { searching: true, results: [], shown: PAGE, lastQ: { v: V.k, area, radius, what: custom, edge: false } });
  $('findNotice').innerHTML = '';
  renderResults();
  try {
    const [m, data] = await Promise.all([loadJSON('meta'), loadJSON(V.k === 'custom' ? 'other' : V.k)]);
    const loc = locate(area, m);
    if (!inBox(loc.lat, loc.lon, m.box)) throw Object.assign(new Error('outside'), { error: 'outside', coverage: m.coverage });
    state.lastQ.edge = reachesPast(loc.lat, loc.lon, radius, m.box);
    state.lastQ.area = loc.label;
    state.results = nearby(data, loc, radius, match).map((p) => ({ ...p, vertical: V.k, area: loc.label }));
    if (!state.results.length) {
      $('findNotice').innerHTML = `<div class="notice"><h3>None found there</h3><p class="hint">The business list has no ${esc(V.k === 'custom' ? custom : V.label.toLowerCase())} within ${radius} mi of ${esc(loc.label)}. Try a wider distance or a nearby area, or add the ones you know with <b>+ Add a business</b>.</p></div>`;
    }
  } catch (e) {
    searchError(e);
  }
  state.searching = false;
  renderResults();
}

function searchError(e) {
  let html;
  if (e.error === 'notfound') html = "<h3>Couldn't find that place</h3><p class=\"hint\">Type a neighborhood, city or ZIP code (suggestions appear as you type), or tap one of the areas.</p>";
  else if (e.error === 'outside') html = `<h3>That's outside the business list</h3><p class="hint">${e.coverage ? `It covers ${esc(e.coverage)}.` : 'It only covers the area it was built for.'} Try a place inside it.</p>`;
  else if (e.status === 404) html = "<h3>The business list isn't on the site yet</h3><p class=\"hint\">Build it with <code>scripts/build-places.py</code> and deploy <code>public/data/places/</code>, then try again.</p>";
  else html = "<h3>Couldn't load the business list</h3><p class=\"hint\">Check your connection and try again.</p>";
  $('findNotice').innerHTML = `<div class="notice">${html}</div>`;
}

// The results as shown: scored with anything saved for them, filtered, best first, then nearest.
export function visibleResults() {
  const hideSkip = $('hideSkip').checked, hideListed = $('hideListed').checked;
  return state.results
    .map((p) => {
      const saved = byPlace.get(p.placeId);
      return { p, a: score(saved ? { ...p, site: saved.site, rating: saved.rating, reviews: saved.reviews, website: saved.website || p.website } : p), saved };
    })
    .filter(({ a, saved }) => !(hideSkip && (a.sig.some((x) => x.k === 'chain' || x.k === 'bad') || (saved && saved.status === 'Not a fit'))) && !(hideListed && saved))
    .sort((x, y) => y.a.score - x.a.score || (x.p.dist ?? 99) - (y.p.dist ?? 99));
}

export function renderResults() {
  const { results, lastQ, searching } = state;
  $('resultsWrap').hidden = !results.length && !searching;
  if (searching && !results.length) {
    $('rTitle').textContent = 'Searching…';
    $('rSub').textContent = lastQ ? `${lastQ.area}, within ${lastQ.radius} mi` : '';
    $('results').innerHTML = '<div class="empty"><h3>Loading the business list…</h3></div>';
    $('more').hidden = true;
    return;
  }
  if (!results.length) return;
  const all = visibleResults(), rows = all.slice(0, state.shown);
  // check the websites of what's on screen, most promising first
  queueSites(rows.map((x) => x.p).filter((p) => p.website && !byPlace.get(p.placeId)?.site?.kind));
  const hot = all.filter((x) => x.a.level === 'Hot' && !x.saved).length;
  const checking = rows.filter((x) => x.a.pending).length;
  $('rTitle').textContent = lastQ.v === 'custom' ? `${all.length} matches for "${lastQ.what}"` : `${all.length} ${vOf(lastQ.v).label.toLowerCase()} businesses`;
  $('rSub').textContent = `within ${lastQ.radius} mi of ${lastQ.area} · best leads first · ${all.filter((x) => x.a.level === 'Hot').length} hot, ${all.filter((x) => x.a.level === 'Warm').length} warm` +
    (checking ? ` · checking ${checking} website${checking > 1 ? 's' : ''}…` : '') + (results.length > all.length ? ` · ${results.length - all.length} hidden` : '') +
    (lastQ.edge ? " · reaches past the list's area" : '');
  $('saveHot').disabled = !hot;
  $('saveHot').textContent = hot ? `Save ${hot} hot lead${hot > 1 ? 's' : ''}` : 'No unsaved hot leads';
  $('results').innerHTML = rows.length
    ? rows.map(({ p, a, saved }) => {
      const pipe = inPipeline(p), q = saved || p;
      const sigs = a.sig.filter((x) => x.pts || x.k === 'checking' || x.k === 'tool').sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts)).slice(0, 5);
      return `<div class="res${saved && !isOpen(saved) ? ' dim' : ''}" data-open="${esc(p.placeId)}">
        <div class="score ${a.level}" title="Fit score"><b>${a.score}</b><span>${a.level}</span></div>
        <div class="body"><button class="nm" type="button" data-open="${esc(p.placeId)}">${esc(p.name)}</button>
          <div class="meta">${[esc(p.btype || ''), p.dist != null ? p.dist.toFixed(1) + ' mi' : '', q.rating ? `${(+q.rating).toFixed(1)}★ (${q.reviews || 0})` : '', esc(p.short || p.address || '')].filter(Boolean).join(' · ')}</div>
          <div class="meta">${q.phone ? `<a href="tel:${esc(digits(q.phone))}">${esc(q.phone)}</a>` : 'No phone listed'} · ${safeUrl(q.website) ? esc(hostOf(q.website)) : 'No website found'}</div>
          <div class="sigs">${sigs.map((x) => `<span class="sig${x.k === 'checking' ? ' wait' : x.pts < 0 || x.k === 'tool' ? ' neg' : ''}">${esc(x.t)}</span>`).join('')}</div></div>
        <div class="acts">${pipe ? '<span class="chip acc">In pipeline</span>' : ''}${saved ? `<span class="chip ${saved.status === 'To contact' ? 'warn' : 'acc'}">${esc(saved.status)}</span>` : `<button class="btn sm primary" type="button" data-save="${esc(p.placeId)}">Save</button><button class="btn sm" type="button" data-skip="${esc(p.placeId)}">Not a fit</button>`}</div>
      </div>`;
    }).join('')
    : '<div class="empty"><h3>Everything here is hidden</h3>Untick the filters above to see them.</div>';
  const left = all.length - rows.length;
  $('more').hidden = left <= 0;
  $('more').textContent = `Show ${Math.min(PAGE, left)} more (${left} left)`;
}
