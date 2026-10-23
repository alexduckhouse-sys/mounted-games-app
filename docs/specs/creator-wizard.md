# Competition creator wizard

Status: built on `feat/creator-wizard`. Finding from the live walkthrough: "Create competition doesn't work as it should with the time per section, sessions per section and other things like HHF, and race selection. It should all be done in the competition creator, although things like races and exact timetables don't need to be made until the day."

## Goal

Everything structural is decided when the competition is created: age groups, formats, sessions, heat size, minutes, heat-heat-final (HHF), finalists and (optionally) the races. The competition then has a **provisional timetable** from the moment it exists. What can only be known on the day (who is in which team, exact heats and times) is done on the renamed **On the day** page, which no longer edits structure.

## The wizard

`/admin/competitions/new` and `/admin/competitions/:id` (edit) show the same stepped form. One step per screen on a phone, with a step indicator ("Step 3 of 7"), Back and Next, and per-step validation (Next is refused with the problems shown). On a laptop the steps are a side list. Drafts persist in local storage as before (`competitionEditor:new`, `competitionEditor:edit:<id>`), including the current step.

| # | Step | Fields |
|---|------|--------|
| 1 | About | name, icon, organiser |
| 2 | When & where | start and end date and time, venue, postcode, what3words |
| 3 | Sections | per age group: age group (presets or "Type your own…"), format (Pairs, Teams, Individual), price, max entries |
| 4 | Structure & timing | per section: standard or heat-heat-final, number of sessions (one for HHF), teams through to the final, run-off race; minutes per race, max teams per heat, arena |
| 4b | Hatbands | in the Structure step: a hatband colour for each lane (as many lanes as the biggest heat), default order red, white, blue, yellow, green, black; pick from the list or type your own. Shown on the review step and the On the day page |
| 5 | Races | per session: pick from the standard lists or the race library, or skip and leave it for later |
| 6 | Payment & notes | where fees go, notes for riders, terms (its own component, `PaymentNotesStep`, so the club payouts change merges easily) |
| 7 | Review | summary, estimated timetable marked "Provisional", breaks and briefings, warnings |
| 8 | Create | the button on the review step ("Create competition" / "Save changes") |

In edit mode any step can be opened from the list. In create mode steps already reached can be revisited.

### Names

A section's name follows one rule everywhere: the age group (a plural word such as Juniors made singular), then the format in the plural: "Junior Individuals", "Novice Pairs", "Open Teams", "Under 12 Teams". The API builds it (`SectionNaming`) when a section is created or saved, and `sectionDisplayName` in `web/src/lib/section.ts` mirrors it. Older stored names are brought in line by `DbInitializer.NormaliseSectionNamesAsync` at start-up (idempotent, only rows that differ; no schema change). `displaySectionName` (used to show a name) turns a legacy "Teams Under 12" or "Individual Juniors" into "Under 12 Teams" / "Junior Individuals", and no longer drops the word "Teams".

### Timing

"Minutes per race" is what the timetable has always meant by `Session.MinutesPerHeat`: a heat runs every race in the list, so a heat takes that many minutes times the number of races. The wizard says so. Default 10, as on the old Format page. Heat size (`Session.LanesPerHeat`) defaults to 6 (4 for pairs).

## Provisional timetable

**Stored as real sessions.** Creating (or saving) the competition creates one `Session` of kind Race per planned session, with `CompetitionSectionId`, name, arena, `LanesPerHeat`, `MinutesPerHeat`, `PlannedRaces`, and an estimated `ScheduledStart` and `DurationMinutes`. No heats exist yet. A race session with no heats **is** the provisional timetable: the existing timetable already shows such a session as "Heats to follow".

**How it is computed** (`web/src/lib/creatorPlan.ts`, on top of `planTimetable` in `formatPlan.ts`):

1. Teams per section: the real count when teams exist; otherwise `ceil(max entries / riders per team)` (4 for teams, 2 for pairs, 1 for individuals); otherwise a guess (6 teams, 8 pairs, 12 individuals).
2. Heats: `heatSizes(teams, max teams per heat)`, the same split the server uses.
3. Minutes: heats × races × minutes per race. Races is the planned list, or the standard list's length when races are skipped. HHF: each race is a qualifier pair and a final, so 3 × races × minutes.
4. Each arena runs on its own clock from the event start, sessions follow in order with a 10 minute gap, and nothing overlaps a break or briefing (the session moves to when it ends).
5. The review step warns when the last session ends after the event's end time.

**Breaks and briefings** are ordinary `Session` rows (kind Break or Briefing, a start and a length, one arena or all). They are added on the review step (and on the On the day page) and are placed first; sessions work around them. Generating the exact timetable does not touch them: it only sets start times on race sessions, again planned around the same breaks. A test covers this.

**Exact timetable.** Once teams are formed and races are set, "Generate" on the On the day page creates heats (`generate-heats`, or `generate-race-finals` for HHF sections) from the planned races and sets real start times. From then on the session has heats and is no longer provisional.

**Visibility.** The provisional rows (race sessions with no heats) are shown to organisers (`canOrganise`), on the review step and on the On the day page only. The public timetable (`TimetableBoard`) hides them until heats exist; the tab-level gating of the public page is done separately by the entry-first competition page work. Competition summaries gain `HeatedSessionCount`; the admin stage uses it, so a competition with only provisional sessions is still "Entries open", not "Ready to run".

## Data and API changes

- `Session.PlannedRaces` (nullable JSON array of names, `TEXT`): the race list chosen before heats exist. `SessionDto.PlannedRaces`. `Competition.LaneHatbands` (nullable JSON array of colour names, index 0 is lane 1; `CompetitionDetail.laneHatbands`). **One migration**, `AddCreatorWizardColumns` (both columns), with its idempotent SQL script and SQLite guards in `DbInitializer` (`EnsureColumnAsync`).
- `CreateSessionRequest` gains optional `LanesPerHeat`, `MinutesPerHeat`, `PlannedRaces`. `UpdateSessionRequest` gains optional `LanesPerHeat`, `MinutesPerHeat`, `DurationMinutes` (heatless sessions only), `PlannedRaces`.
- `CompetitionSummary.HeatedSessionCount`.
- Section names: `SectionNaming`; `AddSection` ignores a client-sent name when there is an age group; `UpdateSection` re-applies the rule.
- Locks: changing `LanesPerHeat` or `PlannedRaces` on a session that has started or has a completed race is refused with 409, and so is deleting it (before, a delete took the results with it). Minutes, name, arena and start time stay editable on the day.

## Editing an existing competition

- Details and price, cap, finalists, run-off, HHF are saved as before.
- Format and age group of a saved section are fixed (changing them would change what entrants entered). A section with entries or teams can't be removed; one without can. Removal is admin-only on the server, and a refusal is shown instead of being swallowed.
- Sessions are matched by id: existing ones are updated, new ones created, extra ones removed only when they have no heats and no scores. A session that has heats or scores is shown read-only (its races and heat size come from the heats), with a note.
- Teams, signups, heats and results are never touched by the wizard. Provisional start times are only rewritten for sessions without heats.
- Competitions created before this change have no `PlannedRaces`: they open in the wizard with races shown as "set when heats are made", and run as before.

## On the day page

`/admin/competitions/:id/format` keeps its route (links and bookmarks) but is titled **On the day** and links read "On the day". It keeps: close signups, form teams, final race lists (editing a session's races, from the planned list), the exact timetable (preview and generate) and breaks and briefings (add and remove). It no longer edits structure: no sessions, HHF, finalists, minutes or arena per section. Those link to the wizard ("Change structure").

## Edge cases

- No sections yet: step 3 needs at least one.
- Free-text age group that duplicates another section of the same format: refused on that step.
- HHF forces one session.
- A paid or pending signup exists: the section's price and cap can still change (the server refuses new entries once the cap is reached, and lowering it never removes entries).
- Clearing the cap on an existing section sends `0`, which the API reads as "no cap" (an omitted value would leave the old cap).
- Offline: creation is several calls; a failure part way keeps the draft and says what was done, and a retry in edit mode picks up from there (the competition then exists).
