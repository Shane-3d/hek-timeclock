// Job scheduling — shared by the admin dashboard and the employee portal.
//
//   Admin:    create / edit jobs — address (with autocomplete), description,
//             date & time, and which employees are assigned.
//   Employee: see the jobs assigned to them and tap the address to open their
//             phone's map app with turn-by-turn directions straight there.
//
// Both pages expose window.HEKAdmin ({ api, esc }); this file is loaded after
// admin.js / portal.js so that helper is ready when these functions run.
(function () {
  const H = () => window.HEKAdmin || {};
  const api = (...a) => H().api(...a);
  const esc = (s) => (H().esc ? H().esc(s) : String(s));
  const $ = (id) => document.getElementById(id);

  // A directions link that opens the map app straight to the destination.
  // Prefer exact coordinates (from geocoding); fall back to the typed address.
  function mapsUrl(job) {
    const dest =
      job.lat != null && job.lng != null
        ? `${job.lat},${job.lng}`
        : encodeURIComponent(job.address);
    return 'https://www.google.com/maps/dir/?api=1&destination=' + dest;
  }

  // Friendly "when" label from the stored date (YYYY-MM-DD) + time (HH:MM).
  function fmtWhen(job) {
    if (!job.date) return 'No date set';
    const d = new Date(job.date + 'T' + (job.time || '00:00'));
    const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return job.time
      ? day + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : day;
  }

  // ======================= EMPLOYEE (portal) view ==========================
  async function loadMine() {
    const list = $('mySchedList');
    if (!list) return;
    let jobs = [];
    try {
      const d = await api('/api/my/schedules');
      jobs = d.jobs || [];
    } catch (e) {
      list.innerHTML = `<div class="card">${esc(e.message)}</div>`;
      return;
    }
    if ($('mySchedEmpty')) $('mySchedEmpty').style.display = jobs.length ? 'none' : 'block';
    list.innerHTML = jobs
      .map(
        (j) => `<div class="job-card">
          <div class="job-when">${esc(fmtWhen(j))}</div>
          ${j.description ? `<div class="job-desc">${esc(j.description)}</div>` : ''}
          <a class="btn gold job-go" href="${mapsUrl(j)}" target="_blank" rel="noopener">
            <span class="job-addr">📍 ${esc(j.address)}</span>
            <span class="job-go-sub">Tap for directions</span>
          </a>
        </div>`
      )
      .join('');
  }

  // ========================= ADMIN (dashboard) =============================
  let editingId = null;
  let picked = { lat: null, lng: null }; // coords from the last chosen suggestion
  let allEmployees = [];
  let jobsCache = [];

  // Wire the admin form once, if we're on the admin page.
  if ($('schedForm')) initAdmin();

  function initAdmin() {
    const addr = $('schedAddr');
    const box = $('schedSuggest');
    let timer = null;

    addr.addEventListener('input', () => {
      picked = { lat: null, lng: null }; // editing the text invalidates a prior pick
      const q = addr.value.trim();
      clearTimeout(timer);
      if (q.length < 3) return hideSuggest();
      timer = setTimeout(() => runGeocode(q), 350);
    });

    async function runGeocode(q) {
      try {
        const d = await api('/api/admin/geocode?q=' + encodeURIComponent(q));
        const rs = d.results || [];
        if (!rs.length) return hideSuggest();
        box._results = rs;
        box.innerHTML = rs
          .map((r, i) => `<div class="addr-item" data-i="${i}">${esc(r.label)}</div>`)
          .join('');
        box.style.display = 'block';
      } catch (e) {
        hideSuggest();
      }
    }
    function hideSuggest() {
      box.innerHTML = '';
      box.style.display = 'none';
    }

    box.addEventListener('click', (e) => {
      const item = e.target.closest('.addr-item');
      if (!item) return;
      const r = (box._results || [])[Number(item.dataset.i)];
      if (!r) return;
      addr.value = r.label;
      picked = { lat: r.lat, lng: r.lng };
      hideSuggest();
    });
    // Click elsewhere closes the suggestion list.
    document.addEventListener('click', (e) => {
      if (e.target !== addr && !box.contains(e.target)) hideSuggest();
    });

    $('schedSave').addEventListener('click', saveJob);
    $('schedCancel').addEventListener('click', resetForm);
    $('schedBody').addEventListener('click', onTableClick);
  }

  function renderEmpChecks(selected) {
    const sel = new Set(selected || []);
    $('schedEmps').innerHTML = allEmployees.length
      ? allEmployees
          .map(
            (e) => `<label class="perm"><input type="checkbox" value="${e.id}"${
              sel.has(e.id) ? ' checked' : ''
            } /> ${esc(e.name)}</label>`
          )
          .join('')
      : '<span style="color:var(--muted);font-size:13px">No employees yet.</span>';
  }
  const collectEmps = () =>
    [...$('schedEmps').querySelectorAll('input[type="checkbox"]:checked')].map((c) =>
      Number(c.value)
    );

  async function loadAdmin() {
    if (!$('schedForm')) return;
    try {
      allEmployees = await api('/api/admin/employees');
    } catch (e) {
      allEmployees = [];
    }
    if (editingId == null) renderEmpChecks([]);
    await refreshJobs();
  }

  async function refreshJobs() {
    const d = await api('/api/admin/schedules');
    jobsCache = d.jobs || [];
    $('schedEmpty').style.display = jobsCache.length ? 'none' : 'block';
    $('schedBody').innerHTML = jobsCache
      .map(
        (j) => `<tr class="clickable-row" data-id="${j.id}" title="Click to edit this job">
          <td>${esc(fmtWhen(j))}</td>
          <td><a href="${mapsUrl(j)}" target="_blank" rel="noopener">${esc(j.address)}</a></td>
          <td>${j.description ? esc(j.description) : '<span style="color:var(--muted)">—</span>'}</td>
          <td>${
            j.employees && j.employees.length
              ? esc(j.employees.join(', '))
              : '<span style="color:var(--muted)">Unassigned</span>'
          }</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="link-btn danger" data-del="${j.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');
  }

  async function onTableClick(ev) {
    if (ev.target.closest('a')) return; // let the address (maps) link open normally
    const del = ev.target.closest('button[data-del]');
    if (del) {
      const id = Number(del.dataset.del);
      if (!confirm('Delete this job?')) return;
      try {
        await api('/api/admin/schedules/' + id, { method: 'DELETE' });
        await refreshJobs();
      } catch (e) {
        alert(e.message);
      }
      return;
    }
    const row = ev.target.closest('tr[data-id]');
    if (row) startEdit(Number(row.dataset.id));
  }

  function startEdit(id) {
    const j = jobsCache.find((x) => x.id === id);
    if (!j) return;
    editingId = id;
    $('schedFormTitle').textContent = 'Edit job';
    $('schedAddr').value = j.address || '';
    picked = { lat: j.lat, lng: j.lng };
    $('schedDesc').value = j.description || '';
    $('schedDate').value = j.date || '';
    $('schedTime').value = j.time || '';
    renderEmpChecks(j.employee_ids || []);
    $('schedSave').textContent = 'Update job';
    $('schedCancel').style.display = 'inline-block';
    $('schedMsg').textContent = '';
    $('schedForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    editingId = null;
    picked = { lat: null, lng: null };
    $('schedAddr').value = '';
    $('schedDesc').value = '';
    $('schedDate').value = '';
    $('schedTime').value = '';
    $('schedSuggest').innerHTML = '';
    $('schedSuggest').style.display = 'none';
    renderEmpChecks([]);
    $('schedFormTitle').textContent = 'Add job';
    $('schedSave').textContent = 'Add job';
    $('schedCancel').style.display = 'none';
    $('schedMsg').textContent = '';
  }

  async function saveJob() {
    const msg = $('schedMsg');
    msg.className = 'msg err';
    msg.textContent = '';
    const address = $('schedAddr').value.trim();
    if (!address) {
      msg.textContent = 'Enter an address.';
      return;
    }
    const payload = {
      address,
      description: $('schedDesc').value,
      date: $('schedDate').value,
      time: $('schedTime').value,
      lat: picked.lat,
      lng: picked.lng,
      employee_ids: collectEmps(),
    };
    $('schedSave').disabled = true;
    try {
      if (editingId != null) {
        await api('/api/admin/schedules/' + editingId, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/admin/schedules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      resetForm();
      await refreshJobs();
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      $('schedSave').disabled = false;
    }
  }

  window.Schedule = { loadAdmin, loadMine };
})();
