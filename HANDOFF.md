# Handoff Summary — Mounted Games App (`feat/consolidate-pages-and-tokens`)

This handoff summarises all changes ready in the working tree for review, database migration on Neon, commit, and push.

---

## 1. Key Fixes & Features Completed

### A. Duplicate "Seniors" Age Group Fix (`ReviewCompetitionSeeder.cs`, `SectionNaming.cs`, `section.ts`)
- **Root Cause Fixed**: `ReviewCompetitionSeeder.cs` previously split any age group with `>= 12` teams into two separate `CompetitionSection` rows (`"Seniors teams A"` and `"Seniors teams B"`), and `SectionNaming.Of(section)` ignored `DisplayName` whenever `Format` and `AgeGroup` were populated, collapsing both sections to `"Seniors"`.
- **Fix**:
  - [`api/Services/ReviewCompetitionSeeder.cs`](file:///Users/alexd/dev/Mounted-games-app/api/Services/ReviewCompetitionSeeder.cs): Kept each age group (`Seniors`, `Juniors`, `Novices`) as a **single** `CompetitionSection` whose sessions contain multiple balanced heats (`Heat 1`, `Heat 2`, `Heat 3`), and added re-seed detection to replace any previously seeded demo competitions that had duplicate `(Format, AgeGroup)` sections.
  - [`api/Services/SectionNaming.cs`](file:///Users/alexd/dev/Mounted-games-app/api/Services/SectionNaming.cs) & [`web/src/lib/section.ts`](file:///Users/alexd/dev/Mounted-games-app/web/src/lib/section.ts): Preserved division suffixes (e.g. `"Seniors teams A"` -> `"Seniors A"`) so two genuine pools/divisions never collapse to the same display name.

### B. Timetable, Multi-Arena Chronological Ordering, Time-Shift Cards (`+`/`-`) & Age-Group Changer
- [`web/src/pages/competition/TimetableBoard.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/TimetableBoard.tsx) & [`web/src/pages/competition/timetable.css`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/timetable.css):
  - Removed the inline `Lanes` dropdown button and expandable lane drawer from timetable heat rows (clicking the heat opens it directly).
  - Removed the `TeamSelect` (`All teams`) and `Search timetable` input from `.tt-strip`, replacing them with an **Age group (`SectionSelect`)** filter (`All age groups` + each competition section).
  - Combined `sessionGroups` and `finalGroups` into a single chronological list sorted by start time across arenas.
  - Added `.tt-shift-card` (`+15m` / `-10m`) badges on every heat row whose time has shifted (`moved && status !== 'finished'`), backed by `[shift:+N]` metadata persisted in [`api/Controllers/SessionsController.cs`](file:///Users/alexd/dev/Mounted-games-app/api/Controllers/SessionsController.cs) and parsed in [`web/src/lib/time.ts`](file:///Users/alexd/dev/Mounted-games-app/web/src/lib/time.ts).
- [`web/src/pages/competition/SessionsTab.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/SessionsTab.tsx), [`web/src/pages/admin/creator/save.ts`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/admin/creator/save.ts), & [`web/src/pages/admin/FormatPage.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/admin/FormatPage.tsx):
  - Sorted sessions across arenas chronologically by start time when saving/creating timetables.
  - Replaced bulky bottom CTA buttons for `Follow teams` and `Download timetable` with a subtle inline footer bar.

### C. Scoreboard Look, Visible Rotated Race Headers & Admin-Controlled Yellow / Red Cards
- [`web/src/pages/competition/heat.css`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/heat.css): Fixed `.race-rules-btn.heat-name` overriding `.heat-name` to `28px × 28px`, restoring full vertical rotated race titles across `HeatScores.tsx`, `SessionPage.tsx`, and `ScoringSection.tsx`.
- [`web/src/pages/competition/ScoringParts.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/ScoringParts.tsx), [`web/src/pages/competition/ScoringSection.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/ScoringSection.tsx), [`web/src/pages/competition/HeatScores.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/HeatScores.tsx), [`web/src/pages/competition/SessionPage.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/SessionPage.tsx), & [`web/src/pages/admin/FormatPage.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/admin/FormatPage.tsx):
  - Unified `HeatGrid` and `SessionPage` to use the `heat.css` scoreboard design (`.heat-card`, `.heat-grid`, `.heat-name`, `.heat-bib`, `.heat-place` podium cells `.p1`/`.p2`/`.p3`, `.heat-tot`).
  - Made **Yellow & Red cards admin-controlled and OFF by default** per competition (`useCardsEnabled(competitionId)`), with admin toggles in both `FormatPage` and the `Alter scores` sheet so competitions that do not use cards never display card buttons or badges.

### D. Navigation Drawer, In-Browser Permission QR Scanner & Cryptographic Key Verification
- [`web/src/components/NavigationDrawer.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/components/NavigationDrawer.tsx):
  - Moved `Sign in` to the bottom of the drawer and removed the `"For trainers, organisers and stewards"` text.
  - Changed the `Events` icon from `ArrowLeftRight` to `CalendarDays`.
  - Removed `Rulebooks` from the sidebar.
  - Added **Scan QR code** right above `Settings`.
- [`web/src/components/QrPermissionScannerModal.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/components/QrPermissionScannerModal.tsx) & [`web/src/pages/ScorerPage.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/ScorerPage.tsx):
  - In-browser camera QR scanner (`BarcodeDetector` + QR image upload + manual key entry).
  - Verifies `/score#t=<token>` against `GET /api/scorer/session` (`X-Scorer-Token`) before granting access and requires a valid pairing token for `/competitions/:id/broadcast?pair=<token>`, rejecting any unsigned URL so no user can ever self-grant permissions.

### E. Arena Setup Diagrams (Evenly Spaced `P1..P5` with 5th Pole & Far-End Equipment Beyond Changeover Line) & All 4 Rulebooks Per Race
- [`web/src/components/diagramSlots.ts`](file:///Users/alexd/dev/Mounted-games-app/web/src/components/diagramSlots.ts), [`web/src/components/RaceDiagram.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/components/RaceDiagram.tsx), & [`api/Services/BuiltInRaceMetadata.cs`](file:///Users/alexd/dev/Mounted-games-app/api/Services/BuiltInRaceMetadata.cs):
  - Spaced all 5 poles (`P1..P5`) **evenly apart** (`Δx = 22`: `P1 = 22, P2 = 44, P3 = 66, P4 = 88, P5 = 110`) with the **Changeover line at `x = 100`**, placing **`P5` (`110`) and top-end bins/containers/cones/tables (`top = 108`, `beyond = 116`) beyond the Changeover line** per the official live rulebook.
- [`web/src/components/RaceRulesSheet.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/components/RaceRulesSheet.tsx), [`web/src/pages/competition/ArenaPage.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/ArenaPage.tsx), [`web/src/pages/RulebooksPage.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/RulebooksPage.tsx), & [`api/Controllers/RaceTemplatesController.cs`](file:///Users/alexd/dev/Mounted-games-app/api/Controllers/RaceTemplatesController.cs):
  - Added all 4 governing body rulebooks (**EGUK**, **Pony Club**, **MGA**, **STRUK**) sorted by race and **lazy-loaded per race** (`GET /api/race-templates/by-name/{name}`) only when a race is clicked.
  - Clicking a race in a heat table or viewing `ArenaPage` shows that specific race's setup diagram and 4-rulebook switcher.
  - Moved the Back buttons on `ArenaPage.tsx`, `CompetitionTeamPage.tsx`, and `RulebooksPage.tsx` into the top header bar via `usePageHeader`.

### F. Public Live Stream / Announcements Cleanup, Team Statistics & 30-Min Replay DVR with Trimming + Follow-Cam
- [`web/src/pages/competition/ChatTab.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/ChatTab.tsx):
  - Removed `<StreamCompanionPanel>` (duplicate live heat scores / timetable / toplist / chat tabs below the stream).
  - Hid the `Announcements` / `Message Organisers` tab buttons for public visitors (`!canPost && !(canMessageOrganisers && privateMessagingAvailable)`), leaving a clean announcements list with the pinned message above the stream.
  - Only shows the top `Live` badge when `activeStreams.length > 0`.
- [`web/src/pages/competition/CompetitionTeamPage.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/pages/competition/CompetitionTeamPage.tsx):
  - Added the **Team stats** section (`Average per race`, `Average place`, `Races won`, `Point quota`, and `Per-race averages`).
- [`web/src/live/replayBuffer.ts`](file:///Users/alexd/dev/Mounted-games-app/web/src/live/replayBuffer.ts) & [`web/src/components/stream/ReplayInspector.tsx`](file:///Users/alexd/dev/Mounted-games-app/web/src/components/stream/ReplayInspector.tsx):
  - 30-minute rolling local replay buffer (`windowSeconds = 1800`) recorded at native phone sensor resolution, non-centred focal zoom + pan, replay start/end trimming (`[ Set Start`, `Set End ]`), Following Zoom ("Follow-Cam" keyframe recording & interpolation), baked-in clip export, and photo-finish PNG snapshot.

---

## 2. Database Migrations (Run Before Deploying API to Vercel)

Two idempotent Postgres migration scripts are included in `api/Data/Migrations/Scripts/`:
1. [`api/Data/Migrations/Scripts/20261024200003_AddEquineVaccineCertification.sql`](file:///Users/alexd/dev/Mounted-games-app/api/Data/Migrations/Scripts/20261024200003_AddEquineVaccineCertification.sql)
2. [`api/Data/Migrations/Scripts/20261024203315_AddScorerLinkScope.sql`](file:///Users/alexd/dev/Mounted-games-app/api/Data/Migrations/Scripts/20261024203315_AddScorerLinkScope.sql)

Run `npm run db:migrate` against Neon (or apply the idempotent scripts above) before deploying the API container, as `Program.cs` enforces zero pending migrations on Postgres startup.

---

## 3. Verification Run

- **Full Production Build**: `npm run build` (`tsc -b && vite build` + `dotnet build api/MountedGames.Api.csproj`) — **0 warnings, 0 errors**.
- **Web Linter**: `npm --prefix web run lint` (`eslint .`) — **0 warnings, 0 errors**.
- **Web Vitest Suites**:
  - `RaceDiagram.test.tsx`, `diagramSlots.test.ts`, `ArenaPage.test.tsx`, `TimetableBoard.test.tsx`, `ChatTab.stream.test.tsx`, `CompetitionTeamPage.test.tsx`, `ScoringTab.test.tsx`, `ScoringSection.test.tsx`, `HeatScores.test.tsx`, `SessionPage.test.tsx`, `RulebooksPage.test.tsx`, `ScorerPage.test.tsx`, `section.test.ts` — **13 test files, 267 passed, 0 failed**.
  - Streaming & Replay suites (`src/live/`, `src/components/stream/`, `BroadcastPage.test.tsx`, `ScorerLinksCard.test.tsx`, `scorerLink.test.ts`) — **17 test files, 312 passed, 0 failed**.
- **API xUnit Tests**:
  - `dotnet test tests/MountedGames.Api.Tests --filter "ReviewCompetitionSeederTests|SectionNamingTests|RaceTemplate|ScorerLinkTests|StreamsControllerTests|SessionsControllerTests|SecurityTests"` — **200 passed, 0 failed**.


## Integration review — 24 October 2026

The original snapshot above was reviewed in `feat/late-handoff-integration`. Recorded race membership, lane order and completed programmes are protected; the calendar and client now agree on shifted starts. Private referee notes are removed from public conflict broadcasts. Camera permissions are limited by arena and publisher, revoked roles stop authorising old tokens, and certification details are restricted to authorised staff. Pony swaps clear the previous pony's identity, age flags use the event year, and disabled passport fields are not saved to the roster.

Replay exports now encode playable video from completed recording segments, including baked follow-cam crops. The local buffer retains up to 30 minutes subject to storage capacity, with bounded memory/disk use, visible storage warnings, cancellation and cleanup. Real browser tests decoded native-resolution VP8/Opus exports and clips restored from IndexedDB.

The four rulebook tabs show the stored app race guide with an explicit unverified-source label; verified rules for each organisation still need to be supplied. Demo orders are excluded from reconciliation totals and exports identify test orders.

Final local checks: 2,142 API tests passed, with four Redis tests reserved for CI; API line coverage 96.58%. All 250 web test files passed (3,363 tests), plus 121 Node tests. Web coverage: 99.35% statements, 97.41% branches, 99.53% functions and 99.90% lines. Lint and the production build passed. Mobile events, menu and QR screens passed a browser smoke check with no JavaScript errors.

Both migrations passed twice on isolated Neon branch `setup-verification-late-handoff-2026-10-24`. SQLite upgrade tests preserve existing data, and EF reports no model drift. Production backup `backup-pre-late-handoff-2026-10-24` is ready. Production migration remains a user-run step before merge; this note does not claim production has been migrated or the PR merged.
