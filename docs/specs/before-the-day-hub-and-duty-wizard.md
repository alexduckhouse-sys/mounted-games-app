# Before the day hub and heat duties wizard

Status: settled with the owner (28 October 2026). Part 1 is built and merged (#293). Part 2 is built: back end #289, web #299; they merge together after the Neon migration `20261028172958_AddHeatIdToVolunteerShift` has run.

## Why

- `/competitions/:id/operations` put 13 tools in a sideways-scrolling tab bar (Preparations, Draw, Entries, Protests, Scorers & team, Volunteers, Emergency contacts, Tack check, Passport check, Import teams, Print sheets, Results book, Duplicate event). It was clunky on a phone, and you had to scroll the bar to find most of them.
- It was hard to find. The only ways in were two rows near the bottom of the Details tab and the admin lists.
- Staff and volunteer duties were set up one shift at a time (`VolunteerRota`), with the steward and arena crew duties separate on each session page (`SessionDutyBoard`). There was no single pass that says "for each heat: which team is referee, starter, scorer, which lines need stewards".

## Part 1: the Before the day hub (built, #293)

One page, no tab bar, at the same URL (`/competitions/:id/operations`, `BeforeTheDayHub.tsx`).

- **Header:** title "Before the day", the competition name as the context line, Back to the event.
- **To sort:** one orange "N things to sort" line with a short summary ("31 dec forms missing · 31 teams short of riders · …"). Tapping it opens the existing Blocking publish / To sort rows in place. With nothing left it shows "Nothing to sort". The "Couldn't refresh" notice and Recheck stay.
- **Tiles** (option B on the Claude Design canvas "MG App organiser pages", artboard `Before-the-day-hub.dc.html`), each with an icon, a name and a one-line status, grouped:
  - **Set up:** Event details · Sections and races · Timetable and draw · Equipment · Sponsors and sharing · Rulebooks
  - **People:** Entries and dec forms · Import teams · Volunteers · Scorers and team · Emergency contacts
  - **On the day:** Tack check · Passport check · Protests · Print sheets · Results book
  - **Other:** Duplicate event (Admin and Trainer only)
  - Two columns on a phone, three at 1024px, four at 1280px. There's no list-and-detail desktop view.
- **Status lines** come only from data the page already loads (the competition and `/operations/readiness`, in `hubData.ts`); no extra fetch per tile.
- **Draw has no tile:** Timetable and draw already holds the draw. `operations/draw` still works for old links.
- **One page per tool:** `operations/<tool>` (`import`, `volunteers`, `scorers`, `safety`, `tack`, `passport`, `protests`, `print`, `results`, `duplicate`, `draw`, `entries`), each with a `RefineHeader` and Back to Before the day. `?tab=<view>` redirects (replace) to `operations/<view>`; `?tab=checks` and unknown values go to the hub.
- **Easier to find:** "Before the day" in the organiser's navigation drawer (`canOrganise`); the two Details rows merged into one; a "Before the day" row with the to-sort count at the top of the organiser's event home (`BeforeTheDayRow`) until any session has started.

Left as they are, for the owner to raise if wanted: the section headings keep the Refine `.rf-sec` line (design-decisions.md says small headings have none); the old Entries panel is reachable by link only.

## Part 2: Heat duties wizard (built, #289 and #299)

Reached from a "Heat duties" row at the top of the Volunteers page ("Not set up yet" / "34 of 36 heats filled"), at `/competitions/:id/operations/heat-duties` (Admin or Trainer, plus `canOrganise`). **Duties go to teams, not named people, and they're set per heat.** It builds on `VolunteerShift` (`AssignedTeamId`, `DutyCategory`, `LaneNumber`, attendance and check-in), so the rota, duty board, arena crew sheet and check-ins keep working. The volunteer rota (open slots anyone can take, such as gate or car parking) is unchanged.

### Rules (owner, 28 October 2026)

- A team **can't do a duty in a heat it rides in**. It **can** do one in another heat of the same session.
- A team has at most one duty per heat.
- **Arena party is normally the teams riding in that heat**, so it isn't assigned by default. An organiser can switch a heat to an assigned arena party. With two arenas, each arena's heat has its own.
- Named people (e.g. a named referee) are left out.

### Steps

Back and Next with a progress line, like the creator wizard. Nothing is saved to the server until step 3; the draft is kept on the device (`mg.draft.heatDuties.<id>`).

1. **Roles.** Switches and steppers for the roles a heat needs: Referee, Starter, Scorer, Start/finish line stewards (one per lane by default), Changeover stewards, Collecting ring, plus custom roles, and the arena party switch. This is the default for every heat. "Share duties out evenly" is an info row: the back end always does it.
2. **Heat by heat.** Sessions in running order, heats inside them as collapsed cards. Each heat lists its roles **as settings-style rows: the role on the left, the team on the right in muted text, and an empty duty shows an orange dot and "Choose"** (owner's pick; boxed team pickers and "team names first" were rejected). Tapping a row opens a team picker sheet; teams riding that heat can't be chosen, and a team already on duty in that heat is marked. A heat can add or remove its own duties, and "Same roles as Heat N" copies roles (not teams).
   - There's **no big fill button**. Each session has an **Auto** pill that opens a sheet: use teams from **This session** or **Other sessions** (session chips appear only after choosing Other sessions), **Only empty duties**, and **Not next to own heat**. A heat's own extra duties are left alone by the fill.
3. **Check.** Gaps and clashes first, then a grid per session (heats × roles) and each team's duty count. "Save duties" saves; if it would remove a duty a team has already checked in to, it asks first.

Running the wizard again only creates, changes or removes the duties that changed; it never duplicates.

### API (#289)

- `VolunteerShift.HeatId`: nullable, `ON DELETE CASCADE` (deleting or redrawing heats removes their duties rather than turning them into session-level shifts), indexed. Migration `20261028172958_AddHeatIdToVolunteerShift` with its idempotent script and SQLite guards.
- Shift create/update checks that the heat belongs to the competition and session, and rejects "{Team} rides in this heat." and "{Team} already has a duty in this heat."
- `PUT /api/competitions/{id}/heat-duties` saves the whole set-up as a diff. It returns `409` (`HeatDutiesConflictDto`) when it would remove a duty whose attendance is `Here` or `TeamSaysHere`, unless `confirmRemoveCheckedIn` is true.
- `POST /api/competitions/{id}/sessions/{sessionId}/heat-duties/auto-fill` returns a proposal only. Options: `teamSessionIds` (whose teams to use), `avoidNeighbouringHeats` (default on), `keepExisting` (only fill empty duties). It never picks a team riding the heat, gives at most one duty per team per heat, spreads duties across the whole competition (HC teams included), breaks ties by team id, and lists unfilled roles with a warning when there aren't enough teams.
- `POST /api/competitions/{id}/volunteer-shifts/{shiftId}/team-here`: anonymous, rate limited per IP (`RateLimits__TeamHerePerMinute`, default the writes limit). Sets `TeamSaysHere`, clears any missing-steward announcement for that duty, is idempotent and never downgrades a staff `Here`.

### Teams see their duties

- **Following tab:** a followed team's next heat duty shows as a light blue line in time order ("Heat 4: Changeover steward, lane 2"), with a **"We're here"** button. Anyone following the team can press it.
- **Duty board:** staff see it as "Team says here" (dashed blue pill), distinct from "Here" set by staff.
- **Push:** a reminder 15 minutes before the duty heat ("{Team}: {Role}, lane {N}, {Heat} around {HH:mm}.") to the team's accepted supporters and its trainer. It re-plans when timetable times move. There are no emails.

## Done when

- [x] `/operations` shows the grouped hub with no tab bar; every tool opens as its own page with Back to the hub; old `?tab=` links redirect (#293).
- [x] "Before the day" is in the organiser's drawer and on the event home before the event starts (#293).
- [ ] The wizard sets up a two-arena, three-session event's per-heat duties in one pass, no team gets a duty in a heat it rides, the result shows on the duty board, the arena crew sheet and each followed team's card, and running it again doesn't duplicate anything. Check on the live site after #289 and #299 merge.
- [x] Tests cover the own-heat rule, the overlap check, fair auto-fill and the diffing (API in #289; web `lib/heatDuties.ts` and `lib/followingDuties.ts` in #299).
- [ ] The UI checklist in `docs/designs/design-decisions.md` is ticked: #299 has every item but "Saving" (the wizard saves explicitly, as the owner's design shows).
- [ ] Native Welsh and French check of the new `ops.hub.*` and `duties` strings.
