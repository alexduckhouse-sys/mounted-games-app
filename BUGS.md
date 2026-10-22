# Code-Verified Bugs (`BUGS.md` — 22 October 2026)

Every bug listed below has been verified directly against the current source code in `api/` and `web/src/`. Each entry includes the exact file and line numbers, what is broken, and how to fix it.

---

## 1. Scoring & Finals Bugs

### BUG-01 — Eliminating a Team Before Entering Finishers Shifts All Other Teams' Places Down by 1
- **Where:** `web/src/pages/competition/SessionPage.tsx` (Lines 232–249)
- **What happens:**
  - When a scorer taps `Elim` (`markEliminated`) on a team **before** tapping the finishing order, `markEliminated` appends `{ teamId, place: 0, eliminated: true }` into the `cur` array (`cur.length` becomes `1`).
  - When the scorer then taps the 1st-place finisher (`toggleTeam`), it assigns `place: cur.length + 1`, which evaluates to **`place: 2` (`4 pts`) instead of `place: 1` (`5 pts`)**, shifting every subsequent finisher down by 1 place!
- **Fix:**
  - Always compute the next finishing place from non-eliminated entries only: `cur.filter(p => !p.eliminated).length + 1`.
  - Whenever a team is marked or unmarked `eliminated`, re-index the non-eliminated finishers sequentially (`1, 2, 3…`).

### BUG-02 — `SessionPage.tsx` Always Auto-Advances Across Heats Even When Heats Do Not Alternate
- **Where:** `web/src/pages/competition/SessionPage.tsx` (Lines 397–433, `saveRace()`)
- **What happens:**
  - When the scorer clicks **Save**, `saveRace()` always looks for the same race index in the **next heat** (`for (let h = currentHeatIdx + 1; h < orderedHeats.length; h++)`), jumping from `Heat 1 · Race 1` to `Heat 2 · Race 1`.
  - In a normal session where `Heat 1` runs all of its races (`Race 1..8`) before leaving the arena, the scorer is wrongly jumped into `Heat 2 · Race 1` after scoring `Heat 1 · Race 1`!
- **Fix:**
  - Default (`!session.raceOrderAlternating`): advance within the **same heat** (`Race 1 → Race 2 → … → Race N`), then move to the next heat.
  - Alternating Heats (`session.raceOrderAlternating === true`): advance `Heat 1 Race 1 → Heat 2 Race 1 → Heat 1 Race 2`.
  - Heat-Heat-Final (`Race-Finals`): advance `Q1 → Q2 → (auto-populate Final) → Final` for each race.

### BUG-03 — Hardcoded `+1` Lane Rotation After Every Race & Missing Sit-Out (`"S"`) Slot
- **Where:** `web/src/pages/competition/SessionPage.tsx` (Lines 19–22, `displayLaneFor`) & `api/Services/Operations/CompetitionDrawService.cs` (Lines 50–52)
- **What happens:**
  - `displayLaneFor` hardcodes `((baseLane - 1 + raceIdx) % totalLanes) + 1`, forcing every competition to rotate lanes `+1` after every race with no way to stay in drawn lanes (`Stay`) or move down 1 lane (`MoveDown`).
  - `CompetitionDrawService.cs` throws an exception if a single heat has `7` teams in a `6`-lane arena instead of rotating a 7th Sit-Out position (`"S"`).
- **Fix:**
  - Add a 3-way `LaneRotationMode` (`Stay = 0`, `MoveUp = +1`, `MoveDown = -1`) per session.
  - Support a Sit-Out slot when a single heat has `TeamsInHeat > ArenaLanes` (e.g. 7 teams in 6 lanes), storing `Result { IsSitOut = true, Points = 0, Placing = null }` and displaying **`S`** instead of `0` across `HeatScores.tsx`, `SessionPage.tsx`, `ToplistView.tsx`, `ScoreCardOverlay`, and printed score sheets.

### BUG-04 — `CreateFinals` Randomly Shuffles `A Final` and `B Final` Qualifiers Together
- **Where:** `api/Controllers/CompetitionsController.cs` (Lines 570–615) & `api/Controllers/SessionsController.cs` (Lines 462–472, `SplitIntoBalancedGroups`)
- **What happens:**
  - `CreateFinals` (`POST /api/competitions/{id}/finals`) takes the top `N` teams (e.g. top 12) in rank order and passes them to `SplitIntoBalancedGroups(top, maxHeatSize)`.
  - `SplitIntoBalancedGroups` runs `teamIds.OrderBy(_ => rng.Next())` and deals them round-robin (`groups[i % groupCount]`), **randomly mixing 1st–12th place across `A Final` and `B Final`** instead of putting `1st–6th` in `A Final` and `7th–12th` in `B Final`!
  - Both `CreateFinals` and `PopulateFinals` (`Lines 709–717`) also hardcode `A Final` as `heats[0]` instead of letting the Admin choose `C Final → B Final → A Final` or `A → B → C` and lane assignment mode.
- **Fix:**
  - Slice `top` sequentially by rank (`Skip(gi * maxHeatSize).Take(maxHeatSize)`) for `A Final`, `B Final`, `C Final`, and add Admin options for Finals running order and lane seeding.

### BUG-05 — `FinalsBoundary` Misses `A/B` & `B/C` Cut-Off Ties and Silently Breaks Point Ties by Race Wins
- **Where:** `api/Controllers/CompetitionsController.cs` (Lines 496–511, `FinalsBoundary`)
- **What happens:**
  - When `topN = 12` (`A Final` = 6, `B Final` = 6), `FinalsBoundary` only checks `ordered[11]` vs `ordered[12]` and completely ignores whether **6th and 7th place** (the `A Final / B Final` boundary) are tied!
  - Line 503 checks `if (lastIn.Total == firstOut.Total && lastIn.Wins == firstOut.Wins)`, silently breaking ties on **Total Points** by heat race wins (`Wins`) instead of flagging the tie so the Admin can run a Run-Off (`section.runoffRaceName`), countback on 1sts, last race, or manual order.
- **Fix:**
  - Check every Final tier boundary (`lanesPerHeat`, `2 * lanesPerHeat`, …, `topN`) for ties on `Total` points, and let the Admin choose the tie-breaker rule when a tie crosses a boundary.

### BUG-06 — `B Final` & `C Final` Teams Can Overtake `A Final` Teams in Overall Standings & Season League Publications
- **Where:**
  - `api/Controllers/CompetitionsController.cs` (Lines 439–447, `Standings`)
  - `web/src/lib/toplist.ts` (Line 77, `computeToplist`)
  - `api/Services/EventTools/PrintableEventService.cs` (Line 64, `ResultsAsync`)
  - `api/Services/Seasons/SeasonPublicationService.cs` (Lines 43–55, `PreviewAsync`)
- **What happens:**
  - All four places sort overall section standings purely by `TotalPoints` across all sessions without grouping by Final tier (`A Final` > `B Final` > `C Final`).
  - Under `CleanSlate` or `5–4–3–2–1` bonus carryover (or if `B Final` has high-scoring races), the winner of the `B Final` or `C Final` can finish with more points than teams in the `A Final` and be ranked **1st–3rd overall** (and receive podium Season League points)!
- **Fix:**
  - Once Finals exist for a section, partition overall rankings by Final tier first (`A Final` = 1st–6th, `B Final` = 7th–12th, `C Final` = 13th–18th, Non-Finalists below), sorting by points within each tier.

### BUG-07 — Heat-Heat-Final (`Race-Finals`) Wrong Finalist Points, Eliminated Finalist Points & Manual Qualifier Taps
- **Where:** `api/Services/ScoringService.cs` (Lines 26–33, 181–183 & 220–230), `web/src/pages/competition/SessionPage.tsx`, and `web/src/pages/competition/HeatScores.tsx`
- **What happens:**
  1. `GetSessionBaseAsync` uses `sizes.Max()` across all heats in the session. If `Q1` has 5 teams and `Final` has 4 teams, `sessionBase` is `5`, so the 4 Finalists score `6, 5, 4, 3` instead of `5, 4, 3, 2` (`2` for last place in the Final).
  2. `ScoringService.cs:181-183` forces the scorer in `Q1`/`Q2` to tap all 6 teams in order even though only the qualifying teams (e.g. Top 3) advance and everyone else gets `1 pt` (unless eliminated `0 pts`).
  3. Finishing `Q1` and `Q2` on `SessionPage.tsx` does not auto-populate that race's `Final` heat (forcing the scorer to leave `SessionPage.tsx` and go to `TimetableManagement.tsx:550`).
  4. `HeatScores.tsx` renders separate heat cards instead of **one unified table** of all teams × all races.
- **Fix:**
  - In `Q1`/`Q2`, only require clicking the qualifying teams (`QualifiersPerHeat`, e.g. Top 3); auto-assign `1 pt` to remaining teams and treat any subsequent tap on a remaining team as `Eliminated (0 pts)`.
  - Auto-populate the race's `Final` heat on `SessionPage.tsx` as soon as `Q1` and `Q2` are saved.
  - Score non-eliminated Finalists `2, 3, 4, 5…` based on the Final heat's size (`finalHeatEntriesCount + 1`), score an Eliminated Finalist `0 pts`, and render `HeatScores.tsx` as a single unified table.

### BUG-08 — `SessionPage.tsx` LocalStorage Draft Restore Is Overwritten on Mount
- **Where:** `web/src/pages/competition/SessionPage.tsx` (Lines 94–171)
- **What happens:**
  - `SessionPage.tsx` hydrates an unsaved scoring draft from `localStorage` on mount, but the `useEffect` that watches `activeRace?.id` immediately runs and overwrites `places` with `activeRace.results` (empty), wiping the restored draft.
- **Fix:**
  - Guard the `activeRace` seed effect so it does not overwrite a freshly restored `localStorage` draft for the same `heatId` + `raceId`.

---

## 2. Multi-Arena & Timetable Bugs

### BUG-09 — `computeTimings` Cascades Early/Late Delays Globally Across All Arenas
- **Where:** `web/src/lib/time.ts` (Lines 52–116)
- **What happens:**
  - `computeTimings` maintains a single `offsetMs` variable across all sessions in `ordered` without grouping by `arenaName`. If **Arena 1** runs 20 minutes late, **Arena 2**'s timetable is shifted 20 minutes late as well!
  - It also only calculates drift after an entire heat finishes, rather than live race-by-race (`≥ 5 min` threshold) during an active heat.
- **Fix:**
  - Group sessions by `arenaName` and cascade `offsetMs` independently per arena, with live race-by-race mid-session drift (`≥ 5 min` threshold) and break compression when running late.

### BUG-10 — Finishing a Session in Arena 1 Can Start and Navigate Into Arena 2's Session
- **Where:** `web/src/pages/competition/SessionEndTransition.tsx` (Lines 38–45 & 91–106)
- **What happens:**
  - `SessionEndTransition.tsx` finds the next session via `s.orderIndex === currentSession.orderIndex + 1` without filtering by `arenaName`.
  - In a 2-arena competition, when the Arena 1 scorer finishes a session and clicks *"Continue"*, it marks Arena 2's session as `InArena` and navigates the Arena 1 scorer into Arena 2!
- **Fix:**
  - Filter `next` and `nextRealSession` by `(s.arenaName ?? '') === (currentSession.arenaName ?? '')`.

### BUG-11 — `ArenaPage.tsx` Has No Multi-Arena Selector (Always Shows Arena 1)
- **Where:** `web/src/pages/competition/ArenaPage.tsx` (Lines 18–30, `computeTarget`)
- **What happens:**
  - `computeTarget` calls `races.find((s) => s.status === 1)` across all sessions in the competition with no arena filter. When Arena 1 and Arena 2 are both running, Arena 2's ring crew can only see Arena 1's equipment setup.
- **Fix:**
  - Add a sticky Arena pill selector (`Arena 1` | `Arena 2`, persisted in `localStorage`) at the top of `ArenaPage.tsx`.

### BUG-12 — Adding a Break or Briefing Hardcodes `arenaName: null`
- **Where:** `web/src/pages/competition/TimetableManagement.tsx` (Line 910, `AddEntryForm`)
- **What happens:**
  - `AddEntryForm` sends `arenaName: null` when creating a Break, Briefing, or Custom item. In a 2-arena competition, `ArenaSplitView` (`Line 727`) puts `arenaName: null` items into a third `"No arena"` column instead of `Arena 1`, `Arena 2`, or `All Arenas`.
- **Fix:**
  - Add an Arena selector (`Arena 1`, `Arena 2`, or `All Arenas`) to `AddEntryForm`.

### BUG-13 — Editing Any Heat Assignment Wipes All Existing Race Results in the Entire Session
- **Where:** `api/Controllers/SessionsController.cs` (Lines 338–357, `UpdateHeatAssignments`) & `web/src/pages/competition/TimetableManagement.tsx` (Lines 992–1093)
- **What happens:**
  - `UpdateHeatAssignments` loops over **every heat** in the session and executes `_db.Results.RemoveRange(race.Results)` and `race.IsComplete = false`, even for heats that were already scored and not modified!
  - `HeatAssignmentEditor` also provides no way to edit lane numbers (`LaneIndex`).
- **Fix:**
  - Only update `HeatEntries` for heats whose team or lane assignments actually changed, never delete results from already-scored heats, and add lane number (`Lane 1..6`) controls in `HeatAssignmentEditor`.

---

## 3. Permissions, Club Hierarchy, Entries & Declarations Bugs

### BUG-14 — Club Is Optional on Signup, Team Managers (`Roles.Manager`) Are Excluded From `MyTeams` & `Organiser`, and `Manager` Signup Bypasses Approval
- **Where:**
  - `web/src/pages/LoginPage.tsx` (Line 156)
  - `api/Controllers/AuthController.cs` (Lines 95–126, `SignupTrainer`)
  - `api/Auth/Roles.cs` (Line 23, `Roles.Organiser`)
  - `api/Controllers/TeamsController.cs` (Lines 102–118, `MyTeams`)
  - `api/Controllers/TrainerRequestsController.cs` (Lines 19–62)
- **What happens:**
  1. `LoginPage.tsx:156` marks Pony Club as `(optional)` and `AuthController.cs:100-108` silently drops unknown club names to `ClubId = null`, instead of requiring every non-Admin user to belong to a Club and allowing new club names (e.g. MGAGB team/club names) to be added.
  2. `AuthController.cs:122-124` puts `Trainer` into `TrainerRequest` (pending approval) but grants `Roles.Manager` immediately with **zero approval check**!
  3. Despite `Manager` (Team Manager) being the overall head of a Club (just below `Admin`), `Roles.Organiser` (`Roles.cs:23`) excludes `Roles.Manager`, and `TeamsController.MyTeams` (`Lines 113–114`) only returns teams where `t.TrainerUserId == userId` — so a Club's **Team Manager cannot see or manage their own club's teams (`t.ClubId == user.ClubId`)**!
  4. Team Managers also have no endpoint to approve Trainers/Members joining their Club.
- **Fix:**
  - Require a Club name on signup (creating/matching the `Club` record automatically when a new club/team name is typed).
  - Gate `Manager` signups behind Admin approval, and let a Club's `Manager` (as well as `Admin`) approve `Trainer` and `Member` accounts for their `ClubId`.
  - Give `Roles.Manager` full access to all teams, signups, declarations, and `SavedRiders` belonging to their `ClubId`.

### BUG-15 — `UpdateTeamRequest` Has No `TrainerUserId` Field & `FormTeams` Leaves `TrainerUserId` Null
- **Where:** `api/Dtos/ApiDtos.cs` (Lines 161–163), `api/Controllers/TeamsController.cs` (Lines 69–88), and `api/Controllers/SignupController.cs` (Lines 308–317)
- **What happens:**
  - `MyTeamsPage.tsx:194` tells trainers: *"An organiser must add you as the trainer of a team."*
  - However, `UpdateTeamRequest` only accepts `Suffix` and `IsHorsConcours` — there is no `TrainerUserId` field on `UpdateTeamRequest` and no UI on `TeamsTab.tsx` for an Admin or Team Manager to assign a Trainer to a team!
- **Fix:**
  - Add `TrainerUserId` (and `BibDescription`) to `UpdateTeamRequest` and `TeamsTab.tsx`.

### BUG-16 — `DetailsTab.tsx` Always Displays `"0 in · X seats left"` to Non-Organisers & Lacks Whole-Team Entry
- **Where:** `web/src/pages/competition/DetailsTab.tsx` (Lines 35, 193 & 238–243) & `api/Dtos/ApiDtos.cs` (`CompetitionSectionDto`)
- **What happens:**
  - `DetailsTab.tsx:35` only fetches `allSignups` if `mayOrganise` is true. For every normal rider, trainer, or visiting Team Manager, `allSignups` is `[]`, so `paidCount` is always `0` and `seatsLeft` always shows the full capacity even when a section is 100% full!
  - `SectionSignupCard` also only allows single-person signups instead of letting a **Team Manager** enter a whole team (while still allowing riders or Team Managers to enter Pairs/Individuals).
- **Fix:**
  - Include `ActiveSignupsCount` on `CompetitionSectionDto` and add Whole-Team entry for Team Managers in `SectionFormat.Teams` sections.

### BUG-17 — `DeclarationsTab.tsx` & `DeclarationFormsController.cs`: Per-Rider Bib Dropdowns, Duplicate Declaration Forms on Edit, Cross-Club Unassigned Teams & Isolated `SavedRiders`
- **Where:**
  - `web/src/pages/competition/DeclarationsTab.tsx` (Lines 19, 91–95, 102–112, 141–159, 251–273)
  - `api/Controllers/DeclarationFormsController.cs` (Lines 81–88, 100–124, 165)
  - `api/Controllers/ClubsController.cs` (Line 37)
  - `api/Services/DbInitializer.cs` (Lines 626–639)
- **What happens:**
  1. **5 Different Bib Colours on 1 Team:** `DeclarationsTab.tsx:115` and `DbInitializer.cs:626-639` assign 5 different dropdown colours (`Red, Yellow, Blue, Green, White`) to the 5 riders on the same team instead of a single plain-text `BibDescription` for the whole team.
  2. **Cross-Club Unassigned Teams Leak:** `DeclarationsTab.tsx:94` (`t.trainerUserId == null || t.trainerUserId === user.id`) shows `"New for {Team}"` buttons for every unassigned team across **all clubs** instead of scoping to `t.clubId === user.clubId`, and `DeclarationFormsController.Submit` (`Line 82`) lets any logged-in user submit a declaration for any unclaimed team!
  3. **Duplicate Declaration Forms When Editing:** Clicking a team on `DeclarationsTab.tsx:102` starts a blank form instead of loading the team's existing declaration, and `DeclarationFormsController.Submit` (`Line 123`) inserts a **second `DeclarationForm` row** for the same `TeamId` instead of updating the existing one!
  4. **`SavedRiders` Locked to One User Instead of the Club:** `ClubsController.SavedRiders:37` and `DeclarationFormsController.cs:87` filter `SavedRiders` by `r.CreatedByUserId == uid` instead of `user.ClubId == id`, so a Club's Team Manager and Trainers cannot share the same club's saved riders.
- **Fix:**
  - Replace per-rider bib dropdowns with a single plain-text `BibDescription` on the Team/Declaration + `IsGuestRider` per rider.
  - Scope `myTeams` and `DeclarationFormsController.Submit` to the user's `ClubId` (`Manager` or assigned `Trainer`), upsert/update the existing `DeclarationForm` when a team already has one (until `Competition.DeclarationsLocked == true`), and share `SavedRiders` across all Team Managers/Trainers in the same `ClubId`.

### BUG-18 — Private "Message the Admins" on `ChatTab.tsx` Blocks Team Managers & Riders/Members, and Admins Have No Way to Reply Privately
- **Where:** `api/Controllers/ChatController.cs` (Lines 52–53) & `web/src/pages/competition/ChatTab.tsx` (Lines 45–50, 113 & 169–184)
- **What happens:**
  - `ChatController.Post` (`Line 53`) has `[Authorize(Roles = Roles.Admin + "," + Roles.Trainer)]` and `ChatTab.tsx:46, 113` only enables the private message composer for `isTrainer` — so **Team Managers (`Roles.Manager`)** and **Members/Riders (`Roles.Member`, `Roles.Rider`)** cannot privately message the competition Admins!
  - Furthermore, when an Admin types in the composer (`ChatTab.tsx:169-170`), it **always** posts a public announcement to the whole competition (`/chat/announcement`) — there is no "Reply privately" option for an Admin to reply to a user's private message!
- **Fix:**
  - Allow any signed-in user (`Team Manager`, `Trainer`, `Member`, `Rider`) to send a private message to the competition Admins/Organisers, and allow Admins/Organisers to reply privately to that thread as well as post public announcements/banners.

---

## 4. Equipment, Race Library & Cloud Deployment Bugs

### BUG-19 — `EquipmentCalculator.cs` Sums Reusable Poles & Cones Across All Races in a Session Instead of Taking `MAX`
- **Where:** `api/Services/EquipmentCalculator.cs` (Lines 64–75)
- **What happens:**
  - `EquipmentCalculator` sums `perLane * lanes` across every race in the session (`totalPerLane += item.PerLane`), telling the organiser they need **144 bending poles** for 6 races in a 6-lane arena instead of **24 bending poles** (`MAX` across races in that arena).
- **Fix:**
  - Compute the maximum required per arena (`MAX(race quantity)` for reusable equipment), plus a per-race breakdown and next-race changeover diff.

### BUG-20 — Duplicate Consecutive `(x2)` Races in `CompetitionEditor.tsx` (`ZONE_PAIRS` & `AREA_PAIRS`)
- **Where:** `web/src/pages/admin/CompetitionEditor.tsx` (Lines 48–54 & 82–86)
- **What happens:**
  - The 2026 Pony Club rulebook notation `(x2)` (meaning 2 runs in a Pairs heat) was misread as running the race twice in a row, resulting in duplicate consecutive races (`'Litter', 'Litter'`, `'Mug', 'Mug'`, etc.) in `ZONE_PAIRS` and `AREA_PAIRS`.
- **Fix:**
  - Deduplicate `ZONE_PAIRS` and `AREA_PAIRS` to single race entries.

### BUG-21 — Ephemeral VAPID Keys & UTC Notification Times on Vercel Container (`mounted-games-api`)
- **Where:** `api/Services/VapidKeyService.cs` (Lines 19–35) & `api/Services/NotificationScheduler.cs` (Line 66)
- **What happens:**
  - `VapidKeyService.cs` writes `vapid-keys.json` to ephemeral container disk without checking `IConfiguration` (`Security:VapidPublicKey` / `Security:VapidPrivateKey`) first, so every container cold start generates a new keypair and invalidates all browser push subscriptions.
  - `NotificationScheduler.cs:66` formats `ScheduledStart.Value.ToLocalTime().ToString("HH:mm")`, which outputs `UTC` (1 hour off during BST) because the Vercel container runs in `UTC`.
- **Fix:**
  - Read `Security:VapidPublicKey` and `Security:VapidPrivateKey` from `IConfiguration` first, and convert `ScheduledStart` to `Europe/London` (`TimeZoneInfo.FindSystemTimeZoneById("Europe/London")`).

---

## 5. In-App Entries, Team Formation, Timing Cascade, Print Views & Shop Bugs

### BUG-22 — `SignupController.FormTeams` Merges All Unknown Club Names Into `"Unaffiliated"`, Re-Bins Already-Linked Signups Into Duplicate Teams, and `DetailsTab.tsx` Ignores Pending Signups in `seatsLeft`
- **Where:**
  - `api/Controllers/SignupController.cs` (Lines 48–51, 215–246, 270–289)
  - `web/src/pages/competition/DetailsTab.tsx` (Lines 239–242)
- **What happens:**
  1. **Different Custom Clubs Merged Together Into `"Unaffiliated"` (`SignupController.cs:225-246`):** When binning paid signups by `PonyClubName`, `FormTeams` only matches existing rows in `_db.Clubs` (`!clubsByName.TryGetValue(name, out var club) ? unaffiliated.Id : club.Id`). If 3 different clubs not yet in `_db.Clubs` enter (e.g. `"Welsh Dragons"`, `"Gower MG"`, `"Monmouthshire"`), all 3 fail the lookup and get dumped into the **same `"Unaffiliated"` bucket**, mixing riders from completely different clubs onto `"Unaffiliated A"`, `"Unaffiliated B"`.
  2. **Already-Formed Signups Re-Binned Into Duplicate Teams (`SignupController.cs:215-218`):** `paidSignups` queries `.Where(s => s.CompetitionSectionId == sectionId && s.Status == SignupPaymentStatus.Paid)` **without** filtering `.Where(s => s.TeamId == null)`. When `ReplaceExisting == false` (or when existing teams already have heats/declarations so line 280 skips deleting them), `FormTeams` re-bins signups that are already on a team and creates duplicate teams (`"Stockport B"`) for the exact same riders!
  3. **`seatsLeft` Mismatch (`DetailsTab.tsx:239-242` vs `SignupController.cs:48-51`):** `SignupController.Create` counts `Paid + Pending` signups towards `MaxParticipants`, whereas `DetailsTab.tsx:239-241` computes `seatsLeft = max - paidCount` (ignoring `Pending` signups), showing seats available when the backend rejects new entries as full.
- **Fix:**
  - Auto-create or resolve a `Club` record for every distinct non-blank `PonyClubName` in `SignupController.Create` and `FormTeams`; support custom `TeamName` alongside `PonyClubName`; filter `paidSignups` to `.Where(s => s.TeamId == null)` after detaching any replaced teams; and count `Paid + Pending` signups in `DetailsTab.tsx` (and expose `ActiveSignupsCount` publicly on `CompetitionSectionDto`).

### BUG-23 — Pinned Heat Times Ignore Session Delay (`offsetMs`), `effectiveEnd` Ignores Heat Drift (`time.ts`), and `MyTeamsPage.tsx` Strips Breaks Before Computing Heat Times
- **Where:**
  - `web/src/lib/time.ts` (Lines 85–108)
  - `web/src/pages/MyTeamsPage.tsx` (Lines 49–50, 61–72)
- **What happens:**
  1. **Pinned Heats Wipe Out Session Delay (`time.ts:85-101`):** When a heat has `h.scheduledStart` (`pinned`), line 90 (`else if (pinned) hEffective = new Date(pinned)`) sets `hEffective` to the raw `pinned` time **without applying `offsetMs`** or checking `if (heatCursor && hEffective < heatCursor)`, and line 100 (`const advanceFrom = pinned ?? heatCursor`) resets `heatCursor` back to the unshifted `pinned` time — wiping out the session delay for that heat and every subsequent heat in the session!
  2. **`effectiveEnd` Ignores Mid-Session Heat Shifts (`time.ts:106-108`):** `effectiveEnd` is computed as `effective + sessionDurationMinutes(s)` rather than `heatCursor`, ignoring any mid-session `h.startedAt` or pinned heat shift when cascading to the next session.
  3. **`MyTeamsPage.tsx` Strips Breaks Before Calling `computeTimings` (`MyTeamsPage.tsx:49-50`):** `MyTeamsPage` filters out Breaks (`kind === 1`) and Briefings (`kind === 2`) on line 49 **before** calling `computeTimings(sessions)` on line 50, so all afternoon heat times on `MyTeamsPage` are shifted earlier by the duration of every break/briefing, and `TeamHeatRow` omits `arenaName` and starting `laneIndex`.
- **Fix:**
  - Pass all `comp.sessions` into `computeTimings(comp.sessions)` on `MyTeamsPage.tsx` before filtering to race sessions (and include `arenaName` and starting `laneIndex` on `TeamHeatRow`); in `time.ts`, apply `offsetMs` (and `Math.max(pinned + offsetMs, heatCursor)`) to pinned heats and use `heatCursor` for `effectiveEnd`.

### BUG-24 — Printed Draw & Score Sheets Show `"Time TBC"` for Every Unpinned Heat, Include Briefings in Draw, and Omit Lane Numbers & Existing Scores
- **Where:**
  - `api/Services/EventTools/PrintableEventService.cs` (Lines 14–45)
  - `web/src/pages/eventTools/PrintEventPage.tsx` (Lines 68, 73)
- **What happens:**
  1. **Every Unpinned Heat Prints `"Time TBC"` (`PrintableEventService.cs:19, 35`):** `DrawAsync` and `ScoreSheetsAsync` pass `h.ScheduledStart` directly into `PrintableHeatDto` / `PrintableScoreHeatDto`. Because `AutoTimetable` only sets `session.ScheduledStart` and leaves `h.ScheduledStart = null`, `PrintEventPage.tsx` displays **`"Time TBC"`** on every heat in the printed draw and score sheets!
  2. **Briefings Included in Printed Draw (`PrintableEventService.cs:14, 31`):** Filtering by `.Where(x => !x.IsBreak)` instead of checking `SessionKind.Race` includes Briefings (`SessionKind.Briefing`) and Custom items as empty sections in the printed Draw.
  3. **Missing Lane Numbers & Scores on Printed Score Sheets (`PrintEventPage.tsx:73`):** `ScoreSheets` omits the team's **Lane (`laneIndex`)** column and renders empty `<td /><td /><td /><td />` cells even when results already exist (`team.placing`, `team.eliminated`, `team.points`).
- **Fix:**
  - Compute scheduled/effective heat start times from `session.ScheduledStart` + heat durations in `PrintableEventService`, filter to `SessionKind.Race`, include `LaneIndex` and existing results on `PrintEventPage.tsx`, and provide a 1-page-per-heat score sheet grid (`Lane | Team | Bib | Race 1..N | Total`).

### BUG-25 — `TeamProfilePage.tsx` & `CsvTeamImportService.cs` Require Non-Empty Suffix and Pre-Existing Club Dropdown
- **Where:**
  - `web/src/pages/seasons/TeamProfilePage.tsx` (Lines 126–130, 171–172)
  - `api/Services/EventTools/CsvTeamImportService.cs` (Lines 56, 60–63)
- **What happens:**
  - `TeamProfilePage.tsx:171-172` and `CsvTeamImportService.cs:56, 60-63` require `suffix` to be non-empty (`required`, `suffix.Length < 1`) and reject any club not already in `_db.Clubs` (`"Unknown club."`), and `TeamProfilePage.tsx:128-129` only allows linking event teams whose `clubId` and `suffix` strictly match `history.profile.clubId` and `history.profile.suffix`, blocking custom team names (e.g. `"Welsh Dragons"`) or single-team clubs without an `A`/`B` suffix.
- **Fix:**
  - Allow optional `suffix` (defaulting to `""`), free-text/auto-created clubs, and custom `DisplayName` in `TeamProfilePage.tsx` and `CsvTeamImportService.cs`, and allow linking any team from that club/competition on `TeamProfilePage.tsx`.

### BUG-26 — Split / Orphaned Shop Implementations (`ShopPage.tsx` + `ShopController.cs` vs `EventShopPage.tsx` + `CommerceController.cs`)
- **Where:**
  - `web/src/App.tsx` (Lines 89, 111)
  - `web/src/pages/ShopPage.tsx` & `api/Controllers/ShopController.cs`
  - `web/src/pages/commerce/EventShopPage.tsx` & `api/Controllers/CommerceController.cs`
- **What happens:**
  - `App.tsx:111` redirects `/shop` to `/competitions`, leaving `ShopPage.tsx` and `ShopController.cs` (tack/equipment classifieds with photos, prices, and private/public comments) orphaned and unreachable, while `EventShopPage.tsx` (`/competitions/:id/shop`) only shows organiser-approved basket items for a single competition.
- **Fix:**
  - Merge both into a single unified Shop experience accessible both at `/shop` (global marketplace + event shops) and `/competitions/:id/shop` (event add-ons/merch + tack & equipment listings to collect at the event).
