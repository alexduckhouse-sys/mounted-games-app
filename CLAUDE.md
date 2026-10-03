# Mounted Games — agent guide

MG App manages Mounted Games competitions on phones at events: organisers handle entries, teams and timetables; trainers submit rider declaration forms; supporters, stewards and spectators follow live scoring, standings and chat. It combines an ASP.NET Core 10 API with a React 19, TypeScript and Vite PWA, including offline caching, push notifications, weather and a marketplace. Payments are recorded for manual confirmation; online payment processing is not implemented.

Read `APP_DESIGN.md` before changing behaviour; use `PRODUCT_DETAILS.md` for the lifecycle and `README.md` for setup. Check implementation where older documentation disagrees.

## Layout

- `api/Controllers/` — attributed REST controllers, validation and role checks.
- `api/Services/` — scoring, seeding/schema upgrades, DTO mappings, geocoding, equipment and push scheduling.
- `api/Data/` — `AppDbContext`, Identity integration and EF relationship configuration; no migrations directory.
- `api/Entities/` — EF domain entities, users and enums.
- `api/Dtos/` — request/response records in `ApiDtos.cs`.
- `api/Hubs/` — SignalR `LiveHub` and `ILiveBroadcaster`/`LiveBroadcaster`.
- `api/Auth/` — role constants/groups, authentication DTOs and JWT `TokenService`.
- `api/Program.cs` — dependency injection, SQLite, authentication, middleware, endpoints and startup seeding.
- `web/src/` — entry point, routes (`App.tsx`), Axios client (`api.ts`), shared types, styles and service worker.
- `web/src/pages/` — routed screens; `admin/` contains editors and `competition/` contains event tabs/scoring.
- `web/src/components/` — shared shell, route guards, weather widgets and race diagrams/editors.
- `web/src/auth/` — authentication context and admin edit-mode state.
- `web/src/theme/` — theme context and persisted theme selection.
- `web/src/competition/` — current-competition context.
- `web/src/live/` — SignalR connection/event hook.
- `web/src/hooks/` — team notification hook.
- `web/src/lib/` — timing, section, CSV, bib and push helpers.

## Commands and local connection

Run commands in the indicated directory. Sources: `README.md`, `api/MountedGames.Api.csproj`, `web/package.json` and `Dockerfile`.

| Task | API (`api/`, .NET 10 SDK) | Web (`web/`) |
| --- | --- | --- |
| Build/release | `dotnet publish -c Release` | `npm run build` (`tsc -b` then Vite; output `dist/`) |
| Run locally | `dotnet run` | `npm run dev` |
| Preview build | No separate command documented | `npm run preview` |
| Test | No test project or command supplied | No test script or suite supplied |
| Lint | No lint command supplied | `npm run lint` (ESLint) |
| Format | No formatter command/configuration supplied | No format script/configuration supplied |

These commands are source-verified but execution is **unverified**: this checkout has no `web/node_modules`, API restore assets or default NuGet package cache. No installs or builds were run.

Vite listens on 5173 and proxies `/api` and `/hubs` (including WebSockets) to `http://localhost:5050`, matching `api/Properties/launchSettings.json`. Axios defaults to `/api`; optional build-time `VITE_API_BASE` overrides only Axios. The SignalR hook always uses same-origin `/hubs/live`. Production serves both halves from one origin.

## Observed conventions

- Use `[ApiController]`, explicit routes and constructor injection; controllers return DTOs/`ActionResult`. `/healthz` is a small minimal-API exception.
- DTO mapping is handwritten in `Services/Mappings.cs` (`ToDto`/`ToSummary`); keep API records and `web/src/types.ts` aligned.
- EF Core uses SQLite (`UseSqlite`) and `IdentityDbContext<AppUser>`. Startup runs `EnsureCreatedAsync` plus additive SQL/`EnsureColumnAsync` in `DbInitializer`; preserve existing data when extending the schema.
- SignalR broadcasts through `ILiveBroadcaster` to competition groups; keep event names/payloads aligned with `web/src/live/useLiveHub.ts`.
- Authentication uses ASP.NET Identity password checks and JWT bearer tokens; shared admin-key login also issues a JWT. Use `Auth/Roles.cs` groups for authorisation; the web client stores auth in localStorage and adds a bearer header.
- Web uses function components, React hooks/context and React Router; localStorage persists auth, themes, selected competition and drafts. Styling uses Tailwind utilities/shared CSS, `data-theme`, Framer Motion and Lucide icons.
- `AuthContext.canEdit()` requires admin edit mode; `canOrganise()` admits Admin, Trainer and Manager. UI guards supplement server authorisation.
- Preserve scoring: normal first-place points equal the largest heat size in the session, decreasing by placing; elimination scores zero. Race-finals qualifiers award one per finisher; HC teams are excluded from standings/finals seeding.

## Configuration and deployment

- `render.yaml` appears to be the default dev/demo path: it leads `DEPLOY.md`. `fly.toml` is the documented production path with persistent SQLite and an always-on machine. Both remain configured; the active host cannot be established from these files alone.
- `Dockerfile` builds both halves, copies `web/dist` into API `wwwroot`, and serves the SPA with a fallback. Container/Fly/Render use port 8080 and `/healthz`.
- Deployment environment names: `ASPNETCORE_ENVIRONMENT`, `ASPNETCORE_URLS`, `ConnectionStrings__Default`; Fly also sets `Cors__Origins__0`.
- Required deployment secrets: `Jwt__Key`, `Admin__Key`. Render generates the former and requires the latter manually; Fly instructions set both as secrets.
- Optional overrides: `Jwt__Issuer`, `Jwt__Audience`, `Jwt__ExpiryMinutes`, `Cors__Origins__0` (and further indexed origins), `What3Words__ApiKey`, `Push__Subject`; frontend: `VITE_API_BASE`.
- API defaults live in `api/appsettings.json`, with development overrides in `api/appsettings.Development.json`; environment variables use `__` for nested keys. No `UserSecretsId` or explicit user-secrets registration is present; do not assume user-secrets are configured.
- `VapidKeyService` generates `vapid-keys.json` in the API content root; it is gitignored and contains the push keypair. There are no configured VAPID key environment overrides.

## Gotchas to flag, not silently fix

- Committed JWT/admin key values are in `api/appsettings.json`; `appsettings.Development.json` contains logging only. Never copy key values into docs/logs. Seeding also creates demo accounts with hard-coded passwords, without a development-only guard.
- README migration claims are stale: there are no EF migration files, and startup uses the additive schema path above. Startup also refreshes built-in race templates.
- `api/MountedGames.Api.http` is a stale template using port 5140 and `/weatherforecast/`; the real local API uses 5050 and controller routes under `/api`.
- Render's configured SQLite file is ephemeral (`/tmp/mg.db`); its documented idle sleep interrupts SignalR. Fly persists `/data/mg.db`.
- VAPID keys live in `/app/vapid-keys.json` in Docker, outside Fly's `/data` mount, despite a source comment saying “next to the DB”; replacing the container can invalidate push subscriptions.
- Manager is accepted by organiser role helpers, but competition editor route guards in `web/src/App.tsx` admit only Admin/Trainer.
- There are no automated test suites, no API lint command and no formatter commands. Do not invent scripts or report unrun checks as passing.
