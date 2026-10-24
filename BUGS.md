# Code-Verified Bugs (`BUGS.md` — 22 October 2026)

Every bug listed below has been verified directly against the current source code in `api/` and `web/src/`. Each entry includes the exact file and line numbers, what is broken, and how to fix it.

## Status (updated 22 October 2026)

Issues #66 to #78 hold these bugs, grouped by area. Bugs 03, 05, 07, 14, 15, 16, 17, 18, 22, 23, 24, 25 and 26 were fixed in the `fix/bugs-md` PR; the rest are covered by PRs #79, #80, #81 and the scoring page PR (#91).

| Bug | Status | What differs from the text below |
| --- | --- | --- |
| 03 | Fixed | `LaneRotationMode` per session (move up, stay, move down; move up is the default and stored as 0). A heat may have one team more than the lanes; that team sits out each race in turn and shows **S** (scoring page, heat table, score card overlay and printed sheets). More than one extra team is still refused. `ToplistView` has no per-race column, so it needed no change. |
| 05 | Mostly fixed | Every finals tier boundary is checked, and teams level on points are flagged as tied (wins no longer break the tie silently). Choosing a tie-break rule in the app is not built: settle a tie with a run-off race or by hand. |
| 07 | Fixed | The final fills itself once both qualifiers are scored (stored "through to the final" count, default 3). In a qualifier only the qualifying places are tapped; the rest score 1 point, and a further tap eliminates. Finalists score on the final's own field plus one. The heat page shows one table per round. |
| 14 | Fixed | Club is required and created if new. A signed-up Team Manager waits for admin approval (new `ManagerRequest` role). A club's Manager approves its Trainers. Managers see and run every team of their club. Members still join without approval. `Roles.Organiser` is unchanged: it means "organises a competition", not "runs a club". |
| 15 | Fixed | `UpdateTeamRequest` takes `TrainerUserId` and `BibDescription` (an empty string clears). Organisers pick the trainer on the Teams tab; a club Manager does it on My Teams. |
| 16 | Fixed | `CompetitionSectionDto.ActiveSignupsCount` is public. Team Managers and Trainers can enter a whole team in a team section. |
| 17 | Fixed, one gap | One `BibDescription` per team, guest riders, one declaration per team (resubmitting updates it and folds old duplicates), saved riders shared by a club's Manager and Trainers. There is no `Competition.DeclarationsLocked` field, so editing is not locked after a cut-off. |
| 18 | Fixed | Any signed-in person can message the organisers privately; admins can reply privately into that thread. |
| 22 | Fixed, one gap | `FormTeams` gives each distinct new club its own team, skips signups already on a team, and groups by team name. Clubs are created when teams are formed, not when someone enters, so anyone signed in can't add clubs by typing names. |
| 23 | Fixed | Pinned heats carry the session delay, a session ends when its last heat does, and My Teams times heats with the breaks counted. |
| 24 | Fixed | Heat times are worked out from the session start, only race sessions print, and the score sheet is one grid per heat with lanes, bibs and recorded scores. |
| 25 | Fixed | Suffix is optional; unknown clubs are created (CSV import and team profiles); any team of a profile's club can be linked. |
| 26 | Fixed | `/shop` lists the event shops and the tack and equipment listings, and each event shop shows the same listings. Listings are not tied to one event. |

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

### BUG-27 — `FormatPage.generate()`, `SessionsController.GenerateHeats`, `GenerateRaceFinals` & `AutoTimetable` Use Unseeded `rng.Next()` Instead of the Fair Seeded Draw (`CompetitionDrawService`)
- **Where:**
  - `web/src/pages/admin/FormatPage.tsx` (Lines 184–202, `generate()`)
  - `api/Controllers/SessionsController.cs` (Lines 244–259 `GenerateRaceFinals` & Lines 481, 529–539 `GenerateHeats` / `SplitIntoBalancedGroups`)
  - `api/Controllers/CompetitionsController.cs` (Lines 815–879, `AutoTimetable`)
  - `api/Services/Operations/CompetitionDrawService.cs` (Lines 42–43)
- **What happens:**
  1. When the organiser generates heats on `FormatPage.tsx:196-198`, it calls `generate-heats` or `generate-race-finals` on each session one by one.
  2. `SessionsController.GenerateHeats` (`Line 481`) and `CompetitionsController.AutoTimetable` use `SplitIntoBalancedGroups` (`teamIds.OrderBy(_ => rng.Next())`) per session independently — completely bypassing `CompetitionDrawService` (`opponentCounts`, `laneCounts`, and `SmallHeatCost`), so the same teams can be drawn against each other in the same lanes across every session!
  3. Similarly, `SessionsController.GenerateRaceFinals` (`Lines 244–259`) uses `teamIds.OrderBy(_ => rng.Next())` for each race's `Q1` and `Q2` in `Heat-Heat-Final` (`usesRaceFinals`) without balancing opponent meetings, lane counts, or smaller-heat assignments across races, and `CompetitionDrawService.cs:42-43` rejects `RaceRoundStage != RaceRoundStage.None` (`"Race-finals heats cannot be redrawn with the section draw."`).
- **Fix:**
  - Make `FormatPage.generate()`, `GenerateHeats`, `GenerateRaceFinals`, and `AutoTimetable` always use the fair seeded draw engine (`CompetitionDrawService` — minimising repeated opponents, balancing lanes `1..N`, and balancing `SmallHeatCost` when heat sizes are unequal) across all sessions/races in the section.

### BUG-28 — `CompetitionDrawService` Includes Scaffolded `A / B / C Final` Sessions in the Qualifier Section Draw
- **Where:**
  - `api/Services/Operations/CompetitionDrawService.cs` (Lines 32–38)
  - `api/Controllers/CompetitionsController.cs` (`ScaffoldFinals`)
- **What happens:**
  - When `ScaffoldFinals` creates placeholder `A Final`, `B Final`, `C Final` sessions before the competition starts, it sets `Kind = SessionKind.Race` and leaves `Heat.RaceRoundStage = RaceRoundStage.None` (`0`).
  - When the organiser later runs the Section Draw (`CompetitionDrawService.PreviewAsync`, lines 32–38), it selects **all** sessions where `s.Kind == SessionKind.Race && !s.IsBreak` — accidentally including the scaffolded `A / B / C Final` sessions and pre-filling them with random qualifier teams!
- **Fix:**
  - Mark finals sessions (`Session.IsFinal = true` or exclude sessions whose heats are `A Final / B Final / C Final`) in `ScaffoldFinals` and `CreateFinals`, and exclude Finals sessions from `CompetitionDrawService`.

### BUG-29 — `FormTeams` Names `Individual` Riders `"Club A" / "Club B"` Instead of Rider Name, `DetailsTab.tsx` Shows `"Team Name"` & `"Team Code"` on `Individual` Sections, and `Admin` Is Blocked From Whole-Team Entry
- **Where:**
  - `api/Controllers/SignupController.cs` (Lines 77, 369–378 & 422)
  - `web/src/pages/competition/DetailsTab.tsx` (Lines 309, 400–416)
- **What happens:**
  1. **Individual Riders Named `"Club A"`, `"Club B"` (`SignupController.cs:369-378, 422`):** When `section.Format == SectionFormat.Individual` (`ridersPerTeam == 1`), `FormTeams` assigns `suffix = "A", "B", "C"` and sets `DisplayName = $"{preview.ClubName} {suffix}"` — so Individual riders from the same club appear on the scoreboard as `"Rockwood A"`, `"Rockwood B"` instead of the rider's actual name (`slice[0].FullName`), and for `SectionFormat.Pairs` without a custom pair name it uses `"Rockwood A"` instead of `"Rider 1 & Rider 2"`.
  2. **`DetailsTab.tsx` Shows `"Team name"` and `"Team code"` on Individual Sections (`DetailsTab.tsx:406-416`):** An `Individual` section entry form asks the solo rider for `"Team name (optional) — Riders with the same team name are put together"` and `"Team code — e.g. STOCKPORT-A"`.
  3. **`Admin` Blocked From Entering a Whole Team (`DetailsTab.tsx:309` & `SignupController.cs:77`):** `canEnterWholeTeam` and `SignupController.Create` check `Manager` and `Trainer` but omit `Roles.Admin`, blocking Admins from entering a whole team.
- **Fix:**
  - In `SignupController.FormTeams`, when `section.Format == SectionFormat.Individual`, set `DisplayName = slice[0].FullName` (with `Suffix = ""`), and when `section.Format == SectionFormat.Pairs` without a custom `TeamName`, set `DisplayName = string.Join(" & ", slice.Select(x => x.FullName))`.
  - Hide `"Team name"` and `"Team code"` on `SectionFormat.Individual` in `DetailsTab.tsx`, label Pairs fields `"Pair / Partner"` (with the `"Looking for a Pair"` option), and include `Roles.Admin` in `canEnterWholeTeam` and `SignupController.Create`.

### BUG-30 — Self-Entered `Individual` & `Pairs` Riders (`Roles.Member` / `Roles.Rider`) Are Blocked From Submitting Their Declaration Form (`403 Forbid`), and `DeclarationsTab.tsx` Shows Delete Buttons on Other Clubs' Forms
- **Where:**
  - `api/Controllers/DeclarationFormsController.cs` (Lines 84, 95–98 & 211–218)
  - `web/src/pages/competition/DeclarationsTab.tsx` (Lines 26–31 & 133)
- **What happens:**
  1. **Self-Entered Riders Blocked From Filling In Their Own Dec Form:** `DeclarationFormsController.Submit` (`Line 84`) has `[Authorize(Roles = Roles.TeamWork)]` (which excludes `Roles.Member` and `Roles.Rider`), lines 95–98 never check whether the user is linked to the team via `SectionSignup` (`_db.SectionSignups.AnyAsync(s => s.TeamId == team.Id && s.UserId == userId)`), and `DeclarationsTab.tsx:26-31` only checks `t.trainerUserId === user.id || (manager && t.clubId === user.clubId)`. As a result, a Rider who enters themselves in an `Individual` or `Pairs` competition sees `"You have no teams in this competition"` and is completely blocked from submitting their declaration form!
  2. **Delete Button Shown on Every Club's Declaration Form (`DeclarationsTab.tsx:133` & `DeclarationFormsController.cs:217`):** `DeclarationsTab.tsx:133` passes `canDelete={user != null}`, showing a red delete button on **every team's declaration card** to any logged-in user, while `DeclarationFormsController.Delete` (`Line 217`) omits `IsClubManagerAsync` and `CanManageAsync` (so even a Club's Team Manager or Competition Co-Organiser gets `403 Forbid` when deleting a declaration).
- **Fix:**
  - Allow `[Authorize]` on `DeclarationFormsController.Submit` and `Delete`, permit submission/editing by any user who entered that team/pair/individual (`SectionSignup.UserId == userId` / connected Entry ID) as well as the Club's `Manager`, assigned `Trainer`, or Competition Organiser/Admin, include the user's own entered `Team`s in `DeclarationsTab.tsx` (`myTeams`), and scope `canDelete` on `DecFormCard` to users who actually have permission to manage that team's declaration.

### BUG-31 — `HeatScores.tsx` Splits a `Heat-Heat-Final` (`Race-Finals`) Session Into 1 Table Per Race Instead of 1 Unified Session Table
- **Where:**
  - `web/src/pages/competition/HeatScores.tsx` (Lines 34–44, 63–88)
  - `api/Controllers/SessionsController.cs` (Lines 248–259, `GenerateRaceFinals`)
- **What happens:**
  - In `GenerateRaceFinals`, each race in the session is assigned a different `RaceRoundId` (`1, 2, 3…`).
  - `HeatScores.tsx:37` filters `roundHeats` by `heats.filter((item) => item.raceRoundId === heat.raceRoundId)` — which only groups `Q1 + Q2 + Final` of **one single race**!
  - Instead of seeing one unified session scoreboard of **all teams × all races (`Race 1..N`)** for the `Heat-Heat-Final` session, spectators and riders only see a single race at a time and have to click `"Next heat"` 8–10 times to see the session's races.
- **Fix:**
  - When a session uses `Heat-Heat-Final` (`heats.some(h => h.raceRoundStage != null && h.raceRoundStage !== 0)`), render **one unified table for the whole session** on `HeatScores.tsx` with all teams in the session down the side, one column per race (`Race 1..N`) showing the team's combined/final points earned in that race (`Q1`/`Q2` `1 pt` or `0 pt` elim for non-finalists, or `Final` `2..N+1 pts` / `0 pt` elim for finalists), and a separate **"Session & Heat Draw (Who's in Q1 vs Q2)"** box (with no scores) so riders can see which heat and lane they are in for each race.

### BUG-32 — `competitionPhase.ts` Exits `'entry'` Phase Prematurely as Soon as 1 Team Exists, and `AfterDrawOnly` Blocks Other Competition Tabs Before the Draw
- **Where:**
  - `web/src/lib/competitionPhase.ts` (Lines 14–28)
  - `web/src/pages/competition/CompetitionHome.tsx` (Lines 11–24)
- **What happens:**
  1. `competitionPhase.ts:18` checks `if (competition.teams.length > 0) return 'running';`. The moment even 1 team exists in the competition (even while entries are still open and no timetable/heats have been generated yet!), `CompetitionHome.tsx` stops showing the **Entry Page (`EntryPage.tsx`)** and switches the competition home page to an empty Timetable!
  2. Conversely, while in `'entry'` phase (`competition.teams.length === 0`), `AfterDrawOnly` (`CompetitionHome.tsx:19-24`) redirects all other tabs back to `/competitions/${competition.id}` instead of leaving the other pages visible.
- **Fix:**
  - Keep `CompetitionHome.tsx` on the **Entry Page (`EntryPage.tsx`)** until the timetable/heats are actually generated (`competition.sessions.some(s => s.heats.length > 0 || s.status !== 0)`), while leaving all other competition tabs visible and accessible (even when empty before the draw). Once the timetable/heats are generated, switch the default landing view to the Timetable & Live Heats.

### BUG-33 — `HeatScores.tsx` Does Not Pre-Fill Sit-Out `"S"` Cells Before Races Are Scored, Does Not Sort Rows by Heat Leader While Live, and Does Not Highlight Followed Teams
- **Where:**
  - `web/src/pages/competition/HeatScores.tsx` (Lines 63–88, 125–140)
  - `web/src/pages/competition/ToplistView.tsx` (Lines 47–75, 107–125)
- **What happens:**
  1. **Sit-Out `"S"` Only Appears After a Race Is Scored (`HeatScores.tsx:78, 132-135`):** `HeatScores.tsx` only sets `cell.sitOut = true` from saved `race.results`. Before a race is scored (`cell == null`), it renders **`–`** instead of pre-filling **`S`** from `sitsOutOf(heat, entry, raceIdx, laneRules)` so teams can see in advance which race they sit out.
  2. **Heat Table Rows Stay in Starting Lane Order While Live (`HeatScores.tsx:85`):** Line 85 checks `list.sort((a, b) => (finished ? b.total - a.total : 0) || a.lane - b.lane)`. While a heat is live in progress (after Race 1, Race 2, etc., when `finished === false`), the table never sorts by who is winning the heat (`b.total - a.total`), instead keeping teams frozen in their starting lane order until the entire heat finishes!
  3. **No Highlighting for Followed Teams (`HeatScores.tsx` & `ToplistView.tsx`):** Neither `HeatScores.tsx` nor `ToplistView.tsx` reads `useFavourites()` to highlight rows belonging to teams the viewer is following.
- **Fix:**
  - Pre-fill **`S`** in `HeatScores.tsx` for every `(team, raceIndex)` where `sitsOutOf(heat, entry, raceIndex, laneRules)` is true even before the race is scored.
  - Sort `HeatScores.tsx` rows by **starting lane (`a.lane - b.lane`) before any race in the heat is scored**, and as soon as at least 1 race has results (`races.some(r => r.results.length > 0)`), sort rows by **who is winning the heat (`b.total - a.total`)** from top to bottom while displaying each team's current/starting lane underneath or alongside their name.
  - Highlight followed teams (`useFavourites`) across `ToplistView.tsx`, `HeatScores.tsx`, and `TimetableBoard.tsx`.

### BUG-34 — `TeamsTab.tsx` Excludes `Roles.Manager`, Forces a `<SelectField>` Club Dropdown + Mandatory 4-Char `Suffix`, and `TeamsController.Create` Cannot Create Free-Text Clubs or Custom Team Names
- **Where:**
  - `web/src/pages/competition/TeamsTab.tsx` (Lines 36, 83, 112–157)
  - `api/Controllers/TeamsController.cs` (Lines 31–68, `Create`)
- **What happens:**
  1. `TeamsTab.tsx:36` (`if (!hasRole('Admin') && !hasRole('Trainer')) return;`) and `Line 83` (`const canCreate = hasRole('Trainer') || hasRole('Admin');`) exclude `hasRole('Manager')` and `canOrganise(competition)`, so Club Team Managers never see `DEC` badges on `TeamsTab.tsx` and cannot add teams.
  2. `TeamsTab.tsx:128-149` and `TeamsController.Create` (`Lines 37–42`) require picking a pre-existing `ClubId` from a `<SelectField>` dropdown and a mandatory `Suffix` (`maxLength={4}`, `required`), making it impossible to type a new club name or a custom team name (e.g. `"Welsh Dragons"`) without an `A`/`B` suffix.
- **Fix:**
  - Include `hasRole('Manager')` and `canOrganise(competition)` in `TeamsTab.tsx`, replace the strict club `<SelectField>` + required suffix with free-text **Club Name** + **Team Name** (auto-creating/matching the `Club` in `TeamsController.Create`), and link each team row to its Competition Team Page (`/competitions/:id/teams/:teamId`).

### BUG-35 — Withdrawing a Team Leaves a Gap in `LaneIndex` (`1, 3, 4, 5`), `WithdrawalRedrawService` Skips `Heat-Heat-Final` Qualifiers, and Moved Teams Are Never Sent Push Notifications
- **Where:**
  - `api/Services/Operations/TeamEntryService.cs` (Lines 137–155, `RemoveFromUnscoredHeatsAsync`)
  - `api/Services/Operations/WithdrawalRedrawService.cs` (Lines 80–81 & 201–275, `ApplyAsync`)
  - `api/Controllers/WithdrawalsController.cs` (Lines 58–75)
- **What happens:**
  1. **Gap Left in `LaneIndex` (`1, 3, 4, 5`) When 1 Team Withdraws:** When a team in Lane 2 of a 5-team heat withdraws, `RemoveFromUnscoredHeatsAsync` removes its `HeatEntry` without closing up the lanes (`1..4`) if no cross-heat rebalance is needed.
  2. **No Push Notifications Sent When Teams Move Heats (`WithdrawalRedrawService.ApplyAsync`):** When withdrawals leave a heat with 2+ fewer teams (`e.g. 5 and 3 → 4 and 4`) and `ApplyRedraw` moves a team to a different heat/lane (`session.Moves`), it never triggers `WebPushService` notifications to alert the moved team's followers/manager/trainer of their new heat and lane.
  3. **`Heat-Heat-Final` Qualifier Heats (`Q1`/`Q2`) Skipped by `WithdrawalRedrawService` (`Line 80`):** Line 80 skips any session where `heats.Any(h => h.RaceRoundStage != RaceRoundStage.None)`, refusing to rebalance unscored `Q1` and `Q2` qualifier heats after a withdrawal.
- **Fix:**
  - Close up `LaneIndex` (`1..N`) in `RemoveFromUnscoredHeatsAsync` when a single team withdraws and no cross-heat move is needed; only flag cross-heat rebalancing when heat sizes differ by `≥ 2` (or drop below `MinHeatSize`); support rebalancing unscored `Q1`/`Q2` heats (`RaceRoundStage.Qualifier`); and send push notifications (`WebPushService`) to every moved team in `session.Moves` when `ApplyRedraw` runs.

### BUG-36 — `RiderSwapService` & `RiderSwapSheet.tsx` Block Emergency Rider / Pony Substitutions (`GR1.4–GR1.9`) When a Team Has Only 4 Riders Declared (No 5th Reserve)
- **Where:**
  - `api/Services/Operations/RiderSwapService.cs` (Lines 54–59)
  - `web/src/pages/operations/RiderSwapSheet.tsx` (Lines 65, 96)
- **What happens:**
  - `RiderSwapService.SwapAsync` requires `inRider` to already exist on the `DeclarationForm` with `inRider.IsReserve == true`, and `RiderSwapSheet.tsx:96` renders `"The declaration lists no reserve to bring in."` if `reserves.length === 0`.
  - In Mounted Games (`GR1.4–GR1.9`), many teams ride as a squad of 4 with no 5th reserve declared, or a Pairs/Individual rider has a lame pony or injured partner and gets Referee approval to bring in an emergency guest rider or replacement pony mid-competition. Currently the app completely blocks this!
- **Fix:**
  - Allow `RiderSwapSheet.tsx` and `RiderSwapService.cs` both to swap in an existing 5th reserve **and** to add/substitute an **Emergency Replacement Rider (or Guest Rider) / Replacement Pony** with a Referee approval reason logged in `RiderSwapEvent`.

### BUG-37 — `decForm.ts` (`teamIsFull` / `canSubmit`) Blocks 4-Rider Teams From Submitting Their Declaration Form
- **Where:**
  - `web/src/lib/decForm.ts` (Lines 27–35, 125–126 & 157–159)
  - `web/src/pages/competition/decform/DecFormEditor.tsx` (Lines 75–76 & 113–114)
- **What happens:**
  - `ridersRequired(SectionFormat.Teams)` returns `5`, and `teamIsFull(slots)` checks `ridersAdded(slots) === slots.length - 1` (`=== 5`).
  - In Mounted Games, a Team is valid with **4 or 5 riders** (4 riders ride in each race, and the 5th squad rider is optional if a team only has 4 riders). Because `canSubmit` requires `teamIsFull(slots)` (`5` riders), a 4-rider team cannot click Submit on `DecFormEditor.tsx`!
  - Furthermore, `decForm.ts:85, 179-180` strips `horseName` and `ponyHeightHands` to `null` for the reserve slot (`index === slots.length - 1`), even when a 6th reserve rider brings a pony or hops on.
- **Fix:**
  - In `decForm.ts`, allow a `Teams` declaration form to be submitted with **4 or 5 riding members** (minimum 4 for `SectionFormat.Teams`, 2 for `Pairs`, 1 for `Individual`), and allow optional pony details on a reserve slot.

### BUG-38 — `MinutesPerHeat` Multiplied by `raceCount` (`10 min × 8 races × 2 heats = 160 min`) Inflates Session Durations to 2.5–5 Hours per Session
- **Where:**
  - `web/src/lib/creatorDraft.ts` (Lines 10–11, 203–204)
  - `web/src/lib/formatPlan.ts` (Lines 71–73)
  - `web/src/lib/time.ts` (Lines 31–35)
  - `api/Services/EventTools/PrintableEventService.cs` (Line 132)
  - `api/Controllers/CompetitionsController.cs` (Lines 815, 849)
- **What happens:**
  - `Session.MinutesPerHeat` is the **minutes for a whole heat** (set per age category/section), and `creatorDraft.ts:11` sets `DEFAULT_MINUTES = 10` (`AutoTimetable` sets `15`).
  - However, `formatPlan.ts:72-73`, `time.ts:33`, `PrintableEventService.cs:132`, and `CompetitionsController.cs:849` multiply `MinutesPerHeat * h.races.length * heats.length`!
  - For a standard 8-race session with 2 heats (`DEFAULT_MINUTES = 10`), the timetable schedules **`2 × 8 × 10 = 160 minutes` (2 hours 40 minutes) for a single session**, and for a 10-race `Heat-Heat-Final` session (`3 × 10 × 10`), it schedules **`300 minutes` (5 hours)** for a single session!
- **Fix:**
  - Treat `Session.MinutesPerHeat` as the **duration of 1 whole heat** (set per age group/section in the creator, e.g. `heats.length * session.minutesPerHeat`), never multiplying `minutesPerHeat` by `raceCount`.

### BUG-39 — `ScorerController` Strips Elimination Reasons (`RefereeNote = null`), and Scoring Races Does Not Automatically Transition `Session.Status` (`InArena` / `Finished`) or Auto-Populate `Heat-Heat-Final` Finals on `ScorerPage.tsx`
- **Where:**
  - `api/Controllers/ScorerController.cs` (Lines 61, 89)
  - `web/src/pages/ScorerPage.tsx` (Lines 286–306)
  - `api/Services/ScoringService.cs` (Lines 120–240)
- **What happens:**
  1. `ScorerController.cs:61, 89` explicitly strips `RefereeNote = null` on every score submission from a Scorer Link, and `ScorerPage.tsx:286` omits `allowReasons`, preventing ring scorers using a Scorer Link from picking/recording why a team was eliminated.
  2. When a scorer starts scoring a heat/session (via `SessionPage.tsx` or `ScorerPage.tsx`), `ScoringService` does not automatically mark `Session.Status = SessionStatus.InArena` (and `StartedAt`/`Heat.StartedAt`) when the first race is scored, nor `SessionStatus.Finished` (and `FinishedAt`) when all heats/races in the session are complete.
- **Fix:**
  - Enable `allowReasons` on `ScorerPage.tsx` and preserve `RefereeNote` in `ScorerController.cs` when submitted by a scorer link (while still keeping `RefereeNote` private from public reads).
  - In `ScoringService`, automatically set `heat.StartedAt` and `session.Status = SessionStatus.InArena` (`session.StartedAt`) when the first race is scored, auto-populate the `Heat-Heat-Final` `Final` heat when both `Q1` and `Q2` of a round are complete, and automatically mark `heat.FinishedAt` / `session.Status = SessionStatus.Finished` when all races in the heat/session are complete.

### BUG-40 — Competition Creator Wizard Labels `MinutesPerHeat` as `"Minutes per race"` and Has No Way to Set Final Races Before the Competition
- **Where:**
  - `web/src/pages/admin/creator/StructureStep.tsx` (Lines 59–61)
  - `web/src/lib/creatorDraft.ts` (Lines 10–11, 204)
  - `web/src/pages/admin/creator/RacesStep.tsx` (Lines 38–58)
  - `web/src/pages/admin/creator/save.ts` (Lines 117–136)
  - `web/src/pages/competition/TimetableManagement.tsx` (Line 1137)
- **What happens:**
  1. `StructureStep.tsx:59` labels `s.minutesPerRace` (which saves into `Session.MinutesPerHeat`) as `"Minutes per race"` with hint `"A heat runs every race, so it takes this times the races"`, contradicting the domain rule that **Minutes per heat** is set per age category for the whole heat.
  2. In `RacesStep.tsx` and `save.ts`, an organiser can only choose races for the qualifying sessions (`Session 1..N`) and has **no way to set the Final races before the competition**, even when `finalistCount` is configured! Later, `CreateFinalsModal` (`TimetableManagement.tsx:1137`) falls back to a hardcoded 5-race string (`'Litter Lifter\nFlag\nBottle\nMug\nBall and Cone'`).
- **Fix:**
  - Relabel `StructureStep.tsx:59` and `creatorDraft.ts` validation to **`Minutes per heat`** (`"How long a single heat takes in the arena"`).
  - Add `finalRaces: string[] | null` to `SectionDraft` in `creatorDraft.ts` and show a **`Finals`** race-list row in `RacesStep.tsx` (for non-`Heat-Heat-Final` sections) so Final races are set before the competition, saved/scaffolded in `save.ts`, and pre-filled in `CreateFinalsModal`.

### BUG-41 — Tack & Turnout Scoring (`TackCheckService.cs` & `TackCheckTab.tsx`) Only Marks One Score Per Team Per Sector Instead of a Per-Rider Grid Out of 10
- **Where:**
  - `api/Services/TackCheck/TackCheckService.cs` (Lines 86–132, 239–249)
  - `web/src/pages/eventTools/TackCheckTab.tsx` (Lines 123–168)
- **What happens:**
  - `TackCheckTab.tsx` (`TeamMarks`) only renders a single input per sector for the entire team (`team.marks`).
  - In real competitions that run a scored Tack & Turnout competition, the admin defines custom text columns/sectors and scores **each rider on the team in a grid** (`Rider × Sector`, each box out of 10), and the rider boxes are summed into each rider's total and the team's grand total.
- **Fix:**
  - Support a **per-rider scoring grid** on `TackCheckTab.tsx` and `TackCheckService.cs` where each declared rider (or `Rider 1..N` slot for that section format) has an input box (out of `10` / `maxPoints`) for each custom sector column typed by the admin, with per-rider row totals and the summed team total automatically calculated and saved.

### BUG-42 — `ScorerController` Restricts Scorer Links by `ArenaName` Instead of Giving Access to All Competition Scoring
- **Where:**
  - `api/Controllers/ScorerController.cs` (Lines 30–35 & 103–108)
- **What happens:**
  - `ScorerController.GetSession` and `InScopeAsync` filter by `s.ArenaName == link.ArenaName`. If a competition has sessions with different arena names (or blank/renamed arena names), the scorer link hides those sessions and returns `404` when trying to score them, even though scorer links are meant to have access to all scoring in the competition ordered by session start time.
- **Fix:**
  - In `ScorerController.cs`, scope scorer links to `s.CompetitionId == link.CompetitionId` across all race sessions in the competition, ordered chronologically by `ScheduledStart` then `OrderIndex`.

### BUG-43 — `CreateFinals` & `ScaffoldFinals` Default to `A Final` First Instead of `C → B → A Final`, and `PopulateFinals` Assigns Top Teams by `OrderIndex` Instead of Final Tier (`A/B/C`)
- **Where:**
  - `api/Controllers/CompetitionsController.cs` (Lines 648–670, 739–754, 768–791)
  - `web/src/pages/competition/TimetableManagement.tsx` (Lines 1122–1230)
- **What happens:**
  1. `CreateFinals` and `ScaffoldFinals` always create `A Final` at `OrderIndex = 1` and the lowest final last, whereas in Mounted Games competitions finals normally run **lowest final first (`C Final → B Final → A Final`)** so the `A Final` is the climax of the section.
  2. Worse still, `PopulateFinals` (`CompetitionsController.cs:768-791`) iterates `session.Heats.OrderBy(h => h.OrderIndex)` instead of ordering by final tier (`FinalsTiers.ParseLabel(h.Label)`). If a session's heats are ordered `C Final (OrderIndex = 1), B Final (OrderIndex = 2), A Final (OrderIndex = 3)`, `PopulateFinals` puts the **1st–6th place top teams into the C Final** and the bottom teams into the A Final!
- **Fix:**
  - Default `CreateFinals` and `ScaffoldFinals` to **lowest final first (`C → B → A Final`)** with a toggle in `CreateFinalsModal` for `A → B → C`.
  - In `PopulateFinals`, sort heats by `FinalsTiers.ParseLabel(h.Label) ?? int.MaxValue` (`A Final = 0, B Final = 1, C Final = 2`) when assigning ranked teams so `A Final` always receives the top qualifiers regardless of running order.

### BUG-44 — `ScoringService` Awards Race Points to Hors Concours (`IsHorsConcours`) Teams Instead of Treating Them Like an Elimination (`0 pts` & Moving Competitive Teams Up)
- **Where:**
  - `api/Services/ScoringService.cs` (Lines 175–263)
- **What happens:**
  - When a team with `Team.IsHorsConcours == true` races in a heat and finishes e.g. 2nd, `ScoringService` gives them `2nd` place points and pushes the competitive teams behind them down to `3rd, 4th...` points.
  - In real competitions, an `HC` team is treated like an elimination for points purposes (`0` competitive points, while competitive teams behind them move up in effective place/points).
- **Fix:**
  - Load `Team.IsHorsConcours` for heat entries in `ScoringService.ApplyCoreAsync`; give `IsHorsConcours` teams `0` points and compact the effective scoring places of non-eliminated, non-`HC` teams so competitive teams behind an `HC` team receive full points for their competitive finishing order. Also support manual point overrides / dead-heat half-points (`.5`).

### BUG-45 — `NavigationDrawer.tsx` Hides the `Seasons` Link Whenever Viewing a Competition Not Yet in a Season, and `SeasonsPage.tsx` Hides `"Create season"` for Admins Unless `editorMode` Is Toggled
- **Where:**
  - `web/src/components/NavigationDrawer.tsx` (Line 135)
  - `web/src/pages/seasons/SeasonsPage.tsx` (Line 14)
- **What happens:**
  1. `NavigationDrawer.tsx:135` renders `{(seasons === null || seasons.length > 0) && <NavLink to={seasonsTo}>Seasons</NavLink>}`. Whenever a user is inside a competition (`currentId != null`) that has not yet been linked to a season (`seasons.length === 0`), the `Seasons` link completely disappears from the drawer!
  2. `SeasonsPage.tsx:14` gates the `"Create season"` button behind `(!hasRole('Admin') || canEdit())`, hiding `"Create season"` from signed-in Admins unless they first unlock `editorMode`.
- **Fix:**
  - Always show the `Seasons` link in `NavigationDrawer.tsx` (linking to `/seasons/${seasons[0].id}` when the competition is in 1 season, or `/seasons` otherwise).
  - Allow `canOrganise()` (including Admins and Season Organisers) to see and use **"Create season"** on `SeasonsPage.tsx` without requiring `editorMode`.

### BUG-46 — `PrintEventPage.tsx` Splits `Draw` and `ScoreSheets` Instead of Printing a Unified Timetable + Draw + Race Columns Table
- **Where:**
  - `web/src/pages/eventTools/PrintEventPage.tsx` (Lines 85–120)
- **What happens:**
  - `PrintEventPage.tsx` (`Draw`) prints `Lane | Team | Club | Races` with all race names jammed into one comma-separated cell and no columns for scoring, while `ScoreSheets` prints each heat on a separate page break.
- **Fix:**
  - Combine the printed Draw and Score Sheet table so `Draw` (and `ScoreSheets`) renders the unified table with **Session & Heat Start Time**, **Lane**, **Team**, **Club**, **Bib**, and individual columns for **`1. Race 1` … `N. Race N` + `Total`**.

### BUG-47 — Missing Post-Final Prize Giving View (Ordered Last-to-First with Riders, Ponies & `"Trained by"`) on `ToplistView.tsx` & `SessionEndTransition.tsx`
- **Where:**
  - `web/src/pages/competition/ToplistView.tsx` (Lines 157–194)
  - `web/src/pages/competition/SessionEndTransition.tsx` (Lines 110–190)
- **What happens:**
  - Prize giving takes place immediately after each Final (`C Final`, `B Final`, `A Final`) and is announced in **reverse order (last place to 1st place)** with each team's **Riders, Ponies, and `"Trained by <Trainer>"`**.
  - Currently `ToplistView.tsx` (`FinalsList`) only shows `1st → 6th` with team names and points (no riders, ponies, or trainer), and `SessionEndTransition.tsx` shows no prize-giving readout when a Final finishes.
- **Fix:**
  - Add a **Prize Giving (Last to First)** toggle/panel on `ToplistView.tsx` (`FinalsList`) and `SessionEndTransition.tsx` that displays each Final's results from **last place up to 1st place**, including **Team Name, Club, `"Trained by <Trainer>"`, and each Rider + Pony** from the team's declaration.

### BUG-48 — `defaultRaces.ts` Gives `Under 10` and `Under 12` Sections the Seniors Race List Instead of the Juniors Race List, and Gives `Individual` (`format === 3`) Sections Team-Only Games
- **Where:**
  - `web/src/lib/defaultRaces.ts` (Lines 32–37)
  - `web/src/pages/admin/RaceListDialog.tsx` (Lines 46–66)
- **What happens:**
  1. `defaultRaceList` checks `const junior = /junior|novice/i.test(ageGroup);`. When an organiser picks the built-in presets `"Under 10"` or `"Under 12"` (`AGE_GROUP_PRESETS` in `creatorDraft.ts:7`), `junior` evaluates to `false` and `defaultRaceList` assigns the **Seniors** race list (`Big Sack`, `5 Mug`, full `Spell EGUK`) instead of the **Juniors** race list!
  2. When `format === 3` (`Individual`), `defaultRaceList` falls through to `ZONE_SENIORS` / `AREA_SENIORS`, which includes team-only games (`Big Sack`, `5 Mug`, `PGUK Pyramid`, `PGSports UK Shopping Spree`) that cannot be ridden by a solo Individual rider.
- **Fix:**
  - Match `Under 10` / `Under 12` (`/\b(junior|novice|(u|under\s*)(8|9|10|11|12))\b/i`) as `junior` in `defaultRaces.ts`, and provide an Individual-eligible default race list when `format === 3`.

### BUG-49 — `Season` Locks Each Season to a Single Age Group, Hides Per-Round Columns & Dropped Scores on `SeasonPage.tsx`, Ignores Most Round Wins (`1st` Places) on Ties in `SeasonStandingsCalculator.cs`, and Tracks Pairs by Team Instead of Individual Rider
- **Where:**
  - `api/Services/Seasons/SeasonStandingsCalculator.cs` (Lines 25–40)
  - `api/Services/Seasons/SeasonPublicationService.cs` (Lines 43–87)
  - `api/Controllers/SeasonsController.cs` (Lines 98–100, 124–125)
  - `web/src/pages/seasons/SeasonPage.tsx` (Lines 93–109)
  - `web/src/pages/seasons/SeasonSettingsForm.tsx` (Lines 85–96)
- **What happens:**
  1. `SeasonsController.AddRound` (`124-125`) rejects any competition section whose `AgeGroup` or `Format` differs from `season.AgeGroup` / `season.Format`, preventing a single Season from holding **all age groups** (with division/age-group tabs on `SeasonPage.tsx`).
  2. `SeasonStandingsCalculator.cs:26-28` orders teams only by `TotalPoints` then `TeamName`, failing to break Season point ties by **most round wins (`1st` places, `EventRank == 1`)**!
  3. `SeasonPage.tsx:101-107` only renders `Pos | Team | Rds | Pts` without showing each round's score column (`R1..RN`) or styling dropped rounds (`!r.counted` when `BestResultsToCount` is set) in grey/crossed-out.
  4. `SeasonSettingsForm.tsx` does not let the organiser select/add multiple competitions at once when creating a season, there is no per-competition points multiplier (`1×`, `1.5×`, `2×`), and `Pairs` season standings do not support tracking **Individual Riders** when pairs change partners across the season.
- **Fix:**
  - Allow a Season to include sections across **all age groups** (with an Age Group / Division tab switcher on `SeasonPage.tsx`), allow selecting multiple competitions at once when creating a season (plus adding rounds later or linking from the Competition Creator), support a round/competition points multiplier, display per-round columns on `SeasonPage.tsx` with dropped rounds crossed out/greyed, break Season ties by **most round wins (`EventRank == 1`)**, and track `Pairs` season points per **Individual Rider**.

### BUG-50 — `EntryPage.tsx`, `DetailsTab.tsx`, `SignupController.cs` & `MySignupsPage.tsx` Lack Step-2 Stabling Booking, Multi-Team Club Entry Stepper, Entries Closing Date, Waiting List When Full, Bank Transfer (`Mark as Paid`), and Pre-Draw Self-Withdrawal
- **Where:**
  - `web/src/pages/competition/EntryPage.tsx` & `web/src/pages/competition/DetailsTab.tsx`
  - `api/Controllers/SignupController.cs`
  - `web/src/pages/MySignupsPage.tsx`
- **What happens:**
  1. There is no `EntriesCloseAt` closing date check (after which public entries close while Admins can still key in late entries).
  2. Entering a team/rider does not have a **Step 2: Stabling & Extras** step (with **Number of Stables** and **Pony Club / Team Name** + organiser Stabling List).
  3. When a Club Manager enters `"Enter a team"`, they can only enter 1 team at a time instead of choosing **Number of teams (`1, 2, 3...`)** in one checkout.
  4. When a section reaches `MaxParticipants`, entrants are blocked with no **Waiting List** option.
  5. `MySignupsPage.tsx` has no **"Withdraw Entry"** button before the draw to free up a spot and notify the organiser for refund, and `SignupController.cs` has no BACS/Bank Transfer option with an organiser **"Mark as Paid"** button.
- **Fix:**
  - Add `EntriesCloseAt` support (allowing Admin late entry), a **Step 2 Stabling booking** (number of stables + Pony Club / Team name + organiser Stabling List), a **Multi-Team stepper (`1..N` teams)** for club managers, a **Section Waiting List** when full, **Card or Bank Transfer (BACS)** with Admin `"Mark as Paid"`, and a pre-draw **"Withdraw Entry"** button on `MySignupsPage.tsx`.

### BUG-51 — `DeclarationFormsController.Submit` Overwrites/Discards Multiple Horse Combos for the Same Rider (`s.FullName == r.FullName`), `ClubsController.SavedRiders` Blocks Self-Entered Riders (`Roles.Rider`), and Declarations Lack a Set Closing Time (`DeclarationsCloseAt`)
- **Where:**
  - `api/Controllers/DeclarationFormsController.cs` (Lines 145, 174–200)
  - `api/Controllers/ClubsController.cs` (Lines 30–40)
  - `web/src/pages/competition/decform/DecFormEditor.tsx`
- **What happens:**
  1. In `DeclarationFormsController.cs:174-176`, when saving declared riders to `SavedRiders`, it checks `s.ClubId == team.ClubId && s.FullName == r.FullName` without comparing `HorseName`, and uses `existing.HorseName ??= r.HorseName`! If a rider has 2 different ponies (e.g. one pony for Pairs and another for Individuals, or a spare pony), the second `(Rider + Horse)` combo is silently discarded instead of being saved as a separate selectable combo!
  2. `ClubsController.SavedRiders` (`[HttpGet("{id:int}/saved-riders")]`) is gated by `[Authorize(Roles = Roles.TeamWork)]`, blocking self-entered `Roles.Rider` accounts from loading their own saved rider+pony combos (`r.CreatedByUserId == uid`).
  3. Declarations do not have a configurable **set lock/closing time (`DeclarationsCloseAt`)**, and `DecFormEditor.tsx` only shows `r.fullName` in the saved-rider picker instead of `"{r.fullName} — {r.horseName}"`.
- **Fix:**
  - Match `SavedRiders` by `(ClubId, FullName, HorseName)` so one rider can save multiple distinct `(Rider + Horse)` combinations, display `"{fullName} — {horseName}"` in `DecFormEditor.tsx`, allow `[Authorize]` on `ClubsController.SavedRiders` (returning club roster for club trainers/managers and own saved combos for riders), auto-fill club default `BibColour` on new teams while allowing per-team override, and enforce an optional set `DeclarationsCloseAt` time.

### BUG-52 — `SessionPage.tsx`, `TimetableManagement.tsx` & `StructureStep.tsx` Lack Mid-Session Race Change/Cancel with Quick Announcement, Clear/Re-Run Race, `"Under Review"` Result Flag, 1-Tap Mark Team `HC`, Combined Section Heat Scoring Mode, Hold/Resume Time Delay, and Default Finalist Count / Max Lanes in Creator
- **Where:**
  - `web/src/pages/competition/SessionPage.tsx`
  - `web/src/pages/competition/TimetableManagement.tsx`
  - `web/src/pages/admin/creator/StructureStep.tsx` & `web/src/lib/creatorDraft.ts`
- **What happens:**
  1. In `StructureStep.tsx:48`, `finalistCount` defaults to `""` (`"Not set"`) instead of defaulting to the heat size (`maxTeamsPerHeat`), and `Max lanes` per heat/arena is not clearly labelled alongside `Max teams per heat`.
  2. On `SessionPage.tsx`, there is no quick button to **Change / Cancel a Race** across the session and simultaneously **post an Announcement** saying what the race is becoming; no 1-tap **"Clear / Re-run Race"** button when a race is stopped and re-run; no **"Under Review / Provisional"** flag next to an elimination/result; and no 1-tap option to switch a short-handed team to **Hors Concours (`HC`)**.
  3. There is no option to **Combine two small sections into one arena heat** (choosing between scoring within each section vs across the combined heat), and no **"Hold / Delay — We will continue at HH:MM"** control that lets the organiser set a custom resume time and post an announcement.
- **Fix:**
  - Default `finalistCount` to heat size and expose `Max lanes` clearly in `StructureStep.tsx`; add Mid-Session **Change/Cancel Race + Quick Announcement**, **Clear / Re-run Race**, **"Under Review" flag**, and **Mark Team HC** on `SessionPage.tsx`; and add **Hold / Set Resume Time** + **Combine Small Sections Into One Heat** (with section-relative vs combined scoring option) on `TimetableManagement.tsx` / `SessionsController.cs`.

### BUG-53 — `TopBarTicker.tsx` / `ticker.ts`, `NotificationScheduler.cs` / `ScoringService.cs`, `StatsService.cs` / `StatsPage.tsx`, `RiderPrivacyFields.tsx`, `CompetitionPicker.tsx`, `DashboardPage.tsx`, `ChatTab.tsx`, and `RaceRulesButton.tsx` Gaps (`#32–#40`)
- **Where:**
  - `web/src/components/BottomTabs.tsx`
  - `web/src/components/TopBarTicker.tsx` & `web/src/lib/ticker.ts`
  - `api/Services/NotificationScheduler.cs`, `api/Services/ScoringService.cs`, `api/Controllers/CompetitionsController.cs`, `api/Controllers/SessionsController.cs`
  - `api/Services/Stats/StatsService.cs`, `api/Dtos/StatsDtos.cs`, `web/src/pages/stats/StatsPage.tsx`
  - `web/src/components/RiderPrivacyFields.tsx` & `web/src/pages/competition/decform/DecFormEditor.tsx`
  - `web/src/competition/CompetitionPicker.tsx`
  - `web/src/pages/DashboardPage.tsx`
  - `web/src/pages/competition/ChatTab.tsx`
  - `web/src/components/RaceRulesButton.tsx`
- **What happens:**
  1. **Top-Bar Ticker (`ticker.ts` / `TopBarTicker.tsx` — `#33`):** `raceName(row, ordinals)` omits the live race progress (`"Race X/Y"`), and when a new Organiser Announcement arrives, `TopBarTicker.tsx` rotates away after `4.5s` instead of flashing/holding the new announcement for **10 seconds** (`10_000 ms`).
  2. **Push Notifications (`NotificationScheduler.cs`, `ScoringService.cs`, `CompetitionsController.cs`, `SessionsController.cs` — `#34`):**
     - `(A)` `NotificationScheduler.cs` fires a generic session alert (`"1 hour to {s.Name}"`) instead of `"60 minutes until your heat"` with the team's heat and starting lane.
     - `(B)` Completing all races in a heat (`ScoringService.cs`) does not push `"Your heat's results are in (1st in Heat 2 — 38 pts)"` to the team's trainer/supporters.
     - `(C)` Publishing a finals draw (`PopulateFinals` / `RaceFinalService`) does not push `"Finals draw published — you are in the A Final, Lane 3"`.
     - `(D)` Updating a session delay (`SessionsController.cs`) or redraw does not push a `"Timetable delay / Redraw alert"`.
  3. **Rider & Pony Career Stats (`StatsService.cs`, `StatsDtos.cs`, `StatsPage.tsx` — `#35`):** `StatsProfileDto` is missing **(C) Season standings they are currently in** (`Seasons` list) and **(D) Clubs represented** (`Clubs` list on Rider/Pony profiles), and Rider/Pony names on team/declaration views do not link to `/stats/riders?name=...` or `/stats/ponies?name=...`.
  4. **Rider Consent Tick Box (`RiderPrivacyFields.tsx` — `#36`):** Renders two separate initial-only/no-filming checkboxes per rider instead of summing rider/media/terms agreement into **1 single `"I agree"` tick box**.
  5. **Past Competitions Archive Filters (`CompetitionPicker.tsx` — `#37`):** Only has a text search box (`Name or venue`); when viewing past competitions (`past === true`), it lacks filters for **Year (`2026`, `2025`...)**, **Country/Region**, and **"My Club / Competitions I rode in"**.
  6. **Dashboard (`DashboardPage.tsx` — `Me` tab — `#38`):** Places the event banner/jumps above `Needs you`, omits `"Pair-up request waiting"` from `Needs you`, omits the **Session name** and **Starting Lane (`Lane X`)** from `Your teams today`, and omits **Club Members (`/members`)** from `Shortcuts`.
  7. **Live Stream Page (`ChatTab.tsx` — `#39`):** Below the video player (`LiveVideo`), `ChatTab.tsx` only shows Announcements/Chat instead of showing the **Live Heat Score Table** for the heat currently in the arena with quick tabs to switch between **Live Heat Scores**, **Timetable**, **Toplist**, and **Announcements / Chat** without stopping the video.
  8. **Race Rules & Arena Setup Popup (`RaceRulesButton.tsx` — `#40`):** Does not include a structured **3-bullet "How to win / Common eliminations" summary** alongside `<RaceDiagram>` and equipment, and tapping a race name in `HeatScores.tsx` / `SessionPage.tsx` does not open the popup.
- **Fix:**
  - Keep `BottomTabs.tsx` to `Timetable · Toplists · Live & stream · Details` (no `Following` tab, `#32`); include `"Race X/Y"` in `ticker.ts` and hold/flash new announcements for `10s` in `TopBarTicker.tsx` (`#33`); wire all 4 push notifications `(A)–(D)` (`#34`); add `(C) Season standings` & `(D) Clubs` + clickable Rider/Pony links to `/stats` (`#35`); sum rider consent into 1 `"I agree"` tick box (`#36`); add Year, Region & `"My Club / I rode in"` filters to `CompetitionPicker.tsx` (`#37`); reorder `DashboardPage.tsx` into `(1) Action items → (2) Today's upcoming heats (with session, heat & starting lane) → (3) Quick links (My Teams, My Signups, Dec Forms, Club Members)` (`#38`); add the tabbed `Live Heat Score Table · Timetable · Toplist · Announcements` view below the video player on `ChatTab.tsx` (`#39`); and add the 3-bullet `"How to win / Common eliminations"` summary + clickable race names to `RaceRulesButton.tsx` (`#40`).

