# Test coverage

The target is at least 97% coverage of the frontend and API. That target has **not** been reached or measured across the whole app.

## What runs now

From the repository root:

```sh
npm test --prefix web
npm run test:coverage:unit --prefix web
```

The test suite uses Node's built-in runner. The coverage command requires a Node version supporting `--test-coverage-include-all`; it has been verified on Node 26.10. No packages were installed for this work.

There are 60 passing tests. The coverage command measures ten explicitly listed helper modules and enforces aggregate minimums of 97% for lines, branches and functions. Files in that scope remain in the report even if no test imports them. It currently reports:

| Measurement | Covered |
| --- | ---: |
| Lines | 100% |
| Branches | 99.20% |
| Functions | 100% |

These numbers apply only to competition preferences, bib and section display helpers, CSV exports, timetable dates and calculations, timetable rows, connection recovery, public-cache policy and weather-request caching. They do not describe React component coverage or backend coverage. The exact file list is in `web/scripts/unit-coverage.mjs`.

The tests exercise delayed and early starts, pinned heats, duration precedence, invalid preferences, CSV escaping and download cleanup, retry backoff, concurrent reconnect requests, disposal during a connection attempt, failed cleanup, cache expiry and cache eviction. Fixtures use invented data. Clocks, transport calls and browser download APIs are controlled at their external boundaries.

A one-off mutation check in temporary copies deliberately broke one behaviour in each of the ten modules. All ten changes caused assertion failures. The real source files were not changed by that check. This is a small check of test sensitivity, not a full mutation score or proof that the code has no bugs.

## Remaining work for the whole-app target

1. Install the frontend dependencies and a React test environment. Package installation has been authorised. The app dependencies now install, but the React test environment still needs to be added. Add component and integration tests for competition selection, cookie consent, routing, mobile navigation, timetable links, theme selection, loading/error states, authentication and scoring. Measure all runtime frontend source, including files that no test imports.
2. Restore the API dependencies and add a .NET test project with a coverage collector. Cover authentication and role checks, scoring, competition generation, data access, endpoint validation and failure paths. Use an isolated test database containing invented data.
3. Add browser tests for phone navigation, offline reloads, reconnection and interrupted score submissions. These need a working browser and local frontend/API services.
4. Enforce the 97% target for the frontend and API separately, including branch coverage, once both full reports are available. Any exclusions must be limited to generated or type-only code and documented explicitly.

Build verification was initially blocked by missing dependencies. See the 14 October verification below for the latest results. The existing Node tests also run without those dependencies. No CI settings were changed for this testing work.

## Installation attempt after approval

Package installation was authorised on 12 October 2026. The attempts failed before a runnable frontend or API test environment was available:

- `npm ci` failed with `ENOTFOUND registry.npmjs.org`.
- `dotnet restore` failed with `NU1301`: `api.nuget.org` could not be resolved.
- An isolated offline React test-tool installation also failed: cached tarballs were present, but required registry metadata was missing (`ENOTCACHED`). The app's locked dependency versions were not replaced with cached alternatives.
- No existing frontend `node_modules` directory or NuGet package cache was available in the main checkout/user package location checked.

No further installation approval is needed. These installation failures were resolved on 14 October; the full frontend/API coverage work above remains outstanding. No full-app coverage percentage can be reported yet.

## Verification on 14 October 2026

Network access is restored. `npm ci` installed the locked frontend dependencies. `npm run build --prefix web` passed, including TypeScript and the production service worker. The 60 tests and helper coverage threshold check passed again.

`dotnet build api/MountedGames.Api.csproj --no-restore` passed after dependency restoration, with three warnings: two existing dependency vulnerability warnings (Microsoft.OpenApi and SQLitePCLRaw.lib.e_sqlite3), and the existing interpolated schema SQL warning in DbInitializer. The stricter `-warnaserror` command failed on the dependency warnings. Those dependency versions and the schema helper were unchanged by this work.

Frontend lint is not clean: 46 errors and seven warnings, compared with 41 errors and ten warnings on the starting commit using the same installed toolchain. Added reports concern synchronous state updates in effects in the picker, preference storage, forecast chips and competition loading. This result is recorded as a failure, not a passed check. Browser/phone visual checks and full-app coverage remain outstanding.
