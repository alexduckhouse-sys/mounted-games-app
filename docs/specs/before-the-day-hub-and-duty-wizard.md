# Before the day hub and staff & volunteers wizard

Status: draft for the owner's review (28 October 2026). Nothing is built yet.

## Why

- `/competitions/:id/operations` puts 13 tools in a sideways-scrolling tab bar (Preparations, Draw, Entries, Protests, Scorers & team, Volunteers, Emergency contacts, Tack check, Passport check, Import teams, Print sheets, Results book, Duplicate event). It's clunky on a phone, and you have to scroll the bar to find most of them.
- It's hard to find. The only ways in are two rows near the bottom of the Details tab ("Manage entries and equipment", "Operations, draw and tools") and the admin lists.
- Staff and volunteer duties are set up one shift at a time (`VolunteerRota`), with the steward and arena crew duties separate on each session page (`SessionDutyBoard`). There's no single pass that says "for each session: which team is on arena party, who's the referee, which lines need stewards".

## Part 1: the Before the day hub

One page, no tab bar. It replaces the tab bar on `/competitions/:id/operations` and keeps the URL.

- **Title:** "Before the day". The context line is the competition name; Back goes to the event.
- **Top: To sort.** The current Preparations "Blocking publish" and "To sort" rows, unchanged (counts, links, zero rows hidden).
- **Then grouped rows**, each a `rf-row` with a chevron that opens its own page:
  - **Set up:** Event details · Sections and races · Timetable and draw · Equipment · Sponsors and sharing · Rulebooks
  - **People:** Entries and dec forms · Import teams · Staff and volunteers (Part 2) · Scorers and team · Emergency contacts
  - **On the day:** Tack check · Passport check · Protests · Print sheets · Results book
  - **Other:** Duplicate event (Admin and Trainer only, as now)
- Each row can show a one-line status as `rf-t2` where we already have the data (e.g. "3 dec forms missing", "12 of 20 places taken"), plus the existing todo dot.
- **Sub-pages:** each tool that's now a tab becomes its own route under `operations/<tool>` (e.g. `operations/draw`, `operations/volunteers`), with a normal `RefineHeader` and Back to the hub. The old `?tab=` links redirect to the new routes so existing links and bookmarks keep working.
- **Desktop (≥1024px):** the hub list sits on the left and the chosen tool opens on the right. It's the same content, so nothing is duplicated.

### Easier to find

- The organiser's navigation drawer gets "Before the day" near the top for any competition they can organise (`canOrganise`).
- The organiser's event home shows a "Before the day" row with the to-sort count until the first session starts. After that it moves to the drawer only.
- The two Details tab rows become one: "Before the day".

## Part 2: Staff and volunteers wizard

A step-by-step set-up reached from "Staff and volunteers" on the hub. **Duties go to teams, not named people, and they're set per heat.** Each team in a heat's duty list gets a role for that heat. It builds on `VolunteerShift` (`AssignedTeamId`, `DutyCategory`, `LaneNumber`, attendance and check-in), so the rota, duty board, arena crew sheet and check-ins keep working.

**Schema change needed:** `VolunteerShift` has a `SessionId` but no heat. Add a nullable `HeatId` (entity, EF migration, idempotent SQL script, SQLite guard), keeping session-level and whole-event shifts as they are.

### Rules (owner, 28 October 2026)

- A team **can't do a duty in a heat it rides in**. It **can** do one in another heat of the same session.
- A team has at most one duty per heat; the wizard flags any overlap.
- **Arena party is normally the teams riding in that heat**, so it's not assigned by default. An organiser can switch a heat to "assigned arena party" and pick a team. With two arenas, each arena's heat has its own arena party.
- Named people (e.g. a named referee) are left out.

### Steps

Back and Next, a progress line at the top, and each step saves as you go, like the creator wizard.

1. **Roles per heat.** Tick the roles a heat needs, with a stepper where more than one is needed: Referee, Starter, Scorer, Start/finish line stewards (default one per lane), Changeover stewards, Collecting ring, plus "+ Add a role". Arena party shows as "Teams in the heat" unless switched. This sets the default for every heat; a heat can override it.
2. **Heat by heat.** Sessions in running order, heats inside them (breaks skipped). Each heat lists its roles, and each role gets a team. Teams riding in that heat can't be chosen ("Riding this heat"). A team already on a duty in that heat shows "Already on duty".
   - "**Fill automatically**" picks teams not riding that heat, spreading duties fairly (fewest duties so far first, and not back-to-back with their own heat where possible). This extends the existing `POST sessions/{id}/duty-assignments` to work per heat.
   - "**Same as previous heat**" copies roles, not teams (copying teams would usually break the rule).
3. **Check.** A grid of heats × roles with team names, where clashes and empty roles are highlighted, plus each team's duty count. "Done" saves and goes to the Staff and volunteers page.

Running the wizard again only creates, changes or removes the shifts that changed; it never duplicates. Removing a team that has already checked in asks for a confirm.

### Teams see their duties

- **Following tab:** a followed team's next duty shows next to its next heat ("Heat 4: Changeover steward, lane 2"), in the same card.
- **"We're here":** from that card, the team's people can confirm they're at their duty. This uses the existing attendance/check-in, so staff see it on the duty board as now.
- **Push notifications:** a push to followers of the team when its duty heat is next (the existing push scheduling), on the web PWA and the iPhone app once the iOS app ships its push support.
- The volunteer rota (open slots that anyone can take) stays as it is, for non-team jobs such as gate or car parking.

## Settled with the owner (28 October 2026)

- Build Part 1 (the hub) first, then Part 2.
- Duties go to teams, per heat. Roles include referee, starter and scorer. A team can't do a duty in a heat it rides, but can in its own session.
- Arena party is normally the teams riding in the heat; one per arena.
- Teams are told through the Following tab and push notifications; there are no emails.

## Still open

1. Who may press "We're here"? Following is anonymous (stored on the device). Suggested: anyone following can press it, but it shows as "Team says here" (not "Checked in by staff") and is rate limited, so staff can still check. The alternative is signed-in team members and trainers only.

## Done when

- `/operations` shows the grouped hub with no tab bar, and every tool opens as its own page with Back to the hub. Old `?tab=` links redirect.
- "Before the day" is in the organiser's drawer and on the event home before the event starts.
- The wizard can set up a two-arena, three-session event's per-heat referee, starter, scorer and steward duties in one pass. No team is given a duty in a heat it rides. The result shows correctly on the duty board, the arena crew sheet and each followed team's card, and running the wizard again doesn't duplicate anything.
- Tests cover the own-heat rule, the overlap check, fair auto-fill and the shift diffing (API and web).
- The UI checklist in `docs/designs/design-decisions.md` is ticked.
