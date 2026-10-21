# API tests — agent guide

xUnit 2 integration tests for `api/`, in `MountedGames.Api.Tests/`. They boot the real app through `WebApplicationFactory<Program>` and call it over HTTP or SignalR. Folders mirror API areas (`Scoring/`, `Streaming/`, `Seasons/`…); shared helpers live in `Infrastructure/`. Web tests are separate: see `web/CLAUDE.md`.

## Commands (repo root)

| Task | Command |
| --- | --- |
| All API tests | `dotnet test tests/MountedGames.Api.Tests` |
| One class or test | `dotnet test tests/MountedGames.Api.Tests --filter "FullyQualifiedName~SeasonsEndpointsTests"` (or `~ClassName.MethodName`) |
| Coverage, as CI runs it | `dotnet test tests/MountedGames.Api.Tests --collect:"XPlat Code Coverage" --results-directory /tmp/cov` then `python3 scripts/api-coverage.py /tmp/cov/*/coverage.cobertura.xml --files --min 95` |

CI (`.github/workflows/ci.yml`) fails below **95% API line coverage**. `scripts/api-coverage.py` skips `obj/` and `Migrations/`; `--files` lists each file's uncovered lines. New API code needs tests in the same PR.

## Writing a test

- Shape: `public class FooEndpointsTests : IClassFixture<ApiFactory>`, take the factory in the constructor, `[Fact]` async methods. Copy `Seasons/SeasonsEndpointsTests.cs`.
- **One database per test class, shared by its tests**, and xUnit can run them in any order. Create your own competition/section/team rather than relying on seeded rows or another test's writes; use unique names (`Guid.NewGuid()`).
- The host runs as environment `Testing`: demo data is seeded by `ApiFactory.CreateHost`, the seeded admin's password login is refused (use the admin key), rate limits are raised to 100000/min, and `NotificationScheduler` and `StreamSweeper` are removed.
- Never make real network calls. All `IHttpClientFactory` traffic goes to `_f.Http` (`StubHttp`): `RespondJson(urlFragment, json)`, `Respond(...)`, `Throw(...)`, `Requests` to assert calls.

## Helpers (`Infrastructure/`)

| Need | Use |
| --- | --- |
| Signed-in clients | `await _f.AdminAsync()`, `_f.TrainerAsync()` (seeded `trainer@mg.local`), `_f.SignupAsync("Member")` (pending user), `_f.ApprovedTrainerAsync()`, `_f.WithToken(token)`; anonymous is `_f.CreateClient()` (`TestClients.cs`) |
| Read JSON | `await response.ReadAsync<TDto>()` (web defaults, matches the API) |
| Arrange or assert in the DB | `_f.InDbAsync(db => …)` / `_f.WithDbAsync(...)` (`DbArrange.cs`, `ArenaFixtures.cs`) |
| Fresh data | `NewSectionAsync`, `SeedCompetitionAsync`, `SeedSectionAsync`, `SeedClubAsync`, `SeedTeamAsync`, `SeedScoredRaceAsync` (`CompetitionsTestData.cs`) |
| A scoring arena | `CreateArenaAsync(teamCount, raceFinals)` returns competition, section, session and team ids; `AddHeatAsync(...)` adds a heat with races |
| Visitor IP (IP blocks, rate limits) | send the `X-Test-Ip` header (`TestIpStartupFilter`) |
| SignalR | build a `HubConnection` to `_f.Server.BaseAddress + "/hubs/live"` with `HttpMessageHandlerFactory = _ => _f.Server.CreateHandler()` (`Hubs/LiveHubTests.cs`) |
| Streaming (Cloudflare SFU) | `StreamingApiFactory`: fake SFU (`SfuRequests`, `FailPath`), `ManualTimeProvider Clock` (call `Advance`, never sleep), `StartAsync`/`ReadyAsync`/`ConnectAsync` |
| Production-like SPA host | `SpaApiFactory` (Development environment, `wwwroot` shell, nested SQLite folder) |

## Rules

- Cover authorisation for new endpoints: anonymous → 401, wrong role → 403, another trainer's competition → **404** (`[CompetitionAccess]` hides it), owner/admin → success (as `SeasonWrites_RequireOrganiserRole` does).
- A schema change needs a `*SchemaTests` case (see `Seasons/SeasonsSchemaTests.cs`) proving `DbInitializer` upgrades an existing SQLite file without losing data.
- `SecurityTests.cs` compares the API's security headers with `web/vercel.json`. If it fails, change both files rather than the test.
- Streaming code takes `TimeProvider`; drive it with `ManualTimeProvider` instead of `Task.Delay`. Give new timer-driven code the same treatment.
- Tests run on SQLite only. Postgres-specific SQL in migration scripts isn't covered here; `npm run test:neon` (root) runs the API against a real Neon branch; it needs `NEON_ENV_FILE` and refuses any branch not named `setup-verification-*`.
