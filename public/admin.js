// Admin dashboard logic.
(function () {
  const $ = (id) => document.getElementById(id);
  let employees = [];
  let liveTimer = null;
  let isDev = false; // the limited-admin "dev" account (no clock-in features)
  let currentFeatures = null; // which paid features the dev has enabled for the client

  // ---- API helper ----
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    // A 401 on a normal request means the session expired — bounce to login.
    // The login request itself is allowed to surface its own error message.
    if (res.status === 401 && path !== '/api/admin/login') {
      showLogin();
      throw new Error('Please sign in.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  // ---- Date helpers ----
  const fmt = (iso, opts) =>
    iso ? new Date(iso).toLocaleString([], opts) : '';
  const fmtDateTime = (iso) =>
    iso
      ? new Date(iso).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  // Convert an ISO string to the value a datetime-local input expects (local tz).
  function isoToLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d - off).toISOString().slice(0, 16);
  }
  // datetime-local value -> ISO (treated as local time).
  const localInputToIso = (v) => (v ? new Date(v).toISOString() : null);

  // ---- Auth ----
  function showLogin() {
    if (liveTimer) clearInterval(liveTimer);
    // Admins sign in on the main page ("/") now — send visitors without a valid
    // admin session there rather than showing a second login form here.
    window.location.replace('/');
  }
  function showApp() {
    $('loginView').style.display = 'none';
    $('app').style.display = 'block';
    loadPermissions();
    loadEmployees();
    if (isDev) applyDevRestrictions();
    else {
      applyEntitlements(currentFeatures);
      showLive();
    }
  }

  // Show/hide a sidebar tab (and drop its "active" if we're hiding it).
  function setTabVisible(name, visible) {
    const tab = document.querySelector('.side-nav .tab[data-tab="' + name + '"]');
    if (tab) tab.style.display = visible ? '' : 'none';
    if (!visible) {
      const sec = $('tab-' + name);
      if (sec) sec.classList.remove('active');
    }
  }

  // For the real admin: hide any paid feature the dev has switched off.
  function applyEntitlements(features) {
    if (!features) return;
    ['quotes', 'schedule', 'pricing'].forEach((key) => {
      if (features[key] === false) setTabVisible(key, false);
    });
  }

  // The "dev" account is a limited admin: hide the clock-in features it can't use,
  // and reveal the "Client access" panel where it controls the client's features.
  function applyDevRestrictions() {
    if (liveTimer) clearInterval(liveTimer);
    ['live', 'sheets'].forEach((t) => setTabVisible(t, false));
    const devTab = $('devAccessTab');
    if (devTab) devTab.style.display = '';
    // Dev can't change the admin's own login — hide that editor.
    ['acEmail', 'acPass', 'acSave', 'acMsg'].forEach((id) => {
      const el = $(id);
      if (el) el.style.display = 'none';
    });
    const acLabel = [...document.querySelectorAll('.menu-label')].find((l) =>
      /admin login/i.test(l.textContent)
    );
    if (acLabel) acLabel.style.display = 'none';
    // Label the signed-in account and open the first available tab.
    const ue = $('userEmail');
    if (ue) ue.textContent = 'dev';
    const av = $('userAvatar');
    if (av) av.textContent = 'D';
    const firstTab = [...document.querySelectorAll('.side-nav .tab')].find(
      (t) => t.style.display !== 'none'
    );
    if (firstTab) firstTab.click();
  }

  // ---- Client access (dev only): toggle which features the client can use ----
  async function loadDevFeatures() {
    const d = await api('/api/dev/features');
    $('featMsg').textContent = '';
    $('featureToggles').innerHTML = d.features
      .map(
        (f) => `<label class="feature-row">
          <span>${esc(f.label)}</span>
          <input type="checkbox" data-feat="${f.key}" ${f.enabled ? 'checked' : ''} />
        </label>`
      )
      .join('');
  }
  const featEl = $('featureToggles');
  if (featEl) {
    featEl.addEventListener('change', async (e) => {
      const cb = e.target.closest('input[data-feat]');
      if (!cb) return;
      try {
        await api('/api/dev/features', {
          method: 'PATCH',
          body: JSON.stringify({ [cb.dataset.feat]: cb.checked }),
        });
        $('featMsg').className = 'msg ok';
        $('featMsg').textContent = 'Saved.';
      } catch (err) {
        cb.checked = !cb.checked; // revert on failure
        $('featMsg').className = 'msg err';
        $('featMsg').textContent = err.message;
      }
    });
  }

  $('loginBtn').addEventListener('click', doLogin);
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  async function doLogin() {
    $('loginMsg').textContent = '';
    try {
      const r = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('email').value, password: $('pw').value }),
      });
      $('pw').value = '';
      isDev = !!(r && r.role === 'dev');
      const me = await api('/api/admin/me').catch(() => ({}));
      currentFeatures = me.features || null;
      showApp();
    } catch (e) {
      $('loginMsg').textContent = e.message;
    }
  }
  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  // ---- Mobile popout menu ----
  function setMenu(open) {
    $('sidebar').classList.toggle('open', open);
    $('sidebarBackdrop').classList.toggle('open', open);
    $('menuToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $('menuToggle').addEventListener('click', () =>
    setMenu(!$('sidebar').classList.contains('open'))
  );
  $('sidebarBackdrop').addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  // ---- Tabs ----
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.section').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $('tab-' + t.dataset.tab).classList.add('active');
      if (t.dataset.tab === 'live') showLive();
      if (t.dataset.tab === 'employees') loadEmployees();
      if (t.dataset.tab === 'sheets') loadTimesheet().catch((e) => alert(e.message));
      if (t.dataset.tab === 'quotes' && window.Quotes) window.Quotes.load();
      if (t.dataset.tab === 'schedule' && window.Schedule)
        window.Schedule.loadAdmin().catch((e) => alert(e.message));
      if (t.dataset.tab === 'access') loadDevFeatures().catch((e) => alert(e.message));
      setMenu(false); // close the popout after choosing a tab
    });
  });

  // ---- Live view ----
  function showLive() {
    refreshLive();
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(refreshLive, 30000);
  }
  function elapsed(iso) {
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  async function refreshLive() {
    try {
      const rows = await api('/api/admin/active');
      $('liveCount').textContent = rows.length;
      $('liveEmpty').style.display = rows.length ? 'none' : 'block';
      $('liveBody').innerHTML = rows
        .map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td>${fmtDateTime(r.clock_in)}</td>
             <td><span class="badge on">${elapsed(r.clock_in)}</span></td></tr>`
        )
        .join('');
    } catch (e) {
      /* handled by api() */
    }
  }

  // ---- Employees ----
  // Permission keys come from the server; labels are friendly names for the UI.
  const PERM_LABELS = { quotes: 'Quotes / estimates' };
  let permKeys = [];

  async function loadPermissions() {
    try {
      const d = await api('/api/admin/permissions');
      permKeys = d.permissions || [];
    } catch (e) {
      permKeys = [];
    }
    renderPermChecks($('newPerms'), []);
  }

  // Render permission checkboxes into a container, checking those in `selected`.
  function renderPermChecks(container, selected) {
    const sel = new Set(selected || []);
    container.innerHTML = permKeys.length
      ? permKeys
          .map(
            (k) =>
              `<label class="perm"><input type="checkbox" value="${k}"${
                sel.has(k) ? ' checked' : ''
              } /> ${esc(PERM_LABELS[k] || k)}</label>`
          )
          .join('')
      : '<span style="color:var(--muted);font-size:13px">No optional features yet.</span>';
  }
  const collectPerms = (container) =>
    [...container.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
  const permSummary = (perms) =>
    perms && perms.length
      ? perms.map((k) => esc(PERM_LABELS[k] || k)).join(', ')
      : '<span style="color:var(--muted)">Hours only</span>';

  async function loadEmployees() {
    employees = await api('/api/admin/employees');
    // populate selects
    const opts =
      '<option value="">All employees</option>' +
      employees.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    $('tsEmp').innerHTML = opts;
    $('mEmp').innerHTML = employees
      .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`)
      .join('');

    $('empBody').innerHTML = employees
      .map(
        (e) => `<tr class="clickable-row" data-id="${e.id}" title="Click to edit this employee's account">
          <td>${esc(e.name)}</td>
          <td>${e.pin}</td>
          <td>${
            e.email ? esc(e.email) : '<span style="color:var(--muted)">—</span>'
          }${
            e.email && !e.hasPassword
              ? '<div style="font-size:12px;color:var(--red)">no password set</div>'
              : ''
          }</td>
          <td>${permSummary(e.permissions)}</td>
          <td>${e.active ? '<span class="badge on">Active</span>' : '<span class="badge">Inactive</span>'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="link-btn" data-act="pin" data-id="${e.id}">Reset PIN</button>
            <button class="link-btn" data-act="toggle" data-id="${e.id}">${e.active ? 'Deactivate' : 'Activate'}</button>
            <button class="link-btn danger" data-act="del" data-id="${e.id}">Delete</button>
          </td></tr>`
      )
      .join('');
  }

  $('empBody').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    // Clicking anywhere else on the row opens that employee's account editor.
    if (!btn) {
      const row = ev.target.closest('tr[data-id]');
      if (!row) return;
      const emp = employees.find((e) => e.id === Number(row.dataset.id));
      if (emp) openEmpModal(emp);
      return;
    }
    const id = Number(btn.dataset.id);
    const emp = employees.find((e) => e.id === id);
    try {
      if (btn.dataset.act === 'del') {
        if (!confirm(`Delete ${emp.name} and all their time entries?`)) return;
        await api('/api/admin/employees/' + id, { method: 'DELETE' });
      } else if (btn.dataset.act === 'toggle') {
        await api('/api/admin/employees/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ active: emp.active ? 0 : 1 }),
        });
      } else if (btn.dataset.act === 'pin') {
        const pin = prompt(`New 4-digit PIN for ${emp.name}:`, emp.pin);
        if (pin == null) return;
        await api('/api/admin/employees/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ pin: pin.trim() }),
        });
      }
      loadEmployees();
    } catch (e) {
      alert(e.message);
    }
  });

  $('addEmp').addEventListener('click', async () => {
    $('empMsg').textContent = '';
    try {
      await api('/api/admin/employees', {
        method: 'POST',
        body: JSON.stringify({
          name: $('newName').value,
          pin: $('newPin').value,
          email: $('newEmail').value,
          password: $('newPass').value,
          permissions: collectPerms($('newPerms')),
        }),
      });
      $('newName').value = '';
      $('newPin').value = '';
      $('newEmail').value = '';
      $('newPass').value = '';
      renderPermChecks($('newPerms'), []);
      loadEmployees();
    } catch (e) {
      $('empMsg').textContent = e.message;
    }
  });

  // ---- Employee account modal (login email / password / permissions) ----
  let empModalId = null;
  function openEmpModal(emp) {
    empModalId = emp.id;
    $('empModalTitle').textContent = 'Account — ' + emp.name;
    $('eaEmail').value = emp.email || '';
    $('eaPass').value = '';
    renderPermChecks($('eaPerms'), emp.permissions || []);
    $('empModalMsg').textContent = '';
    $('empModalBack').classList.add('open');
  }
  $('eaCancel').addEventListener('click', () => $('empModalBack').classList.remove('open'));
  $('empModalBack').addEventListener('click', (e) => {
    if (e.target === $('empModalBack')) $('empModalBack').classList.remove('open');
  });
  $('eaSave').addEventListener('click', async () => {
    if (!empModalId) return;
    $('empModalMsg').textContent = '';
    const payload = {
      email: $('eaEmail').value.trim(),
      permissions: collectPerms($('eaPerms')),
    };
    if ($('eaPass').value) payload.password = $('eaPass').value;
    try {
      await api('/api/admin/employees/' + empModalId, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      $('empModalBack').classList.remove('open');
      loadEmployees();
    } catch (e) {
      $('empModalMsg').textContent = e.message;
    }
  });

  // ---- Timesheets ----
  function buildQuery() {
    const p = new URLSearchParams();
    if ($('tsEmp').value) p.set('employee_id', $('tsEmp').value);
    if ($('tsFrom').value) p.set('from', $('tsFrom').value);
    if ($('tsTo').value) p.set('to', $('tsTo').value);
    return p.toString();
  }

  async function loadTimesheet() {
    const data = await api('/api/admin/timesheet?' + buildQuery());
    $('tsTotal').textContent = data.totalHours.toFixed(2);
    $('tsEntries').textContent = data.entries.length;
    $('tsEmpty').style.display = data.entries.length ? 'none' : 'block';
    $('tsBody').innerHTML = data.entries
      .map(
        (r) => `<tr class="clickable-row" data-punch="${r.id}" title="Click to edit this entry">
          <td>${esc(r.name)}${r.edited ? ' <span class="badge edited">edited</span>' : ''}</td>
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

  $('tsLoad').addEventListener('click', () => loadTimesheet().catch((e) => alert(e.message)));
  $('tsExport').addEventListener('click', () => {
    window.location = '/api/admin/export.csv?' + buildQuery();
  });

  $('tsBody').addEventListener('click', (ev) => {
    const row = ev.target.closest('tr[data-punch]');
    if (!row) return;
    openPunchModal(Number(row.dataset.punch));
  });

  // ---- Punch modal (edit + add) ----
  let modalPunchId = null;
  let modalRows = [];

  async function openPunchModal(id) {
    // Fetch current entries to find this row (from last loaded timesheet).
    const data = await api('/api/admin/timesheet?' + buildQuery());
    modalRows = data.entries;
    const r = modalRows.find((x) => x.id === id);
    if (!r) return;
    modalPunchId = id;
    $('modalTitle').textContent = 'Edit entry';
    $('modalEmpRow').style.display = 'none';
    $('mIn').value = isoToLocalInput(r.clock_in);
    $('mOut').value = isoToLocalInput(r.clock_out);
    $('mWork').value = r.work_done || '';
    $('mReason').value = r.missed_reason || '';
    $('mNote').value = r.note || '';
    $('mDelete').style.display = 'inline';
    $('modalMsg').textContent = '';
    $('modalBack').classList.add('open');
  }

  $('tsAdd').addEventListener('click', () => {
    modalPunchId = null;
    $('modalTitle').textContent = 'Add entry';
    $('modalEmpRow').style.display = 'flex';
    $('mIn').value = '';
    $('mOut').value = '';
    $('mWork').value = '';
    $('mReason').value = '';
    $('mNote').value = '';
    $('mDelete').style.display = 'none';
    $('modalMsg').textContent = '';
    $('modalBack').classList.add('open');
  });

  $('mCancel').addEventListener('click', () => $('modalBack').classList.remove('open'));
  $('modalBack').addEventListener('click', (e) => {
    if (e.target === $('modalBack')) $('modalBack').classList.remove('open');
  });

  $('mSave').addEventListener('click', async () => {
    $('modalMsg').textContent = '';
    const payload = {
      clock_in: localInputToIso($('mIn').value),
      clock_out: $('mOut').value ? localInputToIso($('mOut').value) : '',
      work_done: $('mWork').value,
      missed_reason: $('mReason').value,
      note: $('mNote').value,
    };
    try {
      if (modalPunchId) {
        await api('/api/admin/punches/' + modalPunchId, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        payload.employee_id = Number($('mEmp').value);
        await api('/api/admin/punches', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      $('modalBack').classList.remove('open');
      loadTimesheet();
    } catch (e) {
      $('modalMsg').textContent = e.message;
    }
  });

  $('mDelete').addEventListener('click', async () => {
    if (!modalPunchId || !confirm('Delete this time entry?')) return;
    try {
      await api('/api/admin/punches/' + modalPunchId, { method: 'DELETE' });
      $('modalBack').classList.remove('open');
      loadTimesheet();
    } catch (e) {
      $('modalMsg').textContent = e.message;
    }
  });

  // ---- utils ----
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Share the auth-aware API helper (and utilities) with the Quotes module,
  // which lives in a separate file so this one stays focused on the timeclock.
  window.HEKAdmin = { api, esc, showLogin };

  // ---- boot: default date range = this week, check session ----
  (function initDates() {
    const now = new Date();
    const monday = new Date(now);
    const day = (now.getDay() + 6) % 7; // 0 = Monday
    monday.setDate(now.getDate() - day);
    const toStr = (d) => d.toISOString().slice(0, 10);
    $('tsFrom').value = toStr(monday);
    $('tsTo').value = toStr(now);
  })();

  api('/api/admin/me')
    .then((d) => {
      if (!d.admin) return showLogin();
      isDev = d.role === 'dev';
      currentFeatures = d.features || null;
      showApp();
    })
    .catch(showLogin);
})();
