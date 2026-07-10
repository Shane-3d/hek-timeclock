// Admin dashboard logic.
(function () {
  const $ = (id) => document.getElementById(id);
  let employees = [];
  let liveTimer = null;

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
    $('app').style.display = 'none';
    $('loginView').style.display = 'block';
    if (liveTimer) clearInterval(liveTimer);
  }
  function showApp() {
    $('loginView').style.display = 'none';
    $('app').style.display = 'block';
    loadEmployees();
    showLive();
  }

  $('loginBtn').addEventListener('click', doLogin);
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  async function doLogin() {
    $('loginMsg').textContent = '';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('email').value, password: $('pw').value }),
      });
      $('pw').value = '';
      showApp();
    } catch (e) {
      $('loginMsg').textContent = e.message;
    }
  }
  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

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
      if (t.dataset.tab === 'map') showMap();
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
        (e) => `<tr>
          <td>${esc(e.name)}</td>
          <td>${e.pin}</td>
          <td>${e.active ? '<span class="badge on">Active</span>' : '<span class="badge">Inactive</span>'}</td>
          <td style="text-align:right">
            <button class="link-btn" data-act="pin" data-id="${e.id}">Reset PIN</button>
            <button class="link-btn" data-act="toggle" data-id="${e.id}">${e.active ? 'Deactivate' : 'Activate'}</button>
            <button class="link-btn danger" data-act="del" data-id="${e.id}">Delete</button>
          </td></tr>`
      )
      .join('');
  }

  $('empBody').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
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
        body: JSON.stringify({ name: $('newName').value, pin: $('newPin').value }),
      });
      $('newName').value = '';
      $('newPin').value = '';
      loadEmployees();
    } catch (e) {
      $('empMsg').textContent = e.message;
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

  let tsEntries = [];
  async function loadTimesheet() {
    const data = await api('/api/admin/timesheet?' + buildQuery());
    tsEntries = data.entries;
    $('tsTotal').textContent = data.totalHours.toFixed(2);
    $('tsEntries').textContent = data.entries.length;
    $('tsEmpty').style.display = data.entries.length ? 'none' : 'block';
    $('tsBody').innerHTML = data.entries
      .map(
        (r) => `<tr>
          <td>${esc(r.name)}${r.edited ? ' <span class="badge edited">edited</span>' : ''}</td>
          <td>${fmtDateTime(r.clock_in)}</td>
          <td>${r.clock_out ? fmtDateTime(r.clock_out) : '<span class="badge on">on the clock</span>'}</td>
          <td>${r.hours != null ? r.hours.toFixed(2) : '—'}</td>
          <td>${r.work_done ? esc(r.work_done) : '<span style="color:var(--muted)">—</span>'}${
            r.missed_reason
              ? `<div style="font-size:12px;color:var(--red)">missed: ${esc(r.missed_reason)}</div>`
              : ''
          }</td>
          <td style="text-align:right;white-space:nowrap">${
            r.clock_in_lat != null && r.clock_in_lng != null
              ? `<button class="link-btn" data-loc="${r.id}">Location</button>`
              : ''
          }<button class="link-btn" data-punch="${r.id}">Edit</button></td>
        </tr>`
      )
      .join('');
  }

  $('tsLoad').addEventListener('click', () => loadTimesheet().catch((e) => alert(e.message)));
  $('tsExport').addEventListener('click', () => {
    window.location = '/api/admin/export.csv?' + buildQuery();
  });

  $('tsBody').addEventListener('click', (ev) => {
    const loc = ev.target.closest('button[data-loc]');
    if (loc) {
      const r = tsEntries.find((x) => x.id === Number(loc.dataset.loc));
      if (r && r.clock_in_lat != null) focusPunch(r.clock_in_lat, r.clock_in_lng, r.name, r.clock_in);
      return;
    }
    const btn = ev.target.closest('button[data-punch]');
    if (!btn) return;
    openPunchModal(Number(btn.dataset.punch));
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

  // ---- Map (clock-in locations) ----
  let map = null;
  let mapMarkers = [];
  function mapQuery() {
    const p = new URLSearchParams();
    if ($('mapFrom').value) p.set('from', $('mapFrom').value);
    if ($('mapTo').value) p.set('to', $('mapTo').value);
    return p.toString();
  }
  // Create the Leaflet map the first time it's needed (returns null if Leaflet
  // couldn't load). Must run while the container is visible.
  function ensureMap() {
    if (map) return map;
    if (!window.L) return null;
    map = L.map('map').setView([43.65, -79.38], 8); // default view: southern Ontario
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    return map;
  }
  function activateTab(name) {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.section').forEach((x) => x.classList.remove('active'));
    const tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.classList.add('active');
    const sec = $('tab-' + name);
    if (sec) sec.classList.add('active');
  }
  async function showMap() {
    if (!ensureMap()) return;
    setTimeout(() => map.invalidateSize(), 0); // it was hidden until now
    await loadMap().catch((e) => alert(e.message));
  }
  // Jump the map straight to one clock-in (used by the Timesheets "Location" button).
  function focusPunch(lat, lng, name, when) {
    activateTab('map');
    if (!ensureMap()) return alert('Map could not load (no internet?).');
    setTimeout(() => {
      map.invalidateSize();
      mapMarkers.forEach((m) => map.removeLayer(m));
      mapMarkers = [];
      const mk = L.circleMarker([lat, lng], {
        radius: 9, color: '#a97f43', fillColor: '#c89b5c', fillOpacity: 0.95, weight: 2,
      }).addTo(map);
      mk.bindPopup(`<b>${esc(name)}</b><br>${fmtDateTime(when)}`).openPopup();
      mapMarkers.push(mk);
      $('mapEmpty').style.display = 'none';
      map.setView([lat, lng], 16);
    }, 0);
  }
  async function loadMap() {
    if (!map) return;
    const rows = await api('/api/admin/locations?' + mapQuery());
    mapMarkers.forEach((m) => map.removeLayer(m));
    mapMarkers = [];
    $('mapEmpty').style.display = rows.length ? 'none' : 'block';
    if (!rows.length) return;
    const bounds = [];
    rows.forEach((r) => {
      const mk = L.circleMarker([r.lat, r.lng], {
        radius: 8, color: '#a97f43', fillColor: '#c89b5c', fillOpacity: 0.9, weight: 2,
      }).addTo(map);
      mk.bindPopup(`<b>${esc(r.name)}</b><br>${fmtDateTime(r.clock_in)}`);
      mapMarkers.push(mk);
      bounds.push([r.lat, r.lng]);
    });
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }
  $('mapLoad').addEventListener('click', () => loadMap().catch((e) => alert(e.message)));

  // ---- utils ----
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- boot: default date range = this week, check session ----
  (function initDates() {
    const now = new Date();
    const monday = new Date(now);
    const day = (now.getDay() + 6) % 7; // 0 = Monday
    monday.setDate(now.getDate() - day);
    const toStr = (d) => d.toISOString().slice(0, 10);
    $('tsFrom').value = toStr(monday);
    $('tsTo').value = toStr(now);
    $('mapFrom').value = toStr(monday);
    $('mapTo').value = toStr(now);
  })();

  api('/api/admin/me')
    .then((d) => (d.admin ? showApp() : showLogin()))
    .catch(showLogin);
})();
