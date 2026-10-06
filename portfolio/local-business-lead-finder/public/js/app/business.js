// One business, in a panel: why it's a lead, how to reach it, what happened on each call, its
// audit PDF and the hand-off to the pipeline. Also the audit downloads for the whole call list.
import { $, esc, digits, hostOf, safeUrl, nice, today, workdays, usPhone } from '../shared.js';
import { vOf } from '../verticals.js';
import { store } from '../store.js';
import { mapsSearch } from '../places.js';
import { findings, slim } from '../score.js';
import { auditInput, fileName, pdf } from '../audit.js';
import { byPlace, editing, inPipeline, queueSites, recheck, redraw, reindex, reindexPipe, score, setSave, siteCache, signoff, state, writeP } from './state.js';
import { listRows } from './call-list.js';

// What happened: [button, status it sets, next follow-up, style].
const TOUCHES = [
  ['No answer', 'No answer', () => workdays(1), 'no'],
  ['Left message', 'Left message', () => workdays(2), ''],
  ['Emailed', 'Emailed', () => workdays(3), ''],
  ['Visited', 'Visited', () => workdays(2), ''],
  ['Call back later', 'Follow up', () => workdays(5), ''],
  ['Interested!', 'Interested', () => workdays(1), 'yes'],
  ['Not interested', 'Not interested', () => '', 'no'],
  ['Not a fit', 'Not a fit', () => '', 'no'],
];
const STATUSES = ['To contact', 'No answer', 'Left message', 'Emailed', 'Visited', 'Follow up', 'Interested', 'Not interested', 'Not a fit', 'In pipeline'];

export const current = () => byPlace.get(state.openKey) || state.results.find((r) => r.placeId === state.openKey) || null;
export function openP(key) {
  state.openKey = key;
  $('pLayer').hidden = false;
  document.body.classList.add('locked');
  renderPanel();
  $('pBody').scrollTop = 0;
  $('pLayer').querySelector('[data-close="p"].btn').focus();
}
export function closeP() {
  flushNotes();
  $('pLayer').hidden = true;
  state.openKey = null;
  document.body.classList.remove('locked');
  redraw();
}

export function renderPanel() {
  const p = current();
  if (!p) return closeP();
  const saved = byPlace.get(p.placeId), V = vOf(p.vertical), a = score(p);
  const site = p.website ? (saved && saved.site && saved.site.kind ? saved.site : siteCache.get(p.website)) : null;
  $('pTitle').textContent = p.name;
  $('pSub').textContent = [p.btype || V.label, p.rating ? `${(+p.rating).toFixed(1)}★ (${p.reviews || 0} reviews)` : '', p.area].filter(Boolean).join(' · ');
  const emails = [...new Set([saved && saved.email, ...((site && site.emails) || [])].filter(Boolean))];
  const why = a.sig.filter((x) => x.k !== 'checking').sort((x, y) => y.pts - x.pts);
  // Google Maps links need no key: a search for the business, and directions to its address.
  const lookup = safeUrl(p.mapsUrl) || mapsSearch(p.name, p.address || p.area);
  const directions = p.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.name + ', ' + p.address)}` : '';
  $('pBody').innerHTML = `<div class="pad">
      ${saved ? '' : '<div class="topacts"><button class="btn primary" data-psave>Save to call list</button><button class="btn" data-pskip>Not a fit</button><span class="hint">Save it to log calls, set follow-ups and make its audit.</span></div>'}
      ${inPipeline(p) && !(saved && saved.requestId) ? '<div class="notice"><b>Heads up:</b> a business with this name or phone is already in the pipeline.</div>' : ''}
      <div class="grid2">
        <div class="card"><h3>Why they're a lead</h3>
          <div class="bigscore"><div class="score ${a.level}"><b>${a.score}</b><span>${a.level}</span></div><div class="hint">${a.pending ? 'Still checking their website…' : 'Fit score out of 100, from the map listing, their website, and anything you add from Google.'}</div></div>
          <ul class="why">${why.map((x) => `<li><span class="pts${x.pts < 0 ? ' neg' : ''}">${x.pts > 0 ? '+' + x.pts : x.pts || ''}</span><span>${esc(x.t)}</span></li>`).join('') || '<li><span></span><span class="muted">Nothing stands out. Probably a lower priority.</span></li>'}</ul>
          ${site && site.domain && site.domain.registered ? `<p class="hint">Domain: ${esc(site.domain.name)}${site.domain.registrar ? `, registered with ${esc(site.domain.registrar)}` : ''}${site.domain.expires ? `, expires ${esc(site.domain.expires)}` : ''}.</p>` : ''}
        </div>
        <div class="card"><h3>Contact</h3>
          <dl class="facts">
            <div><dt>Phone</dt><dd>${p.phone ? `<a href="tel:${esc(digits(p.phone))}">${esc(p.phone)}</a>` : '<span class="muted">Not on the map</span>'}</dd></div>
            <div><dt>Website</dt><dd>${safeUrl(p.website) ? `<a href="${esc(safeUrl(p.website))}" target="_blank" rel="noopener noreferrer">${esc(hostOf(p.website))}</a>${site && site.builder ? ` <span class="muted">(${esc(site.builder)})</span>` : ''}` : '<span class="muted">None found</span>'}</dd></div>
            <div><dt>Address</dt><dd>${esc(p.address || '—')}</dd></div>
            <div><dt>Google</dt><dd><a href="${esc(lookup)}" target="_blank" rel="noopener noreferrer">Look up on Google Maps</a>${directions ? ` · <a href="${esc(directions)}" target="_blank" rel="noopener noreferrer">Directions</a>` : ''}</dd></div>
          </dl>
          <div class="checkg">
            <div class="hint"><b>From Google Maps:</b> the map listing has no ratings. Open "Look up on Google Maps" and copy what you see; the score updates.</div>
            <div class="row2"><label class="f">Google rating<input data-g="rating" inputmode="decimal" placeholder="e.g. 4.4" value="${esc(p.rating ?? '')}" autocomplete="off"></label><label class="f">Reviews<input data-g="reviews" inputmode="numeric" placeholder="e.g. 37" value="${esc(p.reviews ?? '')}" autocomplete="off"></label></div>
            <div class="row2"><label class="f">Website<input data-g="website" inputmode="url" placeholder="None found" value="${esc(p.website || '')}" autocomplete="off"></label><label class="f">Phone<input data-g="phone" inputmode="tel" placeholder="Not on the map" value="${esc(p.phone || '')}" autocomplete="off"></label></div>
          </div>
          ${saved ? `<label class="f">Email${emails.length > 1 ? ` <span class="muted light">· also found: ${esc(emails.filter((e) => e !== saved.email).join(', '))}</span>` : ''}<input data-k="email" value="${esc(saved.email || '')}" placeholder="${emails[0] ? esc(emails[0]) : 'Not found on their site'}" autocomplete="off"></label>` : emails.length ? `<div class="hint">Email on their site: ${esc(emails.join(', '))}</div>` : ''}
        </div>
      </div>

      ${saved ? `<div class="card"><h3>Log what happened</h3>
        <div class="touches">${TOUCHES.map(([lab, , , cls]) => `<button data-touch="${esc(lab)}" class="${cls}">${esc(lab)}</button>`).join('')}</div>
        <div class="row2">
          <label class="f">Status<select data-k="status">${STATUSES.map((s) => `<option${s === saved.status ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label class="f">Next follow-up<input type="date" data-k="followUp" value="${esc(saved.followUp || '')}"></label>
        </div>
        <label class="f">Notes<textarea data-k="notes" placeholder="Owner's name, best time to call, what they said…">${esc(saved.notes || '')}</textarea></label>
        ${(saved.log || []).length ? `<ul class="loglist">${saved.log.slice().reverse().slice(0, 12).map((l) => `<li><b>${esc(l.t)}</b> · ${esc(nice(l.d))}</li>`).join('')}</ul>` : '<p class="hint">Tap what happened after each call or visit. It sets the status and the next follow-up for you.</p>'}
      </div>` : ''}

      ${saved ? `<div class="card"><h3>Audit to send or print</h3>
        <p class="hint">A two-page PDF for the owner: what we checked, what we found and how to fix it, and what we'd set up, signed with your details. Their website is checked again first, so it's current.</p>
        ${auditGaps(p)}
        <div class="topacts"><button class="btn primary" data-audit>Download audit (PDF)</button></div>
      </div>` : ''}
    </div>`;

  const nav = [];
  if (saved && saved.requestId) nav.push('<span class="chip acc">In the pipeline</span>');
  else if (saved) nav.push('<span class="confirm" id="bookBox"><button class="btn primary" data-book>Add to pipeline</button></span>');
  if (saved) nav.push('<span class="confirm" id="delBox"><button class="btn" data-del>Remove from list</button></span>');
  $('pNav').innerHTML = nav.join('');
  $('pNav').hidden = !saved; // nothing to do down here until it's on the list
}

// Notes and email save while typing (debounced) and when the field loses focus.
const timers = new Map();
function writeSoon(id, k, el) {
  clearTimeout(timers.get(k));
  setSave('Typing…');
  timers.set(k, setTimeout(() => {
    timers.delete(k);
    delete el.dataset.dirty;
    writeP(id, { [k]: el.value });
  }, 700));
}
export function flushNotes() {
  const p = current(), saved = p && byPlace.get(p.placeId);
  if (!saved) return;
  for (const [k, t] of timers) {
    clearTimeout(t);
    timers.delete(k);
  }
  document.querySelectorAll('#pBody [data-k]').forEach((el) => {
    if (el.dataset.dirty) {
      delete el.dataset.dirty;
      writeP(saved.id, { [el.dataset.k]: el.value });
    }
  });
}

function logTouch(saved, label) {
  const t = TOUCHES.find((x) => x[0] === label);
  if (!t) return;
  const log = [...(saved.log || []), { d: today(), t: label }].slice(-50);
  writeP(saved.id, { status: t[1], touches: (+saved.touches || 0) + 1, lastTouch: today(), followUp: t[2](), log });
  setSave(t[2]() ? `Logged. Next follow-up ${nice(t[2]())}.` : 'Logged.');
}

// Hand a lead over to the pipeline (supabase/schema.sql, requests), with what we found.
async function toPipeline(saved, auditDate) {
  const V = vOf(saved.vertical), a = score(saved);
  setSave('Adding to the pipeline…');
  try {
    const row = await store.add({
      business: saved.name, contact: [saved.phone, saved.email].filter(Boolean).join(' · '), website: saved.website || '',
      btype: V.label, source: 'Lead Finder', status: auditDate ? 'Audit booked' : 'Contacted', auditDate: auditDate || '',
      findings: findings(a).map((x) => x.find).join('\n'),
      notes: [saved.notes, `From Lead Finder: fit ${a.score}/100. ${saved.address || ''}${saved.mapsUrl ? '\n' + saved.mapsUrl : ''}`].filter(Boolean).join('\n\n'),
    });
    await writeP(saved.id, { status: 'In pipeline', requestId: row.id, followUp: '', log: [...(saved.log || []), { d: today(), t: auditDate ? `Audit booked for ${auditDate}` : 'Moved to the pipeline' }].slice(-50) });
    state.reqs.push(row);
    reindexPipe();
    setSave('Added to the pipeline');
    renderPanel();
  } catch {
    setSave('Could not add it to the pipeline. Try again.', true);
  }
}

// ---------------------------------------------------------------- the audit PDF

function auditGaps(p) {
  const gaps = [];
  if (!p.website) gaps.push("No website on file. If Google Maps shows one, add it above first, or the audit will say we couldn't find one.");
  if (p.reviews === null || p.reviews === undefined || p.reviews === '') gaps.push('Add their Google rating and reviews above to include them.');
  return gaps.length ? `<p class="hint warn">${esc(gaps.join(' '))}</p>` : '';
}
// The newest website check (this session's, else the one stored with the business) and your sign-off.
function auditOf(p) {
  const cached = p.website ? siteCache.get(p.website) : null;
  const site = !p.website ? null : cached && cached.kind && cached.kind !== 'error' ? cached : p.site && p.site.kind ? p.site : null;
  return auditInput(p, { site, from: signoff().split('\n').map((l) => l.trim()).filter(Boolean) });
}
export function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 10000);
}
const pdfBlob = (list) => new Blob([pdf(list.map(auditOf))], { type: 'application/pdf' });

async function downloadAudit(saved, btn) {
  btn.disabled = true;
  btn.textContent = saved.website ? 'Checking their website…' : 'Making the PDF…';
  flushNotes();
  try {
    if (saved.website) await recheck([saved]);
    const p = state.plist.find((x) => x.id === saved.id) || saved;
    saveFile(pdfBlob([p]), fileName(p.name));
    const log = p.log || [], last = log[log.length - 1];
    if (!last || last.t !== 'Audit downloaded' || last.d !== today()) writeP(p.id, { log: [...log, { d: today(), t: 'Audit downloaded' }].slice(-50) });
    setSave('Audit downloaded');
  } catch {
    setSave('Could not make the audit. Try again.', true);
  }
  if (state.openKey === saved.placeId && !editing()) renderPanel();
  else {
    btn.disabled = false;
    btn.textContent = 'Download audit (PDF)';
  }
}

// One PDF with an audit for each business on the call list as shown (box + search), for a day of
// visits. Websites not checked in the last week are checked first.
const AUDIT_MAX = 50;
export async function auditsPdf() {
  const btn = $('auditsBtn'), all = listRows().map((x) => x.p), rows = all.slice(0, AUDIT_MAX);
  if (!rows.length) return setSave('Nothing on this list to make audits for.', true);
  btn.disabled = true;
  try {
    const stale = rows.filter((p) => p.website && !(p.site && p.site.at && (new Date(today()) - new Date(p.site.at)) / 864e5 < 7));
    if (stale.length) {
      btn.textContent = `Checking ${stale.length} website${stale.length > 1 ? 's' : ''}…`;
      await recheck(stale);
    }
    btn.textContent = 'Making the PDF…';
    await new Promise((r) => setTimeout(r, 0)); // let the button repaint first
    saveFile(pdfBlob(rows.map((p) => state.plist.find((x) => x.id === p.id) || p)), `audits-${today()}.pdf`);
    setSave(`${rows.length} audit${rows.length > 1 ? 's' : ''} in one PDF${all.length > AUDIT_MAX ? ` (the first ${AUDIT_MAX} on this list)` : ''}`);
  } catch {
    setSave('Could not make the audits. Try again.', true);
  }
  btn.disabled = false;
  btn.textContent = 'Download audits (PDF)';
}

// ---------------------------------------------------------------- facts typed in from Google Maps

// Rating, reviews, website or phone, for a saved business or a search result.
function setFact(p, k, raw) {
  let v = String(raw || '').trim();
  if (k === 'rating') {
    const x = parseFloat(v.replace(',', '.'));
    v = v === '' ? '' : isFinite(x) && x >= 0 && x <= 5 ? Math.round(x * 10) / 10 : null;
  }
  if (k === 'reviews') {
    const x = parseInt(v.replace(/[^\d]/g, ''), 10);
    v = v === '' ? '' : isFinite(x) ? x : null;
  }
  if (k === 'website') v = v ? asUrl(v) || null : '';
  if (k === 'phone') v = v ? usPhone(v) : '';
  if (v === null) {
    setSave(k === 'website' ? "That doesn't look like a web address." : 'Use a number, like 4.4 or 37.', true);
    return renderPanel();
  }
  const saved = byPlace.get(p.placeId), patch = { [k]: v };
  if (k === 'website') patch.site = {}; // a new address gets a fresh check
  const r = state.results.find((x) => x.placeId === p.placeId);
  if (r) Object.assign(r, patch);
  if (saved) {
    const a = score({ ...saved, ...patch });
    writeP(saved.id, { ...patch, score: a.score, signals: slim(a) });
  } else Object.assign(p, patch);
  if (k === 'website' && v) queueSites([{ ...p, website: v }]);
  renderPanel();
  redraw();
}
// A typed website as a link ("example.com" → "http://example.com"); '' if it isn't one.
export const asUrl = (v) => {
  const u = String(v || '').split(';')[0].trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(u) ? 'http://' + u : '';
};

// ---------------------------------------------------------------- the panel's buttons and fields

export function wirePanel(saveResults) {
  $('pBody').addEventListener('click', (e) => {
    const p = current();
    if (!p) return;
    const saved = byPlace.get(p.placeId);
    if (e.target.closest('[data-psave]')) return saveResults([p]).then(renderPanel);
    if (e.target.closest('[data-pskip]')) return saveResults([p], { status: 'Not a fit' }).then(() => closeP());
    const t = e.target.closest('[data-touch]');
    if (t && saved) {
      flushNotes();
      logTouch(saved, t.dataset.touch);
      return renderPanel();
    }
    const au = e.target.closest('[data-audit]');
    if (au && saved) downloadAudit(saved, au);
  });
  $('pBody').addEventListener('change', (e) => {
    if (e.target.dataset.g && current()) return setFact(current(), e.target.dataset.g, e.target.value);
    const p = current(), saved = p && byPlace.get(p.placeId), k = e.target.dataset.k;
    if (!saved || !k) return;
    if (k === 'status' || k === 'followUp') {
      writeP(saved.id, { [k]: e.target.value });
      if (k === 'status') renderPanel();
    }
  });
  $('pBody').addEventListener('input', (e) => {
    const p = current(), saved = p && byPlace.get(p.placeId), el = e.target, k = el.dataset.k;
    if (saved && (k === 'notes' || k === 'email')) {
      el.dataset.dirty = '1';
      writeSoon(saved.id, k, el);
    }
  });
  $('pBody').addEventListener('focusout', (e) => {
    const p = current(), saved = p && byPlace.get(p.placeId), el = e.target, k = el.dataset.k;
    if (saved && (k === 'notes' || k === 'email') && el.dataset.dirty) {
      clearTimeout(timers.get(k));
      timers.delete(k);
      delete el.dataset.dirty;
      writeP(saved.id, { [k]: el.value });
    }
  });
  $('pNav').addEventListener('click', (e) => {
    const p = current(), saved = p && byPlace.get(p.placeId);
    if (!saved) return;
    if (e.target.closest('[data-book]')) {
      $('bookBox').innerHTML = '<label class="f inline">Audit date (optional)<input type="date" id="auditDate" class="in auto"></label><button class="btn primary" data-bookgo>Add to pipeline</button><button class="btn" data-bookno>Cancel</button>';
      return;
    }
    if (e.target.closest('[data-bookno]')) return renderPanel();
    if (e.target.closest('[data-bookgo]')) {
      flushNotes();
      e.target.closest('[data-bookgo]').disabled = true;
      return toPipeline(saved, $('auditDate').value);
    }
    if (e.target.closest('[data-del]')) {
      $('delBox').innerHTML = '<span>Remove this business from your list?</span><button class="btn" data-delno>Keep it</button><button class="btn danger" data-delyes>Remove</button>';
      return;
    }
    if (e.target.closest('[data-delno]')) return renderPanel();
    if (e.target.closest('[data-delyes]')) {
      const id = saved.id;
      state.plist = state.plist.filter((x) => x.id !== id);
      reindex();
      if (!state.results.find((r) => r.placeId === saved.placeId)) closeP();
      else renderPanel();
      store.prospects.remove(id).then(() => setSave('Removed from your list')).catch(() => setSave('Could not remove it. Reload and try again.', true));
    }
  });
}

