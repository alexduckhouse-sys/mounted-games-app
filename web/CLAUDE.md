# Web — agent guide

React 19 + TypeScript + Vite PWA, used mostly on phones in fields with one bar of signal. Treat slow or dropped connections as the normal case. Repo-wide rules are in `../CLAUDE.md`; terms are explained in `../api/CLAUDE.md`.

## Where things live (beyond the root layout)

- `src/lite/` and `src/theme/lite.ts`: lite mode (stored as `mg.lite`, with automatic detection for `navigator.connection.saveData` / `2g`). `useLiteMode()` / `isLite()` gates images (`components/LazyImage.tsx`), weather, the live video player, CSS blur/pulse animations and SignalR event batching. Use `LazyImage` for any remote picture.
- `src/offline/`: public-API cache policy, saved copies, the score outbox. `src/weather/`: weather request cache.
- `src/live/`: SignalR hook, `recoverConnection` (backoff and rejoin), `replayBuffer.ts` (30-minute IndexedDB circular replay buffer with clip export), and the Cloudflare stream publisher, viewer and runtime. `src/components/stream/` (including `ReplayInspector.tsx`): the stream and Follow-Cam replay UI.
- `src/pages/competition/`: event tabs and screens including `TimetableTab.tsx`, `TimetableBoard.tsx`, `WeatherPage.tsx` (`/competitions/:id/weather`), `ScoringTab.tsx`, `ToplistView.tsx`, `CompetitionTeamPage.tsx` (`/competitions/:id/teams/:teamId`), `ChatTab.tsx`, `BroadcastPage.tsx`, `ArenaTab.tsx`, `SessionPage.tsx`.
- `src/pages/{commerce,operations,seasons,eventTools}/`: feature pages, with feature types kept next to them (`*Types.ts`). Legal & policy tabs (`/privacy`, `/terms`, `/refunds`, `/cookies`, `/safeguarding`) live in `src/pages/PrivacyPage.tsx`, linked from `src/pages/SettingsPage.tsx` (`/settings`).
- `src/test/`: Vitest setup, `factories.ts`, `streamFakes.ts`. `tests/*.test.mjs`: the node test suite.
- `middleware.ts` (Vercel routing middleware: `/api/*` visitor IP, plus link-preview pages for crawlers on `/`, `/competitions/*` and `/team-profiles/*`) and `vercel.json` (rewrites, headers, build command).

## Commands (`web/`)

| Task | Command |
| --- | --- |
| Everything CI runs | `npm run lint && node --test tests/*.test.mjs && npm run test:coverage && npm run build` |
| One node test | `node --test tests/csv.test.mjs` (add `--test-name-pattern=...`) |
| One Vitest file | `npx vitest run src/live/useLiveHub.test.ts -t "name"` |

Lint must be clean: CI runs it. Vitest coverage has a **97% gate** (lines, statements, branches, functions) on `api.ts`, `pwa.ts`, `lib`, `auth`, `theme`, `competition`, `live`, `hooks`, `lite`, `offline`, `weather` and `components`. A new file there needs its own test. `pages/**` is excluded but should still get tests for logic.

## Recipes

- **Page:** add a `lazy(() => import('./pages/X').then(m => ({ default: m.X })))` and a `<Route>` inside the `AppShell` route in `src/App.tsx`. Wrap it in `<ProtectedRoute roles={[...]}>` if needed. Add a link in `components/NavigationDrawer.tsx`. If it's an admin-only page that needs a connection anyway, add its chunk to `injectManifest.globIgnores` in `vite.config.ts`.
- **Competition tab:** add a file in `pages/competition/` and a child route under `competitions/:id`. Read data from `useCompetition()` (`pages/competition/context.ts`) rather than fetching the competition again.
- **API call:** use `api` from `src/api.ts`, which adds the token, a 15 s GET timeout, rejects HTML pages served in place of JSON, and clears auth on 401. Add types to `src/types.ts` to match the API DTOs (enums are numbers). Guard the response shape before use (see `hooks/useCompetitionStreams.test.ts`).
- **Hub event:** in `live/useLiveHub.ts`, add `onX?` to `LiveHandlers` and `conn.on('x', forward(...))`. Then handle it in `pages/CompetitionPage.tsx`. `forward` drops events from a replaced connection, so always use it. Put catch-up fetches in `onReady` (runs after every rejoin), not in the event handler. Names must match `api/Hubs/` exactly.
- **Offline read:** a GET can be cached only if every viewer sees the same response. Add it to `offline/cachePolicy.ts` and extend `tests/offline-cache.test.mjs`. If you change the cache shape, bump the cache name in `sw.ts` (now `mg-public-api-v2`).
- **Offline write:** follow the score outbox (`offline/scoreOutbox.ts` logic, `useScoreOutbox.ts` storage). Queue the item with the `expected` state so the server can answer with a conflict, rather than overwriting.
- **Sponsor placement** (a new place a sponsor can appear): three steps, in this order.
  1. Add the next power of two to `SponsorPlacement` in `api/Entities/Sponsor.cs`.
  2. Add one entry to `SPONSOR_PLACEMENTS` in `src/lib/sponsors.ts`: `{ key, placement, label, description }`. The organiser's "Show on" boxes in `pages/competition/SponsorsCard.tsx` come from this list, and a test in `lib/sponsors.test.ts` fails if its bits differ from the enum.
  3. Put a slot where it should show: `<SponsorStrip placement="YourKey" />` on a page, or read `sponsorsFor(sponsors, 'YourKey')` (via `useSponsors`) for something custom, and call `useRecordSponsorViews('YourKey', list)` so it is counted. The exposure endpoint accepts any defined placement, so nothing else changes.
  Sponsors come from `CompetitionContext` (`sponsors`, fetched by `hooks/useSponsorFeed.ts`); the public list is cached offline (`offline/cachePolicy.ts`), the organiser list (`/sponsors/manage`) never is. Video overlays live in `components/stream/SponsorOverlay.tsx`; the producer's switch is `overlay.sponsorMode` and "skip" arrives as the `sponsorControl` hub event.
- **Theme token:** add `--mg-*` RGB channels to `theme/skin.css` (`:root, [data-theme="eguk"]` is the full base set) and use them as `rgb(var(--mg-x) / 0.5)`. A new theme needs a `ThemeName` and `THEMES` entry in `theme/themes.ts` plus a `[data-theme]` block. Tailwind `brand-*` colours come from `--brand-*` in `index.css`.

## Tests

- **node suite** (`tests/*.test.mjs`): imports `.ts` sources directly through Node's type stripping. Only for dependency-free modules: no enums, JSX, DOM or package imports.
- **Vitest** (jsdom, `src/**/*.test.{ts,tsx}`): mocks are reset before every test, so set implementations in `beforeEach`. `src/test/setup.ts` clears storage, cookies and `data-theme` after each test.
  - To mock SignalR, copy `src/live/useLiveHub.test.ts`.
  - To mock `../api`, copy `src/hooks/useCompetitionStreams.test.ts`.
  - To mock auth, the API and the hub together, copy `pages/competition/ChatTab.auth.test.tsx`.
  - For WebRTC fakes, use `src/test/streamFakes.ts`.

## Sharing

- **QR codes:** `components/QrCode.tsx` draws inline SVG from `lib/qr.ts` (`uqr`, MIT, no dependencies); no QR data leaves the browser. Always black on white with a quiet zone, whatever the theme. Staff can scan permission QR codes directly in the browser via `components/QrPermissionScannerModal.tsx` (opened from `NavigationDrawer.tsx`), which validates the `"mg-scorer-v1"` scope key before navigating to `/score`.
- **Venue poster:** `pages/eventTools/PosterPage.tsx`, reached as `/event-tools/:id/print/poster`; public event data only, shown to `canOrganise(competition)`. Styles live in `printEvent.css` (A4 and phone).
- **Calendar:** the Details tab links straight to `/api/competitions/:id/calendar.ics?site=<origin>` (the service worker never handles `/api`). A team's feed link is made on My Teams (`pages/TeamSharing.tsx`), shown once, and opens as `webcal://`. A team QR carries `/teams?join=KEY`, which fills the join box; `ProtectedRoute` keeps the query string through sign-in.

## Gotchas

- **Roles:** `canEdit()` = Admin (there is no edit mode). `canOrganise(comp)` = Admin, the Trainer who owns `comp`, or a competition-team member; `canManage` is the same function. Manager isn't in any route guard. `ChatTab.tsx` shows how to combine them. UI checks only hide controls; the API decides.
- **Scorer links:** `/score` (outside `AppShell`) is where a volunteer scores any race in one competition from `/score#t=<token>`. The token goes in `localStorage` (`mg.scorer.token`) and is sent only by `scorerApi` in `offline/scorerLink.ts` as `X-Scorer-Token`; never use `api` for it, because a 401 there clears a signed-in user. Its saves share the score outbox with `viaLink: true`. `ScoringSection` is shared with `SessionPage` (there is no race clock); lane rules, sit-outs and the heat-heat-final qualifier cap live in `pages/competition/laneRules.ts` and `lib/raceScoring.ts`, so both pages score the same way.
- **Scoring page** (`ScoringSection` + `ScoringParts`, spec `docs/specs/scoring-page-redesign.md`): races are a stack (current open, finished ones a line, upcoming ones list their lanes); rows are always in lane order for the race (`lib/laneOrder.ts`), with `components/BibSwatch`. `lib/queuedView.ts` shows saves still waiting in the outbox as sent, so the announcer summary (`lib/raceSummary.ts`, tie-break mirrors `TieBreaker.cs`) and next-round lanes (`lib/nextRoundLanes.ts`) don't wait for signal. Undo (`lib/scoreUndo.ts`) keeps the last 10 actions; an undone save is cancelled while it waits in the outbox, or sent back as a correction. Elimination reasons (`lib/elimReasons.ts`) are stored as the private referee note. Points overrides and adjustments (SessionPage organiser tools) are `[pts:N]` / `[adj:±N]` directives in that note, whole or half points only; a run-off winner is saved as a finals tie order, not as points. HC uses `PUT /competitions/{id}/teams/{id}` with `isHorsConcours`.
- **Entry phase:** `lib/competitionPhase.ts` is the one place that decides it. A competition with no session that has heats and nothing started is in the `entry` phase, even once teams are formed (BUG-32); the public then gets the entry page (`pages/competition/EntryPage.tsx`, also at `/competitions/:id/enter`) as its home, but every other tab stays open. Once every final is complete the phase is `complete` and home shows the toplist. `canOrganise` users always get the normal layout. Change the rule there, not in the components.
- **Staff-only chat:** messages with `adminOnly` are hidden from non-staff. Trainer messaging appears only when `competition.staffChatEnabled === true` (the API's confirmation that it stays private). Keep that gate.
- **Confirmations:** never `window.confirm`. Use `confirmDialog({ title, message, confirmLabel, destructive, requireText })` (or `useConfirm()`) from `components/ConfirmDialog.tsx`: it resolves true or false, covers the screen with a blurred backdrop, focuses Cancel and shows destructive ones in red. In tests, `autoConfirm(true | false | [answers])` from `src/test/confirm.ts` answers it through its real buttons.
- **Storage:** keys are prefixed `mg.` (e.g. `mg.auth`, `mg.theme`, `mg.outbox.scores`, `mg.saved.v1.*`, `mg.draft.*`). The current competition uses sessionStorage plus the `mg.competition` cookie. Wrap storage access in `try/catch`, as existing code does. Window events: `mg:outbox`, `mg:heat-saved`, `mg:favourites`.
- **Embed widget (`/embed/...`):** `main.tsx` renders `pages/embed/EmbedApp` instead of `App` for these paths, and skips the service worker, push and outbox. Keep it free of `useAuth`, `api.ts`, the app providers and any localStorage/sessionStorage use; fetch through `hooks/useEmbedResource.ts` (no credentials, `X-MG-Embed` header). Unknown `/embed/` paths must show a message, never `Navigate` into the app, because that document is framable. Options are parsed in `lib/embed.ts` (strict hex only). The organiser's card is `pages/competition/EmbedCard.tsx`.
- **Headers:** CSP and other headers in `vercel.json` must match `api/Security/SecurityHeadersMiddleware.cs` (`SecurityTests` checks this). No `*` and no `unsafe-eval`. The live hub URL is hard-coded in both the `buildCommand` (`VITE_LIVE_HUB_URL`) and CSP `connect-src`, so a host move must change both.
- **`middleware.ts`** imports with `.js` extensions because Vercel runs it unbundled. It forwards the visitor IP with `MG_PROXY_KEY`. For link-preview crawlers (`isPreviewCrawler` in `lib/shareCard.ts`; search engines are left out on purpose) it returns a tags-only page and falls back to the app if the API is slow. Anything shown in those tags must be public and goes through `escapeHtml`. A new crawler-visible route needs an entry in the `matcher` and in `sharePageFor`.
- **PWA:** the service worker also runs under `npm run dev` (`devOptions.enabled`). New versions prompt with `window.confirm`, suppressed while broadcasting. Never add an authenticated or per-user GET to the public cache.
- **Streams:** the browser never sees Cloudflare credentials. Viewers negotiate through the hub (`WatchStream`), publishers over HTTP. Updates carry a `generation`; `lib/streams.ts` ignores older ones and drops ended streams (`status === 2`). Details are in `../docs/specs/live-stream.md`.
- **Dates:** ISO UTC from the API, shown in the device's zone with `en-GB` text. Don't find day boundaries by slicing strings.
- `StrictMode` is on (effects run twice in dev), and `noUnusedLocals` and `noUnusedParameters` are on.
