// Shared data layer for the website form (plan.html) and the team dashboard (/dashboard).
// Live mode talks to Supabase. Demo mode (no keys in fc-config.js) keeps everything in this browser.
(function () {
  var cfg = window.FC_CONFIG || {};
  var live = !!(cfg.supabaseUrl && cfg.supabaseKey);
  // Served from this site (public/vendor/) so the CSP never has to trust a third-party script host.
  var SB_JS = '/vendor/supabase-js-2.117.2/supabase.js';
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

  // ------------------------------------------------------------------ live mode (Supabase)
  var sbPromise = null;
  function sb() {
    if (!sbPromise) sbPromise = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = SB_JS;
      s.onload = function () { res(window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey)); };
      s.onerror = function () { rej(new Error('Could not load the database library.')); };
      document.head.appendChild(s);
    });
    return sbPromise;
  }
  function ok(res) { if (res.error) throw res.error; return res.data; }
  var liveStore = {
    // Plain request with the public key: visitors can only add a row, never read one back.
    submit: function (req) {
      return fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/requests', {
        method: 'POST',
        headers: { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + cfg.supabaseKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(toDb(customerFields(req)))
      }).then(function (r) { if (!r.ok) throw new Error('Request failed (' + r.status + ')'); });
    },
    onAuth: function (cb) {
      sb().then(function (c) {
        c.auth.getSession().then(function (r) { cb(r.data && r.data.session ? r.data.session.user.email : null); });
        c.auth.onAuthStateChange(function (_e, session) { cb(session ? session.user.email : null); });
      }).catch(function () { cb(null); });
    },
    signIn: function (email) {
      return sb().then(function (c) { return c.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } }); }).then(ok);
    },
    signOut: function () { return sb().then(function (c) { return c.auth.signOut(); }); },
    watch: function (cb, onErr) {
      sb().then(function (c) {
        function load() { c.from('requests').select('*').order('created_at', { ascending: false }).then(function (r) { if (r.error) { if (onErr) onErr(r.error); return; } cb(r.data.map(fromDb)); }); }
        load();
        c.channel('requests-feed').on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, load).subscribe();
        setInterval(load, 60000); // safety net if the live feed drops
      }).catch(function (e) { if (onErr) onErr(e); });
    },
    add: function (row) { return sb().then(function (c) { return c.from('requests').insert(toDb(row)).select().single(); }).then(ok).then(fromDb); },
    update: function (id, patch) { return sb().then(function (c) { return c.from('requests').update(toDb(patch)).eq('id', id); }).then(ok); },
    remove: function (id) { return sb().then(function (c) { return c.from('requests').delete().eq('id', id); }).then(ok); }
  };

  window.FCStore = live ? liveStore : demo;
  window.FCStore.live = live;
})();
