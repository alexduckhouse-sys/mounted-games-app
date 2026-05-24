# MG App — Mounted Games competition manager

Full-stack live competition manager for Mounted Games events. Replaces paper scoring and timetables with a tap-friendly live dashboard for organisers, trainers, and spectators.

- **Frontend**: React + Vite + TypeScript + Tailwind + Framer Motion (`/web`)
- **Backend**: ASP.NET Core (.NET 10) + EF Core + SQLite + SignalR + Identity/JWT (`/api`)
- **Realtime**: SignalR (chat, session status, live scoring)
- **Weather**: Open-Meteo (no API key required)

## Quick start

Open two terminals.

### 1. Backend (port 5050)

```powershell
cd api
dotnet run
```

On first run, the API automatically applies EF Core migrations and seeds a demo competition (`Spring Open 2026`) with clubs, sections, teams, sessions, races, and dec forms.

The SQLite database file (`mg.db`) is created alongside the project. Delete it any time to reseed from scratch.

### 2. Frontend (port 5173)

```powershell
cd web
npm install   # first time only
npm run dev
```

Vite proxies `/api` and `/hubs` to `http://localhost:5050`, so the frontend talks to the API with no CORS faff in development.

Open <http://localhost:5173>.

## Demo logins

| Email | Password | Role |
|---|---|---|
| `admin@mg.local` | `Admin!234` | Admin / organiser |
| `trainer@mg.local` | `Trainer!234` | Trainer (Warwickshire) |
| `coach@mg.local` | `Trainer!234` | Trainer (Cotswold Edge) |

Admins can score, run sessions, create competitions and clubs. Trainers can see their own teams and submit declaration forms.

## Highlights

- **Big tap-friendly live scoring**: click teams in finishing order — points auto-calculate from the largest heat in the session. Right-click or long-press to mark eliminated (0 pts).
- **Session board**: yellow = in arena, green = finished, neutral = upcoming. Admins flip status with one tap; system messages stream into the live feed.
- **Live feed**: SignalR powers chat, announcements, session status changes, and score updates in one place.
- **Declaration forms**: trainers pre-fill riders from a saved club roster, then submit per team per competition. New riders can be saved back to the roster automatically.
- **Themes**: Meadow, Stable Night, Ocean, Sunset — switchable from the header.
- **Weather**: live conditions from Open-Meteo based on the competition's lat/lon.

## Project layout

```
api/               ASP.NET Core 10 Web API
  Entities/        EF Core domain model
  Data/            AppDbContext + migrations
  Dtos/            Request/response types
  Services/        ScoringService, DbInitializer, mappings
  Hubs/            SignalR LiveHub + broadcaster
  Controllers/     REST endpoints
  Auth/            Roles, JWT TokenService, DTOs
  Program.cs       DI, middleware, hub registration

web/               React + Vite frontend
  src/
    api.ts         Axios client + JWT storage
    auth/          AuthContext
    theme/         ThemeContext (Meadow/Stable Night/Ocean/Sunset)
    live/          SignalR hook
    components/    AppShell, ProtectedRoute, WeatherBadge
    pages/         Dashboard, Login, Competitions, Admin, etc.
    pages/competition/  Tabs: sessions, standings, teams, dec forms, chat, session detail
```

## Scoring rule

In any session, the points for 1st place equal the number of teams in the **largest heat of that session**. All heats in the session use that same scale (so heats with fewer teams still score from the same top value, just without the bottom places). Elimination is always 0.

Example: a session's largest heat has 6 teams → 1st = 6, 2nd = 5, …, 6th = 1, elim = 0.

## Environment

The API reads from `api/appsettings.json` (or environment variables). Key values:

| Key | Default | What it does |
|---|---|---|
| `ConnectionStrings:Default` | `Data Source=mg.db` | SQLite file path |
| `Jwt:Key` | dev secret | **Change this** before any non-local deployment |
| `Jwt:Issuer` / `Jwt:Audience` | MountedGames.* | JWT issuer/audience |
| `Jwt:ExpiryMinutes` | 1440 | Token lifetime (24h) |
| `Cors:Origins` | `http://localhost:5173,4173` | Allowed front-end origins |

## Common tasks

- **Reset the database**: delete `api/mg.db` and `dotnet run` again to re-seed.
- **Add a migration**: `cd api && dotnet ef migrations add <Name>`
- **Build everything for production**: `cd api && dotnet publish -c Release` and `cd web && npm run build` (the SPA output goes to `web/dist`).

## Next ideas

- Wire up an OpenWeatherMap API key as an alternative provider.
- Push notifications for session status changes (PWA).
- Print-friendly PDF exports of standings and dec forms.
- Live spectator view (read-only, no login).
