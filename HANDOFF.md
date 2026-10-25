# Handoff: Ship `feat/consolidate-pages-and-tokens` to `main`

## Repo & Branch
- Workspace: `/Users/alexd/dev/Mounted-games-app`
- Current branch: `feat/consolidate-pages-and-tokens`
- **Database Migrations (CRITICAL — Run Before Deploying API to Vercel)**:
  - **4 new EF Core migrations** and their idempotent Postgres SQL scripts were added on this branch:
    1. `api/Data/Migrations/20261024200003_AddEquineVaccineCertification.cs` (`api/Data/Migrations/Scripts/20261024200003_AddEquineVaccineCertification.sql`)
    2. `api/Data/Migrations/20261024203315_AddScorerLinkScope.cs` (`api/Data/Migrations/Scripts/20261024203315_AddScorerLinkScope.sql`)
    3. `api/Data/Migrations/20261025093000_AddSignupIpAddress.cs` (`api/Data/Migrations/Scripts/20261025093000_AddSignupIpAddress.sql`)
    4. `api/Data/Migrations/20261025101500_AddTimetableDelaysAndClubJoinPin.cs` (`api/Data/Migrations/Scripts/20261025101500_AddTimetableDelaysAndClubJoinPin.sql`)
  - Because `api/Program.cs` refuses to start on Postgres when pending migrations exist, **`npm run db:migrate` MUST be run against Neon before deploying `mounted-games-api`**.

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

8. **Admin Password Requirement, Per-IP Account Creation Cap (`5/IP`) & Tightened Sign-In Rate Limits (`5/min`) (`AuthController.cs`, `AuthDtos.cs`, `RequestLimits.cs`, `LoginPage.tsx`)**:
   - Required a password whenever an email is supplied to `POST /api/auth/admin-key`, creating a password-protected `Admin` account on first use and verifying the password on subsequent uses so admins can sign in from the general `/login` tab on their next visit and nobody can impersonate their email.
   - Enforced a per-IP account creation cap (`RateLimits:AccountsPerIp`, default `5` accounts per IP across `signup-trainer` and `admin-key`) using `AppUser.SignupIpAddress`.
   - Tightened `RateLimits:AuthPerMinute` default to `5` per minute per IP across `/api/auth/login`, `/api/auth/admin-key`, and `/api/auth/signup-trainer`.

9. **Timetable Auto-Delay, Pause/Continue Controls, Multi-Competition Duration Prediction, Hours + Minutes Formatting & Club Join PIN/Approval (`TimetableDelayDtos.cs`, `CompetitionsScheduleController.cs`, `ClubsController.cs`, `time.ts`, `TimetableBoard.tsx`, `SessionsTab.tsx`)**:
   - Added server-synced timetable pause/resume (`POST /api/competitions/{id}/timetable-pause`) and manual delay adjustments (`POST /api/competitions/{id}/timetable-delay`, `+5m`, `+10m`, `+15m`, `-5m`, custom minutes, reset) with SignalR live broadcast (`TimetableChanged`).
   - Added historical race-pace prediction (`GET /api/competitions/{id}/timetable-prediction` + `predictSessionMinutes` in `web/src/lib/time.ts`) blending the competition's live pace with completed competitions.
   - Formatted all delays and offsets `>= 60` minutes as hours and minutes (`1h 34m late`, `+1h 34m`, `2h`) via `formatDurationMinutes` / `formatSignedOffsetMinutes`.
   - Protected club membership joins (`POST /api/clubs/{id}/members`) with either the club's 6-character `JoinPin` or `Pending` approval status (`POST /api/clubs/{id}/members/{memberId}/approve`).

10. **Lite Mode Deep Optimisations (`liteMode.ts`, `LiteModeContext.tsx`, `ToplistView.tsx`, `TimetableBoard.tsx`, `ChatTab.tsx`, `StreamPlayer.tsx`, `SponsorsCard.tsx`, `sw.ts`)**:
    - Auto-activated Lite mode on `navigator.connection.saveData`, `2g`/`slow-2g`, or `navigator.deviceMemory <= 2`, and sent `X-Lite-Mode: 1` on Axios requests.
    - Defaulted `StreamPlayer` to **Audio-only (`0 kbps` video)** in Lite mode unless explicitly overridden, paused offscreen streams via `IntersectionObserver`, throttled `ToplistView` and `TimetableBoard` live recalculations to a 5-second cadence, disabled background weather/sponsor polling, and skipped large image/font runtime caching in `sw.ts`.

11. **Live Streaming Centred Popups, Hidden Bottom Bar on Overlays, 2nd-Phone Remote Control, Dual-Camera Switching, Screen Wake Lock, Separate Contact Organisers Page & Post-Fact Announcement Pinning (`StreamPlayer.tsx`, `BroadcastPage.tsx`, `RemoteDirectorSheet.tsx`, `ChatTab.tsx`, `chat.css`, `ContactOrganisersPage.tsx`)**:
    - Centred live stream race-result popups in `StreamPlayer.tsx` (`w-[88%] max-w-lg`) covering the middle of the screen, and hid the bottom control bar whenever an overlay is active.
    - Added **Remote Control from 2nd Phone** (`RemoteDirectorSheet.tsx` + QR pairing), **Dual-Camera Switching** (`Camera 1 (Main)` / `Camera 2 (Finish Line)`), automatic **Screen Wake Lock (`ON`)** while filming, and accessible **30m Replays & Saved Clips** controls.
    - Moved **"Message Organisers"** off the Live stream page (`/competitions/:id/chat`) to a dedicated `/competitions/:id/contact` page (`ContactOrganisersPage.tsx`), fixed mobile header spacing below `Live stream` (`chat.css`), and added post-fact announcement **Pin (`Pin`)** controls so all announcements appear in the top banner first, then pinned or newer announcements replace them.

12. **Full-Page Phone Scoring UI Matching `Main.dc.html`, Searchable `RacePicker.tsx`, Commentator-Scorer Mode, TV Kiosk, Stream Control Strip & QR Access Hub (`ScoringSection.tsx`, `ScoringParts.tsx`, `SessionPage.tsx`, `ScorerPage.tsx`, `RacePicker.tsx`, `CommentaryDeskPage.tsx`, `TvKioskPage.tsx`, `StreamControlStrip.tsx`, `QrAccessModal.tsx`, `HeatPrintSheet.tsx`)**:
    - Rebuilt the active scoring view (`ScoringSection.tsx`, `ScoringParts.tsx`) to match `docs/designs/scoring/Main.dc.html`: full-page phone scoring layout, top single-line race switcher (`< Previous race | Race X of Y · Status + Race Name | Next race >`) with no stacked race cards, icon-only `Score override` / `Undo` / `Clear` buttons, **hold to eliminate** (no `Out` / `HC` row buttons), row background fills only when a hatband/silk colour is set, teams ordered by lane (`mg.prefs.sortByLaneOrder` in `/settings`), and `<HeatGrid>` shown at the end of the heat.
    - Moved HC (`Hors concours`), Yellow / Red cards, and mid-session race controls (Add race, Change race, Re-run race, Run-off winner) into `ScoreOverrideSheet`, and moved the **"Use yellow & red cards in this competition"** checkbox into the Competition Creator (`AboutStep.tsx`).
    - Replaced plain-text race `<textarea>` inputs with a searchable **Select Race + Custom race** picker (`RacePicker.tsx`).
    - Removed club names from printed heat sheets and results books (`HeatPrintSheet.tsx`, `ResultsBookPage.tsx`).
    - Added the **Commentator Mode prompt** on `SessionPage.tsx` and `ScorerPage.tsx` (*"Do you want to see commentator facts while scoring?"*) with live facts and a post-race Heat Table + Section Toplist popup, plus `StreamControlStrip.tsx` on PA Desk & TV Kiosk and `QrAccessModal.tsx` for instant QR sharing.

13. **Backend Completion for Referee Cards, Team Flags, Heat-Start Ring-Call Auto-Clearing & Post-Fact Announcement Pinning (`ResultStatuses.cs`, `DecFormConfig.cs`, `ApiDtos.cs`, `Mappings.cs`, `StandingsService.cs`, `ScoringService.cs`, `CompetitionsController.cs`, `TeamsController.cs`, `ScoringController.cs`, `ChatController.cs`)**:
    - Added `UseRefereeCards` to `DecFormConfig` and `CompetitionDetail` / `CreateCompetitionRequest` / `UpdateCompetitionRequest`.
    - Exposed `RefereeCard` (`"yellow"` | `"red"` | `null`) and `Flag` (`"gb-wls"` | `"gb-eng"` | etc.) on `TeamDto`, `HeatEntryDto`, and `StandingRow`, plus `RefereeCard` and `UnderReview` on `ResultDto`.
    - Added `PUT /api/competitions/{id}/teams/{teamId}/card` (`SetTeamCardRequest`) to assign or clear a team's yellow/red card before or during racing, and updated `TeamsController` (`Create`, `Update`, `SetTrainer`) to accept `Flag` and preserve `[flag:...]` and `[card:...]` tags on `Team.BibDescription` while stripping internal `[card:...]` tags from public `BibDescription`.
    - Updated `ScoringService.UpdateRaceClockAsync` (`POST /api/races/{raceId}/start`) to stamp `heat.StartedAt ??= at` and `session.StartedAt ??= at` (`SessionStatus.InArena`), and updated `ScoringController` (`StartRace`, `SubmitRaceResults`, `UpdateRaceScore`) to automatically delete any active `"missing-team"` / `"🔔 Ring call"` announcements from `ChatMessages` and broadcast `ChatMessageDeleted` + updated `HeatDto` over SignalR.
    - Added `POST /api/heats/{heatId}/call-missing-team` (refusing with `409 Conflict` once a heat has started) and `POST /api/competitions/{id}/chat/{messageId}/pin` (persisting and toggling `"pinned"` announcements on the server).
    - Documented the full **Next Frontend Build Queue** (including the `/me` mobile blank sidebar root cause, clubs dropdown/page, user name display, heat-table expansion on timetable session click, hiding public runoff lanes, custom-only reminder input, PA-only arena shift, and the full-page vs centred-box audit) in `NEXT_STEPS.md`.

---

## Verification Status (All Passing)
- `npm run build` (`tsc -b && vite build` + `dotnet build api/MountedGames.Api.csproj`): **Passed (0 warnings, 0 errors)**
- `npm --prefix web run lint`: **Passed (0 warnings, 0 errors)**
- `cd web && node --test tests/*.test.mjs`: **Passed (121/121)**
- `npm --prefix web run test:coverage`: **Passed (251/251 test files, all global coverage thresholds >= 97% met)**
- `dotnet test tests/MountedGames.Api.Tests`: **Passed (2,093 passed, 0 failed, 4 Redis-only skipped)**
