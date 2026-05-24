# Deploying the Mounted Games Scoreboard

Pick the path that matches what you need:

| Use case | Platform | Cost | Setup time |
|---|---|---|---|
| **Dev / demo / "show a friend"** | **Render free** (below) | £0, no card | ~10 min |
| Real event with persistent data | Fly.io (see *Production deploy* section) | ~£3/mo, needs card | ~10 min |
| Quick public URL from your laptop | Cloudflare Quick Tunnel | £0, no signup | ~2 min, only up while your laptop is on |

---

# Dev hosting: Render free tier

Render has the only genuine free hosted tier left that supports .NET + SignalR. The catches are real but fine for development:

- **Sleeps after 15 min idle.** First request after wake takes 30–60s while the container spins up. SignalR reconnects automatically.
- **No persistent disk.** SQLite lives in `/tmp` and is wiped on every restart, but `DbInitializer` re-seeds clubs, demo accounts and the race library on every boot, so you always have something to test against.
- **512 MB RAM, slower shared CPU.** Don't load-test it.

URL ends up as `https://mounted-games-scoreboard.onrender.com` (or whatever you name the service).

## 1. Get the code onto GitHub

Render builds from a GitHub repo (no docker registry needed). If you've never pushed this repo:

```powershell
cd C:\Users\alexd\source\repos\MountedGames.App

# If you haven't already
git add .
git commit -m "Initial commit"

# Create an empty repo at https://github.com/new (call it mounted-games-app, don't add a README).
# Then GitHub will show you the exact `git remote add` and `git push` commands. Run them:
git remote add origin https://github.com/<your-user>/mounted-games-app.git
git branch -M main
git push -u origin main
```

## 2. Wire up Render

1. Sign up at <https://render.com> with your email — **no card required for the free tier**.
2. Click **New → Blueprint**.
3. Connect your GitHub account and pick the repo you just pushed.
4. Render finds `render.yaml` automatically and shows a one-screen summary. Click **Apply**.
5. First build takes ~7–10 min (Node install + npm build + .NET publish). Watch the log stream.

## 3. Set the admin key

The blueprint marks `Admin__Key` as "set this manually" — that way it never lives in your repo.

- In the Render dashboard → your service → **Environment** tab → edit `Admin__Key`.
- Pick anything memorable: `MGADMIN-DEV-2026`. Save → Render auto-restarts the service.

## 4. Log in

Your URL: `https://mounted-games-scoreboard.onrender.com` (or whatever Render assigned).

| Role | Sign-in |
|---|---|
| Trainer | `trainer@mg.local` / `Trainer!234` |
| Trainer | `coach@mg.local` / `Trainer!234` |
| Admin | the `Admin__Key` value you just set |

Any new trainer can also sign up via the **Sign up** tab on the login page.

## 5. Pushing updates

Every `git push` to `main` auto-deploys (`autoDeploy: true` in `render.yaml`). Build status visible in the Render dashboard.

## 6. If something breaks

| Symptom | Fix |
|---|---|
| Build fails on `npm ci` | Make sure `web/package-lock.json` is committed |
| 500 on first request | Render is waking the container — wait 30–60s |
| "Invalid admin key" | Set `Admin__Key` in Environment tab and save |
| Service won't start | Check the Logs tab; usually a missing env var or port mismatch |
| Need to wipe the DB | Render Dashboard → Manual Deploy → Clear build cache & deploy. (DB is already ephemeral, so a normal restart also works.) |

---

# Production deploy: Fly.io

Target: single container, SQLite on a persistent volume, always-on so SignalR stays connected. App URL: `https://mounted-games-scoreboard.fly.dev`.

Expected cost for ~100 users: roughly **£3–5/month** on the shared-cpu-1x VM (Fly bills per-second usage; the always-on requirement for SignalR means the VM stays running 24/7).

---

## 1. One-time setup on your machine

1. **Sign up** at <https://fly.io/app/sign-up> with `alexduckhouse@outlook.com`. You'll need to add a credit card — Fly removed their always-free tier, but they only bill what you actually use.
2. **Install the CLI**:
   - Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`
   - macOS / Linux: `curl -L https://fly.io/install.sh | sh`
3. **Sign in**: `fly auth login` — this opens your browser.

## 2. First deploy

Run these from the repo root (`C:\Users\alexd\source\repos\MountedGames.App`):

```powershell
# Reserve the name + create the Fly app (uses fly.toml as-is).
fly apps create mounted-games-scoreboard

# Create the 1 GB volume for SQLite (LHR = London).
fly volumes create mg_data --region lhr --size 1 --yes

# Set the secrets the app needs at runtime.
# Generate a 256-bit JWT key (any 32+ random chars works):
fly secrets set `
  Jwt__Key="$(openssl rand -base64 48)" `
  Admin__Key="MGADMIN-2026-<pick-something-memorable>" `
  --app mounted-games-scoreboard

# (Optional) what3words lookup for the wizard's coordinate finder:
# fly secrets set What3Words__ApiKey="your-w3w-api-key" --app mounted-games-scoreboard

# Build & deploy.
fly deploy
```

When it finishes, `fly status` will show the URL. Open `https://mounted-games-scoreboard.fly.dev`.

### Don't have openssl on Windows?

```powershell
# PowerShell equivalent — generates a 64-char URL-safe random string.
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwtKey = [Convert]::ToBase64String($bytes)
fly secrets set Jwt__Key="$jwtKey" Admin__Key="MGADMIN-2026-pickone" --app mounted-games-scoreboard
```

## 3. First login

The seeder creates demo accounts on first boot:

| Role | Sign-in |
|---|---|
| Trainer | `trainer@mg.local` / `Trainer!234` |
| Trainer | `coach@mg.local` / `Trainer!234` |
| Admin (shared key) | the value you set for `Admin__Key` |

Change or delete these demo accounts once you're up — they have weak passwords. (Admins can register new trainers via the Sign-up tab on the login page.)

## 4. Day-2 operations

```powershell
# Tail logs
fly logs --app mounted-games-scoreboard

# Open a shell on the running machine
fly ssh console --app mounted-games-scoreboard

# Roll out a new version after pushing code changes
fly deploy

# Scale up if 512 MB starts paging
fly scale memory 1024 --app mounted-games-scoreboard

# Restart (e.g. to pick up a secret change)
fly apps restart mounted-games-scoreboard
```

## 5. Backups

Your DB lives at `/data/mg.db` on the Fly volume. To copy it down:

```powershell
fly ssh console --app mounted-games-scoreboard -C "cat /data/mg.db" > mg-backup-$(Get-Date -Format yyyyMMdd).db
```

Run that nightly via a scheduled task if the comp is mid-event.

## 6. Custom domain (later)

If you ever want `scoreboard.yourdomain.com` instead of the `.fly.dev` one:

```powershell
fly certs add scoreboard.yourdomain.com --app mounted-games-scoreboard
```

Then add the `A`/`AAAA` records Fly tells you to. Free.

## 7. If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `fly deploy` complains the app name is taken | Someone else grabbed `mounted-games-scoreboard` | Pick a different name in `fly.toml`'s `app = "..."` |
| 500 on first request, logs say SQLite IO error | Volume not mounted | Re-run the `fly volumes create` step, then `fly deploy` |
| SignalR disconnects every few seconds | Machine auto-stopping | Confirm `auto_stop_machines = "off"` in `fly.toml`; redeploy |
| `Invalid admin key` | `Admin__Key` secret not set | `fly secrets set Admin__Key="..." --app mounted-games-scoreboard` |
| Out-of-memory in logs | 512 MB too small for your peak | `fly scale memory 1024 --app mounted-games-scoreboard` |

## Switching to Railway instead

The same Dockerfile works. From the repo root:

```powershell
railway login
railway init   # pick "Empty service"
railway up     # builds + deploys using Dockerfile
railway volume create   # for /data persistence
railway variables set ConnectionStrings__Default="Data Source=/data/mg.db" Jwt__Key="..." Admin__Key="..."
```

Railway's Hobby plan is $5/mo flat with $5 of usage included — slightly more predictable than Fly's per-second billing.
