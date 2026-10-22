# Next steps (22 October 2026)

The cross-chat to-do list. Update or delete items as they land.

## Where things stand

- **Merged:** PRs #1–#53. Since 21 October:
  - #38 live feed sign-in fix, #40 demo reseed, #41 lint in CI;
  - #43 and #47 API on Vercel;
  - low signal: #45 connection pill and adaptive checks, #48 fast first view, #46 server weather cache, #49 lite mode and lazy images, #52 CSP allows https images;
  - stream controls: #50 overlays (banners, strip, look, producer screen), #53 score cards with producer show, skip and edit.
- **Live API is confirmed:** the live headers show `cle1` in `x-vercel-id`, and the overlays, first-view and weather endpoints answer.
- **Hosting:** the website is on Vercel (project `mounted-games-app`, root `web/`). On 21 October the API moved from Render to its own Vercel project, `mounted-games-api`. It's a container built from `Dockerfile.vercel` at the repo root and runs in `cle1`, next to Neon in AWS us-east-2. The website rewrites `/api` there, and the live hub connects to it directly.
- **Database:** Neon. Every migration on main is applied, including `AddStreamOverlays` (21 Oct) and `AddOverlayLooks` (22 Oct), each with a `backup-pre-…` branch taken first. To reach Neon without the guarded env file: `npx neonctl connection-string --project-id wild-leaf-19597390`. On 21 October the live-video migration's history row was renamed from `20261016181150_AddLiveStreams` to `20261017070452_AddLiveStreams` to match main (the schema is identical); a backup of the history table is in `~/.config/mounted-games/backups/`.
- **Plans:** `docs/plans/stream-controls-and-low-signal.md`, with designs in `docs/designs/stream-controls-and-low-signal.html`.

## Needs you

1. **Delete Render** (the Vercel API is confirmed live): the `mounted-games-scoreboard` service, which is suspended. `render.yaml` can go at the same time.
2. **New sign-in keys.** The Vercel API uses new `Jwt__Key`, `Admin__Key` and `Security__ProxyKey` values (stored in `~/.config/mounted-games/fly-prod.env`, chmod 600). Organisers sign in with the new admin key, and everyone was signed out once. `MG_PROXY_KEY` on the website project holds the same value as `Security__ProxyKey`.
3. **Before the first real event: make the API safe to run as several instances.** Vercel scales containers out and to zero (after 5 minutes idle), and the API still assumes one long-running process:
   - Live updates: add a SignalR Redis backplane (Upstash via the Vercel Marketplace). Without it, a score saved on one instance doesn't reach phones connected to another.
   - Move live-video viewer tracking and the sign-in rate limits to Redis or the database.
   - Put the VAPID push keys in settings rather than `vapid-keys.json`; each instance currently makes its own, which breaks push.
   - `NotificationScheduler` and `StreamSweeper` are background timers and only run while an instance is up. Turn them into Vercel Cron jobs.
   - WebSocket connections end at the function's maximum duration; SignalR reconnects by itself.
   - Cold starts take a few seconds after 5 minutes idle.
4. **Live video (#30).** It stays hidden until it's configured:
   - Create a separate `mounted-games-prod` Cloudflare Realtime SFU app (the dev keys went through chat) and optionally a TURN key. Set `Streaming__Cloudflare__AppId`, `Streaming__Cloudflare__AppToken` and, optionally, `Streaming__Cloudflare__TurnKeyId` and `Streaming__Cloudflare__TurnKeyApiToken` on the `mounted-games-api` Vercel project.
   - Set a Cloudflare billing alert.
   - Test on two real phones (Safari and Android): lock, background, flip camera, mute, pause, end.
   - Nest camera: tell the chat which model the club uses, so phase 2 can be checked.
5. **Official EGUK navy hex.** `#1e3466` is a guess.
6. **Decisions left open in chats:**
   - Remove the race clock? You said "there is no race clock", but it's still in the app.
   - Keep the colour key under the timetable dots?
   - Ticker: should a fresh announcement keep replacing the live heat for up to 15 minutes, or should "Now" stay on top?
   - Toplist before any scoring: show a dash instead of every team as joint 1st?

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

- Flaky under load: `StreamingHubTests.RewatchReplacesAndClosesPreviousSession_EvenAtTheCap_DisconnectClosesCurrent` (seen in CI on #52 and locally) and, once, `CommerceEndpointsTests.DemoDeclineReleasesStock_AndRetryCanSucceed`. Both pass on rerun; make them deterministic.
- Heat page draft restore looks dead on main (the seed effect overwrites the hydrated draft); found by the lint work in #41.
- Stream controls still to come: instant replays (needs recording), and the producer screen's per-angle preview tiles from the design board.

- Unreachable code noted by the test agents:
  - the blank-suffix branch in `TeamsController.Update`
  - the unauthorised early returns in `MyTeams` and `LoadTeamForTrainerAsync`
  - the empty-string guard in `GeocodingService.ResolvePostcodeAsync`
- Scoring: tied places share points and HC teams keep stored points. This matches `APP_DESIGN.md`; change it only if the rules say otherwise.

## Testing

- Real phone on poor signal: the outbox, retries, and the conflict screen against a test competition (not a live one).
- Browser and phone check of the UI from the ticker/settings chat. Most of it was never seen in a browser.
- Uncovered API paths: `Program.cs` `--migrate-database` and `--seed-review-competitions`, and the Postgres path in `DatabaseConfiguration`. These need a Postgres in CI (a Neon branch or a service container).

## Security and dependencies

- Click through the live site (timetable, scoring, Live tab embeds, shop images, sign-in) to confirm the new CSP blocks nothing. Vercel's headers are confirmed served, and the page has no inline scripts.
- The items still open in `docs/security-review.md`.
- Seven Tailwind 3 build-tool advisories. The fix is a breaking Tailwind 4 migration, so plan it as its own PR.
- #20 pinned patched `Microsoft.OpenApi` and `SQLitePCLRaw`, and runtime npm audit is clean.

## Housekeeping

- `docs/test-coverage.md` predates both test suites. Fold it into `docs/test-coverage-handoff.md`, or replace it.
