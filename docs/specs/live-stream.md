# Live video streaming (spec, 16 October 2026)

## Problem and goal

Organisers want to film the arena on a phone and show it live in the app. Today the app can only embed a pasted YouTube or Twitch link. Goal: an admin, or the trainer who owns a competition, taps "Go live" on the website, grants camera and microphone access, and gets a full-screen camera view that broadcasts. Spectators see a red LIVE shortcut in the top ticker, open the Live & stream tab, watch a small player above the live feed, and tap it for full screen. The video stays under a second behind live, with up to 200 viewers at once.

## Decisions (agreed with the user)

| Topic | Decision |
|---|---|
| Relay | Cloudflare Realtime SFU, driven only by our API. The App token stays on the server. |
| Audience | 50–200 concurrent viewers. |
| Sound | On. The broadcaster can mute; viewers start muted and tap to unmute. |
| Recording | Not in v1. Leave room for it (client decision later). |
| Who broadcasts | Admins on any competition; Trainers only on competitions they created (existing `[CompetitionAccess]` rule). |
| Who watches | Anyone, no account needed. |
| How many | Several at once: 1–3 arenas × 1–3 angles. Each broadcast has an arena and an angle name. |
| Where viewers watch | The existing Live & stream tab (`/competitions/:id/chat`): player on top, live feed below. A red LIVE shortcut in the top ticker goes there. No floating player across pages. |
| YouTube/Twitch link | Kept as a fallback when no camera is live, loaded only after a tap, using `youtube-nocookie.com`. Fix the bug where saving it wipes `OrganiserName` and `PaymentDestination`. |
| Broadcaster extras | Viewer count, live feed messages over the camera, Pause / "Back soon", current heat label. |
| Viewer extras | Now-racing strip, announcement pop-ups, viewer count. |
| Quality | Up to 720p, with simulcast so weak connections drop to a lower layer. |
| Nest camera | Later, after a check on the model (out of scope). |
| Overlays | Drawn by the viewer app over the video, never burned into the video. This leaves room for later admin controls (score card after each race, banners, replays). |

## User flows

**Broadcaster**
1. Opens the Live & stream tab and taps "Go live" (only shown to `canOrganise(competition)` users when streaming is enabled), or goes straight to `/competitions/:id/broadcast`.
2. Setup screen: arena (chips from the competition's session `arenaName`s, default the first, or typed), angle (Main camera / Start line / Finish line / Wide, or typed), microphone on/off, camera picker (lists all video inputs, so a laptop with a USB or HDMI capture device works), and a reminder that families should know the event is filmed.
3. "Go live": the browser asks for camera and microphone, then publishes. Full-screen camera view with: flip camera, mute, Pause/Back soon, heat label (auto from the timetable for this arena, or typed), End (with confirmation), viewer count, signal indicator, and the latest announcements and staff messages fading in over the video. The screen stays awake.
4. If the connection drops, or the phone was in the background for more than 20 seconds, the page republishes automatically and viewers reconnect on their own.

**Spectator**
1. When any stream is live, the top ticker shows a red LIVE shortcut ("LIVE · Main Arena"). It goes to the Live & stream tab.
2. The tab shows the player at the top (muted, autoplay, inline), with arena chips when more than one arena is live and angle chips when the chosen arena has several angles. The live feed stays below.
3. Tapping the player opens full screen (above all app chrome; native full screen and landscape lock where the browser allows). Overlays: LIVE badge with viewer count, unmute button, now-racing strip, announcement pop-ups for 8 seconds, a "Back soon" card while paused, and "Reconnecting…" while the media connection recovers. Close, Esc or the back button exits.
4. With nothing live, the tab shows the YouTube/Twitch fallback (tap to load) if a link is set.

## Scope

In: everything above; API, data, hub events, security headers, render.yaml env vars, tests, docs (`APP_DESIGN.md` streaming section).

Out (later): score card after each race, admin producer controls (banners, replays), recording/replays, Nest or RTMP cameras, a data-saver button, a picture-in-picture player that floats across pages, multi-instance API hosting (viewer tracking is in memory and assumes one API instance, as Render runs today).

## Architecture

- **Media path:** broadcaster browser → Cloudflare SFU → each viewer browser, over WebRTC. Our API only brokers the SDP exchange with `https://rtc.live.cloudflare.com/v1/apps/{appId}/…` using `Authorization: Bearer {AppToken}`. The browser never sees the token or the publisher's SFU session id.
- **Publisher:** one SFU session holding track names `video` (simulcast RIDs `f`/`h`/`q`) and `audio`. A republish creates a new SFU session and increments `generation`.
- **Viewer:** one SFU session per viewer, pulling the publisher's remote tracks. The SFU makes the offer (`requiresImmediateRenegotiation`) and the browser answers. The viewer exchange runs over the SignalR hub, not HTTP, because anonymous HTTP writes share a 60-per-minute rate-limit partition behind the Vercel proxy, and the hub connection gives viewer counts and cleanup on disconnect for free.
- **Track lifetime:** Cloudflare garbage-collects a track that receives no media for 30 seconds. Pause therefore sets `videoTrack.enabled = false` (browsers keep sending black frames) instead of stopping the track.
- **CSP:** WebRTC media and `video.srcObject` aren't governed by `connect-src`/`media-src`, so the CSP needs no new hosts. Only `Permissions-Policy` changes, plus `frame-src` for the no-cookie YouTube player.

## Shared contract (both workers build against this; don't change it without asking)

### Configuration (API)

| Key | Default | Notes |
|---|---|---|
| `Streaming:Cloudflare:AppId` | none | Streaming is enabled only when both AppId and AppToken are set. |
| `Streaming:Cloudflare:AppToken` | none | Secret. Render env var `Streaming__Cloudflare__AppToken` (`sync: false`). |
| `Streaming:Cloudflare:BaseUrl` | `https://rtc.live.cloudflare.com/v1` | Overridable for tests. |
| `Streaming:MaxLivePerCompetition` | 9 | Live + paused streams per competition. |
| `Streaming:MaxViewerSessions` | 500 | Concurrent viewer sessions across the API, to bound Cloudflare cost. |
| `Streaming:HeartbeatTimeoutSeconds` | 90 | A stream with no broadcaster heartbeat for this long is ended by the sweeper. |

### Data

New table `LiveStreams` (EF entity `LiveStream`, EF migration `AddLiveStreams` generated after `AddChatAdminOnly`, idempotent SQL script in `api/Data/Migrations/Scripts/`, and a `CREATE TABLE IF NOT EXISTS` guard in the SQLite path of `DbInitializer`):

| Column | Type | Notes |
|---|---|---|
| `Id` | int PK | |
| `CompetitionId` | int FK → Competitions, cascade delete | indexed with `Status` |
| `ArenaName` | string(80), required | trimmed |
| `AngleName` | string(60), required | trimmed |
| `Status` | int enum `LiveStreamStatus`: 0 Live, 1 Paused, 2 Ended | |
| `Caption` | string(80), nullable | heat label override; null means "auto from timetable" |
| `AudioMuted` | bool | |
| `StartedByUserId` | string, required | |
| `StartedAt`, `LastHeartbeatAt` | DateTime (UTC) | |
| `EndedAt` | DateTime? (UTC) | |
| `SfuSessionId` | string(100), required | internal; never in a DTO |
| `Generation` | int | starts at 1; +1 on each republish |

### HTTP API — `api/competitions/{competitionId}/streams`

Enums are serialised as numbers (existing convention). All bodies are camelCase JSON.

```ts
type LiveStreamStatus = 0 | 1 | 2; // Live / Paused / Ended
interface LiveStream {
  id: number; competitionId: number;
  arenaName: string; angleName: string;
  status: LiveStreamStatus;
  caption: string | null;
  audioMuted: boolean;
  startedAt: string;          // ISO UTC
  viewerCount: number;
  generation: number;
}
interface LiveStreamsResponse { enabled: boolean; streams: LiveStream[] }
interface PublishRequest { sdpOffer: string; videoMid: string; audioMid?: string | null }
interface StartStreamRequest extends PublishRequest { arenaName: string; angleName: string; takeOver?: boolean }
interface PublishResponse { stream: LiveStream; sdpAnswer: string }
interface UpdateStreamRequest { status?: 0 | 1; audioMuted?: boolean; caption?: string | null } // caption "" clears it; omitted = unchanged
```

| Method and path | Auth | Result |
|---|---|---|
| `GET /` | anonymous | `200 LiveStreamsResponse`: live and paused streams only, ordered by arena then angle. Works (empty, `enabled:false`) when streaming isn't configured. |
| `POST /` | Organiser + `[CompetitionAccess("competitionId")]` | Body `StartStreamRequest`. Creates an SFU session, pushes `video` (and `audio` when `audioMid` is set) from the offer, stores the row, broadcasts `streamUpdated`. `201 PublishResponse`. `503` when not configured; `409` when the same arena + angle is already live (unless `takeOver`, which ends the old one first) or the per-competition cap is reached; `400` for invalid names or an offer over 20 KB; `502` when Cloudflare fails (no row is left behind). |
| `POST /{streamId}/republish` | same | Body `PublishRequest`. New SFU session, `generation + 1`, best-effort close of the old session's tracks, broadcasts `streamUpdated`. `200 PublishResponse`. `409` if the stream has ended. |
| `PATCH /{streamId}` | same | Body `UpdateStreamRequest`. `200 LiveStream`, broadcasts `streamUpdated`. Caption max 80 characters. |
| `POST /{streamId}/heartbeat` | same | `204`; updates `LastHeartbeatAt`. `409` if ended. |
| `POST /{streamId}/end` | same | `204`; sets Ended and `EndedAt`, best-effort closes tracks, broadcasts `streamUpdated` with status 2. Ending an ended stream is `204`. |

A stream id that doesn't belong to `competitionId` is `404`. The sweeper (hosted service, every 30 s) ends live or paused streams whose heartbeat is older than `HeartbeatTimeoutSeconds` and broadcasts `streamUpdated` for each.

Also fix the stream-link bug: `PUT /api/competitions/{id}/stream-url` (Organiser + `[CompetitionAccess("id")]`), body `{ streamUrl: string | null }`, `204`, changes only `StreamUrl`.

### SignalR (`LiveHub`, existing group `comp:{id}`)

Server → client events:

| Event | Payload |
|---|---|
| `streamUpdated` | `LiveStream` (status 2 means remove it) |
| `streamViewers` | `{ streamId: number, count: number }`, sent at most once every 5 s per stream (trailing), only when the count changed |

Client → server methods (anonymous allowed):

```ts
WatchStream(competitionId: number, streamId: number): Promise<{ viewerSessionId: string; sdpOffer: string; generation: number }>
AnswerStream(viewerSessionId: string, sdpAnswer: string): Promise<void>
StopWatching(streamId: number): Promise<void>
```

- `WatchStream` checks the stream is live or paused and belongs to the competition, creates a viewer SFU session, and pulls `video` (with `simulcast: { preferredRid: "f", priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" }`) and `audio` if published. It returns the SFU's offer. A connection holds at most one viewer session per stream; a second call replaces the first. There's a limit of 10 `WatchStream` calls per connection per minute, and the global cap is `MaxViewerSessions`. Failures throw `HubException` with a short, user-safe message.
- `AnswerStream` only accepts a `viewerSessionId` issued to the calling connection; it calls `renegotiate`.
- `StopWatching` and `OnDisconnectedAsync` drop the connection's viewer sessions (best-effort `tracks/close` with `force: true`).
- Viewer count = connections holding a viewer session for that stream. It's also returned as `viewerCount` in `LiveStream`.
- After a hub reconnect the connection id changes, so clients must call `WatchStream` again from `onReady`. Clients also re-watch when a `streamUpdated` arrives with a higher `generation`.

### Security headers (both `SecurityHeadersMiddleware` and `web/vercel.json`, kept identical)

- `Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), browsing-topics=()`
- CSP `frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv`; nothing else changes.

### Web media settings

- `getUserMedia`: video `{ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'environment' }` (or a chosen `deviceId`); audio `{ echoCancellation: true, noiseSuppression: true }` when the mic is on.
- `RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' })`.
- Video transceiver `sendonly` with `sendEncodings` `[{ rid: 'f', maxBitrate: 1_500_000 }, { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 500_000 }, { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 150_000 }]`; fall back to a single encoding if the browser rejects simulcast. Audio transceiver `sendonly`.
- Flip camera and device changes use `sender.replaceTrack` (no renegotiation).
- Broadcaster heartbeat every 15 s.

## Acceptance criteria

1. An admin, or the trainer who created the competition, can start, pause, resume, mute, caption, republish and end a stream. Anonymous users get 401, Members and Managers 403, and other trainers 404 on every broadcaster endpoint (API tests).
2. `GET /streams` is anonymous and never exposes `SfuSessionId` or the App token (API test on the JSON).
3. With streaming unconfigured, `GET` returns `enabled:false`, `POST` returns 503, and the web hides "Go live".
4. `WatchStream`/`AnswerStream` work anonymously; a foreign `viewerSessionId` is rejected; disconnecting drops the viewer count and closes the session (hub tests with stubbed Cloudflare).
5. Viewer counts reach clients through `streamViewers`, at most once every 5 s per stream.
6. A stream with no heartbeat for 90 s is ended by the sweeper and viewers get `streamUpdated` with status 2.
7. Both header sets carry the new `Permissions-Policy` and `frame-src`, and the parity test passes.
8. Saving the YouTube/Twitch link no longer clears `OrganiserName` or `PaymentDestination` (API test).
9. The ticker shows a red LIVE shortcut while any stream is live and none when all have ended (web test).
10. The Live & stream tab shows the player when live (arena and angle chips when there are several), and the YouTube/Twitch fallback behind a tap when not (web tests).
11. Full screen shows the viewer count, unmute, now-racing strip, announcement pop-ups, "Back soon" while paused, and "Reconnecting…" during recovery (component tests).
12. The broadcaster page publishes with simulcast, falls back to one encoding, republishes after a failure, sends heartbeats, holds a wake lock, and suppresses the PWA update reload while live (unit tests on the publisher module with a mocked `RTCPeerConnection`).
13. CI stays green: API coverage ≥ 95%, and web coverage ≥ 97% for the gated folders. `npm run build`, `dotnet build` and `dotnet test` pass.
14. Manual check on two real phones once Cloudflare credentials exist (not automatable here).

## Risks and open questions

- **Cloudflare account:** the user must create a Realtime SFU app and set `Streaming__Cloudflare__AppId` and `Streaming__Cloudflare__AppToken` on Render. Until then the feature stays hidden.
- **Render free plan:** a cold start delays the first viewer by about 50 seconds. The broadcaster's heartbeat keeps the API awake during a broadcast.
- **iPhone broadcaster:** Safari stops the camera when the phone locks or the app goes to the background. We republish on return, and the setup screen tells the operator to keep the screen on.
- **iPhone viewer:** there's no element full screen on iPhone, so full screen there is an in-app overlay. The installed app's portrait lock stays; we call `screen.orientation.lock('landscape')` where supported.
- **Cost:** 200 viewers × 6 hours at 720p is about 650 GB, most of the 1 TB free monthly allowance. Simulcast lowers this for phones on weak signal. `MaxViewerSessions` caps the worst case.
- **Safeguarding:** streams are public. The broadcaster sees a reminder; club policy is the organiser's responsibility.
- **Single API instance:** viewer sessions and counts live in memory.

## Implementation plan

1. Commit this spec on `feat/live-stream` (based on PR #26). Verify: both workers start from the same commit.
2. **Worker A (Codex `gpt-6-astra`, xhigh): API.** Entity, migration, SQL script, SQLite guard, Cloudflare client, controller, hub methods, viewer tracker, sweeper, stream-url endpoint, headers in both places, `render.yaml`, `APP_DESIGN.md` streaming section, tests. Verify: `dotnet build`, `dotnet test`, coverage ≥ 95%.
3. **Worker B (Codex `gpt-6-astra`, high): web.** Types, hub hook events and invoke, publisher and viewer modules, streams state in `CompetitionPage`, ticker LIVE shortcut, StreamPlayer and overlays, Live & stream tab, broadcaster page and route, YouTube tap-to-load and the new stream-url call, tests. Verify: `npm test`, `npm run test:coverage`, `npm run build`.
4. Integrate (Claude): review both diffs, merge A then B, run everything, and check the UI in a browser with a fake camera (Playwright, Chromium `--use-fake-device-for-media-stream`) against a stubbed or real SFU.
5. Run `code-check` and a security review (auth, headers, migration), then open the PR stacked on #26.
