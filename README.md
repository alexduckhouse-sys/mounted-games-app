# MG App — Mounted Games Competition Manager

Full-stack live competition platform for Mounted Games events, built for phones in a field on one bar of signal and laptops in the secretary's tent. Organisers set up competitions, take entries, manage stabling and draws, run live scoring and stream cameras; trainers and team managers submit declaration forms and manage club rosters; riders, parents and spectators follow live timetables, heat tables, toplists, weather, streams, stats and seasons.

- **Frontend (`/web`)**: React 19 + TypeScript + Vite 8 PWA + Tailwind CSS + Framer Motion (5 themes: `eguk`, `meadow`, `stable-night`, `ocean`, `sunset`, plus automatic low-signal `Lite mode`, offline public cache and score outbox).
- **Backend (`/api`)**: ASP.NET Core 10 + EF Core (Neon Postgres in production, SQLite locally and in tests) + SignalR (`LiveHub` with optional Upstash Redis backplane) + ASP.NET Identity & JWT.
- **Live Video & Weather**: Cloudflare Realtime SFU (`BroadcastPage`, `StreamControlsPage` with 30-min IndexedDB circular replay buffer & Follow-Cam) + Open-Meteo hourly venue forecasts.

For full engineering rules, architecture and invariants, read:
- [`CLAUDE.md`](./CLAUDE.md) (and [`api/CLAUDE.md`](./api/CLAUDE.md), [`web/CLAUDE.md`](./web/CLAUDE.md), [`tests/CLAUDE.md`](./tests/CLAUDE.md))
- [`docs/designs/design-decisions.md`](./docs/designs/design-decisions.md) — UI/UX house style and per-page design decisions
- [`APP_DESIGN.md`](./APP_DESIGN.md) & [`PRODUCT_DETAILS.md`](./PRODUCT_DETAILS.md) — domain model and competition lifecycle
- [`docs/README.md`](./docs/README.md) — full documentation and `.agents/skills/` audit index

---

## Quick Start (Local Development)

Open two terminals:

### 1. Backend API (port `5050`, SQLite)

```bash
cd api
dotnet run
```

On first run in Development, the API automatically creates `api/mg.db`, applies schema upgrades, and seeds demo competitions, clubs, sections, teams, sessions, races, rulebooks (EGUK, Pony Club, MGA, STRUK), and declaration forms.

### 2. Frontend PWA (port `5173`)

```bash
cd web
npm install   # first time only
npm run dev
```

Vite proxies `/api` and `/hubs` (with WebSockets) to `http://localhost:5050`. Open <http://localhost:5173>.

---

## Commands & Quality Gates

| Task | Command (directory) |
| --- | --- |
| Build everything | `npm run build` (repo root: builds `web/` then `dotnet build` on `api/`) |
| Run all tests | `npm test` (repo root) |
| API integration tests | `dotnet test tests/MountedGames.Api.Tests` (xUnit; CI gates line coverage at **95%**) |
| Web lint & tests | `cd web && npm run lint && node --test tests/*.test.mjs && npm run test:coverage` (CI gates coverage at **97%**) |
| Reseed 8 review events | `npm run db:reseed-review` (repo root) |
| Seed historical archive | `npm run db:seed-history` (repo root) |
| Apply prod migrations | `npm run db:migrate` (against Neon Postgres; see `docs/neon-setup.md`) |

---

## Local Development Accounts (Development Only)

| Email | Password | Role |
| --- | --- | --- |
| `admin@mg.local` | *(use Admin key in dev/tests)* | Site Admin / Master Admin (Development) |
| `trainer@mg.local` | `Trainer!234` | Approved Trainer (Warwickshire) |
| `coach@mg.local` | `Trainer!234` | Approved Trainer (Cotswold Edge) |

Outside Development, demo seeding is disabled (`Database__SeedDemoData=false` required) and `SecurityConfiguration` enforces strong deployment secrets (`Jwt__Key`, optional `Admin__Key`, optional `MasterAdmin__KeyHash`). See [`CLAUDE.md`](./CLAUDE.md) and [`docs/security-review.md`](./docs/security-review.md).
