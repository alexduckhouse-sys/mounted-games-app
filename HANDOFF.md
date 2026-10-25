# Handoff: Ship `feat/consolidate-pages-and-tokens` to `main`

## Repo & Branch
- Workspace: `/Users/alexd/dev/Mounted-games-app`
- Source branch: `feat/consolidate-pages-and-tokens`. Reviewed integration: `feat/handoff-weather-timetable`, based on `c50e54e` (PR #142).
- **Database migrations:** the two migrations listed in the original handoff (`20261024200003_AddEquineVaccineCertification` and `20261024203315_AddScorerLinkScope`) were applied and verified in production before PR #142 merged on 25 October. This update adds no migrations.

---

## What Was Built & Verified in the Working Tree

1. **Duplicate Age Groups Fix, Section Naming & Finals Scoring (`ReviewCompetitionSeeder.cs`, `SectionNaming.cs`, `section.ts`, `ScoringService.cs`)**:
   - Fixed duplicate `"Seniors"` age groups by keeping each age group (`Seniors`, `Juniors`, `Novices`) as a single `CompetitionSection` with multiple balanced heats (`Heat 1`, `Heat 2`, `Heat 3`) in `ReviewCompetitionSeeder.cs`, plus automatic re-seed detection for older demo competitions that had split sections.
   - Preserved division suffixes (`"Seniors teams A"` -> `"Seniors A"`) in `SectionNaming.cs` and `web/src/lib/section.ts` while stripping trailing `Teams` from standard team sections (`Juniors`, `Seniors`, `Novices`).
   - Updated lettered Finals (`A Final`, `B Final`, etc.) in `ScoringService.cs` to score first-place points equal to the final heat's own active team count.

2. **Timetable, 2-Day + 2-Arena Selector, Auto-Delay Maths & Coloured Time Display (`TimetableBoard.tsx`, `timetable.css`, `SessionsTab.tsx`, `time.ts`, `timetableRows.ts`, `creator/save.ts`, `FormatPage.tsx`)**:
   - Derived `arenas` across all competition rows so multi-day competitions keep arena filtering across days, and added `.tt-strip-stacked` so 2-day, 2-arena events render Day pills on the top row with Arena and Age-group selectors side-by-side underneath.
   - Moved `Show full timetable` below the `On time / Late / On now / Finished` status legend, moved `Download timetable` inside the expanded `Show full timetable` view, removed `Follow teams` and `Arena setup` from `SessionsTab.tsx`, and removed the inline `Lanes` pill from timetable rows.
   - Suppressed late badges/notes on currently live sessions (`status === 'live'`) while displaying the running delay on every subsequent session.
   - Added first-race and halfway-race auto-delay calculation in `computeTimings` (`web/src/lib/time.ts`): when Race 1 goes in `> 5` minutes after scheduled start, `(timeTaken - 2 mins)` is added to how late subsequent heats/sessions are running; the same `(timeTaken - 2 mins)` rule applies at the halfway race (`Math.floor(N / 2)`).
   - Removed duplicate `X late` card badges, kept the single plain-text indicator (`+15m · 10:00`), coloured `.tt-time` directly (`.tt-time-late` / `.tt-time-early`) when shifted, and ordered sessions chronologically across arenas on save/creation.

3. **Toplist, Compact Heat Tables, Conditional `CF`, Admin Cards & Team Page (`ToplistView.tsx`, `ScoringTab.tsx`, `HeatScores.tsx`, `ScoringParts.tsx`, `heat.css`, `CompetitionTeamPage.tsx`, `toplist.ts`, `useCardsEnabled.ts`)**:
   - Added `By game` and `Heat tables` tabs to `ToplistView.tsx`, persisted the active view across age-group switches, and removed `Share Podium`, `TV Kiosk`, and `PA Desk` from the public Toplist (`ScoringTab.tsx`).
   - Added `.heat-grid-many` for heats with 6+ races so race columns sit closer to team names and `Pts` is visible without horizontal scrolling; allowed long team names to wrap onto 2 lines (`.heat-team-name-long`) and hid the `CF` column when carried-forward points are `0` for all teams in the heat.
   - Gated Yellow & Red cards behind an admin-controlled competition toggle (`useCardsEnabled`, off by default).
   - Built `/competitions/:id/teams/:teamId` (`CompetitionTeamPage.tsx`) with team summary, declared riders & ponies, **Team stats** (`Average per race`, `Average place`, `Races won`, `Point quota`, `Per-race averages`), drawn heats with starting lanes, `<HeatScores>` tables, and race-by-race breakdown.
   - Implemented exact on-device finals qualification maths (`assignPointsNeeded` in `web/src/lib/toplist.ts`).

4. **Dedicated Competition Weather & Timetable Page (`WeatherController.cs`, `WeatherPage.tsx`, `App.tsx`, `NavigationDrawer.tsx`)**:
   - Extended `GET /api/weather/forecast` with hourly forecast arrays (`temperature_2m`, `weather_code`, `precipitation_probability`, `precipitation`, `wind_speed_10m`, `is_day`).
   - Built `/competitions/:id/weather` (`WeatherPage.tsx`) showing a daily weather summary & `07:00`–`19:00` hourly rain/temperature strip at the top and the competition timetable paired with hourly weather below.

5. **Official Arena Diagrams (`P1..P5` Geometry) & All 4 Governing Body Rulebooks Per Race (`diagramSlots.ts`, `RaceDiagram.tsx`, `BuiltInRaceMetadata.cs`, `RaceRulesSheet.tsx`, `RulebooksPage.tsx`, `ArenaPage.tsx`, `RaceTemplatesController.cs`)**:
   - Spaced all 5 poles evenly apart (`P1 = 22, P2 = 44, P3 = 66, P4 = 88, P5 = 110`, `Δx = 22`) with the Changeover line at `x = 100`, placing `P5` (`110`) and top-end bins/containers/cones/tables (`top = 108`, `beyond = 116`) beyond the Changeover line.
   - Added all 4 governing body rulebooks (**EGUK**, **Pony Club**, **MGA**, **STRUK**) sorted per race and lazy-loaded on demand (`GET /api/race-templates/by-name/{name}`).
   - Moved Back buttons to the top header bar on `ArenaPage.tsx`, `CompetitionTeamPage.tsx`, `RulebooksPage.tsx`, and `WeatherPage.tsx`.

6. **Live Stream, Public Announcements Cleanup & 30-Min Replay DVR with Trimming + Follow-Cam (`ChatTab.tsx`, `BroadcastPage.tsx`, `replayBuffer.ts`, `ReplayInspector.tsx`, `StreamPlayer.tsx`)**:
   - Removed `<StreamCompanionPanel>` from the public stream page, hid `Announcements` / `Message Organisers` mode buttons for public visitors, pinned the latest announcement above the stream, and hid the `Live` badge when no stream is active.
   - Added 30-minute local replay buffer, focal-point zoom + pan anywhere on screen, start/end clip trimming, and Following Zoom ("Follow-Cam" keyframe path interpolation).

7. **Navigation Drawer, Full-Screen QR Permission Scanner, Profile-Only Trainer Banner, Settings & UK Legal Policies (`NavigationDrawer.tsx`, `QrPermissionScannerModal.tsx`, `AppShell.tsx`, `SettingsPage.tsx`, `LiteModeSetting.tsx`, `userPrefs.ts`, `PrivacyPage.tsx`)**:
   - Moved `Sign in` to the bottom of `NavigationDrawer.tsx` without the role subtitle, changed `Events` icon to `CalendarDays`, removed `Rulebooks` from the sidebar, and added **Scan QR code** above `Settings`.
   - Rendered `QrPermissionScannerModal` via `createPortal(..., document.body)` as a full-screen top-layer `<dialog>` (`w-screen h-dvh inset-0`) and verified cryptographic scorer/broadcast keys before granting access.
   - Restricted `TrainerAccountNotice` (*"Thanks. Your request needs approving..."*) to `/me` only.
   - Removed Role presets from `SettingsPage.tsx`, added a short human explanation of Lite mode, allowed any custom minute timing (`1`–`240` mins) for heat reminders, and added comprehensive **Policies & legal** sections (`Privacy (UK GDPR)`, `Terms of Service & Equine Liability`, `Refunds, Cancellations & Payments`, `Cookies & Offline Storage (UK PECR)`, and `Safeguarding, Filming & Equine Welfare`).

---

## Verification Status (All Passing)
- `npm run build` (`tsc -b && vite build` + `dotnet build api/MountedGames.Api.csproj`): **Passed (0 warnings, 0 errors)**
- `npm --prefix web run lint`: **Passed (0 warnings, 0 errors)**
- `cd web && node --test tests/*.test.mjs`: **Passed (121/121)**
- `npm --prefix web run test:coverage`: **Passed (249/249 test files, 2,520 tests, all global coverage thresholds >= 97% met)**
- `dotnet test tests/MountedGames.Api.Tests`: **Passed (2,085 passed, 0 failed, 4 Redis-only skipped)**

## Integration review — 25 October 2026

- Preserved the previous QR verification, asynchronous stream cleanup, official standings and rulebook-source corrections. The new full-screen scanner uses the existing scoped scorer client; unsupported broadcast-pair links still do not grant access.
- Weather never substitutes invented forecast values. Missing observations remain unavailable; date/timezone mapping is tested. Refresh fetches weather again.
- Mirrored first/halfway-race delay arithmetic in calendar exports, with boundary and non-compounding regression tests.
- Kept the Weather link discoverable without fetching the badge when weather is disabled.
- Custom reminder timing applies to in-app reminders. Background push remains about one hour before a heat.
- Retained the five policy sections while removing unsupported promises about refunds, universal event rules, lawful bases, cookies, filming and automatic deletion. Public declaration fields and persistent/downloaded replay clips are disclosed. The existing contact placeholder remains until the operator confirms a monitored address; the new handoff's support address has not been verified. Legal/privacy grounds and operator details still require confirmation before treating this as a complete legal notice.
- Mobile browser checks use synthetic competition/weather data. Heat scores, weather, settings and the full-screen QR dialog render without runtime exceptions or page overflow.
