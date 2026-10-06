// Shared data layer for the website form (plan.html) and the team dashboard (/dashboard).
// Live mode talks to Supabase. Demo mode (no keys in fc-config.js) keeps everything in this browser.
(function () {
  var cfg = window.FC_CONFIG || {};
  var live = !!(cfg.supabaseUrl && cfg.supabaseKey);
  var MAP = { createdAt: 'created_at', updatedAt: 'updated_at', emailedDate: 'emailed_date', auditDate: 'audit_date', buildTime: 'build_time', hoursSaved: 'hours_saved', estShown: 'est_shown' };
  var BACK = {}; Object.keys(MAP).forEach(function (k) { BACK[MAP[k]] = k; });

  function toDb(o) {
    var r = {};
    Object.keys(o).forEach(function (k) {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
      var v = o[k];
      if (k === 'emailed') v = v === 'Yes';
      if ((k === 'emailedDate' || k === 'auditDate') && !v) v = null;
      r[MAP[k] || k] = v;
    });
    return r;
  }
  function fromDb(row) {
    var o = {};
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (k === 'emailed') v = v ? 'Yes' : 'No';
      else if (v === null) v = '';
      o[BACK[k] || k] = v;
    });
    if (!o.scope || typeof o.scope !== 'object') o.scope = {};
    return o;
  }
  // what a website visitor is allowed to send
  function customerFields(req) {
    return { name: req.name || '', business: req.business || '', contact: req.contact || '', website: req.website || '', app: req.app || '', needs: req.needs || '', scope: req.scope || {}, estShown: req.estShown || '' };
  }

  // ------------------------------------------------------------------ demo mode
  var mem; try { mem = window.parent.__fcMem || (window.parent.__fcMem = {}); } catch (e) { mem = {}; }
  function get(k) { try { var v = localStorage.getItem(k); if (v !== null) return v; } catch (e) {} return k in mem ? mem[k] : null; }
  function set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }
  var RKEY = 'fc-demo-requests', UKEY = 'fc-demo-user';
  function rows() { try { return JSON.parse(get(RKEY) || '[]'); } catch (e) { return []; } }
  var watchers = [], authers = [], lastSeen = null, lastUser;
  function notify() { lastSeen = get(RKEY); var r = rows(); watchers.forEach(function (w) { w(r); }); }
  function save(r) { set(RKEY, JSON.stringify(r)); notify(); }
  function poll() {
    if (watchers.length && get(RKEY) !== lastSeen) notify();
    var u = get(UKEY); if (authers.length && u !== lastUser) { lastUser = u; authers.forEach(function (a) { a(u); }); }
  }
  var demo = {
    submit: function (req) {
      var r = rows(), now = new Date().toISOString();
      r.push(Object.assign(customerFields(req), { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), source: 'Website form', status: 'New', emailed: 'No', createdAt: now, updatedAt: now }));
      save(r); return Promise.resolve();
    },
    onAuth: function (cb) { authers.push(cb); lastUser = get(UKEY); cb(lastUser); if (authers.length === 1) setInterval(poll, 700); },
    signIn: function () { return Promise.resolve({ demo: true }); },
    demoConfirm: function (email) { set(UKEY, email); poll(); },
    signOut: function () { del(UKEY); poll(); return Promise.resolve(); },
    watch: function (cb) { watchers.push(cb); notify(); if (watchers.length === 1) { window.addEventListener('storage', function (e) { if (e.key === RKEY) notify(); }); if (!authers.length) setInterval(poll, 700); } },
    add: function (row) {
      var r = rows(), now = new Date().toISOString();
      var n = Object.assign({}, row, { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: now, updatedAt: now });
      r.push(n); save(r); return Promise.resolve(n);
    },
    update: function (id, patch) {
      var r = rows(), x = r.filter(function (q) { return q.id === id; })[0];
      if (!x) return Promise.reject(new Error('not found'));
      Object.assign(x, patch, { updatedAt: new Date().toISOString() }); save(r); return Promise.resolve();
    },
    remove: function (id) { save(rows().filter(function (q) { return q.id !== id; })); return Promise.resolve(); }
  };

  // ------------------------------------------------------------------ lead finder: shared bits
  // Prospects (the Lead Finder's outreach list, /dashboard/leads.html) are snake_case in the
  // database and camelCase here. Empty dates and numbers go to the database as null.
  function camel(k) { return k.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); }); }
  function snake(k) { return k.replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); }); }
  var P_NULLS = { last_touch: 1, follow_up: 1, request_id: 1, rating: 1, reviews: 1 };
  function pToDb(o) {
    var r = {};
    Object.keys(o).forEach(function (k) {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return;
      var s = snake(k), v = o[k];
      if (P_NULLS[s] && (v === '' || v === undefined)) v = null;
      r[s] = v;
    });
    return r;
  }
  function pFromDb(row) {
    var o = {};
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (v === null && k !== 'rating' && k !== 'reviews') v = '';
      if (k === 'rating' && v !== null) v = Number(v);
      o[camel(k)] = v;
    });
    return o;
  }
  // What a new search may refresh on a business already on the list. Status, notes,
  // follow-up and history belong to the team and are never overwritten.
  var P_FACTS = ['name', 'btype', 'address', 'phone', 'website', 'mapsUrl', 'links', 'rating', 'reviews', 'hours', 'site', 'score', 'signals'];
  var P_IF_EMPTY = ['vertical', 'area', 'email'];

  // demo mode: the outreach list stays in this browser
  var PKEY = 'fc-demo-prospects';
  function prows() { try { return JSON.parse(get(PKEY) || '[]'); } catch (e) { return []; } }
  function psave(r) { set(PKEY, JSON.stringify(r)); }
  function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  demo.prospects = {
    list: function () { return Promise.resolve(prows()); },
    save: function (list) {
      var all = prows(), now = new Date().toISOString(), out = [];
      list.forEach(function (n) {
        if (!n.placeId) return;
        var x = all.filter(function (q) { return q.placeId === n.placeId; })[0];
        if (x) {
          P_FACTS.forEach(function (k) { if (k in n) x[k] = n[k]; });
          P_IF_EMPTY.forEach(function (k) { if (!x[k] && n[k]) x[k] = n[k]; });
          x.updatedAt = now;
        } else {
          x = Object.assign({ status: 'To contact', touches: 0, notes: '', log: [], email: '', lastTouch: '', followUp: '', requestId: '', site: {}, signals: [] }, n, { id: newId(), createdAt: now, updatedAt: now });
          all.push(x);
        }
        out.push(JSON.parse(JSON.stringify(x)));
      });
      psave(all); return Promise.resolve(out);
    },
    update: function (id, patch) {
      var all = prows(), x = all.filter(function (q) { return q.id === id; })[0];
      if (!x) return Promise.reject(new Error('not found'));
      Object.assign(x, patch, { updatedAt: new Date().toISOString() }); psave(all); return Promise.resolve();
    },
    remove: function (id) { psave(prows().filter(function (q) { return q.id !== id; })); return Promise.resolve(); }
  };
  // Searching Google needs the live site (the key lives in Cloudflare), so demo mode says so.
  demo.leads = function () { var e = new Error('demo mode'); e.error = 'demo'; return Promise.reject(e); };

  // ------------------------------------------------------------------ live mode (Supabase)
  // The dashboard opens with a code, checked by the database (see supabase/dashboard_code.sql).
  // The public key alone can only add a request; reading or editing needs the code.
  var BASE = (cfg.supabaseUrl || '').replace(/\/$/, '');
  var HEADERS = { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + cfg.supabaseKey, 'Content-Type': 'application/json' };
  var CKEY = 'fc-dashboard-code';
  function getCode() { try { return localStorage.getItem(CKEY); } catch (e) { return mem[CKEY] || null; } }
  function setCode(c) { mem[CKEY] = c; try { localStorage.setItem(CKEY, c); } catch (e) {} }
  function clearCode() { delete mem[CKEY]; try { localStorage.removeItem(CKEY); } catch (e) {} }
  function rpc(fn, args) {
    return fetch(BASE + '/rest/v1/rpc/' + fn, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) })
      .then(function (r) {
        if (!r.ok) { var e = new Error('Request failed (' + r.status + ')'); e.status = r.status; throw e; }
        return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
      });
  }
  var codeWatchers = [];
  function tellAuth(who) { codeWatchers.forEach(function (cb) { cb(who); }); }
  var TEAM = 'Team';
  var liveStore = {
    // Plain request with the public key: visitors can only add a row, never read one back.
    submit: function (req) {
      return fetch(BASE + '/rest/v1/requests', {
        method: 'POST',
        headers: { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + cfg.supabaseKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(toDb(customerFields(req)))
      }).then(function (r) { if (!r.ok) throw new Error('Request failed (' + r.status + ')'); });
    },
    onAuth: function (cb) {
      codeWatchers.push(cb);
      var c = getCode(); if (!c) { cb(null); return; }
      rpc('dashboard_check', { code: c }).then(function (ok) { if (!ok) clearCode(); cb(ok ? TEAM : null); }, function () { cb(null); });
    },
    // "Sign in" = check the code; on success it is remembered on this device.
    signIn: function (code) {
      return rpc('dashboard_check', { code: code }).then(function (ok) {
        if (!ok) throw new Error('wrong code');
        setCode(code); tellAuth(TEAM); return {};
      });
    },
    signOut: function () { clearCode(); tellAuth(null); return Promise.resolve(); },
    watch: function (cb, onErr) {
      function load() {
        var c = getCode(); if (!c) return;
        rpc('dashboard_rows', { code: c }).then(function (rows) { cb((rows || []).map(fromDb)); }, function (e) {
          if (e.status === 401 || e.status === 403) { clearCode(); tellAuth(null); return; } // code was changed
          if (onErr) onErr(e);
        });
      }
      load();
      setInterval(load, 10000); // new requests show up within 10 seconds
    },
    add: function (row) { return rpc('dashboard_add', { code: getCode(), new_row: toDb(row) }).then(fromDb); },
    update: function (id, patch) { return rpc('dashboard_update', { code: getCode(), row_id: id, patch: toDb(patch) }); },
    remove: function (id) { return rpc('dashboard_delete', { code: getCode(), row_id: id }); },

    // Lead Finder outreach list (supabase/prospects.sql). A 404 means that file hasn't been run yet.
    prospects: {
      list: function () { return rpc('prospects_rows', { code: getCode() }).then(function (r) { return (r || []).map(pFromDb); }); },
      save: function (list) { return rpc('prospects_save', { code: getCode(), new_rows: list.map(pToDb) }).then(function (r) { return (r || []).map(pFromDb); }); },
      update: function (id, patch) { return rpc('prospects_update', { code: getCode(), row_id: id, patch: pToDb(patch) }); },
      remove: function (id) { return rpc('prospects_delete', { code: getCode(), row_id: id }); }
    },
    // Google search and website checks run in functions/api/prospects.js, which holds the key.
    leads: function (body) {
      return fetch('/api/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, body, { code: getCode() })) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.ok) return j;
            var e = new Error(j.message || j.error || 'Request failed (' + r.status + ')');
            e.status = r.status; e.error = j.error || ''; e.reason = j.reason || ''; e.detail = j.message || '';
            throw e;
          });
        });
    }
  };

  window.FCStore = live ? liveStore : demo;
  window.FCStore.live = live;
})();
