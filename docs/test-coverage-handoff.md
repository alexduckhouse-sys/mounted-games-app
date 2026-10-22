# Test coverage handoff (updated 22 October 2026)

First written on 16 October for the API suite. On 22 October the early web coverage notes (`test-coverage.md`) were folded in and that file was deleted. For how to write and run tests, use `tests/CLAUDE.md` (API) and `web/CLAUDE.md` (web).

## Status

- **API: done.** PR #21 added the xUnit integration suite in `tests/MountedGames.Api.Tests` (`WebApplicationFactory`, one throwaway SQLite file per test class). It has grown since with each feature. Line coverage was 98.7% at the time, excluding EF migrations and generated code.
- **Web: done for the logic layer.** Two suites run under `npm test` in `web/`:
  - Vitest with jsdom and Testing Library (`src/**/*.test.{ts,tsx}`, added in #24). `npm run test:coverage` enforces 97% for lines, statements, branches and functions on `api.ts`, `pwa.ts`, `lib`, `auth`, `theme`, `competition`, `live`, `hooks`, `lite`, `offline`, `weather` and shared `components`. The exclusions (route pages, `AppShell`, `DiagramEditor`, `RaceDiagram`, bootstrap and service worker) and the reason for each are listed in `web/vitest.config.ts`.
  - The older `node --test` suite in `web/tests/*.test.mjs`, covering the helper modules (preferences, bib and section display, CSV, timetable dates and rows, connection recovery, public-cache policy, weather caching and more). `npm run test:coverage:unit` measures the modules listed in `web/scripts/unit-coverage.mjs` against 97%, with files nobody imports still counted. It needs a Node that supports `--test-coverage-include-all` (first verified on Node 26.10).
- **CI** (`.github/workflows/ci.yml`): the API job runs the tests with a 95% line-coverage gate (`scripts/api-coverage.py`) and a Redis service for the `[RedisFact]` tests. The web job runs `npm run lint`, the `node --test` suite, `npm run test:coverage` and `npm run build`.

## Running the API coverage

```sh
dotnet test tests/MountedGames.Api.Tests --collect:"XPlat Code Coverage" --results-directory /tmp/cov
python3 scripts/api-coverage.py /tmp/cov/*/coverage.cobertura.xml --files --missed
```

## Not covered

- `Program.cs` `--migrate-database` and `--seed-review-competitions` branches, and the Postgres path in `DatabaseConfiguration` (need a real Postgres; `npm run test:neon` at the repo root runs the API against a Neon test branch).
- A few unreachable closing braces (for example in `WeatherController`).
- Route pages under `web/src/pages/` are outside the web coverage figure on purpose (see above).
- **No browser tests.** Phone navigation, offline reloads, reconnection and interrupted score submissions are only covered by unit and integration tests with the browser APIs mocked. Browser tests would need a working browser and local web and API servers.

## Production changes made for testability

- `NotificationScheduler`: start-up delay and interval are optional constructor parameters (defaults unchanged); `TickAsync` is `internal`, with `InternalsVisibleTo` for the test project.

## Test-quality notes

- A one-off mutation check (14 October) broke one behaviour in each of the ten `node --test` helper modules in temporary copies, and every change made an assertion fail. It is a small sensitivity check, not a mutation score.
- Fixtures use invented data. Clocks, transport calls and browser download APIs are controlled at the external boundary (`ManualTimeProvider`, `StubHttp`).
- Some UI tests take 6-8 s on a busy machine; the Vitest timeout is 15 s for that reason.

## Suspected bugs (found while testing)

Status as of 16 October 2026: 1, 2 and 5 fixed in #23; 3 matches `APP_DESIGN.md` and is left as is; 4 is handled by #20.

1. **`GenerateRaceFinals` returns 500.** `SessionsController` (around line 130): `s.Heats.Max(h => h.RaceRoundId ?? 0)` throws on an empty sequence when `ReplaceExisting=false` and the session has no heats. Reproduced. Fix: `.DefaultIfEmpty(0).Max()`.
2. **Equipment templates can be missed.** `EquipmentCalculator` looks up templates with a case-sensitive SQL `IN` but builds a case-insensitive dictionary from the result, so a race named "bending" won't find the template "Bending" and its equipment is silently left out. Found by reading the code, not reproduced.
3. **Scoring edge cases.** `ScoringService` gives tied places the same points and does not check `IsHorsConcours`, so hors concours teams still get stored points (only the standings queries filter them). May be intended; needs a decision.
4. **No ownership check on competitions.** Any Trainer or Manager can update, add sections to, lock signups on, or create teams for any competition; only the role is checked.
5. **Missing section gives 500, not 400.** In `CreateFinals` and `ScaffoldFinals`, a non-existent `competitionSectionId` makes the session insert fail the foreign-key check.

## Unreachable code the agents noted

- Removed on 22 October: the blank-suffix branch in `TeamsController.Update` and the empty-string guard in `GeocodingService.ResolvePostcodeAsync`.
- Still there: the unauthorised early returns in `TeamsController.MyTeams` and `LoadTeamForTrainerAsync`. They are being rewritten for the Team Manager role, so leave them for that work.
