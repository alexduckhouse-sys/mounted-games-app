# Live video streaming (spec, 16 October 2026)

## Problem and goal

Organisers want to film the arena on a phone and show it live in the app. Today the app can only embed a pasted YouTube or Twitch link. Goal: an admin, or the trainer who owns a competition, taps "Go live" on the website, grants camera and microphone access, and gets a full-screen camera view that broadcasts. Spectators see a red Watch button in the top ticker, open the Live & stream tab, watch a small player above the live feed, and tap it for full screen. The video stays under a second behind live, with up to 200 viewers at once.

## Decisions (agreed with the user)

| Topic | Decision |
|---|---|
| Relay | Cloudflare Realtime SFU, driven only by our API. The App token stays on the server. |
| Audience | 50–200 concurrent viewers. |
| Sound | On. The broadcaster can mute; viewers start muted and tap to unmute. |
| Recording | Not in v1. Leave room for it (client decision later). |
| Who broadcasts | Admins on any competition; Trainers only on competitions they created (existing `[CompetitionAccess]` rule). |
| Who watches | Anyone, no account needed. |
| Ticker shortcut | Option A on the design board: a red Watch button inside the dark ticker strip. |
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
1. When any stream is live, the top ticker strip shows a red Watch button (design board option A). It goes to the Live & stream tab.
2. The tab shows the player at the top (muted, autoplay, inline), with arena chips when more than one arena is live and angle chips when the chosen arena has several angles. The live feed stays below.
3. Tapping the player opens full screen (above all app chrome; native full screen and landscape lock where the browser allows). Overlays: LIVE badge with viewer count, unmute button, now-racing strip, announcement pop-ups for 8 seconds, a "Back soon" card while paused, and "Reconnecting…" while the media connection recovers. Close, Esc or the back button exits.
4. With nothing live, the tab shows the YouTube/Twitch fallback (tap to load) if a link is set.

## Scope

In: everything above; API, data, hub events, security headers, render.yaml env vars, tests, docs (`APP_DESIGN.md` streaming section).

Out (later): score card after each race, admin producer controls (banners, replays), recording/replays, Nest or RTMP cameras, a data-saver button, a picture-in-picture player that floats across pages, multi-instance API hosting (viewer tracking is in memory and assumes one API instance, as Render runs today).

## Architecture

- **Media path:** broadcaster browser → Cloudflare SFU → each viewer's browser, over WebRTC. Our API only brokers the SDP exchange with `https://rtc.live.cloudflare.com/v1/apps/{appId}/…` using `Authorization: Bearer {AppToken}`. The browser never sees the token, the publisher's SFU session id or a viewer's SFU session id.
- **Publisher:** one SFU session holding track names `video` (simulcast RIDs `f`/`h`/`q` when the browser accepts them) and `audio`. Publishing is two-phase: the API returns the SFU answer for a pending *attempt*, and the stream (or its new generation) only becomes visible once the broadcaster's browser reports the connection is up (`POST /ready`). Cloudflare only makes tracks discoverable once the publisher's connection is established.
- **Viewer:** one SFU session per viewer, pulling the publisher's remote tracks. The SFU makes the offer (`requiresImmediateRenegotiation`) and the browser answers. The exchange runs over the SignalR hub rather than HTTP for two reasons. Behind the Vercel proxy, anonymous HTTP writes share one 60-per-minute rate-limit partition. And the hub connection gives viewer counts and cleanup on disconnect for free.
- **Track lifetime:** Cloudflare garbage-collects a track that receives no media for 30 seconds. So Pause keeps the camera sending: viewers cover the picture with the "Back soon" card and mute it, and the broadcaster disables only the audio track. Both sides watch WebRTC stats. The broadcaster republishes if outbound packets stall for 15 s (for example after iOS backgrounding). A viewer shows "Reconnecting…" after 10 s without new frames and re-watches after 20 s.
- **Republish:** a new SFU session and a new generation. Existing viewer connections are not retargeted: viewers close the old peer connection and call `WatchStream` again when they see the higher generation.
- **Cost guard:** anonymous hub calls create paid SFU sessions. The API reserves a slot atomically before calling Cloudflare and releases it on every failure. It also enforces a global cap, an app-wide token bucket, a per-connection limit and a 20-second answer deadline. There's no per-IP limit, because the API has no trusted client IP behind Render; this is documented as a known limit.
- **ICE:** STUN by default. When TURN keys are configured, the API mints short-lived Cloudflare TURN credentials for broadcasters (HTTP) and viewers (inside the `WatchStream` result), for venue Wi-Fi that blocks UDP.
- **CSP:** WebRTC media and `video.srcObject` aren't governed by `connect-src`/`media-src`, so the CSP needs no new hosts. Only `Permissions-Policy` changes, plus `frame-src` for the no-cookie YouTube player.
- **Rejected alternative:** Cloudflare Stream WebRTC (WHIP/WHEP, GA on 15 October 2026). It needs no custom viewer signalling, but it costs about $1 per 1,000 viewer-minutes (about $72 for 200 viewers over 6 hours) and has no viewer counts. The SFU's 1 TB a month free allowance won on cost, which was the user's choice.

## Shared contract (both workers build against this; don't change it without asking)

### Configuration (API)

| Key | Default | Notes |
|---|---|---|
| `Streaming:Cloudflare:AppId` | none | Streaming is enabled only when both AppId and AppToken are set. |
| `Streaming:Cloudflare:AppToken` | none | Secret. Render env var `Streaming__Cloudflare__AppToken` (`sync: false`). |
| `Streaming:Cloudflare:BaseUrl` | `https://rtc.live.cloudflare.com/v1` | Overridable for tests. |
| `Streaming:Cloudflare:TurnKeyId` | none | Optional. With `TurnKeyApiToken`, enables TURN credentials. |
| `Streaming:Cloudflare:TurnKeyApiToken` | none | Optional secret. |
| `Streaming:MaxLivePerCompetition` | 9 | Starting + live + paused streams per competition. |
| `Streaming:MaxViewerSessions` | 300 | Concurrent viewer sessions across the API, including ones awaiting an answer. |
| `Streaming:ViewerSessionsPerSecond` | 10 | App-wide token bucket for new viewer sessions (burst 40). |
| `Streaming:HeartbeatTimeoutSeconds` | 180 | The sweeper ends a live or paused stream with no heartbeat for this long. It doesn't sweep during the first `HeartbeatTimeoutSeconds` after API start. |
| `Streaming:PendingAttemptSeconds` | 30 | A publish attempt not confirmed with `/ready` in time is discarded. |

### Data

New table `LiveStreams` (EF entity `LiveStream`). It needs:
- an EF migration `AddLiveStreams`, generated after `AddChatAdminOnly`;
- an idempotent SQL script in `api/Data/Migrations/Scripts/`;
- a `CREATE TABLE IF NOT EXISTS` guard in the SQLite path of `DbInitializer`.

| Column | Type | Notes |
|---|---|---|
| `Id` | int PK | |
| `CompetitionId` | int FK → Competitions, cascade delete | indexed with `Status` |
| `ArenaName` | string(80), required | trimmed |
| `AngleName` | string(60), required | trimmed |
| `Status` | int enum `LiveStreamStatus`: 0 Live, 1 Paused, 2 Ended, 3 Starting | 3 is internal: never returned by `GET` or sent in events |
| `Caption` | string(80), nullable | heat label override; null means "auto from timetable" |
| `AudioMuted` | bool | |
| `HasAudio` | bool | the current generation publishes an audio track |
| `Simulcast` | bool | the current generation's offer advertised `a=simulcast:send` for video (detected server-side from the SDP) |
| `StartedByUserId` | string, required | |
| `StartedAt`, `LastHeartbeatAt` | DateTime (UTC) | |
| `EndedAt` | DateTime? (UTC) | |
| `SfuSessionId` | string(100), nullable | current publisher session; internal, never in a DTO |
| `Generation` | int | 0 until the first `/ready`; then the confirmed attempt number |
| `PendingSfuSessionId` | string(100), nullable | internal |
| `PendingAttempt` | int, nullable | attempt awaiting `/ready` |
| `PendingHasAudio`, `PendingSimulcast` | bool | internal, copied on `/ready` |
| `PendingSince` | DateTime?, UTC | |
| `TakeOverStreamId` | int, nullable | the stream to end when this one becomes ready |

### HTTP API — `api/competitions/{competitionId}/streams`

Enums are numbers (existing convention). Bodies are camelCase JSON. HTTP errors use the existing ProblemDetails/ValidationProblem shapes.

```ts
type LiveStreamStatus = 0 | 1 | 2;   // Live / Paused / Ended (3 Starting is server-internal)
interface LiveStream {
  id: number; competitionId: number;
  arenaName: string; angleName: string;
  status: LiveStreamStatus;
  caption: string | null;
  audioMuted: boolean;
  hasAudio: boolean;
  startedAt: string;          // ISO UTC
  viewerCount: number;
  generation: number;
}
interface IceServer { urls: string | string[]; username?: string; credential?: string }
interface LiveStreamsResponse { enabled: boolean; streams: LiveStream[] }
interface PublishRequest { sdpOffer: string; videoMid: string; audioMid?: string | null }
interface StartStreamRequest extends PublishRequest { arenaName: string; angleName: string; takeOver?: boolean }
interface PublishResponse { streamId: number; attempt: number; sdpAnswer: string }
interface ReadyRequest { attempt: number }
interface UpdateStreamRequest { status?: 0 | 1; audioMuted?: boolean; caption?: string | null } // caption "" clears it; omitted = unchanged
```

| Method and path | Auth | Result |
|---|---|---|
| `GET /` | anonymous | `200 LiveStreamsResponse`: live and paused streams with `generation ≥ 1` only, ordered by arena then angle. Works (empty, `enabled:false`) when streaming isn't configured. |
| `GET /ice-servers` | Organiser + `[CompetitionAccess("competitionId")]` | `200 { iceServers: IceServer[] }`: TURN credentials (TTL 6 h, port-53 URLs removed) when configured, otherwise `[{ urls: "stun:stun.cloudflare.com:3478" }]`. |
| `POST /` | same | Body `StartStreamRequest`. Creates an SFU session and pushes `video` (and `audio` when `audioMid` is set) from the offer. Stores the row with status 3 and `PendingAttempt = 1`. `201 PublishResponse`. Nothing is broadcast yet. Errors: `503` when not configured; `409` when the same arena + angle is already starting, live or paused (unless `takeOver`, which records `TakeOverStreamId`) or the cap is reached; `400` for invalid names, missing `videoMid` or an offer over 20 KB; `502` when Cloudflare fails (no row is left behind). Start/takeover/cap checks are serialised per competition with an in-process lock (single instance). |
| `POST /{streamId}/ready` | same | Body `ReadyRequest`. If `attempt` matches the pending attempt and it's younger than `PendingAttemptSeconds`, it promotes the pending session (`Generation = attempt`, `SfuSessionId`, `HasAudio`, `Simulcast`). A starting stream becomes Live; a paused one stays paused. It best-effort closes the previous publisher session and ends `TakeOverStreamId` (broadcasting its status 2), then broadcasts `streamUpdated`. `200 LiveStream`. `409` for a stale or expired attempt. |
| `POST /{streamId}/republish` | same | Body `PublishRequest`. New SFU session as a pending attempt (`attempt = max(Generation, PendingAttempt) + 1`). `200 PublishResponse`. The stream keeps its current generation until `/ready`. `409` if the stream has ended. |
| `PATCH /{streamId}` | same | Body `UpdateStreamRequest`. `200 LiveStream`, broadcasts `streamUpdated`. Caption max 80 characters. `409` if ended or still starting. |
| `POST /{streamId}/heartbeat` | same | `204`; updates `LastHeartbeatAt`. `409` if ended. |
| `POST /{streamId}/end` | same | `204`; sets Ended and `EndedAt`, best-effort closes tracks, broadcasts `streamUpdated` with status 2 (if it had ever been visible). Ending an ended stream is `204`. |

- A stream id that doesn't belong to `competitionId` is `404`.
- The sweeper (a hosted service running every 30 s) does three things:
  - ends live or paused streams whose heartbeat is older than `HeartbeatTimeoutSeconds` (outside the startup grace), broadcasting `streamUpdated` for each;
  - deletes starting rows whose attempt has expired;
  - clears expired pending attempts on visible streams.

Also fix the stream-link bug: `PUT /api/competitions/{id}/stream-url` (Organiser + `[CompetitionAccess("id")]`), body `{ streamUrl: string | null }`, `204`. It changes only `StreamUrl`.

### Cloudflare calls (API worker reference)

Base `{BaseUrl}/apps/{AppId}`, header `Authorization: Bearer {AppToken}`, 10 s timeout. Treat any top-level or per-track `errorCode` as a failure, even on HTTP 200.

- `POST /sessions/new` → `{ sessionId }`.
- Publisher: `POST /sessions/{sid}/tracks/new`.
  - Body: `{ sessionDescription: { type: "offer", sdp }, tracks: [ { location: "local", mid: videoMid, trackName: "video" }, { location: "local", mid: audioMid, trackName: "audio" } ] }`.
  - Response: `{ sessionDescription: { type: "answer", sdp }, tracks }`.
- Viewer: `POST /sessions/{sid}/tracks/new`.
  - Body: `{ tracks: [ { location: "remote", sessionId: publisherSid, trackName: "video", simulcast?: { preferredRid: "f", priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" } }, { location: "remote", sessionId: publisherSid, trackName: "audio" } ] }`.
  - Include `simulcast` only when the stream's `Simulcast` is true, and the audio track only when `HasAudio` is true.
  - Response: `{ requiresImmediateRenegotiation: true, sessionDescription: { type: "offer", sdp }, tracks }`.
- `PUT /sessions/{sid}/renegotiate` with body `{ sessionDescription: { type: "answer", sdp } }`.
- `PUT /sessions/{sid}/tracks/close` with body `{ tracks: [ { mid } ], force: true }`. Best-effort; never throws to the caller.
- TURN: `POST {BaseUrl}/turn/keys/{TurnKeyId}/credentials/generate-ice-servers`, `Authorization: Bearer {TurnKeyApiToken}`, body `{ "ttl": 21600 }` → `201 { iceServers: [...] }`. Drop any URL containing `:53`. Cache the result for 1 hour.
- Never log the tokens or SDP bodies.

### SignalR (`LiveHub`, existing group `comp:{id}`)

Server → client events:

| Event | Payload |
|---|---|
| `streamUpdated` | `LiveStream` (status 2 means remove it) |
| `streamViewers` | `{ streamId: number, count: number }`, sent at most once every 5 s per stream (trailing), only when the count changed |

Client → server methods (anonymous allowed):

```ts
WatchStream(competitionId: number, streamId: number): Promise<{ watchId: string; sdpOffer: string; generation: number; iceServers: IceServer[] }>
AnswerStream(watchId: string, sdpAnswer: string): Promise<void>
StopWatching(streamId: number): Promise<void>
```

- **`WatchStream`:**
  - Checks the stream is live or paused (`generation ≥ 1`) and belongs to the competition.
  - Reserves a viewer slot (global cap, token bucket, and 10 calls per connection per minute).
  - Creates a viewer SFU session and pulls the tracks as above.
  - Returns an opaque `watchId` (a GUID, not the SFU session id) and the SFU's offer.
  - A connection holds at most one viewer session per stream; a second call replaces and closes the first.
  - If `AnswerStream` doesn't arrive within 20 s, the session is closed and the slot released.
- **`AnswerStream`:** only accepts a `watchId` issued to the calling connection, then calls `renegotiate`. The answer is limited to 20 KB.
- **Cleanup:** `StopWatching` and `OnDisconnectedAsync` drop the connection's viewer sessions (best-effort `tracks/close`) and release their slots.
- **Errors:** failures throw `HubException` whose message starts with a stable code and a colon, then a short user-safe sentence. The codes are `STREAM_NOT_FOUND`, `STREAM_FULL`, `RATE_LIMITED`, `WATCH_EXPIRED`, `UPSTREAM_UNAVAILABLE` and `INVALID_REQUEST`.
- **Viewer count:** the number of connections holding an answered viewer session for that stream. It's also returned as `viewerCount` in `LiveStream`.
- **Re-watch rules (web):** after a hub reconnect the connection id changes, so the client closes its old peer connection and calls `WatchStream` again from `onReady`. It does the same on `streamUpdated` with a higher `generation`, and after 20 s without new inbound frames.

### Security headers (both `SecurityHeadersMiddleware` and `web/vercel.json`, kept identical)

- `Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), browsing-topics=()`
- CSP `frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv`; nothing else changes.

### Web media and ownership

- `CompetitionPage` owns the one hub connection used for streams. `useLiveHub` returns an `invoke` function and an `onReady` signal, and `CompetitionContext` exposes `streams`, `streamingEnabled`, `invoke` and a ready counter. Viewers use that connection, not a new one.
- **Camera capture:** start it from a user tap (the setup screen's "Allow camera" step). Fill the camera picker from `enumerateDevices()` only after permission, so labels are readable.
  - Video: `{ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'environment' }`, or a chosen `deviceId`.
  - Audio (when the mic is on): `{ echoCancellation: true, noiseSuppression: true }`.
- **Peer connection:** `RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })`. The broadcaster gets `iceServers` from `GET /ice-servers`, viewers from `WatchStream`.
- **Transceivers:**
  - Video is `sendonly` with `sendEncodings` `[{ rid: 'f', maxBitrate: 1_500_000 }, { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 500_000 }, { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 150_000 }]`. Fall back to a single encoding if the browser rejects simulcast; the server detects which one was used from the SDP.
  - Audio is `sendonly`.
  - Send `videoMid`/`audioMid` after `setLocalDescription`.
- **Publish sequence:** offer → `POST /` (or `/republish`) → `setRemoteDescription(answer)` → wait for `connectionState === 'connected'` (15 s timeout, then retry) → `POST /ready`.
- **Camera changes:** flip camera and device changes use `sender.replaceTrack` (no renegotiation).
- **Broadcaster heartbeat:** every 15 s.
- **Viewer video element:** set `muted`, `playsInline` and `autoplay` before assigning `srcObject`. If `play()` rejects, show a Play button.
- **Wake lock:** best-effort, re-acquired on `visibilitychange`.
- **Full screen:** a CSS overlay everywhere. Also call `requestFullscreen()` and `screen.orientation.lock('landscape')` where available (not on iPhone).

## Acceptance criteria

1. An admin, or the trainer who created the competition, can start (start + ready), pause, resume, mute, caption, republish (republish + ready) and end a stream. On every broadcaster endpoint, anonymous users get 401, Members and Managers 403, and other trainers 404 (API tests).
2. `GET /streams` is anonymous, never shows starting streams, and never exposes SFU session ids or tokens (API test on the JSON).
3. With streaming unconfigured, `GET` returns `enabled:false`, `POST` returns 503, and the web hides "Go live".
4. `WatchStream`/`AnswerStream` work anonymously. A foreign or expired `watchId` is rejected. Caps, the token bucket and the per-connection limit return the right codes. Disconnecting drops the viewer count and closes the session. The simulcast config is only sent for simulcast publishers (hub tests with stubbed Cloudflare).
5. Viewer counts reach clients through `streamViewers`, at most once every 5 s per stream.
6. A stream with no heartbeat for 180 s (outside the startup grace) is ended by the sweeper, and viewers get `streamUpdated` with status 2. Expired attempts are cleaned up.
7. Both header sets carry the new `Permissions-Policy` and `frame-src`, and the parity test passes.
8. Saving the YouTube/Twitch link no longer clears `OrganiserName` or `PaymentDestination` (API test).
9. The ticker shows the red Watch button (design board, option A) while any stream is live, and none when all have ended (web test).
10. The Live & stream tab shows the player when live, with arena and angle chips when there are several, and the YouTube/Twitch fallback behind a tap when not (web tests).
11. Full screen shows the viewer count, unmute (only with audio), the now-racing strip, announcement pop-ups, "Back soon" while paused, "Reconnecting…" during recovery, and a Play button when autoplay is refused (component tests).
12. The publisher module has unit tests with a mocked `RTCPeerConnection` covering:
    - publishing with simulcast, and falling back to one encoding;
    - calling `/ready` only after connecting;
    - republishing after failure or stalled packets, and starting a new stream with `takeOver` when the old one has ended;
    - heartbeats and the wake lock;
    - suppressing the PWA update reload while live.

    The viewer module's tests cover re-watching on reconnect, on a new generation and on stalled frames.
13. CI stays green: API coverage ≥ 95%, and web coverage ≥ 97% for the gated folders. `npm run build`, `dotnet build` and `dotnet test` pass.
14. Manual check on two real phones once Cloudflare credentials exist (not automatable here). Cases: Safari and the installed PWA; locking the phone; backgrounding; a phone call; flipping the camera; muting; coming back.

## Risks and open questions

- **Cloudflare account:** the user must create a Realtime SFU app (and optionally a TURN key) and set the `Streaming__Cloudflare__*` env vars on Render. Until then the feature stays hidden.
- **Render free plan:** a cold start delays the first viewer by about 50 seconds. The broadcaster's heartbeat keeps the API awake during a broadcast, and the sweeper's startup grace stops a restart from ending healthy streams.
- **iPhone broadcaster:** Safari stops the camera when the phone locks or the app goes to the background. We republish on return, and the setup screen tells the operator to keep the screen on.
- **iPhone viewer:** there's no element full screen on iPhone, so full screen there is an in-app overlay with no orientation lock.
- **Cost:** 200 viewers × 6 hours at 720p is about 650 GB, most of the 1 TB free monthly allowance. Simulcast lowers this for phones on weak signal. `MaxViewerSessions` (300) caps abuse at roughly 160 GB an hour. Without a trusted client IP there's no per-IP limit, so set a Cloudflare billing alert.
- **Shared TURN credentials:** viewers receive the same short-lived TURN credentials (cached for an hour, valid for six). Someone could reuse them to relay their own traffic through the account until they expire. The billing alert covers this; if it happens, revoke the TURN key in the Cloudflare dashboard (streaming keeps working over STUN).
- **Safeguarding:** streams are public. The broadcaster sees a reminder; club policy is the organiser's responsibility.
- **Single API instance:** viewer sessions, counts, locks and the token bucket live in memory.

## Implementation plan

1. Commit this spec on `feat/live-stream` (based on PR #26). Verify: both workers start from the same commit.
2. **Worker A (Codex `gpt-6-astra`, xhigh): API.** Entity, migration, SQL script, SQLite guard, Cloudflare client (SFU and TURN), controller, hub methods, viewer registry, sweeper, stream-url endpoint, headers in both places, `render.yaml`, tests. Verify: `dotnet build`, `dotnet test`, coverage ≥ 95%.
3. **Worker B (Codex `gpt-6-astra`, high): web,** following `docs/designs/live-stream-proposal.html`. Types, hub hook events and invoke, publisher and viewer modules, streams state in `CompetitionPage`, ticker Watch button, StreamPlayer and overlays, Live & stream tab, broadcaster page and route, YouTube tap-to-load and the new stream-url call, tests. Verify: `npm test`, `npm run test:coverage`, `npm run build`.
4. Integrate (Claude): review both diffs, merge A then B, run everything, and check the UI in a browser with a fake camera (Playwright, Chromium `--use-fake-device-for-media-stream`) against a stubbed or real SFU.
5. Docs (Claude): `APP_DESIGN.md` streaming section, `NEXT_STEPS.md` (Cloudflare setup and the Neon migration), user-facing copy through `humanise`.
6. Run `code-check` and a security review (auth, headers, migration, abuse limits), then open the PR stacked on #26.
