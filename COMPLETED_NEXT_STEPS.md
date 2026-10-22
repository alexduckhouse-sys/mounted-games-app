# Completed next steps

Items moved here from `NEXT_STEPS.md` once their PR is merged into main and deployed. Newest first.

## 22 October 2026

### PR #81: rider clash warning and tidy-ups
- **Same-Rider Clash Readiness Warning (`CompetitionReadinessService.cs`)** (section 6). Declared riders are matched by name (case and spacing ignored). A rider in two different arenas at overlapping heat times shows under "Arena clashes" and blocks readiness. Reserves, trainers and pony names are ignored. Still to do: avoiding these clashes when auto-scheduling.
- **Unreachable code** (housekeeping). Removed the blank-suffix branch in `TeamsController.Update` and the empty-string guard in `GeocodingService.ResolvePostcodeAsync`.
- **Test coverage docs** (housekeeping). `docs/test-coverage.md` was folded into `docs/test-coverage-handoff.md`.
- The flaky `CommerceEndpointsTests.DemoDeclineReleasesStock_AndRetryCanSucceed` couldn't be reproduced under heavy load. It now reports the real response when it fails, but the cause isn't fixed.

### PR #80: finals seeding, standings by final tier, equipment and heat edits (closes #71; refs #68, #76)
- **Finals seeded in rank order** (bug 3, first part). `CreateFinals` puts ranks 1–n in the A Final, the next n in the B, and so on. Choosing the finals order and flagging boundary ties are still open (owned by fix/bugs-md).
- **Standings by final tier** (bug 9). Overall standings, the printable results and season publication sort A finalists, then B, then C, then non-finalists, with points deciding within each tier. `StandingRow.finalTier` is new.
- **Equipment** (bug 6). Poles, cones and tables take the largest single-race need in a session; items still add up.
- **Non-destructive heat edits** (bug 10). Only heats whose teams or lane order change are rewritten. Changing a signed-off heat is refused with a 409. Unlabelled heats match the editor's "Heat N". Editing lane numbers is still open.
- **Older age groups first in `AutoTimetable`** (section 6). Open/Senior, U18, U15, U14, U12, U10, then Lead Rein; unclassified sections go last.

### PR #79: multi-arena timing, arena picker and break arenas (issue #70)
- **Independent Arenas (`web/src/lib/time.ts`)** (section 6, bug 5). Delays now cascade per arena. A whole-event break or briefing takes the largest arena delay so far, but doesn't push the arenas back afterwards. A single-arena event behaves as before.
- **≥ 5 min threshold** (part of "Running Early & Cutting Breaks When Late"). The public timetable only shows "late" from 5 minutes. Still to do: running early, compressing breaks and live drift race by race.
- **Arena Selector for Breaks / Briefings (`TimetableManagement.tsx`)** (section 6, bug 5). There's an Arena dropdown (each arena or "All arenas") when the event has more than one arena.
- **Arena Pill Switcher on `ArenaPage.tsx`** (section 6, bug 5). A sticky arena bar remembers the choice per device and competition. Sessions with no arena show for every arena.
- Still open from bug 5: the same-arena filter in `SessionEndTransition.tsx`. It's in the scoring page PR, which isn't merged yet.

### PR #65: arena and lane on followed heats, follow a club, quick race rules
- **Show Arena & Starting Lane on `MyTeamsPage.tsx` & `FollowingTab.tsx`** (section 6). Every heat row now shows "Lane N", plus the arena name when the event runs more than one arena. This is the lane for the heat's first race, because lanes rotate.
- **"Follow Entire Club" on `FollowingTab.tsx`** (section 6). The team picker lists each club with "Follow club" / "Unfollow club", and search also matches club names. Follows are saved on the device, as before. A club that would take someone past the 100-team limit shows a message instead.
- **Quick Race Rules Modal on Race Views (#5)** (section 8). A new `RaceRulesButton` opens a sheet with the race's summary, diagram, rules and equipment. It appears beside each race in the new "Races in this heat" list under the heat score table. Not wired in yet: the scoring page (`SessionPage.tsx`) and the arena page (`ArenaPage.tsx`).
