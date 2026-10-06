// The Call list view: saved businesses, by what to do next, with follow-ups and a CSV export.
import { $, digits, esc, nice, norm, today } from '../shared.js';
import { vOf } from '../verticals.js';
import { store } from '../store.js';
import { findings } from '../score.js';
import { isOpen, queueSites, redraw, reindex, score, setSave, state } from './state.js';
import { saveFile } from './business.js';

const due = (p) => isOpen(p) && p.followUp && p.followUp <= today();
// The boxes along the top: [key, label, which businesses, what it means].
const LW = [
  ['', 'Open leads', (p) => isOpen(p), 'Everyone still in play'],
  ['due', 'Due today', due, 'Follow-ups to do now'],
  ['new', 'To call', (p) => p.status === 'To contact', 'Not contacted yet'],
  ['working', 'In progress', (p) => ['No answer', 'Left message', 'Emailed', 'Visited', 'Follow up'].includes(p.status), 'Reached out, no answer yet'],
  ['hot', 'Interested', (p) => p.status === 'Interested', 'Ready for the pipeline'],
  ['done', 'Closed', (p) => !isOpen(p), 'In pipeline, no, or not a fit'],
];

function renderBoard() {
  $('board').innerHTML = LW.map(([k, lab, fn, sub]) => `<button class="w ${k === 'due' ? 'due' : k === 'hot' ? 'hot' : ''}${state.lfilter === k ? ' on' : ''}" data-w="${k}" aria-pressed="${state.lfilter === k}"><span class="lab">${lab}</span><b>${state.listLoaded ? state.plist.filter(fn).length : '–'}</b><span class="sub">${sub}</span></button>`).join('');
}
function followText(p) {
  if (!isOpen(p) || !p.followUp) return '';
  const days = Math.round((new Date(p.followUp + 'T12:00') - new Date(today() + 'T12:00')) / 864e5);
  return days < 0 ? `<span class="chip bad">Overdue ${-days}d</span>` : days === 0 ? '<span class="chip warn">Due today</span>' : `<span class="chip">Next: ${esc(nice(p.followUp))}</span>`;
}

// The call list as shown: the picked box, the search, due first, then by follow-up date and score.
export function listRows() {
  const w = LW.find((x) => x[0] === state.lfilter) || LW[0], q = norm($('lsearch').value);
  const when = (p) => p.followUp || '9'; // no date sorts last
  return state.plist
    .filter(w[2])
    .filter((p) => !q || norm([p.name, p.phone, p.area, p.notes, p.email].join(' ')).includes(q))
    .map((p) => ({ p, a: score(p) }))
    .sort((x, y) => due(y.p) - due(x.p) || (when(x.p) < when(y.p) ? -1 : when(x.p) > when(y.p) ? 1 : 0) || y.a.score - x.a.score);
}

export function renderList() {
  renderBoard();
  renderListNotice();
  if (!state.listLoaded) {
    $('plist').innerHTML = '<div class="empty"><h3>Loading your call list…</h3></div>';
    return;
  }
  const rows = listRows();
  if (!rows.length) {
    $('plist').innerHTML = state.plist.length
      ? '<div class="empty"><h3>Nothing here right now</h3>Pick another box above.</div>'
      : '<div class="empty"><h3>Your call list is empty</h3>Find businesses, then tap <b>Save</b> on the ones worth a call.</div>';
    return;
  }
  $('plist').innerHTML = rows.map(({ p, a }) => `<div class="res${isOpen(p) ? '' : ' dim'}" data-open="${esc(p.placeId)}">
      <div class="score ${a.level}"><b>${a.score}</b><span>${a.level}</span></div>
      <div class="body"><button class="nm" type="button" data-open="${esc(p.placeId)}">${esc(p.name)}</button>
        <div class="meta">${esc(vOf(p.vertical).label)} · ${esc(p.area || p.address || '')}${p.touches ? ` · ${p.touches} touch${p.touches > 1 ? 'es' : ''}, last ${esc(nice(p.lastTouch))}` : ''}</div>
        <div class="meta">${p.phone ? `<a href="tel:${esc(digits(p.phone))}">${esc(p.phone)}</a>` : 'No phone'}${p.email ? ' · ' + esc(p.email) : ''}</div>
        ${p.notes ? `<div class="meta clip">${esc(p.notes.split('\n')[0])}</div>` : ''}</div>
      <div class="acts"><span class="chip ${p.status === 'Interested' ? 'good' : p.status === 'In pipeline' ? 'acc' : p.status === 'To contact' ? 'warn' : ''}">${esc(p.status)}</span>${followText(p)}</div>
    </div>`).join('');
}

function renderListNotice() {
  $('listNotice').innerHTML = state.listMissing
    ? '<div class="notice spaced"><h3>Turn on the call list</h3><p>Run <code>supabase/prospects.sql</code> in Supabase &gt; SQL Editor (after the other two SQL files), then reload this page. Searching works without it, but nothing can be saved.</p></div>'
    : '';
}

export function loadList() {
  store.prospects.list().then(
    (rows) => {
      Object.assign(state, { plist: rows, listLoaded: true, listMissing: false });
      reindex();
      queueSites(state.plist.filter((p) => p.website && !(p.site && p.site.kind)));
    },
    (e) => {
      if (e.status === 401 || e.status === 403) return store.signOut();
      state.listLoaded = true;
      state.listMissing = e.status === 404;
      if (!state.listMissing) setSave('Could not load your call list. Reload the page.', true);
    },
  ).then(redraw);
}

// The whole call list as a spreadsheet (UTF-8 with a byte-order mark, so Excel reads accents).
export function csv() {
  const cols = [['Business', (p) => p.name], ['Type', (p) => vOf(p.vertical).label], ['Fit score', (p) => score(p).score], ['Status', (p) => p.status], ['Phone', (p) => p.phone],
    ['Email', (p) => p.email], ['Website', (p) => p.website], ['Address', (p) => p.address], ['Rating', (p) => p.rating ?? ''], ['Reviews', (p) => p.reviews ?? ''],
    ['Next follow-up', (p) => p.followUp], ['Last touch', (p) => p.lastTouch], ['Touches', (p) => p.touches], ['What we found', (p) => findings(score(p)).map((x) => x.find).join(' | ')],
    ['Notes', (p) => p.notes], ['Google Maps', (p) => p.mapsUrl]];
  const cell = (v) => {
    let s = String(v ?? '');
    // Names and notes come from the web: a cell starting with = + - or @ would run as a spreadsheet formula.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = [cols.map((c) => c[0]).join(','), ...state.plist.map((p) => cols.map((c) => cell(c[1](p))).join(','))].join('\r\n');
  saveFile(new Blob(['﻿' + text], { type: 'text/csv' }), `call-list-${today()}.csv`);
}
