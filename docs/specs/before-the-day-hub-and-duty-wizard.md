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

A step-by-step set-up reached from "Staff and volunteers" on the hub. It creates ordinary `VolunteerShift` rows through the existing API, so the rota, duty board, arena crew sheet and check-ins keep working as they do. No schema change is expected.

Steps (Back and Next, a progress line at the top, and each step saves as you go, like the creator wizard):

1. **Roles you need.** Tick the jobs this event uses, each with a stepper for how many per session: Referee, Arena party (a team or club), Start/finish line stewards (one per lane), Changeover stewards, Collecting ring, Tack steward, Gate, Scorer, First aid liaison, plus "+ Add a role". Defaults come from the current presets (`VOLUNTEER_ROLE_PRESETS`, `STEWARD_DUTY_ROLE_PRESETS`); lane counts come from each session's lanes.
2. **Session by session.** One card per race session in running order (breaks skipped), with the roles from step 1 as rows. For each row, choose:
   - **A team or club** ("Session 2 arena party: Stockport A"). Teams riding in that session are greyed out with "Riding this session".
   - **A named person** (an organiser, a competition-team member, or typed).
   - **Open to volunteers:** the slot appears on the public rota for people to take.
   - "**Fill the rest automatically**" uses the existing `POST sessions/{id}/duty-assignments` (non-riding teams) for the steward and arena crew rows.
   - "**Same as previous session**" copies the card above.
3. **Whole-event jobs.** Jobs that don't belong to a session (e.g. Gate, First aid liaison), set the same way.
4. **Check and share.** A summary table of sessions × roles showing who's on what, with any gaps highlighted. Then the "Ask for help" share text for open slots (the existing `unfilledShareText`) and "Done", which goes to the Staff and volunteers page.

After set-up, "Staff and volunteers" opens the current rota view (with each session's duties folded in) and an "Edit set-up" button that reopens the wizard with everything filled in. Running the wizard again changes existing shifts; it never duplicates them. A shift someone has already taken is never removed without a confirm that names them.

## Open questions for the owner

1. Is "Referee" a staff job you want listed here (a named person per session), or is it out of scope?
2. Should arena party be one team per session, or one per arena when a session uses two arenas?
3. Should named people get an email or notification when they're put on a duty, or is the rota enough?
4. Part 1 first, then Part 2? (Recommended: Part 1 is small and makes Part 2 easy to place.)

## Done when

- `/operations` shows the grouped hub with no tab bar, and every tool opens as its own page with Back to the hub. Old `?tab=` links redirect.
- "Before the day" is in the organiser's drawer and on the event home before the event starts.
- The wizard can set up a two-arena, three-session event's referee, arena party and line stewards in one pass. The result shows correctly on the rota, the session duty board and the arena crew sheet, and running the wizard again doesn't duplicate anything.
- The UI checklist in `docs/designs/design-decisions.md` is ticked, and tests cover the shift diffing (create, change or remove only what changed).
