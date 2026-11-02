# Handoff: duty wizard back end (API only)

For: Gemini (Antigravity). From: Claude, 28 October 2026. Back end only; Claude builds all the web UI.

## Read first

- `CLAUDE.md`, `api/CLAUDE.md`, `tests/CLAUDE.md` (repo rules, glossary, test helpers).
- The spec, Part 2: `docs/specs/before-the-day-hub-and-duty-wizard.md` on branch `docs/before-the-day-spec` (PR #274, not merged yet). Read it with `git show origin/docs/before-the-day-spec:docs/specs/before-the-day-hub-and-duty-wizard.md`.
- Existing code:
  - `api/Entities/Operations/VolunteerShift.cs`
  - `api/Controllers/VolunteerAndEmergencyController.cs`: shift CRUD, claims, `PUT volunteer-shifts/{id}/attendance`, `POST sessions/{sessionId}/duty-assignments` (today's per-session auto-assign of teams not riding), call-missing
  - `api/Services/Notifications/ReminderPlan.cs`: heat reminders to a team's accepted `TeamSupporters`
  - `NotificationScheduler.cs` and `PushNotifier.cs`

## Set-up

- Work in your own worktree from **origin/main**, not the local `main`, which is far behind and has uncommitted edits:
  `git -C /Users/alexd/dev/mounted-games-app worktree add -b feat/duty-wizard-backend /Users/alexd/dev/mounted-games-app/.claude/worktrees/feat-duty-wizard-backend origin/main`
- Don't edit anything under `web/`, apart from adding the new fields to `web/src/types.ts` (types only, matching the DTOs). Claude does the screens.
- Heavy commands one at a time (another agent may be building): run them as `lockf -k /private/tmp/claude-501/-Users-alexd-dev-mounted-games-app/61d46177-f8e7-403c-b1d9-cd4ad11fb3b4/scratchpad/heavy.lock nice -n 15 <cmd>`.
- Run targeted tests (`dotnet test tests/MountedGames.Api.Tests --filter ...`). CI runs the full suite and gates line coverage at 95%.
- Open a **draft** PR and don't merge. **Don't run the Neon migration**; the owner or Claude does that before merging.

## Rules (settled with the owner)

- Duties go to **teams**, per **heat**. Roles include Referee, Starter, Scorer, Start/finish line steward (per lane), Changeover steward (per lane), Collecting ring and custom roles.
- A team **can't** have a duty in a heat it rides in. It **can** in another heat of the same session.
- At most **one duty per team per heat**.
- Arena party is normally the teams riding the heat. Nothing is stored for that default. An organiser can still assign an arena-party team to a heat (`DutyCategory = "ArenaCrew"`).
- Session-level and whole-event shifts (`HeatId = null`) and the public volunteer rota keep working exactly as now.

## Jobs

1. **`HeatId` on `VolunteerShift`.** Add a nullable FK to `Heat` (delete behaviour: set null, or cascade; pick and say why) plus an index. A schema change needs all four parts:
   - the entity and `AppDbContext` config
   - an EF migration (`dotnet ef migrations add`; design time uses Npgsql)
   - an idempotent SQL script in `api/Data/Migrations/Scripts/` (`dotnet ef migrations script <previous> <new> --idempotent`)
   - a SQLite guard in `DbInitializer` (`EnsureColumnAsync`)

   Add `heatId` (and `heatLabel` for display) to the shift DTO and to create/update input. Validate that the heat belongs to the session and the competition.
2. **Validation on create/update** of a heat-level team shift. Reject a team that rides in that heat, or that already has a duty in that heat. Return 400 with a plain message, e.g. "Stockport A rides in this heat." Unit-test both.
3. **Save the whole set-up at once:** `PUT /api/competitions/{id}/heat-duties` (staff policy + `[CompetitionAccess]`).
   - The body is the full desired list for the given sessions: `{ sessionIds: [...], duties: [{ heatId, role, dutyCategory, laneNumber?, assignedTeamId }] }`.
   - Diff it against the existing heat-level shifts of those sessions: create, update and delete only what changed, and return the result.
   - If a delete would remove a shift that's checked in (`AttendanceStatus` "Here" or "TeamSaysHere"), answer 409 listing them, unless `confirmRemoveCheckedIn: true` is sent.
   - Saving the same list twice changes nothing.
4. **Auto-fill per heat:** `POST /api/competitions/{id}/sessions/{sessionId}/heat-duties/auto-fill`.
   - Body: the roles wanted per heat (`[{ role, dutyCategory, laneNumber? }]`) and optionally which heats.
   - Returns a **proposal** (it doesn't save) of team per heat per role.
   - The proposal never puts a team on a heat it rides in, and gives at most one duty per team per heat.
   - Spread duties fairly: fewest duties so far first, counting duties in the whole competition. Avoid the heat straight before or after a team's own heat where possible.
   - The result must be deterministic for the same input (stable tie-break by team id). HC teams count as teams.
   - If there aren't enough teams, leave the role empty and say so in the response.
5. **"Team says here":** `POST /api/competitions/{id}/volunteer-shifts/{shiftId}/team-here`.
   - Anonymous (anyone following the team can press it), so apply a per-IP rate limit (reuse the writes policy, or add one in `api/Security/`).
   - Only for heat-level shifts with an `AssignedTeamId`.
   - Sets `AttendanceStatus = "TeamSaysHere"`. `NormaliseAttendanceStatus` must accept that value, and it must not overwrite a staff "Here".
   - Idempotent. Broadcast the same update staff get today (check how attendance changes are pushed to `comp:{id}:admins`).
   - Record `CheckedInAt` but no user.
6. **Duty reminders (push).** In `ReminderPlan`, add a reminder for each heat-level team duty, e.g. 15 minutes before the heat's start: "Stockport A: Changeover steward, lane 2, Heat 4 around 14:20."
   - It goes to the team's accepted supporters, the same audience as heat reminders, plus the team's trainer if there is one.
   - Key it like `duty:{shiftId}` so timetable changes re-plan it.
   - Remember that the API scales to zero. Use the existing scheduler pattern and don't add new timers.

## Tests

xUnit through `ApiFactory`: migration/SQLite guard round trip, the validation rules, PUT diff (create, update, delete, idempotent, checked-in 409), auto-fill (rules, fairness, determinism, too few teams), team-here (anonymous, rate limit, doesn't overwrite staff, wrong shift kinds rejected) and reminder planning.

## Report back

PR URL; the endpoints with request/response shapes (Claude builds the screens from this); the migration name and script file; anything you couldn't do or changed from this brief; honest test results.
