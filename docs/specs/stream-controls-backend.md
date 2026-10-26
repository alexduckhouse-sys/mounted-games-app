# Stream controls: back end still to build

Status: proposal, 26 October 2026. The Stream controls page (`/competitions/:id/stream-controls`, design in `docs/designs/design-decisions.md`) is built on the front end only. Three parts of it work in the browser today and need a server before they can run unattended. Nothing here is built, and no migration exists yet.

## What the front end does now

| Part | Today | Limit |
| --- | --- | --- |
| Overlay tiles | The choice is saved in the overlay's `look` JSON (`liveCard`, `liveSectionId`, `liveOptions`) through `PUT /competitions/:id/overlays` | Viewers draw Toplist, Heat table and Up next. Podium, Race result, Race title, sponsor size and "Automatic" are saved but not drawn |
| Auto rules | Kept in the organiser's browser and run only while the Stream controls page is open on that device | Stops when the tab closes or the phone sleeps |
| Race recordings and clips | The Stream controls page records the live video it is showing into the 30-minute replay buffer (`live/replayBuffer.ts`). Each scored race is kept as a 45 second recording, instant replays are saved on demand, and clips sit in this device's IndexedDB | Only the device that was watching has them, and only from when it opened the page. They vanish with the browser storage. A clip takes as long to prepare as it lasts (the encoder plays it back in real time), so 30 minutes is not practical |
| Play on air | Not built | Replays have never reached viewers: the broadcaster's replay screen is local. The Replay tab has no Play on air button for that reason |

## 1. Auto rules on the server

Rules the page offers: after each race (heat table for N seconds), from session 2 (toplist every N races), after a session (podium), before each race (race title), between races (sponsors).

**Data.** Prefer a small table over `look`, because rules need a state (what is showing, until when) that changes on every race.

- `StreamAutoRule`: `Id`, `CompetitionId`, `Key` (`race`, `toplist`, `podium`, `title`, `sponsor`), `Enabled`, `Seconds`, `EveryRaces`, `UpdatedAt`. One row per key per competition.
- `StreamAutoState` (or two columns on the existing overlay row): `AutoEnabled`, `ShowingCard`, `ShowUntil`, `LastRaceId`. This is the master "Run automations" switch and what the server last put on screen.
- Alternative: keep the rules inside `look` (4000-byte cap, no extra table). Cheaper, but every race write would be a read-modify-write of the whole overlay and would race with the producer's own taps. Not recommended.

**Who evaluates, and when.** The API, as a side effect of the writes that already happen:

- `RaceFinalService` / the score save path calls `StreamAutomation.OnRaceScored(competitionId, raceId)`.
- Heat and session completion call `OnHeatFinished` and `OnSessionFinished`.
- A rule that fires writes the overlay (same revision check as `PUT /overlays`) and broadcasts `overlayUpdated`, which the viewers and the producer page already handle. Producer taps win: a manual tile choice sets `AutoEnabled` to false for that card until the next rule fires, or the organiser turns Automatic back on.

**Timed reverts.** A card shown "for 20 seconds" must clear itself. Vercel runs the API as a scale-to-zero container, so an in-process timer can be lost. Use `ShowUntil` as the source of truth and clear it two ways: viewers hide a card whose `ShowUntil` has passed (no server needed), and `StreamSweeper` tidies the stored row when an instance is up. Do not rely on `BackgroundService` timers alone.

**SignalR.** No new event names: reuse `overlayUpdated` (payload gains `autoEnabled` and `showUntil` only if the overlay DTO is extended; otherwise they stay inside `look`). Keep `web/src/live/useLiveHub.ts` in step.

**Endpoints.** `GET/PUT /competitions/:id/stream-auto` (staff, `[CompetitionAccess]`), returning and accepting the rule list and the master switch with an `expectedRevision`.

## 2. Server-stored race recordings

Goal: every race is recorded, the "Last 30 minutes" rolls on, and any organiser device can watch or cut a clip.

**Options**

- A. Cloudflare Stream (recording of the SFU output). Fits the existing Cloudflare account; per-minute storage and delivery cost; clips by start/end time via the API. Needs the SFU session to be forwarded to a Stream live input.
- B. The phone uploads each race's segment (the replay buffer already cuts segments) to object storage (Vercel Blob or R2). Simple and cheap; quality is the phone's, and uploads compete with the live uplink at the venue.
- C. Keep client-only. Zero cost; no cross-device access.

Recommendation: B for a first version (segments already exist, no new vendor), moving to A if organisers want clips from any camera.

**Rules to decide.** Retention (suggest 14 days after the event ends, then delete), size cap per race (suggest 100 MB) and per event (suggest 5 GB), uploads only on Wi-Fi or when the live stream is idle, and a way to turn recording off (rider privacy: `NoFilming` teams are already respected for the live stream, so recordings must follow the same flag).

**Data and endpoints.**

- `RaceRecording`: `Id`, `CompetitionId`, `RaceId` (null for the rolling 30 minutes), `StreamId`, `StartedAt`, `DurationSeconds`, `Bytes`, `StorageKey`, `Status` (uploading, ready, failed), `ExpiresAt`.
- `POST /competitions/:id/recordings` (create, returns a signed upload URL), `POST .../recordings/:id/complete`, `GET /competitions/:id/recordings` (staff), `GET .../recordings/:id/url` (short-lived signed read URL), `DELETE`.
- Auth: staff only (`CompetitionStaff` policy plus `[CompetitionAccess]`). Never public; never cached by the service worker (`offline/cachePolicy.ts` must not list these).
- Clips cut from a recording are saved as a small JSON record (start, end, keyframes, slow-mo) beside the video, so framing edits cost no storage.

**Cost.** Roughly 1.5 Mbit/s for 720p is about 0.7 GB per hour. A 6-hour, two-arena event is about 8 GB stored for two weeks, plus a few viewing downloads. Check current object-storage prices before choosing; egress to organisers is the part that surprises.

### Playing a replay to viewers ("Play on air")

Needs one of: the camera phone mixes the clip into its outgoing video (heavy on the phone), or the clip is stored on the server (section above) and a hub event tells every viewer to play it over the video. The second also gives the cross-device clips the Replay tab lacks. Slow motion is a playback speed in the editor only today; the encoder has no speed option, so a saved clip is always full speed.

## 3. Viewer renderers for the new overlay tiles

The producer can choose these tiles now; viewers draw nothing for them until each has a renderer in `components/stream/OverlayExtras.tsx` and a test:

- **Podium** (all at once, or one place at a time with a "Reveal next" control). The reveal step needs a small shared state: add `look.liveOptions.podiumShown` (0 to 3) so every viewer sees the same step.
- **Race result** (placings and points for one chosen race).
- **Race title** (race number and name, bottom left).
- **Sponsors, full screen or corner.** `SponsorOverlay` already draws sponsor cards; add the size option and "Next sponsor".
- **Automatic.** Not a card: it means "the rules choose". The server rules above set the real card.
- **Heat table, "Totals only"**, and **Toplist, "Top 3 / Top 5 / All"**: options on cards that exist, not yet read by the renderers.

These are front-end only once the `look` keys are agreed, so they can ship before the server work. Animations belong to the motion work, not these changes.

## 4. Migration and Neon steps (when the tables are built)

Follow `CLAUDE.md`: entity and `AppDbContext` config, `dotnet ef migrations add` (design time uses Npgsql), the idempotent script in `api/Data/Migrations/Scripts/`, and a SQLite guard in `DbInitializer` (`CREATE TABLE IF NOT EXISTS` / `EnsureColumnAsync`). Run the script on Neon (`npm run db:migrate`, see `docs/neon-setup.md`) before the API deploys, because the API refuses to start on Postgres with a pending migration. New tables are additive, so the old web build keeps working while the script runs first. Add API tests for rule evaluation (fake clock for `ShowUntil`) and the recording endpoints; the coverage gate is 95%.

## Open decisions

1. Auto rules: a table (recommended) or `look` JSON?
2. Should a manual tile tap pause Automatic until the next rule fires, or turn it off?
3. Recordings: Cloudflare Stream, phone upload to object storage (recommended first), or stay on the phone?
4. Retention, per-race and per-event size caps, and whether `NoFilming` teams are excluded from recordings as well as the live feed.
5. Who may watch recordings: organisers and the competition team only, or also scorers on a scorer link?
6. Which podium and result options need to be shared state (reveal step) rather than local to the producer?
