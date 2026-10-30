# Mounted Games — agent guide

MG App manages Mounted Games competitions on phones at events: organisers handle entries, teams and timetables; trainers submit rider declaration forms; supporters, stewards and spectators follow live scoring, standings and chat. It combines an ASP.NET Core 10 API with a React 19, TypeScript and Vite PWA, including offline caching, push notifications, weather and a marketplace. Payments are recorded for manual confirmation; online payment processing is not implemented.

Read `APP_DESIGN.md` before changing behaviour, `docs/designs/design-decisions.md` for the house style and per-page UI/UX rules (25–27 October 2026; every UI PR ticks its "Before you open a UI pull request" checklist), and `PRODUCT_DETAILS.md` for the lifecycle. `docs/README.md` says which docs are current. Check implementation where older documentation disagrees.

Each area has its own guide, loaded when you work there: `api/CLAUDE.md` (glossary, change recipes, scoring rules), `web/CLAUDE.md` (pages, hub events, offline, tests) and `tests/CLAUDE.md` (API test helpers). Each has an `AGENTS.md` symlink for Codex.

Audited workspace skills in `.agents/skills/` (also symlinked into `~/.claude/skills/` and `~/.gemini/config/plugins/shared-from-claude/skills/`):
- `mg-security-audit` — OWASP, auth, MasterAdmin/locks/blocks, IDOR, child safeguarding (`UseInitialOnly`), GDPR PII redaction, CSP/`/embed/`, SignalR and rate-limit audit runbook.
- `mg-ui-ux-audit` — Slick minimalist visual polish, responsive phone (`390×844`) & desktop (`1440×900`), 5 themes, Lite mode, WCAG 2.2 AA, `docs/designs/design-decisions.md` and copywriting (`humanise`) audit runbook.
- `mg-animations-audit` — Framer Motion & CSS motion, `250ms→600ms` hold-to-eliminate, climbing rows, saved tick, celebrations, stream overlays, Follow-Cam replay, `prefers-reduced-motion`, 60fps and new micro-animation opportunities runbook.
- `mg-fresh-persona-walkthrough` — Strict zero-repo-access ("black-box / fresh eyes") 10-persona walkthrough skill (`P1`–`P10`) for testing live user journeys on `https://mounted-games-app.vercel.app` without reading source code.
- `mg-domain-and-data-integrity-audit` — Mounted Games scoring maths, Heat-Heat-Final, final options (`HasFinal`, `CarryPointsIntoFinal`, `DoublePointsInFinal`), tie-breakers, timetable delay cascades and DB schema parity runbook.
- `mg-performance-and-offline-audit` — Rural showground 3G/poor-signal resilience, offline scoring outbox sync, SignalR reconnect reconciliation, bundle/code-splitting and battery/CPU hygiene runbook.
- `mg-livestream-and-broadcast-audit` — Cloudflare SFU WebRTC ingest/WHEP playback, multi-camera switching, Stream Controls (`Overlay · Auto · Replay · Camera`), Follow-Cam replay editor, Commentator Desk and `/embed/` resilience runbook.
- `mg-growth-and-scalability-audit` — Concurrent user capacity modelling, SQLite vs Neon Postgres scaling, SignalR `LiveHub` thundering-herd/fan-out analysis, EF Core N+1 detection, showground shared-NAT rate-limit safety and viral growth loops runbook.
- `mg-irritants-and-annoyances-audit` — Premature offline/reconnecting banners, cold-start loading flickers, SignalR live-update input/scroll clobbering, lost filter/tab state on Back navigation, iOS `<16px` auto-zoom, toast spam and thumb-zone touch hazard runbook.
- `mg-navigation-consolidation-and-inline-ux-audit` — Back-button destination accuracy, context-preserving navigation, inline/in-page expansion (e.g. viewing heat tables directly inside team views instead of jumping pages) and route/page consolidation runbook.
- `mg-missing-features-and-gaps-audit` — Half-wired settings/buttons, backend-to-frontend parity gaps, unimplemented spec promises and real-world Mounted Games missing features runbook.
- `mg-contract-and-null-safety-audit` — C# API DTO (`ApiDtos.cs` / `CommerceDtos.cs` / `StatsDtos.cs`) vs TypeScript (`web/src/types.ts`) contract parity, enum alignment, SignalR payload matching and runtime null/undefined safety runbook.
- `mg-copy-and-humanise-audit` — UK English spelling, `humanise` natural copywriting, developer-jargon removal, error message friendliness and transactional/custom email template audit runbook.
- `mg-dead-code-and-duplication-audit` — Dead code, orphaned files/components, unused CSS classes, duplicate frontend/backend helpers, pointless wrappers and tech-debt cleanup runbook.
- `mg-money-and-commerce-audit` — Entry fees, stabling maths, BACS references, Club Shop pricing/variants/stock concurrency, seller payouts, floating-point rounding and currency formatting audit runbook.
- `mg-production-readiness-and-ops-audit` — Production readiness, silent failure / swallowed catch blocks, PWA service worker update traps, Vercel scale-to-zero duplicate background jobs, third-party outage resilience and destructive-action safety runbook.
- `mg-timezones-and-multiday-audit` — Timezone handling, BST→GMT Daylight Saving Time clock-change weekend, multi-day competition rollover, HeatRing countdowns, declaration deadlines and `.ics` calendar feed accuracy runbook.

Multi-model audit reports live in `docs/audits/antigravity/`, `docs/audits/claude/`, and `docs/audits/codex/` so duplicate runs across models never overwrite each other.

## Layout

- `api/Controllers/` — attributed REST controllers, validation and role checks.
- `api/Services/` — scoring, seeding/schema upgrades, DTO mappings, geocoding, equipment and push scheduling.
- `api/Data/` — `AppDbContext`, Identity integration, EF relationship configuration, EF migrations (`Migrations/`) and their idempotent SQL scripts (`Migrations/Scripts/`).
- `api/Entities/` — EF domain entities, users and enums.
- `api/Dtos/` — request/response records in `ApiDtos.cs` (plus `CommerceDtos.cs`, `StatsDtos.cs`, `OperationsDtos.cs`).
- `api/Hubs/` — SignalR `LiveHub` and `ILiveBroadcaster`/`LiveBroadcaster`.
- `api/Auth/` — role constants/groups, `[CompetitionAccess]` ownership filter, authentication DTOs and JWT `TokenService`.
- `api/Security/` — security headers, rate limits, trusted proxies and startup secret validation.
- `api/Program.cs` — dependency injection, database provider (Postgres or SQLite), authentication, middleware, endpoints, startup seeding and the `--migrate-database`, `--seed-review-competitions` / `--reseed-review-competitions`, `--seed-history` and `--import-competition <file>` (`--dry-run`, `--finals-only`) commands.
- `web/src/` — entry point, routes (`App.tsx`), Axios client (`api.ts`), shared types, styles and service worker.
- `web/src/pages/` — routed screens: `admin/` (site admin dashboard, competitions, trainer requests, users, blocked accounts, custom email, rules library, and the 10-step `creator/` competition wizard), `competition/` (event tabs, full-screen phone scoring, stream controls, live stream, commentary desk, TV kiosk, announcements, WhatsApp-style message threads, weather, arena, team page), `operations/` (Preparations, Event details, Sections & races, Timetable & draw, Equipment, Sponsors & sharing, Entries & dec forms, Rulebooks), and `commerce/`, `seasons/`, `stats/`, `eventTools/`, `embed/`, `profile/`, `refine/`.
- `web/src/components/` — shared shell (`AppShell`, `NavigationDrawer`, `BottomTabs`, `TopBarTicker`), route guards, 8-kind pop-ups & warnings kit (`ConfirmDialog`, `BottomSheet`), QR generator/scanner, weather widgets, `stream/` overlays/replay, and race diagrams/editors.
- `web/src/i18n/` — English, Welsh and French message catalogues (`en`, `cy`, `fr`); cy/fr are AI drafts (see `REVIEW.md`).
- `web/src/auth/` — authentication context (`canEdit`, `canOrganise`, `canManage`; there is no edit-mode switch).
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
- **Authorisation:** use `Auth/Roles.cs` groups (`Admin`, `MasterAdmin`, `Trainer`, `TrainerRequest`, `ManagerRequest`, `Manager`, `Member`, `Rider`). Per-competition work uses `[Authorize(Policy = CompetitionStaff.Policy)]` plus `[CompetitionAccess("id")]` (an authorisation filter reading the route value): admins reach any competition, Trainers the ones they created (`CreatedByUserId`), and anyone on a competition's team (`CompetitionCollaborators`) that one. On the web, `canOrganise(comp)` mirrors that, and `canEdit()` is true for admins. Site admins can lock/unlock organisers (`LockedAt`) and block accounts (`BlockedAt`); only a `MasterAdmin` (`POST /api/auth/master-admin` with `MasterAdmin__KeyHash`) can lock/unlock or block/unblock an `Admin` or grant/revoke the `Admin` role. There is no edit mode. UI guards supplement server checks.
- Authentication uses ASP.NET Identity password checks (lockout after 5 failures) and JWT bearer tokens (`LiveAccounts` checks every request and hub connection uncached and rejects tokens for deleted, locked or blocked accounts, or an older `SessionVersion`, at once on every instance; lock, block, password reset and change all bump `SessionVersion`); shared admin-key login (`POST /api/auth/admin-key`) with an email also requires a password, creating or verifying a password-protected `Admin` account so the organiser can sign in from the general `/login` tab on their next visit and nobody can impersonate their email without their password. Admins can also invite organisers or site admins via one-time 7-day email links (`/invite#t=...`, `AccountInvite`). Password reset (email link) and Google/Apple/Facebook sign-in (`POST /api/auth/external`, providers from `GET /api/auth/providers`) also exist. The web client stores auth in localStorage (`mg.auth`).
- **Rider privacy:** a one-letter surname forces `UseInitialOnly` (roster, rider swap, sign-up and guest riders). There is no per-rider filming opt-out: the event entry terms cover filming and footage isn't close-up. The old `NoFilming` columns stay in the database, unused. Public results, the results book and the archive use only locked declaration forms and honour `SavedRider.UseInitialOnly`; names go through `RiderNames.Display` (API) and `publicRiderName` (web). A saved-rider roster is open only to an admin or an approved trainer/manager of that club (`SharesClubRosterAsync`), not to any member who picked the club.
- **Entries and money:** a free or demo-paid entry forms its team at once, as mark-paid does (`FormTeamsCoreAsync`). Stabling is bought in the event shop only; the sign-up request carries no stable fee or nights. Deleting a competition returns 409 while shop orders or season rounds exist; deleting a section returns 409 if it is a season round. `CancelRace` returns 409 when the race has recorded or signed-off results.
- Web uses function components, React hooks/context and React Router; localStorage persists auth, themes, selected competition and drafts. Styling uses Tailwind plus the `--mg-*` tokens in `web/src/theme/skin.css` (five themes via `data-theme`: `eguk`, `meadow`, `stable-night`, `ocean`, `sunset`), the Refine control system (`web/src/pages/refine/Refine.tsx` & `controls.tsx` following `docs/designs/design-decisions.md`), Framer Motion and Lucide icons.
- **Tests:** API tests run the real app through `tests/MountedGames.Api.Tests/Infrastructure/ApiFactory.cs` (environment `Testing`, throwaway SQLite, admin-key sign-in, raised rate limits, all outbound HTTP through `StubHttp`). Web tests use Vitest with jsdom; mock `@microsoft/signalr` and `../api` as the existing tests do.
- Preserve scoring: normal first-place points equal the largest heat size in the session, decreasing by placing; lettered Finals (`A/B/C Final`) score from the final heat's own team count (doubled on save when `DoublePointsInFinal` is on, and totalled with or without earlier points per `CarryPointsIntoFinal` in `SectionScoring`); elimination scores zero; sit-outs score zero and display as `S`. Race-finals qualifiers award one per finisher; HC teams are excluded from standings/finals seeding.
- `NEXT_STEPS.md` is the cross-chat to-do list; `docs/decisions.md` records settled architecture/domain decisions; `docs/designs/design-decisions.md` records the settled UI/UX house style; feature specs live in `docs/specs/`, design boards in `docs/designs/`.

## Configuration and deployment

- **Production:** two Vercel projects. The website (`mounted-games-app`, root `web/`, `web/vercel.json`) rewrites `/api/*` to the API project `mounted-games-api` (repo root, built from `Dockerfile.vercel`, region `cle1` set in the root `vercel.json`, next to Neon in AWS us-east-2). The browser connects to the SignalR hub on the API project directly, over WebSockets with negotiation skipped. Data is in Neon Postgres: the Vercel-billed store `mounted-games-db`, connected to the API project for Production only (moved 30 October 2026; see `docs/neon-setup.md`). `render.yaml`, `fly.toml` and `DEPLOY.md` describe older hosts that are not in use.
- **Security headers** are defined twice, in `api/Security/SecurityHeadersMiddleware.cs` and `web/vercel.json`; `SecurityTests` fails if they differ, and bans `*` and `unsafe-eval` in the CSP.
- **Required production settings:** `Jwt__Key` (at least 32 bytes), `Database__Provider=postgres`, `DATABASE_URL`. `Admin__Key` is optional (at least 20 bytes if set; without it there's no shared admin login). `SecurityConfiguration` refuses to start outside Development with weak keys, keys taken from `appsettings.json`, or `Database__SeedDemoData=true`.
- Optional: `Jwt__Issuer`, `Jwt__Audience`, `Jwt__ExpiryMinutes`, `MasterAdmin__KeyHash` (SHA-256 hex of the master admin secret), `Privacy__IpHashKey`, `Privacy__IpRetentionDays`, `Cors__Origins__N`, `Security__KnownProxies__N`, `Security__ProxyKey`, `RateLimits__AuthPerMinute` (default 5/min per IP), `RateLimits__AccountsPerIp` (default 5 retained accounts per IP across `signup-trainer` and `admin-key`), `RateLimits__GeocodePerMinute`, `RateLimits__SponsorExposurePerMinute`, `RateLimits__WritesPerMinute`, `RateLimits__PublicReadsPerMinute`, `Sharing__PublicBaseUrl`, `Streaming__MaxViewersPerIp`, `What3Words__ApiKey`, `Push__Subject`, `Email__Enabled`, `Email__ApiKey`, `Email__From`, `Email__SiteUrl`, `Email__TimeoutSeconds`, `Email__CustomBatchSize`, `Email__CustomBatchSeconds`; frontend build: `VITE_API_BASE`, `VITE_LIVE_HUB_URL`; Vercel runtime: `MG_PROXY_KEY` and `MG_API_ORIGIN` (both read by `web/middleware.ts`; the second defaults to the API project).
- Environment variables use `__` for nested keys. There's no user-secrets setup.
- `VapidKeyService` reads `Push:VapidPublicKey`/`Push:VapidPrivateKey` (set on the Vercel API project, so every instance signs with the same keys). Without them, as in local runs, it generates `vapid-keys.json` in the API content root (gitignored).

## Gotchas to flag, not silently fix

- `api/appsettings.json` still holds development JWT/admin key values. Never copy key values into docs or logs.
- **Sharing:** link previews (Open Graph), calendar files and feeds, and QR codes. Preview crawlers don't run JavaScript, so `web/middleware.ts` answers them for `/`, `/competitions/*` and `/team-profiles/*` with a small page of `og:`/`twitter:` tags built by `web/src/lib/shareCard.ts` from the public `GET /api/share/*` cards (every value escaped; image is `web/public/og/mounted-games.png`). Calendar: `CalendarController` plus `api/Services/Calendar/`; a team's feed link holds an unguessable token whose SHA-256 is stored, never the token. QR codes are drawn in the browser (`uqr`).
- **Visitor IPs:** behind Vercel, the API learns a visitor's IP only from `web/middleware.ts`, which sends it with a shared key (`MG_PROXY_KEY` on the website project, the same value as `Security__ProxyKey` on the API project; at least 32 bytes). Without the key every visitor shares one rate-limit partition. The live hub connects to the API project directly and isn't covered (see `docs/security-review.md`), so the per-address anonymous viewer cap (`Streaming__MaxViewersPerIp`) applies only when the address is trusted (proxy key matched or known proxies configured); the per-stream total cap always applies.
- Anyone can sign up (`POST /api/auth/signup-trainer`, naming a club). A Trainer request gets `TrainerRequest` (approved by an admin or that club's Manager) and a Team Manager request gets `ManagerRequest` (approved by an admin) at `/admin/trainer-requests`; Member sign-ups take effect at once. Approved Trainers can create competitions.
- **Vercel runs the API as a scaling, scale-to-zero container** (no instance cap). Live-hub messages, viewer totals and rate limits are shared through Redis (`REDIS_URL` from the Upstash integration), each falling back to per-instance memory without it. Viewer sessions stay with the instance holding the connection, and `NotificationScheduler`/`StreamSweeper` only run while an instance is up. Redis-backed tests use `[RedisFact]` and need `REDIS_TEST_URL` (CI provides a Redis service).
