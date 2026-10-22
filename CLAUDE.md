# Mounted Games — agent guide

MG App manages Mounted Games competitions on phones at events: organisers handle entries, teams and timetables; trainers submit rider declaration forms; supporters, stewards and spectators follow live scoring, standings and chat. It combines an ASP.NET Core 10 API with a React 19, TypeScript and Vite PWA, including offline caching, push notifications, weather and a marketplace. Payments are recorded for manual confirmation; online payment processing is not implemented.

Read `APP_DESIGN.md` before changing behaviour and `PRODUCT_DETAILS.md` for the lifecycle. `docs/README.md` says which docs are current. Check implementation where older documentation disagrees.

Each area has its own guide, loaded when you work there: `api/CLAUDE.md` (glossary, change recipes, scoring rules), `web/CLAUDE.md` (pages, hub events, offline, tests) and `tests/CLAUDE.md` (API test helpers). Each has an `AGENTS.md` symlink for Codex.

## Layout

- `api/Controllers/` — attributed REST controllers, validation and role checks.
- `api/Services/` — scoring, seeding/schema upgrades, DTO mappings, geocoding, equipment and push scheduling.
- `api/Data/` — `AppDbContext`, Identity integration, EF relationship configuration, EF migrations (`Migrations/`) and their idempotent SQL scripts (`Migrations/Scripts/`).
- `api/Entities/` — EF domain entities, users and enums.
- `api/Dtos/` — request/response records in `ApiDtos.cs`.
- `api/Hubs/` — SignalR `LiveHub` and `ILiveBroadcaster`/`LiveBroadcaster`.
- `api/Auth/` — role constants/groups, `[CompetitionAccess]` ownership filter, authentication DTOs and JWT `TokenService`.
- `api/Security/` — security headers, rate limits, trusted proxies and startup secret validation.
- `api/Program.cs` — dependency injection, database provider (Postgres or SQLite), authentication, middleware, endpoints, startup seeding and the `--migrate-database` / `--seed-review-competitions` commands.
- `web/src/` — entry point, routes (`App.tsx`), Axios client (`api.ts`), shared types, styles and service worker.
- `web/src/pages/` — routed screens; `admin/` contains editors, `competition/` event tabs/scoring, and `commerce/`, `operations/`, `seasons/`, `eventTools/` the newer feature areas.
- `web/src/components/` — shared shell, route guards, weather widgets and race diagrams/editors.
- `web/src/auth/` — authentication context and admin edit-mode state.
- `web/src/theme/` — theme context and persisted theme selection.
- `web/src/competition/` — current-competition context.
- `web/src/live/` — SignalR hook, reconnection, and the Cloudflare stream publisher/viewer.
- `web/src/offline/` — public-API cache policy, saved copies and the score outbox.
- `web/src/hooks/` — team notification hook.
- `web/src/lib/` — timing, section, CSV, bib, ticker and push helpers.
- `tests/MountedGames.Api.Tests/` — xUnit API tests (endpoints, hub, security, services).
- `docs/` — specs, design boards, decisions, Neon setup, security review.

## Commands and local connection

| Task | Command (directory) |
| --- | --- |
| Build everything | `npm run build` (repo root: web build, then `dotnet build` of the API) |
| Run locally | `dotnet run` (`api/`, port 5050, SQLite, demo data) and `npm run dev` (`web/`, port 5173) |
| All tests | `npm test` (repo root) |
| API tests | `dotnet test tests/MountedGames.Api.Tests` (xUnit). CI also gates line coverage at 95%: see `.github/workflows/ci.yml` and `scripts/api-coverage.py` |
| Web tests | `npm test` in `web/` (`node --test` suite, then Vitest); `npm run test:coverage` enforces 97% on `lib`, `live`, `hooks`, `components` and friends (`web/vitest.config.ts`; `src/pages/**` is excluded) |
| Lint | `npm run lint` in `web/`; CI fails on any error. No API lint or formatter is configured |
| Prod migrations | `npm run db:migrate` (repo root) against Neon; see `docs/neon-setup.md` |

Vite proxies `/api` and `/hubs` (with WebSockets) to `http://localhost:5050`. Axios uses `/api`. The SignalR hook uses `VITE_LIVE_HUB_URL` when set (production points it straight at the API's Vercel project), otherwise same-origin `/hubs/live`.

## Observed conventions

- Use `[ApiController]`, explicit routes and constructor injection; controllers return DTOs/`ActionResult`. `/healthz` is a small minimal-API exception.
- DTO mapping is handwritten in `Services/Mappings.cs` (`ToDto`/`ToSummary`); keep API records and `web/src/types.ts` aligned. Enums travel as numbers.
- **Database:** Postgres (Neon) in production, SQLite locally and in tests. A schema change needs all of: the entity and `AppDbContext` config, an EF migration (`dotnet ef migrations add`, design time uses Npgsql), an idempotent SQL script in `api/Data/Migrations/Scripts/` (`dotnet ef migrations script <previous> <new> --idempotent`), and a SQLite guard in `DbInitializer` (`CREATE TABLE IF NOT EXISTS` / `EnsureColumnAsync`). On Postgres the API refuses to start with a pending migration, so the script must run on Neon before the API deploys.
- SignalR broadcasts through `ILiveBroadcaster` to `comp:{id}` groups (admins also join `comp:{id}:admins`); keep event names and payloads aligned with `web/src/live/useLiveHub.ts`. Hub methods are anonymous.
- **Authorisation:** use `Auth/Roles.cs` groups. Per-competition work uses `[Authorize(Policy = CompetitionStaff.Policy)]` plus `[CompetitionAccess("id")]` (an authorisation filter reading the route value): admins reach any competition, Trainers the ones they created (`CreatedByUserId`), and anyone on a competition's team (`CompetitionCollaborators`) that one. On the web, `canOrganise(comp)` mirrors that, and `canEdit()` additionally needs admin edit mode. UI guards supplement server checks.
- Authentication uses ASP.NET Identity password checks (lockout after 5 failures) and JWT bearer tokens; shared admin-key login also issues a JWT. The web client stores auth in localStorage (`mg.auth`).
- Web uses function components, React hooks/context and React Router; localStorage persists auth, themes, selected competition and drafts. Styling uses Tailwind plus the `--mg-*` tokens in `web/src/theme/skin.css` (five themes via `data-theme`), Framer Motion and Lucide icons.
- **Tests:** API tests run the real app through `tests/MountedGames.Api.Tests/Infrastructure/ApiFactory.cs` (environment `Testing`, throwaway SQLite, admin-key sign-in, raised rate limits, all outbound HTTP through `StubHttp`). Web tests use Vitest with jsdom; mock `@microsoft/signalr` and `../api` as the existing tests do.
- Preserve scoring: normal first-place points equal the largest heat size in the session, decreasing by placing; elimination scores zero. Race-finals qualifiers award one per finisher; HC teams are excluded from standings/finals seeding.
- `NEXT_STEPS.md` is the cross-chat to-do list; `docs/decisions.md` records settled decisions; feature specs live in `docs/specs/`, design boards in `docs/designs/`.

## Configuration and deployment

- **Production:** two Vercel projects. The website (`mounted-games-app`, root `web/`, `web/vercel.json`) rewrites `/api/*` to the API project `mounted-games-api` (repo root, built from `Dockerfile.vercel`, region `cle1` set in the root `vercel.json`, next to Neon in AWS us-east-2). The browser connects to the SignalR hub on the API project directly, over WebSockets with negotiation skipped. Data is in Neon Postgres. `render.yaml`, `fly.toml` and `DEPLOY.md` describe older hosts that are not in use.
- **Security headers** are defined twice, in `api/Security/SecurityHeadersMiddleware.cs` and `web/vercel.json`; `SecurityTests` fails if they differ, and bans `*` and `unsafe-eval` in the CSP.
- **Required production settings:** `Jwt__Key` (at least 32 bytes), `Database__Provider=postgres`, `DATABASE_URL`. `Admin__Key` is optional (at least 20 bytes if set; without it there's no shared admin login). `SecurityConfiguration` refuses to start outside Development with weak keys, keys taken from `appsettings.json`, or `Database__SeedDemoData=true`.
- Optional: `Jwt__Issuer`, `Jwt__Audience`, `Jwt__ExpiryMinutes`, `Cors__Origins__N`, `Security__KnownProxies__N`, `Security__ProxyKey`, `RateLimits__AuthPerMinute`, `RateLimits__GeocodePerMinute`, `RateLimits__WritesPerMinute`, `Streaming__MaxViewersPerIp`, `What3Words__ApiKey`, `Push__Subject`; frontend build: `VITE_API_BASE`, `VITE_LIVE_HUB_URL`; Vercel runtime: `MG_PROXY_KEY` (read by `web/middleware.ts`).
- Environment variables use `__` for nested keys. There's no user-secrets setup.
- `VapidKeyService` reads `Push:VapidPublicKey`/`Push:VapidPrivateKey` (set on the Vercel API project, so every instance signs with the same keys). Without them, as in local runs, it generates `vapid-keys.json` in the API content root (gitignored).

## Gotchas to flag, not silently fix

- `api/appsettings.json` still holds development JWT/admin key values. Never copy key values into docs or logs.
- **Visitor IPs:** behind Vercel, the API learns a visitor's IP only from `web/middleware.ts`, which sends it with a shared key (`MG_PROXY_KEY` on the website project, the same value as `Security__ProxyKey` on the API project; at least 32 bytes). Without the key every visitor shares one rate-limit partition. The live hub connects to the API project directly and isn't covered (see `docs/security-review.md`).
- Anyone can sign up (`POST /api/auth/signup-trainer`). A Trainer request gets the `TrainerRequest` role until an admin approves it at `/api/admin/trainer-requests`; Manager and Member sign-ups take effect at once. Approved Trainers can create competitions.
- `api/MountedGames.Api.http` is a stale template (port 5140, `/weatherforecast/`).
- **Vercel runs the API as a scaling, scale-to-zero container** (no instance cap). Live-hub messages, viewer totals and rate limits are shared through Redis (`REDIS_URL` from the Upstash integration), each falling back to per-instance memory without it. Viewer sessions stay with the instance holding the connection, and `NotificationScheduler`/`StreamSweeper` only run while an instance is up. Redis-backed tests use `[RedisFact]` and need `REDIS_TEST_URL` (CI provides a Redis service).
