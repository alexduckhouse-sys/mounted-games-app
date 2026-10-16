# Next steps (16 October 2026)

Pulled together from every chat in this project and a survey of all branches and worktrees. Replaces the scattered follow-ups in each chat. Update or delete items as they land.

## Where things stand

- **Merged and live:** PRs #1–#19, #21 and #22:
  - EGUK redesign
  - ticker, settings and age-group menu
  - timetable grouping and status dots
  - skeleton loading and saved copies
  - low-signal fixes and the offline score outbox
  - Neon move and the 8 demo competitions
  - API tests at 98.7% with a 95% CI gate
- **Open, ready once CI is green:**
  - #23: race-finals 500, equipment template case, section validation, garbled characters in the competition editor.
  - #24: web Vitest suite at 99.9% lines with a 97% CI gate, and the age-group menu highlight fix.
- **Open, blocked on you:** #20, the security hardening (see below).
- **Nothing else is unmerged.** All other branches are already in `main`, apart from:
  - the untracked design file `docs/designs/public-pages-proposal.html` in the main checkout;
  - a stale, superseded test attempt in the `aictl-3e053904` worktree.

## Needs you

1. **PR #20 deploy gate.** The code is reviewed and CI is green, but merging deploys an API that won't start until both of these are done:
   - Apply `api/Data/Migrations/Scripts/20261015220000_AddSavedRiderOwnership.sql` to the live Neon database. It adds one nullable column.
   - Check that Render has `Jwt__Key` (at least 32 bytes), `Admin__Key` (at least 20 bytes, if shared admin login is used) and `Database__SeedDemoData=false`.

   Then merge and check `/api/competitions` on the live site.
2. **PR #26 deploy gate (staff-only live feed).** Before merging, apply `api/Data/Migrations/Scripts/20261016162534_AddChatAdminOnly.sql` to Neon (one boolean column, default false); the API refuses to start with a pending migration.
3. **Official EGUK navy hex.** `#1e3466` is a guess.
4. **Decisions left open in chats:**
   - Remove the race clock? You said "there is no race clock", but it's still in the app.
   - Stream embeds: switch to "Tap to load the stream" with YouTube's no-cookie player, so no third-party cookies are set before consent?
   - Keep the colour key under the timetable dots?
   - Ticker: should a fresh announcement keep replacing the live heat for up to 15 minutes, or should "Now" stay on top?
   - Reseed the existing demo competitions with the 5–6 teams and 7–8 races layout?
   - Toplist before any scoring: show a dash instead of every team as joint 1st?
5. **Always-on host.** Render's free plan sleeps after 15 minutes, so the first visit takes about 50 seconds and live updates drop. The chats call this the biggest real-world delay.

## Features

- Low-signal follow-ups (`docs/connection-performance.md`):
  - SignalR reconnect, an offline pill and a polling fallback
  - weather fetched once per timetable, and a server-side weather cache
  - shop-image thumbnails
  - a spectator lite mode
  - a venue box / always-on host
- Heat page riders list. It's in the design but was skipped on request; revisit if wanted.
- Hide the old arena-setup / full-timetable link from public visitors.
- Put the cookie/storage policy wording in the repo (it only exists in the low-bandwidth chat). Add a privacy note covering chat IP storage, and a controller/contact.

## Bugs and tidy-ups

- Unreachable code noted by the test agents:
  - the blank-suffix branch in `TeamsController.Update`
  - the unauthorised early returns in `MyTeams` and `LoadTeamForTrainerAsync`
  - the empty-string guard in `GeocodingService.ResolvePostcodeAsync`
- Lint: about 46 existing errors on `main`. Clear them, then add `npm run lint` to CI.
- Scoring: tied places share points and HC teams keep stored points. This matches `APP_DESIGN.md`; change it only if the rules say otherwise.

## Testing

- Real phone on poor signal: the outbox, retries, and the conflict screen against a test competition (not a live one).
- Browser and phone check of the UI from the ticker/settings chat. Most of it was never seen in a browser.
- Uncovered API paths: `Program.cs` `--migrate-database` and `--seed-review-competitions`, and the Postgres path in `DatabaseConfiguration`. These need a Postgres in CI (a Neon branch or a service container).

## Security and dependencies

- After #20: browser checks of the CSP and headers on the live site, and the items still open in `docs/security-review.md`.
- Seven Tailwind 3 build-tool advisories. The fix is a breaking Tailwind 4 migration, so plan it as its own PR.
- NuGet warnings for `Microsoft.OpenApi` 2.0.0 and `SQLitePCLRaw.lib.e_sqlite3` 2.1.11 on `main`. #20 says it patches runtime dependencies, so recheck after it merges.

## Housekeeping

- Remove merged branches and worktrees. Every `aictl/*` except `f5c941a6`, the `worktree-agent-*` and `agent-*` worktrees, `aictl/verify`, and the merged `feat/*`, `docs/*` and `test/coverage` branches, local and on origin.
- Fast-forward the main checkout's local `main`, which is 64 commits behind. Commit or move `docs/designs/public-pages-proposal.html` first.
- `docs/test-coverage.md` predates both test suites. Fold it into `docs/test-coverage-handoff.md`, or replace it.
