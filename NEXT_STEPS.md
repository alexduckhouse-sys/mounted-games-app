# Next steps (22 October 2026)

The cross-chat to-do list, confirmed product specifications, code-verified bugs, and roadmap. Update or delete items as they land.

**This file, `BUGS.md` and `COMPLETED_NEXT_STEPS.md` live in git on main.** Edit them on your feature branch (or a small docs PR), not in an uncommitted copy in another worktree. Move finished items to `COMPLETED_NEXT_STEPS.md` once their PR is merged.

## Who owns what (22 October, evening)

Check this before taking an item, and add yourself here when you start one.

- **Chat 99b776bf:** BUG-01, 02, 04, 06, 08, 09, 10, 11, 12, 13, 19, 20. Merged #79 (multi-arena), #80 (finals, standings, equipment, heat edits) and #81 (rider clash, tidy-ups). Still open: `fix/scoring-page-bugs`.
- **Chat 11a9436f:** BUG-03, 05, 07, 14–18, 22–26 (issues #67, #69, #72–#75, #77, #78 and the boundary-tie part of #68), including the product decisions they need (lane rotation and sit-outs, heat-heat-final, club hierarchy, bib description, guest riders). Branch `fix/bugs-md`; overlapping early work parked on `wip/bugs-md-overlap`.
- **Chat a29f41a2 (copy `-d7`, fork 9f48b569):** scorer links, sharing links (#82) and the sign-up terms tick, then the competitor-gap stages in `docs/competitive-gaps.md`.
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

### 4. Whole-Team Entries, Individuals, Pairs, Lockable Declarations, Saved Riders, Guest Riders, Team Bib Description & Tack/Passport Checks
- **Entries by Section Format (`DetailsTab.tsx` & `SignupController.cs`):**
  - **`SectionFormat.Teams`:** **Team Managers** enter the **whole team** (or multiple teams) directly for their club (creating/linking the `Team` immediately and declaring the 5 riders on `DeclarationsTab.tsx`), rather than requiring 5 separate individual rider signups first.
  - **`SectionFormat.Pairs` & `SectionFormat.Individual`:** **Both** Riders themselves (self-entry) **and** Team Managers (on behalf of riders in their club) can enter Pairs and Individuals.
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
- **Printable & Optional Scored Tack Check + Toggleable Passport Check:**
  - **Printable Tack Check Forms:** Add a 1-click printable Tack Check form pre-filled with each Section, Team, and Riders/Ponies.
  - **Digital Tack Check Table & Optional Tack Check Points:** Allow the Admin to enable a **Tack Check** table per section (with customisable sectors/columns such as *Saddle/Girth, Bridle/Bit, Rider Hat/Boots, Turnout*), and choose whether Tack Check is:
    1. Pass/Fail checklist only,
    2. A standalone **Tack & Turnout** leaderboard table by section, or
    3. Added into the main competition standings as **Tack Check Bonus Points**.
  - **Toggleable Passport / Vaccination Check:** Add a per-competition toggle (`EnablePassportCheck`) so competitions that check equine passports on arrival can tick off ponies/teams. *(Do NOT flag duplicate pony names across declarations, as many ponies share common names.)*

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
    - Render the public `HeatScores.tsx` view for Heat-Heat-Final as **one massive unified table** of all teams × all races.
  - **Fix Auto-Advance Order (`SessionPage.tsx:397-433`) — Normal vs Alternating vs Heat-Heat-Final:**
    - Currently `SessionPage.tsx` *always* jumps across heats (`H1 Race 1 → H2 Race 1`).
    - Fix it so:
      1. **Normal Session (`!raceOrderAlternating`):** Advances within the same heat (`Heat 1 Race 1 → Race 2 → … → Race N`) before moving to `Heat 2 Race 1`.
      2. **Alternating Heats (`raceOrderAlternating === true`):** Advances `Heat 1 Race 1 → Heat 2 Race 1 → Heat 1 Race 2`.
      3. **Heat-Heat-Final (`Race-Finals`):** Advances `Q1 → Q2 → (auto-populate Final) → Final` for each race.
  - **"Re-Run Race" Button on `SessionPage.tsx`:**
    - When a race is stopped and re-run (e.g. broken equipment or a fallen rider), tapping **"Re-Run Race"** clears the finish places (`1st, 2nd, 3rd…`) for the re-run while **keeping any already-eliminated team locked as `Eliminated (0 pts)`**, and broadcasts `"RE-RUN IN PROGRESS"` to the live status/overlay.
  - **Finals Boundary Tie Detection & Admin-Selectable Tie-Break Options (`SessionPage.tsx` & `CompetitionsController.cs`):**
    - **Only flag ties that cross a Final boundary** (e.g. `6th vs 7th` between `A Final` and `B Final`, `12th vs 13th` between `B Final` and `C Final`, `5–4–3–2–1` placement bonus spots, or podium ties at the end of a Final). Do not flag ties within the middle of the same Final when no bonus points are at stake.
    - Give the Admin a choice of how to break any boundary tie:
      1. **Run-Off Race (`section.runoffRaceName`)** — automatically spawned on `SessionPage.tsx` with tied teams in adjacent lanes next to each other.
      2. **Most 1st Places (Countback on Wins)** (`1sts → 2nds → 3rds`).
      3. **Best Result in the Last Race** (or a nominated race that has already happened).
      4. **Manual Admin Order / Split Points** (for `5–4–3–2–1` bonus ties).
  - **End-of-Qualifiers → 1-Tap "Populate A / B / C Finals Now" on `SessionEndTransition.tsx`:**
    - When the last qualifier session for a section finishes on `SessionPage.tsx` (and any boundary tie is resolved), show the **Qualifier Cut-Off Summary** and a **1-tap "Populate A / B / C Finals Now"** button directly on `SessionEndTransition.tsx`.
  - **Fix Multi-Arena `SessionEndTransition.tsx` (`SessionEndTransition.tsx:38-45`):**
    - Filter `next` and `nextRealSession` by the **same arena (`s.arenaName === finishedSession.arenaName`)** so finishing a session in Arena 1 never accidentally starts or navigates to Arena 2's session.
  - **Fix Draft Restore on `SessionPage.tsx` (`SessionPage.tsx:94-171`):**
    - Stop the race-change seed effect from overwriting the hydrated `localStorage` scoring draft.
- **Non-Destructive Heat & Lane Editing (`SessionsController.UpdateHeatAssignments` & `TimetableManagement.tsx`):**
  - Update `UpdateHeatAssignments` (`SessionsController.cs:320-364`) so editing heat or lane assignments **only updates the heats/lanes that actually changed** and never wipes results from already-scored heats.
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
- **A2 — Tie-break detection, past-race tie-breaker & Admin choice on `5–4–3–2–1` bonus ties.**
- **A3 — Granular non-finish statuses (`DNS`, `DNF`, `R`, `E`) & Private Referee Elimination Notes.**
- **A4 — Official Post-Event Results Export (CSV + PDF Results Book), Special Awards & Pre-Event Printables.**
- **Ring Scoring #1 & #2 — "Tap-in-Order" Finish-Line Pad & Split Line-Judge / Arena-Referee Mode.**
- **Standings #6 — Deeper "Cut-Off Line & Magic Number" Maths (`+4 pts safe`, `Needs X pts`, `Q` Qualified, `🏆` Clinched).**
- **Post-Session Point Editing & Public "Report a Score Issue" (#7).**

### 6. Timetable Generation, Multi-Arena Support, Live Notifications & Following Whole Clubs
- **Older Age Groups Scheduled Earlier in `AutoTimetable` (`CompetitionsController.cs:744`):**
  - Sort sections from **oldest age group to youngest** (`Open / Senior → U18 / U17 → U15 / Intermediate → U14 → U12 / Junior → U10 / Novice → Lead Rein`) when generating the timetable.
- **Same-Rider Clash Avoidance & Readiness Warning (`CompetitionReadinessService.cs` & `AutoTimetable`):**
  - Check declared **Rider names** across sections and warn (or avoid when auto-scheduling a multi-arena timetable) if the **same Rider** is scheduled in two arenas at overlapping times. *(Do not check Trainers or Pony names.)*
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
- **Cross-Competition Rider, Pony & Team Statistics Hub (`/stats` — Matching & Beating `mg-scoreboard.de`):**
  - Type a **Rider name**, **Pony/Horse name**, or **Team/Club name** to view cross-competition statistics:
    - **Rider Profile Rules:**
      - For **Individual** and **Pairs** competitions: show the rider's **per-race game statistics** (best/worst games, win %, Point Quota % per game).
      - For **Teams** competitions: only show **overall Team competition & session results** on the Rider's profile — per-race game statistics for a Team live on the **Team Profile** (`TeamProfilePage.tsx`).
    - **Metrics:** Competitions entered, Finals reached (`A-Final %`), Podiums (`1st / 2nd / 3rd`), **Point Quota %** (`Points Won ÷ Max Possible Points in their heats`), average placing, and Pony partnerships.
- **Season League Points & Tie-Breakers (`SeasonStandingsCalculator.cs`):**
  - Support Season League points following Individual riders in Pairs (`SeasonStandings`), and break Season League point ties by **most round wins (`1st` places) overall** across the season.
- **Live Stream Score Cards (`ScoreCardOverlay` & `/produce`):**
  - Allow the Producer/Admin to choose whether live stream score cards display **Session/Heat Points**, **Overall Competition Standings**, or **Both** (e.g. transitioning from the heat table to overall standings if display time allows), with smooth row-movement animations (`layout` transitions) showing teams moving up and down.
- **Merge the Two Shops Into One Unified Shop (`EventShopPage.tsx` + `ShopPage.tsx` — `BUG-26`):**
  - Merge the orphaned classifieds shop (`ShopPage.tsx` / `ShopController.cs`) and the per-competition event shop (`EventShopPage.tsx` / `CommerceController.cs`) into a single unified Shop experience at `/shop` and `/competitions/:id/shop` supporting both organiser event items/add-ons (stabling, hook-up, camping, merch) and community tack & equipment listings (with photos, prices, and comments/messages).
- **Clickable Weather Icon Forecast Popover (`WeatherChips.tsx`, `TimetableBoard.tsx` & `TimetableManagement.tsx`):**
  - Remove per-heat weather chips (`HeatWeatherChip`) from individual heat rows in `TimetableManagement.tsx`.
  - Show a single compact **Weather Icon / Chip (`WeatherNow`)** in the timetable header (`TimetableBoard.tsx`), and when the user **clicks on the weather icon**, open a clean **Hourly / Session Weather Forecast Sheet** showing how temperature, rain, and wind evolve across the competition day(s).
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

> **Full Bug Catalogue:** See [`BUGS.md`](./BUGS.md) for the complete list of all **26 code-verified bugs (`BUG-01` through `BUG-26`)** with exact file paths, line numbers, root causes, and fix specifications.

1. **CRITICAL BUG in `SessionPage.tsx` (Lines 232–249 & 397–433) — Elimination Place Shift (`BUG-01`) & Wrong Auto-Advance Order (`BUG-02`):**
   - Always compute `place` from `cur.filter(p => !p.eliminated).length + 1`, and re-index non-eliminated places whenever a team is eliminated or un-eliminated.
   - Fix `saveRace()` auto-advance so normal sessions advance within the same heat (`Race 1 → Race 2 → …`) and only alternate across heats when `session.raceOrderAlternating` is enabled.
2. **BUG in `SessionPage.tsx` (Lines 19–22) — Hardcoded `+1` Lane Rotation After Every Race (`displayLaneFor`):**
   - Replace with the 3-way `LaneRotationMode` (`Stay`, `MoveUp`, `MoveDown`) plus the **Sit-Out / Bye Lane (`Position 7`, cell `"S"`)** mechanic when `TeamsInHeat > LanesPerHeat`.
3. **CRITICAL BUG in `CompetitionsController.CreateFinals` (Lines 570–615), `PopulateFinals` (Lines 709–717) & `FinalsBoundary` (Lines 501–511):**
   - `CreateFinals` calls `SplitIntoBalancedGroups(top, maxHeatSize)` which **randomly shuffles** all top qualifiers across `A Final`, `B Final`, `C Final` instead of grouping `1st–6th` into `A Final` and `7th–12th` into `B Final`!
   - Both `CreateFinals` and `PopulateFinals` hardcode `A Final` into `heats[0]` instead of letting the Admin choose `C → B → A` (A-Final last) or `A → B → C` and lane seeding mode.
   - `FinalsBoundary` only checks `ordered[topN - 1]` vs `ordered[topN]` (ignoring ties at the `A Final / B Final` cut-off, e.g. `6th` vs `7th` when `topN = 12`) and silently breaks point ties by heat race `Wins` instead of flagging all **Total Points** ties at every Final tier boundary (`6th/7th`, `12th/13th`, `18th/19th`) so the Admin can pick their tie-break rule (Run-Off, Most 1sts, Last Race, or Manual).
4. **BUG in `ScoringService.cs` (Lines 26–33 & 220–230) & `HeatScores.tsx` — Heat-Heat-Final (`Race-Finals`) Scoring, Elimination & Display:**
   - In `Q1` and `Q2`, only require the scorer to click the qualifying teams (e.g. Top 3); auto-score remaining teams as `1 pt` (non-finalists) and treat any subsequent click on a remaining team as `Eliminated (0 pts)`.
   - Compute Finalist points from the Final heat's size so non-eliminated Finalists always score `2, 3, 4, 5…` (`2` for last place in the Final) and a Finalist eliminated in the Final scores `0` (with manual override support).
   - Auto-populate each race's `Final` heat on `SessionPage.tsx` as soon as `Q1` and `Q2` complete, and render `HeatScores.tsx` as **1 unified table of all teams × all races**.
5. **BUG in `web/src/lib/time.ts` (Lines 52–116), `SessionEndTransition.tsx` (Lines 38–45), `ArenaPage.tsx` (Lines 18–30) & `TimetableManagement.tsx` (Line 910) — Multi-Arena Bugs:**
   - `SessionEndTransition` advances to `orderIndex + 1` even if that session is in a different arena.
6. **BUG in `EquipmentCalculator.cs` (Lines 64–75) — Sums Reusable Poles & Cones Across All Races in a Session:**
   - Take the `MAX` per race in an arena instead of summing across all races in the session.
7. **BUG in `CompetitionEditor.tsx` (Lines 48–54 & 82–86) — Duplicate Consecutive Races in `ZONE_PAIRS` and `AREA_PAIRS`:**
   - Remove the duplicate `'Litter', 'Litter'` entries that misread `(x2)` in the Pony Club Pairs race list.
8. **BUG in `DeclarationsTab.tsx` (`Lines 19, 91–95, 102–112, 141–159, 251–273`), `DeclarationFormsController.cs` (`Lines 86–88, 100–124, 165`), `ClubsController.SavedRiders` (`Line 37`) & `DbInitializer.cs` (`Lines 626–639`):**
   - Replace the 5 per-rider dropdown colours with a single plain-text `BibDescription` field on the Team / Declaration, and add `IsGuestRider` per rider.
   - `DeclarationsTab.tsx:94` shows `"New for {team}"` for every unassigned team across **all clubs** instead of scoping to the user's `ClubId`, and clicking a team that already has a declaration starts a blank form and inserts a **duplicate `DeclarationForm` row** (`DeclarationFormsController.cs:123`) instead of editing/replacing the team's existing declaration!
   - `ClubsController.SavedRiders:37` and `DeclarationFormsController.cs:87` filter `SavedRiders` by `r.CreatedByUserId == uid` instead of `user.ClubId == id`, preventing a Club's Trainers and Team Manager from sharing the same club's saved riders.
9. **CRITICAL BUG in `CompetitionsController.Standings` (Lines 439–447), `web/src/lib/toplist.ts` (Line 77), `PrintableEventService.ResultsAsync` (Line 64) & `SeasonPublicationService.cs` (Lines 43–55) — B-Final & C-Final Teams Can Overtake A-Final Teams in Overall & Season Standings:**
   - Group overall section standings (and Season League round publication) by Final tier first (`A Final` = 1st–6th, `B Final` = 7th–12th, `C Final` = 13th–18th, Non-Finalists below), and sort by points within each Final tier.
10. **BUG in `SessionsController.UpdateHeatAssignments` (Lines 338–357) — Editing Any Heat Assignment Wipes All Existing Race Scores in the Session:**
    - Only update the heats/lanes that changed, preserve results in already-scored heats, and allow editing lane numbers (`Lane 1..6`).
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
- Flaky under load: `StreamingHubTests.RewatchReplacesAndClosesPreviousSession_EvenAtTheCap_DisconnectClosesCurrent` (seen in CI on #52 and locally) and, once, `CommerceEndpointsTests.DemoDeclineReleasesStock_AndRetryCanSucceed`. Both pass on rerun; make them deterministic.
- Heat page draft restore looks dead on main (the seed effect overwrites the hydrated draft); found by the lint work in #41.
- Stream controls still to come: instant replays (needs recording), and the producer screen's per-angle preview tiles from the design board.
- Unreachable code noted by the test agents:
  - the blank-suffix branch in `TeamsController.Update`
  - the unauthorised early returns in `MyTeams` and `LoadTeamForTrainerAsync`
  - the empty-string guard in `GeocodingService.ResolvePostcodeAsync`
