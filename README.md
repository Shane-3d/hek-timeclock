# HEK Fencing Inc. — Time Clock

A simple employee time clock:

- **Employees** clock in/out from their phone using a **4-digit PIN** — no app to install, just open the web page. When clocking out they must enter **what they worked on** that day. If they forget to clock out, the next time they enter their PIN they're asked **when they finished and why** before they can start again.
- **Admins** sign in with an **email + password** to see who's on the clock, view/total hours (including each day's work notes and missed-clock-out reasons), fix mistakes, add employees, and export to CSV for payroll.

## Screens

| URL | Who | What |
| --- | --- | --- |
| `/` | Employees | Enter PIN → Clock In / Clock Out |
| `/office` | Admin | Dashboard (password protected) |

> The admin dashboard is **not** at `/admin` and is **not** linked from the
> employee page, so the crew never sees it. The path defaults to `/office` — set
> the `ADMIN_PATH` env var to change it to something only you know. Bookmark it.

## Admin dashboard

- **On the clock** — live list of who is currently clocked in.
- **Timesheets** — filter by employee and date range, see total hours, edit any entry, add a manual entry, **Export CSV**.
- **Employees** — add employees (name + 4-digit PIN), reset PINs, deactivate, or delete.

---

## Database

All data lives in a **cloud MongoDB** database — nothing is stored on the app
server. Get a free cluster from [MongoDB Atlas](https://www.mongodb.com/atlas) and
copy its connection string (Atlas → **Connect → Drivers**), which looks like:

```
mongodb+srv://user:password@cluster.mongodb.net/?appName=yourapp
```

Put it in the `DATABASE_URL` environment variable. The collections
(`employees`, `punches`) are created automatically on first use.

## Run it locally

```bash
npm install
# copy .env.example to .env and fill in DATABASE_URL + ADMIN_EMAIL + ADMIN_PASSWORD
npm start
```

On Windows PowerShell (without a .env file):

```powershell
$env:DATABASE_URL="mongodb+srv://user:pass@cluster.mongodb.net/?appName=yourapp"
$env:ADMIN_PASSWORD="yourpassword"
npm start
```

Open http://localhost:3000 (clock-in) and http://localhost:3000/office (dashboard).
The first thing to do after signing in is add your employees under the **Employees** tab.

## Deploy to Netlify

The repo is Netlify-ready (`netlify.toml`). The pages are served as static files
and the API runs as a serverless function.

1. Push this project to a GitHub repo.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
   Netlify reads `netlify.toml` (build command, publish dir, function) automatically.
3. In **Site settings → Environment variables**, add:
   - `DATABASE_URL` — your MongoDB connection string
   - `ADMIN_EMAIL` — admin sign-in email
   - `ADMIN_PASSWORD` — admin sign-in password
   - `SESSION_SECRET` — a long random string
   - `ADMIN_PATH` — the admin page path, e.g. `/fence` (also sets the page filename)
   - `TIMEZONE` — e.g. `America/New_York`
4. Deploy. Netlify gives you a public `https://…netlify.app` URL — share `/` with
   the crew and bookmark your admin path (e.g. `/fence`).

> **Atlas network access:** In Atlas → **Network Access**, add `0.0.0.0/0` (allow
> from anywhere) so Netlify's servers can reach the cluster, otherwise the API
> will time out.

## Deploy to a Node host instead (Render, Railway, Fly.io…)

The app also runs as a normal long-running server (`npm start`). The repo
includes `render.yaml` for [Render](https://render.com): push to GitHub, then in
Render pick **New + → Blueprint** and set the same environment variables above.

## Configuration

| Env var | Purpose |
| --- | --- |
| `DATABASE_URL` | MongoDB connection string. **Required.** |
| `DB_NAME` | Database name inside the cluster (default `hektimeclock`). |
| `ADMIN_EMAIL` | Email admins sign in with (default `admin@hekfencing.com`). |
| `ADMIN_PASSWORD` | Password for the admin dashboard. **Set this.** |
| `SESSION_SECRET` | Random string signing the login cookie. |
| `ADMIN_PATH` | URL path for the admin dashboard (default `/office`). |
| `TIMEZONE` | IANA timezone for the workday boundary (default `America/New_York`). |
| `PORT` | Port to listen on (host usually sets this). |

## Notes

- Times are stored in UTC and displayed in each viewer's local timezone.
- PINs are stored as-is so an admin can look them up and remind employees; keep the admin password private.
