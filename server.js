// HEK Fencing Inc. timeclock server.
// - Public: mobile clock-in page (PIN based) at "/"
// - Admin:  dashboard at ADMIN_PATH protected by an email + password.
//
// All data lives in a cloud MongoDB database (see db.js / DATABASE_URL).

// Load a local .env file if one exists (so `node server.js` picks up your
// settings). On a cloud host you set real environment variables instead, and
// this simply does nothing.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — using real environment variables */
}

const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const { connect, store } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@hekfencing.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET =
  process.env.SESSION_SECRET || 'hek-timeclock-dev-secret-please-change';
// The admin dashboard lives at this (deliberately non-obvious) path so it isn't
// linked from the employee clock-in page. Override it with the ADMIN_PATH env var.
const ADMIN_PATH = process.env.ADMIN_PATH || '/office';
// Timezone used to decide when "today" starts, so a missed clock-out from a
// previous day is detected correctly. Set it to your region.
const TIMEZONE = process.env.TIMEZONE || 'America/New_York';

// Local calendar day (YYYY-MM-DD) for a timestamp, in the configured timezone.
function localDay(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(d));
}

if (ADMIN_PASSWORD === 'changeme') {
  console.warn(
    '\n[WARN] ADMIN_PASSWORD is not set — using default "changeme". ' +
      'Set the ADMIN_PASSWORD env var before going live.\n'
  );
}

// When running as a Netlify function, requests arrive under a
// "/.netlify/functions/<name>" prefix. Strip it so the Express routes below see
// clean paths like "/api/status". Harmless when running as a normal server.
app.use((req, res, next) => {
  req.url = req.url.replace(/^\/\.netlify\/functions\/[^/?]+/, '');
  if (!req.url.startsWith('/')) req.url = '/' + req.url;
  next();
});

app.use(express.json());
app.use(
  cookieSession({
    name: 'hek_sess',
    secret: SESSION_SECRET,
    maxAge: 12 * 60 * 60 * 1000, // 12h
    httpOnly: true,
    sameSite: 'lax',
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const iso = (v) => (v == null ? null : new Date(v).toISOString());

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'Not authorized' });
}

function validPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error.' });
  });

const NO_USER = 'No user found for that PIN.';

async function getEmployeeByPin(pin) {
  return store.employees.findOne({ pin, active: true });
}

async function getOpenPunch(employeeId) {
  return store.punches.findOne(
    { employee_id: employeeId, clock_out: null },
    { sort: { clock_in: -1 } }
  );
}

// Attach employee names to a set of punch docs (app-side join).
async function withNames(punches) {
  const ids = [...new Set(punches.map((p) => p.employee_id))];
  const emps = await store.employees.find({ _id: { $in: ids } }).toArray();
  const nameById = Object.fromEntries(emps.map((e) => [e._id, e.name]));
  return punches.map((p) => ({ ...p, name: nameById[p.employee_id] || '(deleted)' }));
}

// ---------------------------------------------------------------------------
// Rate limiting — after RL_LIMIT failed attempts from one IP within RL_WINDOW,
// further attempts are blocked until the window passes. Stored in MongoDB so it
// works across serverless invocations. Only *failed* attempts count, so a whole
// crew clocking in from one office IP with correct PINs is never locked out.
// ---------------------------------------------------------------------------

const RL_LIMIT = 10;
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function clientIp(req) {
  return (
    req.headers['x-nf-client-connection-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    'unknown'
  );
}

async function isBlocked(key) {
  const doc = await store.rateLimits.findOne({ _id: key });
  if (!doc || !doc.windowStart) return 0;
  const elapsed = Date.now() - new Date(doc.windowStart).getTime();
  if (elapsed > RL_WINDOW_MS) return 0;
  return doc.count >= RL_LIMIT ? RL_WINDOW_MS - elapsed : 0;
}

async function recordFail(key) {
  await store.rateLimits.updateOne(
    { _id: key },
    [
      {
        $set: {
          windowStart: {
            $cond: [
              {
                $gt: [
                  { $subtract: ['$$NOW', { $ifNull: ['$windowStart', new Date(0)] }] },
                  RL_WINDOW_MS,
                ],
              },
              '$$NOW',
              { $ifNull: ['$windowStart', '$$NOW'] },
            ],
          },
        },
      },
      {
        $set: {
          count: {
            $cond: [
              { $eq: ['$windowStart', '$$NOW'] },
              1,
              { $add: [{ $ifNull: ['$count', 0] }, 1] },
            ],
          },
        },
      },
    ],
    { upsert: true }
  );
}

const clearFails = (key) => store.rateLimits.deleteOne({ _id: key });

// Middleware factory: blocks a request if the IP is over the limit for `scope`.
const limiter = (scope) => async (req, res, next) => {
  const key = `${scope}:${clientIp(req)}`;
  req._rlKey = key;
  try {
    const waitMs = await isBlocked(key);
    if (waitMs > 0) {
      const mins = Math.ceil(waitMs / 60000);
      return res
        .status(429)
        .json({ error: `Too many attempts. Please wait ${mins} minute${mins > 1 ? 's' : ''}.` });
    }
  } catch (err) {
    console.error('rate-limit check failed (allowing request):', err.message);
  }
  next();
};

const pinLimiter = limiter('pin');
const adminLimiter = limiter('admin');

// Look up an employee by PIN, recording a failed attempt (for rate limiting) if
// the PIN is unknown and clearing the counter on success.
async function resolvePin(req, res, pin) {
  const emp = await getEmployeeByPin(pin);
  if (!emp) {
    await recordFail(req._rlKey);
    res.status(404).json({ error: NO_USER });
    return null;
  }
  await clearFails(req._rlKey);
  return emp;
}

// ---------------------------------------------------------------------------
// Employee (public) API
// ---------------------------------------------------------------------------

app.post(
  '/api/status',
  pinLimiter,
  wrap(async (req, res) => {
    const { pin } = req.body || {};
    if (!validPin(pin)) return res.status(400).json({ error: 'Enter your 4-digit PIN.' });

    const emp = await resolvePin(req, res, pin);
    if (!emp) return;

    const open = await getOpenPunch(emp._id);
    // A still-open punch that started on an earlier day = a missed clock-out.
    let missed = null;
    if (open && localDay(open.clock_in) < localDay(new Date())) {
      missed = { punchId: open._id, clockIn: iso(open.clock_in), day: localDay(open.clock_in) };
    }
    res.json({
      id: emp._id,
      name: emp.name,
      clockedIn: !!open,
      since: open ? iso(open.clock_in) : null,
      missed,
    });
  })
);

app.post(
  '/api/clock-in',
  pinLimiter,
  wrap(async (req, res) => {
    const { pin } = req.body || {};
    if (!validPin(pin)) return res.status(400).json({ error: 'Enter your 4-digit PIN.' });

    const emp = await resolvePin(req, res, pin);
    if (!emp) return;

    const open = await getOpenPunch(emp._id);
    if (open) {
      if (localDay(open.clock_in) < localDay(new Date()))
        return res
          .status(409)
          .json({ error: 'Please resolve your missed clock-out first.' });
      return res.status(409).json({ error: `${emp.name} is already clocked in.` });
    }

    const now = new Date();
    await store.punches.insertOne({
      _id: await store.nextId('punches'),
      employee_id: emp._id,
      clock_in: now,
      clock_out: null,
      work_done: null,
      missed_reason: null,
      note: null,
      edited: false,
    });
    res.json({ name: emp.name, clockedIn: true, since: iso(now) });
  })
);

app.post(
  '/api/clock-out',
  pinLimiter,
  wrap(async (req, res) => {
    const { pin } = req.body || {};
    const workDone = (req.body?.workDone || '').trim();
    if (!validPin(pin)) return res.status(400).json({ error: 'Enter your 4-digit PIN.' });
    if (!workDone)
      return res.status(400).json({ error: 'Please enter what you worked on today.' });

    const emp = await resolvePin(req, res, pin);
    if (!emp) return;

    const open = await getOpenPunch(emp._id);
    if (!open) return res.status(409).json({ error: `${emp.name} is not clocked in.` });

    // Clock-out defaults to now, but the employee may supply an earlier time.
    let co = new Date();
    if (req.body?.clockOut) {
      co = new Date(req.body.clockOut);
      if (isNaN(co)) return res.status(400).json({ error: 'Invalid clock-out time.' });
      if (co.getTime() > Date.now() + 60000)
        return res.status(400).json({ error: "Clock-out time can't be in the future." });
      if (co < new Date(open.clock_in))
        return res.status(400).json({ error: 'Clock-out must be after your clock-in.' });
    }
    await store.punches.updateOne(
      { _id: open._id },
      { $set: { clock_out: co, work_done: workDone } }
    );
    res.json({ name: emp.name, clockedIn: false, since: iso(open.clock_in), until: iso(co) });
  })
);

// Resolve a missed clock-out from a previous day: the employee supplies the time
// they actually finished, what they did, and why they forgot to clock out.
app.post(
  '/api/resolve-missed',
  pinLimiter,
  wrap(async (req, res) => {
    const { pin, punchId, clockOut, workDone, reason } = req.body || {};
    if (!validPin(pin)) return res.status(400).json({ error: 'Enter your 4-digit PIN.' });

    const emp = await resolvePin(req, res, pin);
    if (!emp) return;

    const p = await store.punches.findOne({
      _id: Number(punchId),
      employee_id: emp._id,
      clock_out: null,
    });
    if (!p) return res.status(404).json({ error: 'Nothing to resolve.' });

    const work = (workDone || '').trim();
    const why = (reason || '').trim();
    if (!clockOut) return res.status(400).json({ error: 'Enter the time you finished.' });
    if (!work) return res.status(400).json({ error: 'Enter what you worked on that day.' });
    if (!why) return res.status(400).json({ error: 'Enter why you did not clock out.' });

    const co = new Date(clockOut);
    if (isNaN(co)) return res.status(400).json({ error: 'Invalid finish time.' });
    if (co < new Date(p.clock_in))
      return res.status(400).json({ error: 'Finish time must be after your clock-in.' });

    await store.punches.updateOne(
      { _id: p._id },
      { $set: { clock_out: co, work_done: work, missed_reason: why, edited: true } }
    );
    res.json({ ok: true, name: emp.name });
  })
);

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------

app.post(
  '/api/admin/login',
  adminLimiter,
  wrap(async (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    const { password } = req.body || {};
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      await clearFails(req._rlKey);
      req.session.admin = true;
      return res.json({ ok: true, email });
    }
    await recordFail(req._rlKey);
    res.status(401).json({ error: 'Wrong email or password.' });
  })
);

app.post('/api/admin/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ admin: !!(req.session && req.session.admin) });
});

// ---------------------------------------------------------------------------
// Admin: employees
// ---------------------------------------------------------------------------

app.get(
  '/api/admin/employees',
  requireAdmin,
  wrap(async (req, res) => {
    const rows = await store.employees.find({}, { sort: { name: 1 } }).toArray();
    res.json(
      rows.map((e) => ({
        id: e._id,
        name: e.name,
        pin: e.pin,
        active: e.active,
        created_at: e.created_at,
      }))
    );
  })
);

app.post(
  '/api/admin/employees',
  requireAdmin,
  wrap(async (req, res) => {
    const name = (req.body?.name || '').trim();
    const pin = (req.body?.pin || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!validPin(pin)) return res.status(400).json({ error: 'PIN must be 4 digits.' });

    if (await store.employees.findOne({ pin }))
      return res.status(409).json({ error: 'That PIN is already in use.' });

    const _id = await store.nextId('employees');
    await store.employees.insertOne({
      _id,
      name,
      pin,
      active: true,
      created_at: new Date(),
    });
    res.json({ id: _id, name, pin, active: true });
  })
);

app.patch(
  '/api/admin/employees/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const emp = await store.employees.findOne({ _id: id });
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });

    const name = req.body?.name != null ? String(req.body.name).trim() : emp.name;
    const pin = req.body?.pin != null ? String(req.body.pin).trim() : emp.pin;
    const active =
      req.body?.active != null ? !!req.body.active && req.body.active !== 0 : emp.active;

    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!validPin(pin)) return res.status(400).json({ error: 'PIN must be 4 digits.' });

    if (await store.employees.findOne({ pin, _id: { $ne: id } }))
      return res.status(409).json({ error: 'That PIN is already in use.' });

    await store.employees.updateOne({ _id: id }, { $set: { name, pin, active } });
    res.json({ id, name, pin, active });
  })
);

app.delete(
  '/api/admin/employees/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    await store.employees.deleteOne({ _id: id });
    await store.punches.deleteMany({ employee_id: id }); // cascade their time entries
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Admin: live "who's on the clock"
// ---------------------------------------------------------------------------

app.get(
  '/api/admin/active',
  requireAdmin,
  wrap(async (req, res) => {
    const open = await store.punches
      .find({ clock_out: null }, { sort: { clock_in: 1 } })
      .toArray();
    const named = await withNames(open);
    res.json(
      named.map((p) => ({
        punch_id: p._id,
        clock_in: iso(p.clock_in),
        employee_id: p.employee_id,
        name: p.name,
      }))
    );
  })
);

// ---------------------------------------------------------------------------
// Admin: timesheets
// ---------------------------------------------------------------------------

// from/to are inclusive dates (YYYY-MM-DD). Returns entries ordered newest-first,
// each with the employee's name attached.
async function timesheetRows({ employeeId, from, to }) {
  const q = {};
  if (employeeId) q.employee_id = Number(employeeId);
  if (from || to) {
    q.clock_in = {};
    if (from) q.clock_in.$gte = new Date(from + 'T00:00:00');
    if (to) q.clock_in.$lte = new Date(to + 'T23:59:59.999');
  }
  const rows = await store.punches.find(q, { sort: { clock_in: -1 } }).toArray();
  const named = await withNames(rows);
  return named.map((r) => ({
    id: r._id,
    employee_id: r.employee_id,
    name: r.name,
    clock_in: r.clock_in,
    clock_out: r.clock_out,
    work_done: r.work_done,
    missed_reason: r.missed_reason,
    note: r.note,
    edited: r.edited,
  }));
}

function hoursOf(row) {
  if (!row.clock_out) return null;
  const ms = new Date(row.clock_out) - new Date(row.clock_in);
  return Math.round((ms / 3600000) * 100) / 100;
}

app.get(
  '/api/admin/timesheet',
  requireAdmin,
  wrap(async (req, res) => {
    const rows = await timesheetRows({
      employeeId: req.query.employee_id,
      from: req.query.from,
      to: req.query.to,
    });
    let total = 0;
    const entries = rows.map((r) => {
      const hours = hoursOf(r);
      if (hours) total += hours;
      return { ...r, clock_in: iso(r.clock_in), clock_out: iso(r.clock_out), hours };
    });
    res.json({ entries, totalHours: Math.round(total * 100) / 100 });
  })
);

// ---------------------------------------------------------------------------
// Admin: create / edit / delete punches
// ---------------------------------------------------------------------------

app.post(
  '/api/admin/punches',
  requireAdmin,
  wrap(async (req, res) => {
    const employeeId = Number(req.body?.employee_id);
    const { clock_in, clock_out, note, work_done } = req.body || {};
    const emp = await store.employees.findOne({ _id: employeeId });
    if (!emp) return res.status(400).json({ error: 'Unknown employee.' });
    if (!clock_in) return res.status(400).json({ error: 'Clock-in time is required.' });

    const ci = new Date(clock_in);
    const co = clock_out ? new Date(clock_out) : null;
    if (isNaN(ci)) return res.status(400).json({ error: 'Invalid clock-in time.' });
    if (co && isNaN(co)) return res.status(400).json({ error: 'Invalid clock-out time.' });
    if (co && co < ci)
      return res.status(400).json({ error: 'Clock-out must be after clock-in.' });

    const _id = await store.nextId('punches');
    await store.punches.insertOne({
      _id,
      employee_id: employeeId,
      clock_in: ci,
      clock_out: co,
      work_done: work_done || null,
      missed_reason: null,
      note: note || null,
      edited: true,
    });
    res.json({ id: _id });
  })
);

app.patch(
  '/api/admin/punches/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const p = await store.punches.findOne({ _id: id });
    if (!p) return res.status(404).json({ error: 'Entry not found.' });

    const ci = req.body?.clock_in ? new Date(req.body.clock_in) : new Date(p.clock_in);
    let co;
    if (req.body?.clock_out === '' || req.body?.clock_out === null) {
      co = null; // explicitly reopen the entry
    } else if (req.body?.clock_out) {
      co = new Date(req.body.clock_out);
    } else {
      co = p.clock_out ? new Date(p.clock_out) : null;
    }

    if (isNaN(ci)) return res.status(400).json({ error: 'Invalid clock-in time.' });
    if (co && isNaN(co)) return res.status(400).json({ error: 'Invalid clock-out time.' });
    if (co && co < ci)
      return res.status(400).json({ error: 'Clock-out must be after clock-in.' });

    const note = req.body?.note != null ? req.body.note : p.note;
    const workDone = req.body?.work_done != null ? req.body.work_done : p.work_done;
    const missedReason =
      req.body?.missed_reason != null ? req.body.missed_reason : p.missed_reason;
    await store.punches.updateOne(
      { _id: id },
      {
        $set: {
          clock_in: ci,
          clock_out: co,
          work_done: workDone,
          missed_reason: missedReason,
          note,
          edited: true,
        },
      }
    );
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/punches/:id',
  requireAdmin,
  wrap(async (req, res) => {
    await store.punches.deleteOne({ _id: Number(req.params.id) });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Admin: CSV export
// ---------------------------------------------------------------------------

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get(
  '/api/admin/export.csv',
  requireAdmin,
  wrap(async (req, res) => {
    const rows = await timesheetRows({
      employeeId: req.query.employee_id,
      from: req.query.from,
      to: req.query.to,
    });
    const header = [
      'Employee',
      'Clock In',
      'Clock Out',
      'Hours',
      'Work Done',
      'Missed Clock-out Reason',
      'Edited',
      'Note',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.name),
          csvCell(iso(r.clock_in)),
          csvCell(iso(r.clock_out) || ''),
          csvCell(hoursOf(r) ?? ''),
          csvCell(r.work_done || ''),
          csvCell(r.missed_reason || ''),
          csvCell(r.edited ? 'yes' : ''),
          csvCell(r.note || ''),
        ].join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hek-timesheet-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(lines.join('\n'));
  })
);

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

// Admin page is served from /views (outside the static folder) at ADMIN_PATH,
// so it is not reachable at a guessable /admin or /admin.html URL.
app.get(ADMIN_PATH, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Diagnostic: reports whether the database is reachable and, if not, the exact
// error. Always returns HTTP 200 so the body is easy to read.
app.get('/dbcheck', async (req, res) => {
  try {
    await connect();
    await store.client.db().command({ ping: 1 });
    res.json({ db: 'connected', hasUrl: !!process.env.DATABASE_URL });
  } catch (err) {
    res.json({
      db: 'FAILED',
      error: err.message,
      code: err.code || err.codeName || null,
      hasUrl: !!process.env.DATABASE_URL,
    });
  }
});

// Start a normal long-running server only when run directly (local / Render /
// any host that runs `node server.js`). When required by the Netlify function,
// this block is skipped and the function manages the DB connection itself.
if (require.main === module) {
  // Safety net: log transient errors instead of letting one bad request or a
  // brief database hiccup crash the whole server.
  process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
  });

  connect()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`HEK Timeclock running on http://localhost:${PORT}`);
        console.log(`  Employee clock-in:  http://localhost:${PORT}/`);
        console.log(`  Admin dashboard:    http://localhost:${PORT}${ADMIN_PATH}`);
      });
    })
    .catch((err) => {
      console.error('[FATAL] Could not connect to the database:', err.message);
      process.exit(1);
    });
}

module.exports = { app, connect };
