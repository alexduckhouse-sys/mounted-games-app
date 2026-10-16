# Test coverage handoff (16 October 2026)

Companion to `test-coverage.md`, which predates the API suite described here.

## Status

- **API: done.** PR #21 added about 690 integration tests in `tests/MountedGames.Api.Tests` (xUnit, `WebApplicationFactory`, one throwaway SQLite file per test class). Line coverage is 98.7%, excluding EF migrations and generated code.
- **CI:** `.github/workflows/ci.yml` runs the API tests with a 95% line-coverage gate (`scripts/api-coverage.py`), plus web `npm test` and `npm run build`. Lint is deliberately not in CI: `npm run lint` already reports 46 errors on `main`.
- **Web: not done.** `main` has a `node --test` suite covering 10 helper modules at 97%. The decision was to add Vitest, Testing Library and jsdom alongside it and reach 97% on the logic layer (`lib`, `api.ts`, `auth`, `theme`, `competition`, `live`, `hooks`, `offline`, `weather`, small components). The large pages (`SessionPage`, `SessionsTab`, `CompetitionEditor` and similar) stay out of the figure, and the exclusions must be listed in the coverage config. An agent started this but stopped before committing anything, so it needs restarting. Keep the existing `node --test` suite working, and make `npm test` run both.

## Running the API coverage

```sh
dotnet test tests/MountedGames.Api.Tests --collect:"XPlat Code Coverage" --results-directory /tmp/cov
python3 scripts/api-coverage.py /tmp/cov/*/coverage.cobertura.xml --files --missed
```

## Not covered

- `Program.cs` `--migrate-database` and `--seed-review-competitions` branches, and the Postgres path in `DatabaseConfiguration` (need a real Postgres).
- A few unreachable closing braces (for example in `WeatherController`).

## Production changes made for testability

- `NotificationScheduler`: start-up delay and interval are optional constructor parameters (defaults unchanged); `TickAsync` is `internal`, with `InternalsVisibleTo` for the test project.

## Suspected bugs (found while testing)

Status as of 16 October 2026: 1, 2 and 5 fixed in #23; 3 matches `APP_DESIGN.md` and is left as is; 4 is handled by #20. The web Vitest work is in #24, which also fixes the age-group menu highlight.

1. **`GenerateRaceFinals` returns 500.** `SessionsController` (around line 130): `s.Heats.Max(h => h.RaceRoundId ?? 0)` throws on an empty sequence when `ReplaceExisting=false` and the session has no heats. Reproduced. Fix: `.DefaultIfEmpty(0).Max()`.
2. **Equipment templates can be missed.** `EquipmentCalculator` looks up templates with a case-sensitive SQL `IN` but builds a case-insensitive dictionary from the result, so a race named "bending" won't find the template "Bending" and its equipment is silently left out. Found by reading the code, not reproduced.
3. **Scoring edge cases.** `ScoringService` gives tied places the same points and does not check `IsHorsConcours`, so hors concours teams still get stored points (only the standings queries filter them). May be intended; needs a decision.
4. **No ownership check on competitions.** Any Trainer or Manager can update, add sections to, lock signups on, or create teams for any competition; only the role is checked.
5. **Missing section gives 500, not 400.** In `CreateFinals` and `ScaffoldFinals`, a non-existent `competitionSectionId` makes the session insert fail the foreign-key check.

Unreachable code the agents noted (safe to tidy): the blank-suffix branch in `TeamsController.Update`; the unauthorised early returns in `MyTeams` and `LoadTeamForTrainerAsync`; the empty-string guard in `GeocodingService.ResolvePostcodeAsync`.
