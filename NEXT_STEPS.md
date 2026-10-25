# Next steps (25 October 2026)

The cross-chat to-do list, confirmed product specifications, code-verified bugs, and roadmap. Update or delete items as they land.

**This file, `BUGS.md` and `COMPLETED_NEXT_STEPS.md` live in git on main.** Edit them on your feature branch (or a small docs PR), not in an uncommitted copy in another worktree. Move finished items to `COMPLETED_NEXT_STEPS.md` once their PR is merged.

## Start here: after the 23–25 October walkthroughs

On 23 October the user walked through creating a competition on production and reported findings live. Chat c5406079 turned them into PRs #105–#124, all merged with CI green; every migration ran on Neon first, each after a backup branch. Streaming is switched on (new Cloudflare SFU app; TURN not set up).

**24–25 October consolidation, live streaming, rules & timetable pass:**
- Consolidated `/event-tools/:id` into `/competitions/:id/operations` tabs (Readiness, Equipment, Draw, Entries, Scorers & team, Tack check, Passport check, Import teams, Print sheets, Results book, Duplicate event) while keeping `/event-tools/:id/print/*` printable routes.
- Consolidated `/competitions/:id/produce` into `/competitions/:id/broadcast` (Camera & stream + Overlays & banners tabs) with two-phone QR producer handoff, 30-minute IndexedDB circular replay buffer (`replayBuffer.ts`) with Follow-Cam (`ReplayInspector.tsx`), quality presets (`Auto HD`, `720p`, `480p Saver`), low-latency catch-up and audio-only/Lite Mode support.
- Consolidated `/stats` and `/competitions/past` with a shared `ResultsStatsNav` switcher; added `Arena setup & race diagrams` to `DetailsTab` and `SessionsTab`, and added 4 governing body rulebooks (**EGUK**, **Pony Club**, **MGA**, **STRUK**) fetched per race via `GET /api/race-templates/by-name/{name}` (`RaceRulesSheet.tsx`).
- Surfaced **Scorer QR codes & links** (`ScorerLinksCard`) with optional session/heat scoping (`20261024203315_AddScorerLinkScope`) and added an in-browser QR permission scanner modal (`QrPermissionScannerModal.tsx`) in `NavigationDrawer.tsx`.
- Added equine flu vaccination certification & passport verification (`20261024200003_AddEquineVaccineCertification`), legal/policy tabs (`/privacy`, `/terms`, `/refunds`, `/cookies`, `/safeguarding`), dedicated `/competitions/:id/weather` page (`WeatherPage.tsx`), and `/competitions/:id/teams/:teamId` (`CompetitionTeamPage.tsx`) with race-by-race stats.
- Added automatic first-race and halfway-race `(timeTaken - 2m)` delay maths, learned pace prediction, and organiser **Pause / Continue** + custom-minute shift controls on `TimetableBoard.tsx` and `TimetableTimes.cs` (`.ics` calendar sync).
- Updated organiser-key sign-in (`POST /api/auth/admin-key`) to require a password when signing in with an email (claiming/verifying a password-protected `Admin` account so the organiser can sign in normally on subsequent visits and nobody can impersonate their email) and enforced `RateLimits:AccountsPerIp` (default 5 per IP) and `RateLimits:AuthPerMinute` (default 5/min per IP).
- Pinned `PayoutClubId` on competition creation (`DecFormConfig.PayoutClubId`) and updated `ClubAccess.IsClubManagerAsync` to verify the `Manager` role against the database.
- **Backend completed for Referee Cards, Team Flags, Ring-Call Auto-Clearing on Heat Start, and Post-Fact Announcement Pinning (`ResultStatuses.cs`, `DecFormConfig.cs`, `ApiDtos.cs`, `Mappings.cs`, `StandingsService.cs`, `ScoringService.cs`, `CompetitionsController.cs`, `TeamsController.cs`, `ScoringController.cs`, `ChatController.cs`)**:
  - Added `UseRefereeCards` to `DecFormConfig` and `CompetitionDetail` / `CreateCompetitionRequest` / `UpdateCompetitionRequest`.
  - Exposed `RefereeCard` (`"yellow"` | `"red"` | `null`) and `Flag` (`"gb-wls"` | `"gb-eng"` | etc.) on `TeamDto`, `HeatEntryDto`, and `StandingRow`, plus `RefereeCard` and `UnderReview` on `ResultDto`.
  - Added `PUT /api/competitions/{id}/teams/{teamId}/card` (`SetTeamCardRequest`) to set or clear a team's yellow/red card before or during racing.
  - Updated `ScoringService.UpdateRaceClockAsync` (`POST /api/races/{raceId}/start`) to set `heat.StartedAt ??= at` and `session.StartedAt ??= at` (`SessionStatus.InArena`), and updated `ScoringController` (`StartRace`, `SubmitRaceResults`, `UpdateRaceScore`) to automatically delete any active `"missing-team"` / `"🔔 Ring call"` announcements and broadcast `ChatMessageDeleted` + updated `HeatDto` over SignalR.
  - Added `POST /api/heats/{heatId}/call-missing-team` (returning `409 Conflict` if the heat has already started) and `POST /api/competitions/{id}/chat/{messageId}/pin` for server-persisted announcement pinning.

## Next Frontend Build Queue (Noted — Ready to Build Next)

1. **`/me` (`ProfilePage.tsx`) Mobile Blank Sidebar Fix, Clubs Dropdown / Dedicated Page & User Name Only (`ProfilePage.tsx`, `SiteAdmin.tsx`, `QuickActions.tsx`, `LaptopParts.tsx`, `AppShell.tsx`, `NavigationDrawer.tsx`)**:
   - **Mobile blank sidebar bug**: Below `1024px` (`lg:`) and `640px` (`sm:`), `ProfilePage.tsx:195-205` (`grid gap-6 lg:grid-cols-3`), `QuickActions.tsx:20`, and `SiteAdmin.tsx:267, 284, 408` lack `grid-cols-1` (`minmax(0, 1fr)`) and `min-w-0` on grid/flex children containing `truncate` (`white-space: nowrap`) text, while `.mg-band` (`ProfilePage.tsx:178`) uses a `100vmax` `border-image` without `overflow-x-clip` on `AppShell.tsx:71, 129`. Add `grid-cols-1` + `min-w-0` to those grids/children, `flex-wrap` to `PartHead` (`LaptopParts.tsx:8-11`), and `overflow-x-clip` to `AppShell.tsx`.
   - **Clubs list**: Move the long inline Clubs list out of `SiteAdmin.tsx:408-455` on `/me` into a collapsible dropdown / dedicated `/clubs` management page.
   - **Show user's name only (no title or role badge)**: On `ProfilePage.tsx:178-190` and `NavigationDrawer.tsx` / `AppShell.tsx`, display only the user's name without role/title labels.
2. **"Call to Ring" Disappears Immediately When Heat Starts (`SessionPage.tsx:617-645`, `CommentaryDeskPage.tsx`)**:
   - Hide the `"Late to ring — call missing team"` controls whenever `activeHeat.startedAt != null || activeHeat.finishedAt != null || activeHeat.races.some(r => r.startedAt != null || r.finishedAt != null || r.isComplete)` (and wire the button to `POST /api/heats/${activeHeat.id}/call-missing-team`).
3. **Click a Session in the Timetable to Show All Heat Tables (`TimetableBoard.tsx`, `SessionsTab.tsx`)**:
   - Make clicking a session card/header in `TimetableBoard.tsx` expand/render all `<HeatScores>` heat tables for that session inline (or in a full-page session heat-tables view).
4. **Do Not Show Runoff Lanes on the Public Site (`ToplistView.tsx:272-291`, `toplist.ts:315-327`)**:
   - Remove the public `<section aria-labelledby="runoff-title">` ("Run-off · Nth place — Lanes drawn for the tie at the final cut-off") from `ToplistView.tsx` so public toplists never display runoff lanes.
5. **Render Team Flags & Referee Cards Next to Team Names Everywhere (`ScoringParts.tsx`, `ToplistView.tsx`, `HeatScores.tsx`, `CommentaryDeskPage.tsx`, `TvKioskPage.tsx`, `MyTeamsPage.tsx`, `MyTeamParts.tsx`, `TeamsTab.tsx`)**:
   - Wire the new backend `flag` and `refereeCard` fields on `TeamDto`, `HeatEntryDto`, `StandingRow`, and `ResultDto` into `ScoringParts.tsx` (`ScoreRow`, `HeatGrid`, `Qualifiers`), `ScorerPage.tsx`, `CommentaryDeskPage.tsx`, `TvKioskPage.tsx`, and `MyTeamsPage.tsx` (and strip `[flag:...]` via `parseBibAndFlag` in `MyTeamsPage.tsx:151` & `MyTeamParts.tsx:200` so raw `[flag:...]` text is never shown).
   - Add a flag/nation selector when creating or editing a team in `TeamsTab.tsx` and `MyTeamParts.tsx`.
6. **Heat Reminder Timing in Settings — Custom Minutes Only (`SettingsPage.tsx:220-290`)**:
   - Remove the preset timing buttons (`15m`, `30m`, `1h`) from `SettingsPage.tsx` and replace them with a clean, well-designed custom minutes control.
7. **Move `Shift all arenas` Off Admin Timetable to PA View Only (`SessionsTab.tsx`, `TimetableBoard.tsx`, `CommentaryDeskPage.tsx`)**:
   - Remove global `Shift all arenas` / global delay controls from the admin timetable (`SessionsTab.tsx` / `TimetableBoard.tsx`) and keep them exclusively on the PA Commentator Desk (`/competitions/:id/commentary`).
8. **Full-Page Layouts Instead of Centred Boxes (`HeatScores.tsx`, `ScoringTab.tsx`, `ToplistView.tsx`, `TimetableBoard.tsx`, `CompetitionTeamPage.tsx`, `ScoringSection.tsx`, `ScorerPage.tsx`, `SettingsPage.tsx`, `Refine.tsx`)**:
   - `HeatScores.tsx:321, 333`: Remove `mx-auto max-w-xl` (`576px` cap) and the `.mg-card` wrapper around `<table className="heat-grid">` so heat tables use the full page width.
   - `ScoringTab.tsx:330` & `ToplistView.tsx:153, 217, 331, 399`: Remove `max-w-[560px] lg:max-w-3xl` and the individual `.mg-card` wrappers around Totals, Points by session, Points by game, and Finals tables.
   - `timetable.css:2, 50` & `TimetableBoard.tsx:229`: Remove `max-width: 560px; margin: 0 auto` on `.timetable-board` and flatten `.tt-card` boxes into full-width sections.
   - `CompetitionTeamPage.tsx:296, 302-609`: Replace the 7 stacked `.mg-card` boxes and `max-w-4xl` constraint with a clean full-page layout.
   - `ScoringSection.tsx:197` & `ScorerPage.tsx:129`: Remove the outer `.sc-card` box and double horizontal padding so live phone scoring is truly edge-to-edge full-page.
   - `SettingsPage.tsx:119`, `FollowingTab.tsx:79`, `MyTeamsPage.tsx:96`, `WeatherPage.tsx:371`, `ContactOrganisersPage.tsx:143`, and `Refine.tsx:11` (`RefinePage`): Remove narrow `max-w-[560px]` / `max-w-xl` / `max-w-2xl` centred-box wrappers in favour of full-page layouts.

**Decisions taken in the walkthrough** (don't relitigate):
- Admin **edit mode is removed** entirely; destructive actions use the red full-screen `ConfirmDialog`, never `window.confirm`.
- No "Demo event" labels anywhere (only the user uses the site); demo events count in stats.
- `/events` is the one competition picker; Forget clears the saved competition; `/` jumps into a competition only when the user chose Remember.
- A new competition is **entry-first**: until teams are drawn the public sees only the entry page and Details.
- Competitions are created in a **stepped wizard** (structure, timing, HHF, hatbands and races up front, races skippable); the Format page is now **On the day**.
- Section names are age group first: "Junior Individuals", "Novice Pairs".
- **Club payouts** are a mock of provider onboarding owned by the club; only masked bank details are stored.
- **Dec forms** are set per competition. New competitions start minimal: pony name and rider name per rider, trainer name and **trainer phone** per team. Organisers add parts and custom number rules (a breach is allowed but flagged).
- HC teams are left out of race finals as well as standings.

**1. Check in a browser first.** No agent had a browser, so nobody has seen these yet:
- [ ] Live & stream, including **Go live from this device** on a phone, and the organiser laptop layout
- [ ] Creator wizard, On the day, and the provisional timetable
- [ ] Scoring page: lane order, team colours, stacked races, Undo, elimination reasons, between-race summary, HHF next lanes, Print heat table
- [ ] Admin dashboard on Me, approvals (fixed in #123), and the red confirm dialog
- [ ] Dec form setup and a submitted dec form with trainer phone
- [ ] Timetable, event shop and events picker at full laptop width, and at phone width

**2. Carry on with the walkthrough.** The user got to about section C of the checklist in chat c5406079 (create, entries, payment). Still to do: dec forms, Readiness & draw, event tools, then event day (scoring, Arena, scorer links, finals, toplists, Live & stream, Following), then account and themes, then delete "TEST COMP1". After that the planned phase 2: Claude goes through every page with Playwright.

**3. Pages the user hasn't reviewed yet.** No feedback given on these:
- Public: `/competitions/past`, `/stats/:kind` (rider, pony, team and club profiles), `/seasons/:id`, `/team-profiles` and `/team-profiles/:id`, `/following`, `/shop`, `/privacy`, `/unsubscribe`, `/login`
- Competition tabs: Toplists, Arena, Teams, Following, Rulebooks, Sponsors, event Shop
- Organiser: Readiness & draw (`operations`), Broadcast, Produce, `shop/manage`, `/event-tools/:id` (import, duplicate, print sheets, results book, tack and passport checks), the print views and the venue poster
- Account: `/me/account`, `/me/signups` and the test payment page, `/me/catalogue`, `/me/orders`, `/me/members`, `/me/payouts` (new), `/teams` (My teams), `/declarations` index, `/confirm-email` (new)
- Scorer link page `/score`, and the embed widget

**4. Laptop layouts not done in #124:** Teams side drawer, Seasons filters, team profile in two columns, the scoring heat table beside the race stack, and `shop/manage`, `/me/catalogue`, `/me/orders`, rulebooks and members (still a centred column). `DataTable` exists but nothing uses it yet.

**5. Security follow-ups** from the review of #113, #114 and #116 (all low):
- [x] Payouts: allow clearing the responsible person's date of birth. (Privacy page updated on 24 Oct to mention the stored sort code and account holder name.)
- [x] Payouts: pin the paying club on the competition before real money moves (`DecFormConfig.PayoutClubId` pinned at competition creation).
- [x] Show "Pay to …" on the entry page only to signed-in users.
- [x] `IsClubManagerAsync` trusts the Manager role in the token; re-check it against the database, as `ClubPayoutsController.ScopeAsync` does.
- [x] Require a password when claiming an email via `POST /api/auth/admin-key` and enforce per-IP account creation cap (`RateLimits:AccountsPerIp`, default 5) and sign-in rate limit (`RateLimits:AuthPerMinute`, default 5).

**6. Optional:** a TURN key for streaming on weak 4G (`Streaming__Cloudflare__TurnKeyId` is set, its `TurnKeyApiToken` isn't), a tutorial mode for scoring, and the remaining browser alert in `useTeamNotifications`.

**7. Housekeeping:** Neon has 9 of 10 branches (backups from 23 October); delete older ones once tonight's changes have settled. Remove the merged agent branches and worktrees (`.claude/worktrees/agent-*`). A stash entry `creator-wip-1` is safe to drop.

## Who owns what (22 October, evening)

Check this before taking an item, and add yourself here when you start one.

- **Chat 99b776bf:** BUG-01, 02, 04, 06, 08, 09, 10, 11, 12, 13, 19, 20. Merged #79 (multi-arena), #80 (finals, standings, equipment, heat edits) and #81 (rider clash, tidy-ups). Still open: `fix/scoring-page-bugs`.
- **Chat 11a9436f:** BUG-03, 05, 07, 14–18, 22–26 (issues #67, #69, #72–#75, #77, #78 and the boundary-tie part of #68), including the product decisions they need (lane rotation and sit-outs, heat-heat-final, club hierarchy, bib description, guest riders). Branch `fix/bugs-md`; overlapping early work parked on `wip/bugs-md-overlap`.
- **Chat a29f41a2 (copy `-d7`, fork 9f48b569):** scorer links, sharing links (#82) and the sign-up terms tick, then the competitor-gap stages in `docs/competitive-gaps.md`.
- **Chat 30324baf (23 October):** the NEXT_STEPS batch on `feat/next-steps-batch`: result statuses and referee notes (A3), the results book (A4), finals tie-breaks (A2), tack and passport checks, and `/stats`.
- **BUG-21** (VAPID keys and UK times) was fixed in #57.
- `SessionPage.tsx` is touched by `fix/scoring-page-bugs`, scorer links and several of 11a9436f's bugs: land `fix/scoring-page-bugs` first, then rebase the others.

## Where things stand

- **Merged:** PRs #1–#65 and #79–#81. Since 21 October:
  - #38 live feed sign-in fix, #40 demo reseed, #41 lint in CI;
  - #43 and #47 API on Vercel;
  - low signal: #45 connection pill and adaptive checks, #48 fast first view, #46 server weather cache, #49 lite mode and lazy images, #52 CSP allows https images;
  - stream controls: #50 overlays (banners, strip, look, producer screen), #53 score cards with producer show, skip and edit, #54 saved looks;
  - roadmap section 1: #57 VAPID keys from settings and UK reminder times, #58 Redis backplane for SignalR, #59 shared viewer counts and rate limits;
  - roadmap section 2: #60–#62 one competition admin role per event (the per-role design below was replaced by this);
  - roadmap section 3: #63 rider privacy (initials only, filming opt-out), #64 privacy hardening (declaration access, geocode limit, IP scrubbing, account deletion, `/privacy`);
  - #65 arena and lane on followed heats, follow a club, race rules; #79 multi-arena timing; #80 finals seeding, standings by tier, equipment and heat edits; #81 rider clash warning and tidy-ups.
- **Sections 1–3 below are done** apart from: the privacy page contact email (placeholder until there is an address), the anonymous per-IP stream cap (off; check how the hub sees client IPs first), the club-scoped role hierarchy and private admin replies (now BUG-14 and BUG-18), and section 1's cron item (still open: per-minute Vercel cron needs the Pro plan, so the schedulers can sleep when the API scales to zero).
- **Live API is confirmed:** the live headers show `cle1` in `x-vercel-id`, and the overlays, first-view and weather endpoints answer.
- **Hosting:** the website is on Vercel (project `mounted-games-app`, root `web/`). On 21 October the API moved from Render to its own Vercel project, `mounted-games-api`. It's a container built from `Dockerfile.vercel` at the repo root and runs in `cle1`, next to Neon in AWS us-east-2. The website rewrites `/api` there, and the live hub connects to it directly.
- **Database:** Neon. Every migration on main is applied, including `AddStreamOverlays` (21 Oct) and `AddOverlayLooks` (22 Oct), each with a `backup-pre-…` branch taken first. To reach Neon without the guarded env file: `npx neonctl connection-string --project-id wild-leaf-19597390`. On 21 October the live-video migration's history row was renamed from `20261016181150_AddLiveStreams` to `20261017070452_AddLiveStreams` to match main (the schema is identical); a backup of the history table is in `~/.config/mounted-games/backups/`.
- **Plans:** `docs/plans/stream-controls-and-low-signal.md`, with designs in `docs/designs/stream-controls-and-low-signal.html`.

---

## Confirmed Product & Architecture Decisions (22 October Review)

All items below have been reviewed and confirmed for upcoming implementation:

### 1. API Multi-Instance & Scale-to-Zero Fixes (`mounted-games-api`)
- **Fix `VapidKeyService.cs` (`api/Services/VapidKeyService.cs`):** Read `Security:VapidPublicKey` and `Security:VapidPrivateKey` from `IConfiguration` first before falling back to local `vapid-keys.json`. Currently every container boot generates a new keypair on ephemeral disk and invalidates existing browser push subscriptions.
- **Fix `NotificationScheduler.cs` timezone (`api/Services/NotificationScheduler.cs`):** Convert `ScheduledStart` to UK/venue time (`Europe/London`) instead of `ToLocalTime()` (which formats in container `UTC` in `cle1`).
- **Vercel container & cron setup:**
  - Pin `mounted-games-api` to **Max Instances = 1** for single-process SignalR groups (`LiveHub`), `ViewerRegistry`, `CompetitionStreamLocks` and `RequestLimits` until an Upstash Redis backplane is added.
  - Trigger notification & stream sweep ticks via Vercel Cron (or keep `min: 1` during live competition weekends) so `NotificationScheduler` and `StreamSweeper` don't sleep after 5 minutes of inactivity.

### 2. Club-Scoped Role Hierarchy (`Admin > Team Manager > Trainer > Member/Rider`) & Competition Permissions
- **Every Role Belongs to a Club (`ClubId` Required) & Free-Text Club + Custom Team Names (`AuthController.cs`, `TeamsTab.tsx` & `SignupController.cs`):**
  - Make **Club / Squad name mandatory** on signup (`LoginPage.tsx:156` & `AuthController.SignupTrainer:100-108`) for all non-Admin users.
  - Because MGAGB and open competitions have tons of custom team and club names, **do not force a strict `<select>` dropdown** where unknown names get dropped to `null` (`TeamsTab.tsx:128-137`, `AuthController.cs:100-108`, `SignupController.FormTeams:238-246`).
  - When entering or creating a team, allow **both** a free-text **Club Name** (e.g. `"Welsh MG"`) and a custom free-text **Team Name** (e.g. `"Welsh Dragons"`, defaulting to the Club Name or `"{Club} A"` if left blank), and auto-create or link the `Club` record when a new name is entered.
- **Team Manager (`Roles.Manager`) Has Overall Control of the Club (Just Below `Admin`):**
  - Hierarchy: **`Admin` > `Manager` (Team Manager) > `Trainer` > `Member` / `Rider`**.
  - **Approval Chain:**
    - Global **`Admin`** approves **Team Managers (`Roles.Manager`)** for a Club.
    - Once approved, a **Team Manager** (as well as `Admin`) can approve or remove **Trainers (`Roles.Trainer`)** and **Members/Riders** belonging to their own Club (`user.ClubId`).
  - A **Team Manager** has full control over their Club (`user.ClubId`):
    - Automatically sees and manages **every team belonging to their Club (`t.ClubId == user.ClubId`)** on `MyTeamsPage.tsx`, `TeamsTab.tsx`, and `DeclarationsTab.tsx` (fix `TeamsController.MyTeams` which currently only checks `t.TrainerUserId == userId`).
    - Can **enter whole teams** (e.g. `Club A`, `Club B`, or custom team names) directly into Team competitions on `DetailsTab.tsx` / `SignupController.cs`, and can also enter **Pairs** and **Individuals** from their club (while Riders can also enter themselves in Pairs and Individual sections).
    - Can assign Trainers from their club to specific teams (`UpdateTeamRequest.TrainerUserId`), manage the club's shared `SavedRiders`, and submit/edit declarations for any team in their club.
    - Include `Roles.Manager` in `Roles.Organiser` (`Roles.cs:23`) and `AuthContext.canOrganise`.
- **Unlock all day-of endpoints for competition organisers:** Replace `[Authorize(Roles = Roles.Admin)]` with `[Authorize(Roles = Roles.Organiser)]` + `[CompetitionAccess]` across `ScoringController`, `SessionsController`, and `CompetitionsController` (`CreateFinals`, `AutoTimetable`, heat activation, score entry, session management).
- **Per-competition staff / co-organiser permissions (`CompetitionCollaborator`):**
  - Allow a competition creator (or Admin) to grant other users permission to manage **that specific competition** (e.g. co-organisers, ring scorers, line judges, commentators, stream producers) without making them global `Admin`s.
  - Update `CompetitionAccessAttribute` and frontend `canOrganise(comp)` to check `CreatedByUserId == userId || Collaborators.Any(c => c.UserId == userId)`.
  - Add a "Competition Team / Permissions" management card in the organiser tools UI.
- **Competition Live Feed & Private Messaging to Admins with Private Admin Replies (`ChatController.cs` & `ChatTab.tsx` — `BUG-18`):**
  - Public feed remains **Admin/Organiser announcements only** (`IsPublicAnnouncement = true`), while **any authenticated user (`Manager`, `Trainer`, `Member`, `Rider`)** can send a **private message to the Admins** (`IsPublicAnnouncement = false` or a *"Report a Score Issue"* flag).
  - Add a **"Reply Privately"** button for Admins on private messages and score-issue reports (`ToUserId` / `ParentMessageId`) so the Admin's reply goes **only to that sender** (with a push notification) instead of broadcasting to the public feed.

### 3. Safeguarding & UK GDPR Options (Initial-Only & Filming Opt-Out)
- **Optional rider privacy checkboxes** (unticked by default) on `SavedRider`, `RiderEntry`, and `SectionSignup`:
  - `UseInitialOnly`: Display the rider's surname as an initial only (`"Oliver Smith"` → `"Oliver S."`) on public unauthenticated scoreboards, declarations, and print views, while keeping the full name visible to authenticated organisers/admins.
  - `NoFilming`: Opt out of close-up filming/photography. When a heat in the arena contains a rider with `NoFilming = true`, show a private safeguarding alert banner on `/produce` and `/broadcast` (e.g. *"Safeguarding notice: Filming opt-out in Heat 2, Lane 4"*).
- **Additional security & privacy hardening:**
  - Fix `DeclarationFormsController.Submit` so a user can only submit/overwrite a declaration for a team belonging to their club (`Manager` of `team.ClubId`), a team they coach (`TrainerUserId == userId`), or a competition they organise, rather than any unclaimed team (`TrainerUserId == null`).
  - Rate-limit `GET /api/geocode` (which calls the paid What3Words API) and cap anonymous `LiveHub.WatchStream` connections per IP.
  - Add a public `/privacy` & cookie notice page, hash or drop raw IP addresses after 30 days on `ChatMessages`/`ShopPosts`, and add self-service account deletion (`DELETE /api/auth/me`).

### 4. Whole-Team Entries, "Looking for a Pair" (50% Pay), Guest Rider Waiting List, Individuals, Pairs, Lockable Declarations, Saved Riders & Team Bib Description
- **Competition Home Phase & Visible Tabs (`CompetitionHome.tsx` & `competitionPhase.ts` — `BUG-32`):**
  - **Stage A (Before Timetable Is Generated):** Keep `CompetitionHome.tsx` on the **Entry Page (`EntryPage.tsx`)** until the timetable/heats are generated (do NOT switch away just because `competition.teams.length > 0`), while keeping all other competition tabs visible and accessible (even when empty before the draw).
  - **Stage B (Once Timetable / Heats Are Generated):** Automatically switch the default competition home page to the **Timetable & Live Heats** view.
- **Entries by Section Format, Team Names & Declaration Linking (`DetailsTab.tsx`, `SignupController.cs`, `DeclarationsTab.tsx` — `BUG-29`, `BUG-30`, `BUG-34`):**
  - **Entries Do NOT Require Declaration Forms at Entry Time:** Entering on `DetailsTab.tsx` only submits the entry (Team / Pair / Individual name, Club name, contact, payment). Later, **one person** (the Team Manager, Trainer, or one rider in a Pair/Individual) fills in the Declaration form (`DeclarationsTab.tsx`), using the **Team Name** (or Pair / Rider name) to identify and connect the entry to its Declaration Form.
  - **"Looking for a Pair / Partner" (Both Solo Riders Pay Half to Reserve a Spot, Mutual Agreement to Pair Up):**
    - When a solo rider enters a `Pairs` section as **"Looking for a Pair / Partner"**, they **pay half (`section.PriceMinor / 2`)** on entry, and **paying half reserves a spot** in the section.
    - Other solo riders (who also pay half `section.PriceMinor / 2` to reserve their spot) can see the **"Looking for a Partner"** list on `DetailsTab.tsx` / `EntryPage.tsx` and **request to pair up** — once **the other person agrees/accepts**, the two solo entries are linked together into a Pair.
  - **Whole-Team Booking + "Looking for Guest Rider(s)" & Free "Wait for a Guest Ride Spot" List:**
    - In `SectionFormat.Teams`, the Club / Team Manager (or Trainer / Admin) books and pays for the **whole team slot** as normal, and can flag that the team is **looking for Guest Rider(s)** (guest riders do not pay in-app).
    - Individual riders without a team can join a **free "Waiting for a Guest Ride Spot" list** on that section (`0` fee in-app) so teams needing a guest rider can invite/claim them (automatically adding them as `IsGuestRider = true` on the team's Declaration Form).
  - **4 or 5 Active Riders on a Team + 6th Rider / Emergency Replacements (`DecFormEditor.tsx` & `RiderSwapService.cs` — `BUG-36`, `BUG-37`):**
    - A Team declaration is valid with **4 or 5 riding members** (5th riders ride with the team; 4-rider teams must not be blocked from submitting `DecFormEditor.tsx`), plus an optional **6th reserve rider** who can hop on.
    - On competition day (once declarations are locked), **Admins / Organisers** can make **Emergency Rider or Pony Replacements** (`RiderSwapSheet.tsx` / `RiderSwapService.cs`), even if no reserve was pre-declared on the form.
  - **`SectionFormat.Teams`:** **Team Managers** (as well as Trainers and Admins) enter the **whole team** (or multiple teams) directly for their club (creating/linking the `Team` immediately and declaring the 5 riders on `DeclarationsTab.tsx`), rather than requiring 5 separate individual rider signups first.
  - **`SectionFormat.Pairs` & `SectionFormat.Individual`:** **Both** Riders themselves (self-entry) **and** Team Managers (on behalf of riders in their club) can enter Pairs and Individuals, and self-entered riders can submit/edit their own Declaration Form on `DeclarationsTab.tsx` (`BUG-30`).
  - Include a public `ActiveSignupsCount` on `CompetitionSectionDto` so `DetailsTab.tsx` shows the real number of entries and remaining places (`seatsLeft`) to all users, not just the competition organiser.
- **Edit Existing Declarations & Admin "Lock Declarations" Toggle (`Competition.DeclarationsLocked`):**
  - Fix `DeclarationFormsController.Submit` and `DeclarationsTab.tsx` so clicking a team that already has a declaration **loads and updates that existing `DeclarationForm`** instead of creating a duplicate row.
  - Add an Admin toggle **`Competition.DeclarationsLocked`** so Team Managers and Trainers can freely edit their riders/ponies/bib description until the Admin locks declarations before the competition starts (after which only the Admin can make changes or emergency substitutions).
- **Fix Individual & Pairs Naming (`SignupController.FormTeams` & Scoreboards):**
  - When forming entries for `SectionFormat.Individual`, set `Team.DisplayName` to the rider's name (instead of `"Club A"`, `"Club B"`) and auto-populate their `DeclarationForm` / `RiderEntry` (including pony name and club).
  - For `SectionFormat.Pairs`, set `Team.DisplayName` to `"Rider 1 & Rider 2"`.
  - On `ScoringTab`, `ToplistView`, `HeatScores`, and `StreamOverlays`, label the column header `"Rider"` or `"Pair"` instead of `"Team"` and display the pony name + club underneath.
- **Saved Riders Picker for Team Managers & Trainers:**
  - Ensure Team Managers and Trainers can save their club's riders (`SavedRiders`) and pick them with one click on Declarations and Signups so names and ponies stay consistent across competitions.
- **Single Plain-Text Bib / Hat Silk Description per Team (No Per-Rider Dropdown, No Last-Man Tracking):**
  - All riders on a team wear the **same bib / hat silk**, and the "last man" hatband changes per race without needing to be recorded.
  - Remove the per-rider `<select>` colour dropdown (`Red, Yellow, Blue, Green, White`) in `DeclarationsTab.tsx:264-273` and `DbInitializer.cs:626-639`.
  - Replace it with a **single free plain-text `BibDescription` field on the Team / Declaration** (e.g. `"Red"`, `"Navy with White Stars"`, `"Green & Gold Quarters"`), displayed on `SessionPage.tsx`, `HeatScores.tsx`, `DeclarationsTab.tsx`, and `StreamOverlays`.
- **Main Club + Guest Riders (`RiderEntry.IsGuestRider`):**
  - Every team belongs to **one main `ClubId`** (no multi-club composite teams).
  - Borrowed riders from another club/branch are marked as **Guest Riders** (`IsGuestRider = true`, plus optional plain-text `GuestClubName`) on the declaration form.

### 5. Scoring, Manual Score Override, Penalty Adjustments, Automatic Scoring Page (`SessionPage.tsx`), Run-Offs & Finals Rules
- **Manual Score Override & Overall Team Point Adjustment / Penalty (`+` / `-`):**
  - **Per-Race Manual Score Override (`Result.IsManualOverride`):** Allow the Admin / Scorer to manually override any team's points in a specific race to **any custom value**, bypassing `sessionBase - place + 1`.
  - **Team Point Adjustment / Penalty (`TeamPointAdjustment`):** Allow the Admin / Chief Steward to apply a `+` or `-` points adjustment to a team's overall/session total (e.g. `-2 pts` or `-5 pts` for outside assistance, yellow card, or steward penalty) with a reason note shown on the standings.
- **Automatic Scoring Page (`SessionPage.tsx`) Overhaul & Run-Off Race Integration:**
  - **Manual Tap on Every Team (Including Last Team) + Sticky "⬅ Back to Previous Race" Bar:**
    - In standard heats and Finals, keep manual tap required for all teams including the last remaining team (in case the last team was also eliminated rather than finishing).
    - Add a sticky **"⬅ Back to Previous Race (Race X)"** pill at the top of `SessionPage.tsx` after saving a race so the scorer can jump back in 1 tap if the referee calls a late elimination.
  - **Fast Qualifier Scoring in Heat-Heat-Final (`Race-Finals`) on `SessionPage.tsx`:**
    - The Race Final heat size defaults to the same size as the qualifier heats (e.g. `6` and `6` → `6` in the Final, so `3` from each heat go through), with an Admin setting (`QualifiersPerHeat`) to choose how many advance from each heat (`Q1` and `Q2`).
    - When scoring `Q1` and `Q2` on `SessionPage.tsx`, the scorer **only taps the teams that qualify into the Final** (e.g. taps the Top 3 in order).
    - All remaining teams in `Q1`/`Q2` automatically receive the non-finalist **`1 pt`** — and **any click on a remaining team after the qualifiers are selected marks that team as Eliminated (`0 pts`)**!
    - Once `Q1` and `Q2` of a race are scored on `SessionPage.tsx`, **automatically populate that race's `Final` heat** (`Q1[1], Q2[1], Q1[2], Q2[2]…`) right inside `SessionPage.tsx` and advance the scorer straight to the `Final`.
    - In the `Final`, non-eliminated Finalists score **`2, 3, 4, 5…`** (reversed so last non-eliminated place gets `2 pts`) and an Eliminated Finalist gets **`0 pts`** (with manual override available).
    - **Per-Race Rider/Team Sets & 3-Sub-Tab Section Page (`Draw / Heats` · `Heat Scores` · `Toplist`):**
      - In `Heat-Heat-Final` (`Race-Finals`), each race has its own drawn set of riders/teams in `Q1` and `Q2` (using the fair seeded draw).
      - Give each Age Group / Section page **3 clean sub-tabs**:
        1. **`Draw / Heats` (No Scores):** Shows each Session and which teams/riders are in each Heat & Lane (or `Q1`/`Q2` per race in `Heat-Heat-Final`) with start times and arena.
        2. **`Heat Scores`:** All heat score tables for that section (or the 1 unified session table for `Heat-Heat-Final` — `BUG-31`).
        3. **`Toplist`:** Overall standings (`Totals` / `By Session` / `Finals`), shown automatically at the end of each section's Final once completed.
    - **Run-Off Race Scoring (`+0.01` Hidden Tie-Breaker vs `.5` Visible Half-Points):**
      - When a **Run-Off Race** is run on `SessionPage.tsx` after qualifiers or a Final, resolve the tie by adding a hidden **`+0.01`** tie-breaker increment to the run-off winner (so it sorts 1st/2nd automatically while remaining **invisible** on the public scoreboard, whereas `.5` dead-heat split points **are** displayed visibly).
  - **Public Heat Table (`HeatScores.tsx`), Pre-Filled Sit-Out `"S"`, Live Leader Ordering, Followed Highlighting & Dedicated Competition Team Page (`BUG-33`):**
    - **Pre-Fill `"S"` (Sit-Out) Before Races Are Scored:** In `HeatScores.tsx`, pre-populate **`S`** for every `(team, raceIndex)` where a team sits out (`sitsOutOf(heat, entry, raceIndex, laneRules)`), even before the race is scored (instead of showing `–` until after scoring).
    - **Row Ordering on `HeatScores.tsx`:** Before any race in the heat is scored, order rows by **starting lane (`1..6`)**. As soon as racing starts in the heat (and when finished), order rows from top to bottom by **who is winning the heat (`Total` points highest at the top going down)**, while showing each team's **current lane** (or starting lane) underneath their name (no hatband colour needed on the public heat table).
    - **Highlight Followed Teams Across the App:** When a viewer follows a team or club (`useFavourites`), **highlight that team's row** on the **Toplist (`ToplistView.tsx`)**, **Sessions / Timetable (`TimetableBoard.tsx`)**, and **Heat Table (`HeatScores.tsx`)**.
    - **Dedicated Competition Team Page (`/competitions/:id/teams/:teamId`):** Clicking a team on the **Toplist (`ToplistView.tsx`)**, **Heat Table (`HeatScores.tsx`)**, or **Teams / Following** opens a dedicated page for that team in the competition showing:
      - Team Name, Section/Age Group, Club, **Bib Colour / Description**, and current **Toplist Ranking & Total Points**,
      - Declared Riders & Ponies (respecting `UseInitialOnly`), and
      - **All of the Heat Tables they are in** (Session 1, Session 2, Finals) with their race-by-race scores and totals.
  - **Fix Auto-Advance Order (`SessionPage.tsx:397-433`) — Normal vs Alternating vs Heat-Heat-Final:**
    - Currently `SessionPage.tsx` *always* jumps across heats (`H1 Race 1 → H2 Race 1`).
    - Fix it so:
      1. **Normal Session (`!raceOrderAlternating`):** Advances within the same heat (`Heat 1 Race 1 → Race 2 → … → Race N`) before moving to `Heat 2 Race 1`.
      2. **Alternating Heats (`raceOrderAlternating === true`):** Advances `Heat 1 Race 1 → Heat 2 Race 1 → Heat 1 Race 2`.
      3. **Heat-Heat-Final (`Race-Finals`):** Advances `Q1 → Q2 → (auto-populate Final) → Final` for each race.
  - **"Re-Run Race" Button on `SessionPage.tsx`:**
    - When a race is stopped and re-run (e.g. broken equipment or a fallen rider), tapping **"Re-Run Race"** clears the finish places (`1st, 2nd, 3rd…`) for the re-run while **keeping any already-eliminated team locked as `Eliminated (0 pts)`**, and broadcasts `"RE-RUN IN PROGRESS"` to the live status/overlay.
  - **End-of-Qualifiers → 1-Tap "Populate A / B / C Finals Now" on `SessionEndTransition.tsx`:**
    - When the last qualifier session for a section finishes on `SessionPage.tsx` (and any boundary tie is resolved), show the **Qualifier Cut-Off Summary** and a **1-tap "Populate A / B / C Finals Now"** button directly on `SessionEndTransition.tsx`.
  - **Fix Multi-Arena `SessionEndTransition.tsx` (`SessionEndTransition.tsx:38-45`):**
    - Filter `next` and `nextRealSession` by the **same arena (`s.arenaName === finishedSession.arenaName`)** so finishing a session in Arena 1 never accidentally starts or navigates to Arena 2's session.
  - **Fix Draft Restore on `SessionPage.tsx` (`SessionPage.tsx:94-171`):**
    - Stop the race-change seed effect from overwriting the hydrated `localStorage` scoring draft.
- **Lane Editing in Manage Heats (`TimetableManagement.tsx`):** non-destructive heat edits landed in #80.
  - Allow the Admin to edit **lane numbers (`Lane 1..6`)** directly in the Manage Heats modal.
- **3-Way Lane Rotation Setting Inside a Heat (`LaneRotationMode`):**
  - Replace the hardcoded `+1` lane rotation in `SessionPage.tsx:19` (`displayLaneFor`) with a configurable per-session `LaneRotationMode`:
    1. `Stay` (`0` — teams stay in their drawn lane for the whole heat).
    2. `MoveUp` (`+1` — teams move up 1 lane after each race: `1 → 2 → 3…`).
    3. `MoveDown` (`-1` — teams move down 1 lane after each race: `6 → 5 → 4…`).
- **Sit-Out / Bye Lane Rotation (`"S"` Cell) vs Splitting Into 2 Heats:**
  - **When there are 2+ heats in a session:** Split teams across the heats (`BalancedSizes`, e.g. 4 and 3) so every team gets the **exact same number of races** in the session (with unequal heat sizes scoring `4, 3, 2, 1` and `4, 3, 2`).
  - **When a single heat has `7` teams in a `6`-lane arena (`TeamsInHeat > ArenaLanes`):**
    - Position `7` sits out each race while Positions `1..6` compete in Lanes `1..6`, rotating after each race so teams take turns sitting out.
    - Store `Result { IsSitOut = true, Points = 0, Placing = null }` and display **`S`** (for **Sitting Out**) instead of `0` or `–` in the score grid (`HeatScores.tsx`, `SessionPage.tsx`, `ToplistView.tsx`, `ScoreCardOverlay` on live streams, and printed score sheets) for the race a team sits out.
    - Warn the organiser if the number of races is not a multiple of the number of teams in a sit-out heat.
- **Team Withdrawal / Scratching After the Draw:**
  - **1 team withdraws from a heat:** Treat it like a normal unequal heat with 1 less team (e.g. a 5-team and 4-team heat both score off `sessionBase = 5`, so the 4-team heat scores `5, 4, 3, 2`).
  - **Withdrawals leave a heat with 2+ fewer teams than another heat in the session (e.g. `5` and `3`):** Automatically flag that the heats need rebalancing, allow/prompt moving a team from the larger heat to the smaller heat (`4` and `4`), and **automatically send a push notification / alert to the moved team(s)** with their updated heat and lane.
- **Alternating Heats Within a Session (`Session.RaceOrderAlternating`):**
  - When 2 heats run alternating (`H1 Race 1 → H2 Race 1 → H1 Race 2 → H2 Race 2`), the 2 heats have **completely separate sets of results** (`Heat 1` results vs `Heat 2` results); they only interleave the order they run in the arena.
- **Dead Heats Within a Single Race (Split Points — `.5` Support):**
  - When two (or more) teams tie in a single race (e.g. dead heat for 2nd in a 5-team heat scoring `5, 4, 3, 2, 1`), they **split the combined points** (`(4 + 3) ÷ 2 = 3.5 pts` each) and the next finisher takes **4th (`2 pts`)**.
- **Remove the Race Clock & Show Dash (`—`) Before Scoring Starts:**
  - **Remove `RaceClock`** (`Start / Stop` timer) from `SessionPage.tsx`.
  - **Toplist before Race 1:** Show a **`—` dash** for rank on `ToplistView.tsx` before any races are scored in a section, instead of listing every team on `0 pts` as joint `1st`.
- **Participation / Non-Scoring Mode Toggle (`Section.IsParticipationOnly`):**
  - Add a toggle on a Section for Lead Rein / Novice / Have-a-Go classes that hides numeric points and rankings (`1st..6th`) on public scoreboards and gives every rider/team a `"Completed" / "Clear Round" 🏵️` badge.
- **Unequal Heat Sizes Scoring & Draw Fairness (`CompetitionDrawService.cs`):**
  - In a session with unequal heat sizes (e.g. a 4-team heat and a 3-team heat), `sessionBase = 4` so the 4-team heat scores `4, 3, 2, 1` and the 3-team heat scores `4, 3, 2`.
  - Track `SmallHeatCost` so no team is drawn into the smaller (`4, 3, 2`) heat more times than other teams across qualifier sessions.
- **Hors Concours (`HC`) Dual Display / Point Mode.**
- **Rulebook Emergency Substitution (`GR1.4–GR1.9`).**
- **Finals Running Order, Lane Assignment, Two-Part Finals, Semi-Finals & Points Carryover.**
- **A1 — Multi-session score carryover rules (`FinalsCarryoverMode`).**
- **A2 leftovers (tie-breaks shipped in `feat/next-steps-batch`):** a screen to order podium ties by hand (the standings already use the rule), splitting points on a bonus tie, and spawning a real run-off heat on `SessionPage.tsx` (today the organiser enters the run-off's finishing order).
- **Ring Scoring #1 & #2 — "Tap-in-Order" Finish-Line Pad & Split Line-Judge / Arena-Referee Mode.**
- **Standings #6 — Deeper "Cut-Off Line & Magic Number" Maths (`+4 pts safe`, `Needs X pts`, `Q` Qualified, `🏆` Clinched).**
- **Post-Session Point Editing & Public "Report a Score Issue" (#7).**

### 6. Timetable Generation, Multi-Arena Support, Live Notifications & Following Whole Clubs
- **Same-Rider Clash Avoidance in `AutoTimetable`:** the readiness warning landed in #81.
  - When auto-scheduling a multi-arena timetable, avoid putting the **same Rider** in two arenas at overlapping times. *(Do not check Trainers or Pony names.)*
- **Independent Multi-Arena Timing, Arena Selector on Breaks/Briefings & Multi-Arena Ring Crew Switcher:**
  - **Running Early & Cutting Breaks When Late + Live Mid-Session Drift (`≥ 5 Min` Threshold):**
    - Cascade early offsets forward when running ahead of time, allow breaks to be compressed when running late, and estimate live drift mid-session race-by-race (showing the shift indicator only when **`≥ 5 minutes`** early or late).
- **Live Arena-Progress "Collecting Ring / Tack Up" Notifications (`NotificationScheduler.cs` & `ScoringController.cs`):**
  - Trigger a push notification to teams in the **next heat** when the current heat in their arena enters its **final 2 races** (plus a 1-tap **"Call Next Heat to Collecting Ring"** button for the scorer/steward).

### 7. 2026 Pony Club Race List, Duplicate `(x2)` Fix & Individual Race Eligibility Filter
- **Remove Duplicate Consecutive `(x2)` Races in `CompetitionEditor.tsx` (`ZONE_PAIRS` & `AREA_PAIRS`, Lines 48–54 & 82–86):**
  - Remove all duplicate consecutive entries from `ZONE_PAIRS` and `AREA_PAIRS`.
- **Add Missing 2026 Pony Club Booklet Races to `RaceLibrarySeed.cs`:**
  - Seed `One Mug Race (Junior)`, `Two Bean Bag Race (Junior)`, `Three Mug and Table (Pairs)`, `Spell PONY (Juniors)`, `Ball & Racquet (Old Version)`, and `Four Ball Cone (2002)` from `docs/pc-mounted-games-race-rules-2026.md`.
- **Filter Out Non-Individual Races When `SectionFormat == Individual` (`RaceTemplate.SupportedFormats`):**
  - Only show races that have rules adaptable to an Individual (1 rider + 1 pony without needing a partner or an unmounted No. 5 holding equipment).
- **Format-Aware Equipment Counts & Junior (`JV`) Rule Variations (#6).**

### 8. Cross-Competition Statistics (#9), Season Leagues, Stream Score Cards, Commerce & Next-Level Features
- **Season League Points & Tie-Breakers (`SeasonStandingsCalculator.cs`):**
  - Support Season League points following Individual riders in Pairs (`SeasonStandings`), and break Season League point ties by **most round wins (`1st` places) overall** across the season.
- **Live Stream Score Cards (`ScoreCardOverlay` & `/produce`):**
  - Allow the Producer/Admin to choose whether live stream score cards display **Session/Heat Points**, **Overall Competition Standings**, or **Both** (e.g. transitioning from the heat table to overall standings if display time allows), with smooth row-movement animations (`layout` transitions) showing teams moving up and down.
- **Merge the Two Shops Into One Unified Shop (`EventShopPage.tsx` + `ShopPage.tsx` — `BUG-26`):**
  - Merge the orphaned classifieds shop (`ShopPage.tsx` / `ShopController.cs`) and the per-competition event shop (`EventShopPage.tsx` / `CommerceController.cs`) into a single unified Shop experience at `/shop` and `/competitions/:id/shop` supporting both organiser event items/add-ons (stabling, hook-up, camping, merch) and community tack & equipment listings (with photos, prices, and comments/messages).
- **Clickable Weather Icon Toggle — Show Timetable With Weather (`WeatherChips.tsx`, `TimetableBoard.tsx` & `TimetableManagement.tsx`):**
  - Remove per-heat weather chips (`HeatWeatherChip`) from individual heat rows in `TimetableManagement.tsx` by default.
  - Show a single compact **Weather Icon / Chip (`WeatherNow`)** in the timetable header (`TimetableBoard.tsx`), and when the user **clicks on the weather icon**, toggle the timetable into **Timetable with Weather** view (displaying the hourly weather forecast inline alongside the timetable sessions/heats).
- **Always Use Fair Seeded Draw in `FormatPage.generate()`, `GenerateHeats`, `GenerateRaceFinals` & `AutoTimetable` (`CompetitionDrawService` — `BUG-27`, `BUG-28`):**
  - Make `FormatPage.generate()`, `SessionsController.GenerateHeats`, `SessionsController.GenerateRaceFinals`, and `CompetitionsController.AutoTimetable` always use the **Fair Seeded Draw (`CompetitionDrawService`)** automatically (minimising repeated opponents, balancing lanes `1..N`, balancing `SmallHeatCost` when heat sizes are unequal, and excluding scaffolded `A / B / C Final` sessions).
- **Live Stream Camera / Arena Switcher (`BroadcastPage.tsx`, `ProducerPage.tsx`):**
  - Usually 1 live stream per competition, sometimes 2 (e.g. `Arena 1` and `Arena 2`). Keep single-stream automatic by default, and when a 2nd stream is active simultaneously, show a simple Arena/Camera switcher pill for viewers.
- **Final Races Set Before the Competition (`creatorDraft.ts`, `RacesStep.tsx`, `save.ts`, `TimetableManagement.tsx` — `BUG-40`):**
  - Final races are chosen **before the competition** in the Competition Creator (`RacesStep.tsx`), stored per section (`finalRaces`), scaffolded/pre-filled into the Finals session, and `"Minutes per race"` in `StructureStep.tsx` is corrected to **`Minutes per heat`** (set per age category).
- **Per-Rider Tack & Turnout Scoring Grid (`TackCheckTab.tsx` & `TackCheckService.cs` — `BUG-41`):**
  - Sometimes Tack & Turnout is scored on a dedicated Tack Score page (as well as printable paper forms): the admin can type custom text columns/criteria, and mark each team in a **per-rider grid** (`Rider 1..N × Criterion 1..K`, out of 10 per box), with each rider's row summed and all riders summed into the team total.
- **End-of-Qualifiers Finals Boundary Ties (`TieBreaker.cs`, `FinalsTiePanel.tsx`):**
  - Support all 3 tie-break options for cut-off boundary ties (`A / B / C Final`): **Run-Off race**, **Result of Last Race (`LastRace`)**, **Countback (most wins)**, or **Manual Organiser Order**.
- **Final Starting Lanes, Lane Rotation & Carried-Forward (`CF`) Column (`CompetitionsController.cs`, `HeatScores.tsx`, `StandingsService.cs`):**
  - Final starting lanes are assigned straight by qualifying rank (`1st → Lane 1, 2nd → Lane 2, ...`).
  - Finals support configurable lane rotation (`MoveUp`, `MoveDown`, or `Stay` in the same lane).
  - When points carry forward into the Finals (`CarryAcrossToFinals`), display a **`CF` (Carried Forward)** column on the Final Heat Score Table (`HeatScores.tsx`) before `R1..RN` so spectators see prior heat points + final race scores + Grand Total.
  - On the final **Toplist**, all **A Final** teams always rank above all **B Final** teams (`FinalsTiers`), regardless of raw points scored in a lower final.
- **Ring Crew Live Next-Race View (`OperationsPage.tsx` / `ArenaPage.tsx`):**
  - Provide a Ring Crew view showing the **Next Race** with a **quick picture/diagram (`RaceDiagram`)**, **short description**, and **exact equipment required**.
- **Timetable Session-Time Ordering & Full Scorer Link Access (`TimetableBoard.tsx`, `ScorerController.cs` — `BUG-42`):**
  - Organise timetable sessions chronologically by **session and starting time (`ScheduledStart`)**.
  - Give **Scorer Links** access to **all scoring across the competition** (`s.CompetitionId == link.CompetitionId`), not restricted by arena name.
- **Competition Team Page (`/competitions/:id/teams/:teamId`):**
  - Primarily focused on **this competition** (Bib colour, Toplist rank & points, Follow button, Next Heat, Heat score tables, Declared Riders & Ponies), with a compact section for **Season results**.
- **Live Stream Broadcast Overlays (`mounted-games-overlays`):**
  - Automatically support all 3 broadcast graphics as scores arrive:
    - **(A) Pre-race Lower-Third:** `Session + Heat + Race X of Y (Game Name)` + Lane lineup (`Lane 1..6` + Bib colours),
    - **(B) Between Races:** Live **Heat Leaderboard** (sorted by heat leader, with `+0.01` run-offs hidden and `"S"` for sit-outs),
    - **(C) End of Final:** Full-screen **Podium / Final Standings** graphic.
- **Finals Running Order (`C → B → A Final` Default with Toggle) & Tier-Safe `PopulateFinals` (`CompetitionsController.cs`, `TimetableManagement.tsx` — `BUG-43`):**
  - Default Finals running order to **lowest final first (`C Final → B Final → A Final`)** so the `A Final` runs last, with a toggle for `A → B → C`, and ensure `PopulateFinals` always seeds teams by final tier (`A`, `B`, `C`) rather than `OrderIndex`.
- **Dead Heats (Half-Points in Manual Point Override) & Hors Concours (`HC`) Scoring (`ScoringService.cs`, `SessionPage.tsx` — `BUG-44`):**
  - Allow dead heats / half-points (`.5`) in the manual point override on `SessionPage.tsx`.
  - Treat `IsHorsConcours` (`HC`) teams like an elimination for points purposes (`0` competitive points, moving competitive teams behind them up in points).
- **Optional Per-Pony Passport / Vaccination Tick in App (`PassportCheckService.cs`, `PassportCheckTab.tsx`):**
  - Keep the simple in-app tick box on every declared pony (`PassportCheckTab.tsx`) as an optional check for organisers who want to tick horses off in the app, with no separate collecting-ring screen needed.
- **Unified Printable Timetable + Draw + Score Sheet Table (`PrintEventPage.tsx` — `BUG-46`):**
  - Mix **(B) Master Timetable & Heat Draw** and **(A) Blank Race Score Columns (`Race 1..N + Total`)** into **1 unified table** per heat/session on `PrintEventPage.tsx`.
- **Prize Giving After Each Final — Last to First with Riders, Ponies & `"Trained by"` (`ToplistView.tsx`, `SessionEndTransition.tsx` — `BUG-47`):**
  - Prize giving happens after each Final (`C Final`, `B Final`, `A Final`) from **last place to 1st place**, showing each team's **Place, Team Name, Club, `"Trained by <TrainerName>"`, and Declared Riders & Ponies**.
- **Create Season Flow & Position-Based Season Points (`SeasonsPage.tsx`, `SeasonSettingsForm.tsx`, `NavigationDrawer.tsx` — `BUG-45`, `BUG-49`):**
  - Keep `Seasons` always visible in `NavigationDrawer.tsx` and allow any Organiser/Trainer/Admin (`Roles.Organiser`) to create a Season.
  - **Multi-Age-Group Seasons (#1):** A single Season holds **all age groups** (with tabs on `SeasonPage.tsx` per age group/division).
  - **Select Multiple Competitions at Once (#8) & Multiplier Option (#3):** When creating a Season, allow selecting multiple competitions at once (plus adding more later or linking from the Competition Creator), and support a points multiplier (`1×`, `1.5×`, `2×`) for major competitions.
  - **Dropped Rounds Shown in Grey/Crossed-Out (#4), Position Points Down Through B/C Finals (#6) & Tie-Break by Most Round Wins (#7):** Show per-round columns on `SeasonPage.tsx` with dropped rounds (`BestResultsToCount`) styled in grey/crossed-out, support position points down through lower finals, and break Season point ties by **most round wins (`1st` places)**.
  - **Pairs Season Points Track Individual Riders (#5):** In `Pairs` divisions, track Season points per **Individual Rider** so riders keep their points even if they change partners mid-season.
- **Entries Closing Date, Step-2 Stabling, Multi-Team Checkout, Bank Transfer, Waiting List & Pre-Draw Withdrawal (`EntryPage.tsx`, `DetailsTab.tsx`, `SignupController.cs`, `MySignupsPage.tsx` — `BUG-50`):**
  - **Entries Closing Date & Admin Late Entry (#9):** Support an `EntriesCloseAt` deadline per competition; after closing, public entries close while Admins/Organisers can still key in late entries.
  - **Step 2: Stabling & Extras (#10, #11):** Make Stabling Step 2 of the Entry flow (`EntryPage.tsx` / `DetailsTab.tsx`), capturing **Number of Stables** and **Pony Club / Team Name** so they book together and generate a **Stabling List** for the organiser.
  - **100% Upfront Payment + Card & Bank Transfer (`Mark as Paid`) (#12, #13):** Charge 100% upfront (50% for `"Looking for a Pair"`), and support both **Card (Stripe)** and **Bank Transfer (BACS)** (showing bank details + an organiser **"Mark as Paid"** button).
  - **Pre-Draw Self-Withdrawal (#14) & Full-Section Waiting List (#15):** Allow entrants to click **"Withdraw Entry"** on `MySignupsPage.tsx` before the draw (freeing up their spot and flagging for refund), and when a section hits `MaxParticipants`, allow entrants to join a **Waiting List**.
  - **Enter Multiple Teams at Once (#16):** Add a **"Number of teams (`1, 2, 3...`)"** stepper when a Club Manager/Trainer enters teams so they can enter and pay for multiple club teams in one go.
- **Declarations Set Lock Time, Multiple Rider+Horse Combos, Shared Club Roster, Club Default Bibs & Supporter Invite Links (`DeclarationFormsController.cs`, `ClubsController.cs`, `DecFormEditor.tsx`, `TeamSharing.tsx` — `BUG-51`):**
  - **Set Declaration Lock Time (#17):** Support a configurable set time (`DeclarationsCloseAt`) when declarations lock for self-edits.
  - **Shared Club Roster (#18) & Multiple Saved Rider+Horse Combos (#19):** Share `SavedRiders` across all Trainers and Team Managers of the same Club, allow self-entered riders (`Roles.Rider`) to save and reuse their own details, and deduplicate by `(FullName, HorseName)` so one rider can save multiple separate `(Rider + Horse)` combinations (displayed as `"Rider — Horse"`).
  - **No Pony/Trainer Cross-Section Timetable Warnings Needed (#20, #21).**
  - **Club Default Bib Auto-Fill with Per-Team Override (#22) & Open Supporter/Parent Invite Links (#23):** Auto-fill a new team's bib colour from `Club.BibColour` while allowing per-team override (`BibDescription` / `BibColour`), and allow `supporterJoinKey` invite links to be used by any supporter or child's parent.
- **Competition Day Controls — Combined Section Heats, Race Swap + Announcement, Re-Run Clear, Under-Review Flag, Short-Handed `HC`, Max Lanes & Hold/Resume Time (`SessionPage.tsx`, `TimetableManagement.tsx`, `StructureStep.tsx` — `BUG-52`):**
  - **All Sessions Drawn Randomly via Fair Seeded Draw (#24).**
  - **Combine Small Age Groups Into One Arena Heat (#25):** Support combining two small sections into one arena heat with both scoring options (**points within each own section** vs **points across the combined heat**).
  - **Change/Cancel Race Mid-Session + Quick Announcement (#26):** Add a quick button on the heat/session page (`SessionPage.tsx`) to change or cancel a race across the session and post an announcement saying what the race is becoming.
  - **Re-Run Race Clear (#27), `"Under Review"` Elimination/Result Flag (#28) & Short-Handed Team Goes `HC` (#29):** Add a 1-tap **"Clear / Re-run Race"** button, an **"Under Review"** flag by an elimination/result, and a quick toggle to mark a short-handed team **Hors Concours (`HC`)**.
  - **Finalist Count Defaulted to Heat Size + Explicit Max Lanes in Competition Editor (#30):** Default `finalistCount` to the heat size (`maxTeamsPerHeat`) in `StructureStep.tsx` (editable by admin) and ensure **Max lanes** is an explicit option in the Competition Editor.
  - **Hold / Delay Banner with Custom Resume Time (#31):** Allow the organiser to set a custom resume time (or `+X min` delay) with an announcement/banner (`"We will continue at HH:MM"`).
- **Navigation, Top-Bar Ticker, Push Notifications, Career Stats, Single `"I Agree"` Consent, Archive Filters, Dashboard Priority Order, Live Stream Score Table & Race Rules Popup (`#32–#40` — `BUG-53`):**
  - **Bottom Tab Bar Inside a Competition (#32):** Keep `BottomTabs.tsx` to `Timetable · Toplists · Live & stream · Details` (plus `Me` when signed in) — **no separate `Following` tab** in the bottom bar (followed teams are highlighted directly inside Timetable/Sessions and Toplists).
  - **Top-Bar Ticker Live Race Progress & 10-Second Announcement Flash (#33):** Show `"ON NOW: <Session> · <Heat> · Race X/Y"` in `TopBarTicker.tsx` / `ticker.ts`, and flash/hold any new Organiser Announcement for **10 seconds** when posted.
  - **4 Push Notifications for Teams & Followers (#34):**
    - **(A)** `"60 minutes until your heat"` (with session, heat & starting lane),
    - **(B)** `"Your heat's results are in (1st in Heat 2 — 38 pts)"`,
    - **(C)** `"Finals draw published — you are in the A Final, Lane 3"`,
    - **(D)** `"Timetable delay / Redraw alert"`.
  - **Rider & Pony Career Stats (`/stats` — #35):** Show all 4 sections on `StatsPage.tsx` / `StatsService.cs`: **(A)** Competitions & Finals reached (`A / B / C Finals` count), **(B)** Total points & win rate, **(C)** Current Season standings they are in, and **(D)** Clubs represented & rider/pony partnerships; make Rider and Pony names clickable links to their `/stats` profile.
  - **Single `"I Agree"` Consent Tick Box (#36):** Sum rider/media/terms consent into **1 single tick box saying `"I agree"`** instead of separate initial-only/no-filming checkboxes.
  - **Past Competitions Archive Filters (#37):** On `CompetitionPicker.tsx` (`past === true`), allow filtering by **Year (`2026`, `2025`...)**, **Country/Region**, and **"My Club / Competitions I rode in"**.
  - **Dashboard (`Me` Tab) 1 → 2 → 3 Priority Order (#38):** Order `DashboardPage.tsx` as:
    1. **Action items** (`"Dec form needed"`, `"Pair-up request waiting"`, `"Unpaid entry"`),
    2. **Today's upcoming heats for My Teams** (with live estimated start time, **session**, **heat**, and **starting lane**),
    3. **Quick links** to **My Teams (`/teams`)**, **My Signups (`/me/signups`)**, **Dec Forms (`/declarations`)**, and **Club Members (`/members`)**.
  - **Live Stream Page Below Video Player (#39):** On `ChatTab.tsx` (`Live & stream`), display the **Live Heat Score Table** for the heat currently in the arena below the video player (updating race-by-race via SignalR), with quick tabs to switch to **Timetable**, **Toplist**, or **Announcements / Chat** without stopping the video.
  - **Race Rules & Arena Setup Popup (#40):** Clicking a race name or info icon (`RaceRulesButton.tsx`) opens `<RaceDiagram>`, equipment required, and a **3-bullet "How to win / Common eliminations" summary**.
- **Deposit Paid Status & Entry Add-Ons (Stabling / Hook-Up / Camping).**
- **Venue Layout Photo Upload on `DetailsTab.tsx` (#8).**
- **Custom Top-Bar Banner / Pinned Status Item (`AppShell.tsx`).**
- **B1 — "Ring Crew Diff" (Next-Race Equipment Changeover on `ArenaPage.tsx`).**
- **B2 — PA Commentator / Announcer Desk (`/commentator`).**
- **B3 — 1-Tap Shareable Instagram / WhatsApp Story Result Cards.**
- **B4 — Rich WhatsApp / iMessage Social Link Previews (Dynamic OpenGraph Tags).**
- **Unify the Visual Skin (`skin.css`) Across All Competition & Scoring Screens.**

---

## Code-Verified Scoring, Finals, Multi-Arena, Permissions & Equipment Bugs to Fix First

> **Full Bug Catalogue:** See [`BUGS.md`](./BUGS.md) for the complete list of all **39 code-verified bugs (`BUG-01` through `BUG-39`)** with exact file paths, line numbers, root causes, and fix specifications.

1. **CRITICAL BUG in `SessionPage.tsx` (Lines 232–249 & 397–433) — Elimination Place Shift (`BUG-01`) & Wrong Auto-Advance Order (`BUG-02`):**
   - Always compute `place` from `cur.filter(p => !p.eliminated).length + 1`, and re-index non-eliminated places whenever a team is eliminated or un-eliminated.
   - Fix `saveRace()` auto-advance so normal sessions advance within the same heat (`Race 1 → Race 2 → …`) and only alternate across heats when `session.raceOrderAlternating` is enabled.
2. **BUG in `SessionPage.tsx` (Lines 19–22) — Hardcoded `+1` Lane Rotation After Every Race (`displayLaneFor`):**
   - Replace with the 3-way `LaneRotationMode` (`Stay`, `MoveUp`, `MoveDown`) plus the **Sit-Out / Bye Lane (`Position 7`, cell `"S"`)** mechanic when `TeamsInHeat > LanesPerHeat`.
3. **CRITICAL BUG in `CompetitionsController.CreateFinals` (Lines 570–615), `PopulateFinals` (Lines 709–717) & `FinalsBoundary` (Lines 501–511):**
   - Both `CreateFinals` and `PopulateFinals` hardcode `A Final` into `heats[0]` instead of letting the Admin choose `C → B → A` (A-Final last) or `A → B → C` and lane seeding mode.
4. **BUG in `ScoringService.cs` (Lines 26–33 & 220–230) & `HeatScores.tsx` — Heat-Heat-Final (`Race-Finals`) Scoring, Elimination & Display:**
   - In `Q1` and `Q2`, only require the scorer to click the qualifying teams (e.g. Top 3); auto-score remaining teams as `1 pt` (non-finalists) and treat any subsequent click on a remaining team as `Eliminated (0 pts)`.
   - Compute Finalist points from the Final heat's size so non-eliminated Finalists always score `2, 3, 4, 5…` (`2` for last place in the Final) and a Finalist eliminated in the Final scores `0` (with manual override support).
   - Auto-populate each race's `Final` heat on `SessionPage.tsx` as soon as `Q1` and `Q2` complete, and render `HeatScores.tsx` as **1 unified table of all teams × all races**.
5. **BUG in `web/src/lib/time.ts` (Lines 52–116), `SessionEndTransition.tsx` (Lines 38–45), `ArenaPage.tsx` (Lines 18–30) & `TimetableManagement.tsx` (Line 910) — Multi-Arena Bugs:**
   - `SessionEndTransition` advances to `orderIndex + 1` even if that session is in a different arena.
7. **BUG in `CompetitionEditor.tsx` (Lines 48–54 & 82–86) — Duplicate Consecutive Races in `ZONE_PAIRS` and `AREA_PAIRS`:**
   - Remove the duplicate `'Litter', 'Litter'` entries that misread `(x2)` in the Pony Club Pairs race list.
8. **BUG in `DeclarationsTab.tsx` (`Lines 19, 91–95, 102–112, 141–159, 251–273`), `DeclarationFormsController.cs` (`Lines 86–88, 100–124, 165`), `ClubsController.SavedRiders` (`Line 37`) & `DbInitializer.cs` (`Lines 626–639`):**
   - Replace the 5 per-rider dropdown colours with a single plain-text `BibDescription` field on the Team / Declaration, and add `IsGuestRider` per rider.
   - `DeclarationsTab.tsx:94` shows `"New for {team}"` for every unassigned team across **all clubs** instead of scoping to the user's `ClubId`, and clicking a team that already has a declaration starts a blank form and inserts a **duplicate `DeclarationForm` row** (`DeclarationFormsController.cs:123`) instead of editing/replacing the team's existing declaration!
   - `ClubsController.SavedRiders:37` and `DeclarationFormsController.cs:87` filter `SavedRiders` by `r.CreatedByUserId == uid` instead of `user.ClubId == id`, preventing a Club's Trainers and Team Manager from sharing the same club's saved riders.
11. **BUG in `Roles.cs` (`Line 23`), `AuthController.SignupTrainer` (`Lines 95–126`), `TeamsController.MyTeams` (`Lines 110–116`), `UpdateTeamRequest` (`ApiDtos.cs:161-163`), `SignupController.FormTeams` (`Lines 308–317`) & `DetailsTab.tsx` (`Lines 35 & 238–242`):**
    - `LoginPage.tsx:156` and `AuthController.cs:100-108` treat `ClubName` / `ClubId` as optional instead of requiring every user role to belong to a Club.
    - `Roles.Organiser` (`Roles.cs:23`) and `TeamsController.MyTeams` (`Lines 113–114`) exclude `Roles.Manager` (Team Manager), and `MyTeams` only checks `t.TrainerUserId == userId` instead of letting a Club's **Team Manager** see and control all teams belonging to their `ClubId`.
    - `AuthController.SignupTrainer` (`Lines 122–124`) requires approval for `Trainer` (`TrainerRequest`) but grants `Manager` immediately with no approval check.
    - `UpdateTeamRequest` has no `TrainerUserId` field and `TeamsTab.tsx` has no UI to assign a Trainer to a team.
    - `DetailsTab.tsx` only fetches `allSignups` for the competition organiser (`mayOrganise`), so normal riders/trainers/managers always see `"0 in · X seats left"` even when a section is completely full, and `SectionSignupCard` only allows 1-person individual signups instead of letting a **Team Manager** enter a whole team.

---

## Operational & Housekeeping Items (Existing Backlog)

### Needs you
1. **Delete Render** (the Vercel API is confirmed live): the `mounted-games-scoreboard` service, which is suspended. `render.yaml` can go at the same time.
2. **New sign-in keys.** The Vercel API uses new `Jwt__Key`, `Admin__Key` and `Security__ProxyKey` values (stored in `~/.config/mounted-games/fly-prod.env`, chmod 600). Organisers sign in with the new admin key, and everyone was signed out once. `MG_PROXY_KEY` on the website project holds the same value as `Security__ProxyKey`.
3. **Live video (#30).** It stays hidden until it's configured:
  - Create a separate `mounted-games-prod` Cloudflare Realtime SFU app and optionally a TURN key. Set `Streaming__Cloudflare__AppId`, `Streaming__Cloudflare__AppToken` and, optionally, `Streaming__Cloudflare__TurnKeyId` and `Streaming__Cloudflare__TurnKeyApiToken` on the `mounted-games-api` Vercel project.
  - Set a Cloudflare billing alert.
  - Test on two real phones (Safari and Android): lock, background, flip camera, mute, pause, end.
  - Nest camera: tell the chat which model the club uses, so phase 2 can be checked.
4. **Official EGUK navy hex.** `#1e3466` / `#17385f` — confirm exact brand hex.
5. **Remaining decisions from earlier chats:**
  - Keep the colour key under the timetable dots?
  - Ticker: should a fresh announcement keep replacing the live heat for up to 15 minutes, or should "Now" stay on top?

### Bugs and tidy-ups
- Move note tags (`[pts]`, `[adj]`, `[under-review]`, `[scoring:*]`) to real columns.
- Flaky under load: `StreamingHubTests.RewatchReplacesAndClosesPreviousSession_EvenAtTheCap_DisconnectClosesCurrent` (seen in CI on #52 and locally) and, once, `CommerceEndpointsTests.DemoDeclineReleasesStock_AndRetryCanSucceed`. Both pass on rerun; make them deterministic.
- Heat page draft restore looks dead on main (the seed effect overwrites the hydrated draft); found by the lint work in #41.
- Stream controls still to come: instant replays (needs recording), and the producer screen's per-angle preview tiles from the design board.
- Unreachable code noted by the test agents:
  - the blank-suffix branch in `TeamsController.Update`
  - the unauthorised early returns in `MyTeams` and `LoadTeamForTrainerAsync`
  - the empty-string guard in `GeocodingService.ResolvePostcodeAsync`
