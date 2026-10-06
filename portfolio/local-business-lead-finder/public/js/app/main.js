// The Lead Finder page: wires the views together, plus "Add a business", "Your details" and sign-in.
import { REGION } from '../config.js';
import { $, esc, usPhone } from '../shared.js';
import { VERTICALS, vOf } from '../verticals.js';
import { store } from '../store.js';
import { mapsSearch } from '../places.js';
import { PAGE, defaultSignoff, prefs, queueSites, reindexPipe, saveResults, savePrefs, state, views } from './state.js';
import { fillAreaList, renderResults, renderSearch, runSearch, visibleResults } from './find.js';
import { csv, loadList, renderList } from './call-list.js';
import { asUrl, auditsPdf, closeP, openP, renderPanel, wirePanel } from './business.js';

Object.assign(views, { results: renderResults, list: renderList, panel: renderPanel });
const lock = () => document.body.classList.add('locked');
const unlock = () => {
  if ($('pLayer').hidden && $('meLayer').hidden && $('addLayer').hidden) document.body.classList.remove('locked');
};

// ---------------------------------------------------------------- views and search

document.querySelector('.views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  document.querySelectorAll('.views button').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-pressed', x === b);
  });
  $('findView').hidden = state.view !== 'find';
  $('listView').hidden = state.view !== 'list';
  if (state.view === 'list') renderList();
  else renderResults();
});
$('vchips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  state.V = vOf(b.dataset.v);
  prefs.v = state.V.k;
  savePrefs();
  renderSearch();
});
$('areas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-area]');
  if (!b) return;
  $('area').value = b.dataset.area;
  renderSearch();
  runSearch();
});
$('area').addEventListener('input', () => document.querySelectorAll('#areas button').forEach((b) => b.classList.toggle('on', b.dataset.area === $('area').value)));
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});
$('more').addEventListener('click', () => {
  state.shown += PAGE;
  renderResults();
});
$('radius').addEventListener('click', (e) => {
  const b = e.target.closest('[data-radius]');
  if (!b) return;
  prefs.radius = +b.dataset.radius;
  savePrefs();
  renderSearch();
  if (state.results.length) runSearch();
});
$('hideSkip').addEventListener('change', renderResults);
$('hideListed').addEventListener('change', renderResults);
$('saveHot').addEventListener('click', () => {
  const hot = visibleResults().filter((x) => x.a.level === 'Hot' && !x.saved).map((x) => x.p);
  if (hot.length) saveResults(hot).then(renderResults);
});

// A result or call list row: Save, Not a fit, or open it.
function listClick(e) {
  if (e.target.closest('a')) return;
  const s = e.target.closest('[data-save]');
  if (s) {
    const p = state.results.find((r) => r.placeId === s.dataset.save);
    if (p) saveResults([p]).then(renderResults);
    return;
  }
  const k = e.target.closest('[data-skip]');
  if (k) {
    const p = state.results.find((r) => r.placeId === k.dataset.skip);
    if (p) saveResults([p], { status: 'Not a fit' }).then(renderResults);
    return;
  }
  const o = e.target.closest('[data-open]');
  if (o) openP(o.dataset.open);
}
$('results').addEventListener('click', listClick);
$('plist').addEventListener('click', listClick);
$('board').addEventListener('click', (e) => {
  const b = e.target.closest('[data-w]');
  if (!b) return;
  state.lfilter = state.lfilter === b.dataset.w ? '' : b.dataset.w;
  renderList();
});
$('lsearch').addEventListener('input', renderList);
$('csv').addEventListener('click', csv);
$('auditsBtn').addEventListener('click', auditsPdf);
wirePanel(saveResults);

// ---------------------------------------------------------------- dialogs

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (!c) return;
  if (c.dataset.close === 'p') closeP();
  else if (c.dataset.close === 'add') closeAdd();
  else closeMe();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('addLayer').hidden) closeAdd();
  else if (!$('meLayer').hidden) closeMe();
  else if (!$('pLayer').hidden) closeP();
});

// Add a business by hand (one found on Google Maps, driven past, or heard about).
function openAdd() {
  ['n-name', 'n-phone', 'n-web', 'n-addr', 'n-rating', 'n-reviews'].forEach((id) => {
    $(id).value = '';
  });
  $('n-v').innerHTML = VERTICALS.map((v) => `<option value="${esc(v.k)}"${v.k === state.V.k ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  $('n-err').hidden = true;
  $('addLayer').hidden = false;
  lock();
  setTimeout(() => {
    if (!$('addLayer').contains(document.activeElement)) $('n-name').focus();
  }, 30);
}
function closeAdd() {
  $('addLayer').hidden = true;
  unlock();
}
async function saveAdd() {
  const name = $('n-name').value.trim();
  if (!name) {
    $('n-err').hidden = false;
    $('n-name').focus();
    return;
  }
  const num = (v, max) => {
    const x = parseFloat(String(v).replace(',', '.'));
    return isFinite(x) && x >= 0 && x <= max ? x : '';
  };
  const address = $('n-addr').value.trim(), v = $('n-v').value, reviews = num($('n-reviews').value, 1e7);
  const p = {
    placeId: 'manual:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name, vertical: v, btype: vOf(v).label, phone: usPhone($('n-phone').value), website: asUrl($('n-web').value),
    address, area: '', mapsUrl: mapsSearch(name, address),
    rating: num($('n-rating').value, 5), reviews: reviews === '' ? '' : Math.round(reviews),
  };
  $('n-save').disabled = true;
  const saved = await saveResults([p]);
  $('n-save').disabled = false;
  if (!saved.length) return;
  closeAdd();
  if (p.website) queueSites([p]);
  document.querySelector('[data-view="list"]').click();
  openP(p.placeId);
}
$('addBtn').addEventListener('click', openAdd);
$('n-save').addEventListener('click', saveAdd);

// Your details: the sign-off on audits. Saved on this device only.
function openMe() {
  $('me-name').value = prefs.me || '';
  $('me-sign').value = prefs.sign || '';
  $('me-sign').placeholder = defaultSignoff();
  $('meLayer').hidden = false;
  lock();
  setTimeout(() => {
    if (!$('meLayer').contains(document.activeElement)) $('me-name').focus();
  }, 30);
}
function closeMe() {
  prefs.me = $('me-name').value.trim();
  prefs.sign = $('me-sign').value.trim();
  savePrefs();
  $('meLayer').hidden = true;
  unlock();
  if (!$('pLayer').hidden) renderPanel();
}
$('meBtn').addEventListener('click', openMe);

// ---------------------------------------------------------------- sign-in (live mode: the team's dashboard code)

let started = false;
function showApp() {
  $('loginView').hidden = true;
  $('app').hidden = false;
  if (started) return;
  started = true;
  $('area').value = prefs.area || `${REGION.defaultArea}, ${REGION.state}`;
  renderSearch();
  fillAreaList();
  loadList();
  store.watch((rows) => {
    state.reqs = rows;
    reindexPipe();
    if (state.view === 'find') renderResults();
  }, () => {});
  if (!store.live) runSearch(); // the demo opens on a search
}
function showLogin() {
  if (!$('pLayer').hidden) closeP();
  $('app').hidden = true;
  $('loginView').hidden = false;
}
$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('l-code').value.trim(), msg = $('l-msg'), btn = $('l-send');
  if (!code) {
    msg.textContent = 'Enter the dashboard code.';
    msg.hidden = false;
    return;
  }
  msg.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  store.signIn(code)
    .then(() => {
      $('l-code').value = '';
    })
    .catch(() => {
      msg.textContent = "That code didn't work. Check it and try again.";
      msg.hidden = false;
    })
    .then(() => {
      btn.disabled = false;
      btn.textContent = 'Open';
    });
});

if (store.live) {
  $('signOut').addEventListener('click', () => store.signOut());
} else {
  // the demo has no sign-in: the button starts it over instead
  $('demoBanner').hidden = false;
  $('signOut').textContent = 'Reset demo';
  $('signOut').addEventListener('click', () => {
    store.reset();
    try {
      localStorage.removeItem('lf-prefs');
    } catch {
      // nothing stored
    }
    location.reload();
  });
}
store.onAuth((who) => {
  if (who) showApp();
  else {
    if (started) location.reload();
    showLogin();
  }
});
