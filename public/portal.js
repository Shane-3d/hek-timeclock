// Employee portal logic (the login page at "/").
//
// After signing in, the employee always sees their own hours, plus any extra
// features the admin has granted them (permissions). Admin credentials on this
// same form redirect straight to the admin dashboard.
(function () {
  const $ = (id) => document.getElementById(id);
  let me = null; // { role, id, name, email, permissions }

  // ---- utils ----
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Auth-aware API helper. A 401 (session expired) bounces back to the login
  // gate; the login request itself surfaces its own error message.
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (res.status === 401 && path !== '/api/login') {
      showLogin();
      throw new Error('Please sign in.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  // Shared with the Quotes module (quotes.js), which loads right after this file.
  window.HEKAdmin = { api, esc, showLogin };

  const fmtDateTime = (iso) =>
    iso
      ? new Date(iso).toLocaleString([], {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : '—';

  // ---- auth / views ----
  function showLogin() {
    $('app').style.display = 'none';
    $('loginView').style.display = 'block';
  }
  function showApp() {
    $('loginView').style.display = 'none';
    $('app').style.display = 'block';
    applyPermissions();
    $('sideUser').textContent = me && me.name ? me.name : '';
    showTab('hours');
    loadMyHours().catch((e) => alert(e.message));
  }

  // Show/hide feature nav based on the granted permissions.
  function applyPermissions() {
    const perms = (me && me.permissions) || [];
    $('navQuotes').style.display = perms.includes('quotes') ? 'block' : 'none';
  }

  $('loginBtn').addEventListener('click', doLogin);
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  async function doLogin() {
    $('loginMsg').textContent = '';
    try {
      const r = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('email').value, password: $('pw').value }),
      });
      $('pw').value = '';
      if (r.role === 'admin') {
        window.location = r.redirect || '/';
        return;
      }
      me = r;
      showApp();
    } catch (e) {
      $('loginMsg').textContent = e.message;
    }
  }

  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    me = null;
    showLogin();
  });

  // ---- tabs ----
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.section').forEach((x) => x.classList.remove('active'));
    const tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.classList.add('active');
    const sec = $('tab-' + name);
    if (sec) sec.classList.add('active');
  }
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      showTab(t.dataset.tab);
      if (t.dataset.tab === 'hours') loadMyHours().catch((e) => alert(e.message));
      if (t.dataset.tab === 'schedule' && window.Schedule) window.Schedule.loadMine();
      if (t.dataset.tab === 'quotes' && window.Quotes) window.Quotes.load();
    });
  });

  // ---- my hours ----
  function buildQuery() {
    const p = new URLSearchParams();
    if ($('myFrom').value) p.set('from', $('myFrom').value);
    if ($('myTo').value) p.set('to', $('myTo').value);
    return p.toString();
  }

  async function loadMyHours() {
    const data = await api('/api/my/timesheet?' + buildQuery());
    $('myTotal').textContent = data.totalHours.toFixed(2);
    $('myEntries').textContent = data.entries.length;
    $('myEmpty').style.display = data.entries.length ? 'none' : 'block';
    $('myBody').innerHTML = data.entries
      .map(
        (r) => `<tr>
          <td>${fmtDateTime(r.clock_in)}</td>
          <td>${r.clock_out ? fmtDateTime(r.clock_out) : '<span class="badge on">on the clock</span>'}</td>
          <td>${r.hours != null ? r.hours.toFixed(2) : '—'}</td>
          <td>${r.work_done ? esc(r.work_done) : '<span style="color:var(--muted)">—</span>'}${
            r.missed_reason
              ? `<div style="font-size:12px;color:var(--red)">missed: ${esc(r.missed_reason)}</div>`
              : ''
          }</td>
        </tr>`
      )
      .join('');
  }

  $('myLoad').addEventListener('click', () => loadMyHours().catch((e) => alert(e.message)));

  // ---- boot: default date range = this week, then restore session ----
  (function initDates() {
    const now = new Date();
    const monday = new Date(now);
    const day = (now.getDay() + 6) % 7; // 0 = Monday
    monday.setDate(now.getDate() - day);
    const toStr = (d) => d.toISOString().slice(0, 10);
    $('myFrom').value = toStr(monday);
    $('myTo').value = toStr(now);
  })();

  api('/api/me')
    .then((d) => {
      if (d.role === 'admin') {
        window.location = d.redirect || '/';
        return;
      }
      if (d.role === 'employee') {
        me = d;
        showApp();
      } else {
        showLogin();
      }
    })
    .catch(showLogin);
})();
