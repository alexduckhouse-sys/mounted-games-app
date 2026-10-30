# Simulcast to YouTube/Facebook and GoPro/DJI cameras

Status: proposal, 30 October 2026. Spec only: nothing here is built, and no code, migration or setting changes with this document. The owner asked for the basic app to work for the 31 October weekend and for this to be specced, not built. Check "Break this" and the open questions before turning any of it into code.

Requests (owner, 30 October 2026): c11, stream the event to YouTube and/or Facebook at the same time as our own player; c14, use GoPro and DJI cameras as camera sources as well as phones. Nest cameras were considered and are out (see Rejected).

## Short version

- Phone cameras cannot be sent to YouTube or Facebook by Cloudflare alone. Cloudflare's own WebRTC input does not support restreaming, and our phones publish to the Realtime SFU, which has no RTMP output. A server that decodes and re-encodes video would be needed, and Vercel's scale-to-zero API can't host one.
- GoPro and DJI cameras push RTMP, and Cloudflare Stream Live Inputs accept RTMP(S) and can restream it to up to 50 destinations. So an RTMP camera is the one source that can be both a camera slot in our app and a simulcast source, with no laptop and no extra server.
- What YouTube viewers get that way is the camera's picture alone, with no scores. Scores on YouTube need the organiser's laptop running OBS with our existing transparent overlay page. That works today, with nothing to build.
- Recommendation: build RTMP camera slots first, then a "Also stream to YouTube / Facebook" switch on top of them, then (optionally) a full-screen program page for OBS. Don't build a server-side compositor.

## Corrections to the brief

I checked "phones publish with WebRTC into the Realtime SFU, viewers play over WHEP, overlays and replays are not in the video". Two parts need correcting.

1. **Viewers do not use WHEP.** Neither side uses WHIP or WHEP (those are Cloudflare Stream's WebRTC protocols, which `docs/decisions.md` rejects for the main path on cost). Phones publish through our API to the SFU's Tracks API (`api/Services/Streaming/CloudflareSfuClient.cs:30` `PublishAsync`). Each viewer opens its own SFU session pulling the publisher's tracks (`CloudflareSfuClient.cs:39` `WatchAsync`), and the SDP offer and answer travel over our SignalR hub: `WatchStream`, `AnswerStream`, `StopWatching` (`api/Hubs/LiveHub.cs:46-68`; web side `web/src/live/streamViewer.ts:171-186`). The video element then plays a `MediaStream` (`web/src/components/stream/StreamPlayer.tsx:107-112`).
2. **The overlay is not burned in, as you said, and it also is not a "program feed".** There is no server-side picture that equals what a viewer sees. Every camera angle is its own SFU session. "On air" is only a hint that viewers' browsers follow: the producer sends a `selectAngle` command through `POST /streams/{id}/command` (`api/Controllers/StreamsController.cs:280-297`, allowed commands at `:232-234`), it is broadcast over the hub, and each viewer's `LiveVideo` switches angle (`web/src/components/stream/LiveVideo.tsx:37-39`; `onAirStream` in `web/src/lib/streamControls.ts:4`). Score cards, now-racing strip and banners are drawn by each viewer's browser. Replays have never reached viewers: they are local to the producer's device (`docs/specs/stream-controls-backend.md`, "Play on air").

Also noticed while reading, not part of this spec: `Streaming:MaxStreamDurationMinutes` defaults to 45 (`api/Services/Streaming/StreamingOptions.cs:8`) and `StreamSweeper` ends any stream older than that (`StreamSweeper.cs:35-37`), so a phone stream is cut after 45 minutes unless production config overrides it. `docs/specs/live-stream.md` says the default viewer cap is 300 but the code default is 50 (`StreamingOptions.cs:7`). Both are worth checking in the production environment.

## 1. Why, and what "done" looks like

Families who can't come to the showground, and clubs who want to share the day, already watch on YouTube and Facebook. Our own player is the best experience (scores, replays, sub-second delay), but it only reaches people who open the app. Separately, many organisers already own a GoPro or DJI camera that gives a better picture than a phone held by a volunteer.

Done, for an organiser:

- **Camera.** On the Camera tab of Stream controls there is an "Add a GoPro / DJI camera" button. It asks for an arena and an angle name, then shows an address and a key to paste into the camera's app, with short steps and a status that moves from "Waiting for the camera" to "Connected". The camera then appears next to the phone cameras and can be cut to like any other.
- **Simulcast.** On the same camera, a switch "Also stream to YouTube" (and one for Facebook). The organiser pastes a stream key, ticks a notice about children and public streams, and turns it on. A status line says what was sent and reminds them to check YouTube Studio. One tap stops it.
- **Without a laptop, a router or an engineer.** The only extra thing at the venue is the camera and a phone hotspot or Wi-Fi for it.
- **What viewers get.** On our site: the camera as one more angle. On YouTube or Facebook: that camera's picture and sound, without our graphics (unless the organiser uses the OBS route below).

Not part of "done": scores on YouTube without OBS, recording, phone cameras on YouTube, replays from RTMP cameras, YouTube chat in our app.

## 2. Current architecture (what we build on)

| Part | Where |
| --- | --- |
| Phone publish: `getUserMedia`, simulcast layers `f`/`h`/`q`, `RTCPeerConnection` to the SFU via our API | `web/src/live/streamPublisher.ts:340-354` |
| Phone uplink budget: about 2.7 Mbit/s at 720p (1.5 + 0.85 + 0.35), up to about 3.4 Mbit/s on Auto HD, plus audio | `streamPublisher.ts:88-99` |
| Stream rows: `LiveStream` (arena, angle, status Live/Paused/Ended/Starting, generation, SFU session ids, heartbeat) | `api/Entities/LiveStream.cs` |
| Broadcaster endpoints (start, `ready`, republish, patch, heartbeat, command, end), public `GET /streams` | `api/Controllers/StreamsController.cs:24-310` |
| SFU client (the only code that talks to Cloudflare; never logs tokens or SDP) | `api/Services/Streaming/CloudflareSfuClient.cs` |
| Sweeper: ends streams with no heartbeat for 180 s or over the duration cap; only runs while an API instance is up | `api/Services/Streaming/StreamSweeper.cs:17-67` |
| Viewer cap, token bucket, per-connection limit (the cost guard) | `api/Services/Streaming/ViewerRegistry.cs`, `StreamingOptions.cs` |
| Viewer player and overlays (drawn in the browser, over a `MediaStream`) | `web/src/components/stream/StreamPlayer.tsx`, `StreamOverlays.tsx`, `LiveVideo.tsx` |
| Producer UI: Overlay, Auto, Replay and Camera tabs | `web/src/pages/competition/StreamControlsPage.tsx`, `streamControls/CameraTab.tsx` |
| Replay buffer: `MediaRecorder` on the live `MediaStream`, kept on the producer's device | `web/src/live/replayBuffer.ts:474-475` |
| **OBS/vMix overlay, already shipped:** a transparent page with lineups, results, standings, banner, sponsors and podium, from a public snapshot with an adjustable delay of 0 to 120 s | route `/embed/competitions/:id/overlay?arena=&delay=&section=` (`web/src/lib/broadcast.ts:69`, `web/src/pages/embed/BroadcastOverlay.tsx`), `api/Controllers/BroadcastController.cs:15-26`, `api/Services/Broadcast/BroadcastService.cs:12`, setup panel `streamControls/BroadcastSetup.tsx`, spec `docs/specs/event-day-tools.md` section 2 |
| Security headers, twice, kept identical by a test | `api/Security/SecurityHeadersMiddleware.cs:13`, `web/vercel.json` |
| Hosting: API is a scale-to-zero container on Vercel; Redis shares hub messages and limits | `vercel.json`, `CLAUDE.md` "Gotchas" |
| An existing pattern for encrypting a secret at rest (AES-GCM, per-purpose) | `api/Services/Apple/AppleSecurity.cs:36-50` |

The OBS overlay's own comment says its tree never imports app context, auth or video (`BroadcastOverlay.tsx`, doc comment). Keep that.

## 3. RTMP out (simulcast to YouTube and Facebook)

### What each option can carry

| | Picture | Our graphics (scores, banners) | Camera switching | Needs at the venue | Server cost |
| --- | --- | --- | --- | --- | --- |
| **A. Cloudflare Live Input outputs** | RTMP camera only | No | No (one input, one picture) | The camera and its uplink | About $1 per 1,000 minutes per destination |
| **B. OBS on the organiser's laptop** | Anything OBS can see (HDMI/USB capture, webcam mode, an RTMP source) | **Yes**, our overlay as a browser source | Yes, in OBS | A laptop, a capture device or a program page, and an uplink | None from us |
| **C. Server-side compositor** | Phone WebRTC and RTMP | Yes | Yes | Nothing | An always-on worker (see below) |

**Why not "phones into a Live Input, then simulcast".** Cloudflare Stream's WebRTC (WHIP) input is GA, but its docs say live viewer counts, broadcast metrics and simulcasting (restreaming via RTMP/SRT) are not supported for it. So a phone's WebRTC picture can't be fanned out by Cloudflare, whichever way it gets there. (Docs read 30 October 2026, `developers.cloudflare.com/stream/webrtc-beta/`; re-check before building, as this is a beta-era page.)

### A. Cloudflare Stream Live Input with outputs (recommended for the "one switch")

- One Live Input per RTMP camera. The camera pushes RTMPS to Cloudflare. We add Outputs to the input with `POST /accounts/{account_id}/stream/live_inputs/{uid}/outputs` and a body of `url` and `streamKey`. Up to 50 outputs per input; they can be added, switched off or deleted during a broadcast, and a deleted output stops within 30 seconds (Cloudflare docs, "Simulcasting").
- **Which camera is "on air"?** The brief asks for one program feed. With option A there isn't one: each Live Input is its own picture, and the output is bound to that input. If the organiser cuts our site from the GoPro to a phone, YouTube keeps showing the GoPro. Moving the YouTube output from one input to another on every cut would drop and reconnect the YouTube ingest each time, which is bad on the day. So in v1 the simulcast is **per camera**: "Send this camera to YouTube". We say that plainly in the UI. It suits the common set-up of one good main camera on the finish line.
- **Where does the overlay go?** Nowhere. Nothing is composited, so YouTube viewers get no scores, no heat names, no sponsors. The commentator can say them; the description on YouTube can link to the live results page. If the organiser wants graphics on YouTube they use option B.
- **Cost** (Cloudflare Stream pricing page, read 30 October 2026; confirm before building): ingest and encoding are free; simulcast outputs count as delivered minutes at $1 per 1,000 minutes, per output. One camera to YouTube and Facebook for a 6-hour day is 2 x 360 = 720 minutes, about $0.72. Recording is off unless we turn it on and would count as storage ($5 a month per 1,000 minutes), so we leave it off.
- **Unknowns to confirm:** whether outputs accept RTMPS (Facebook Live requires RTMPS; the Cloudflare page shows only `rtmp://` examples), whether any per-output health is exposed (without it the app can't tell if YouTube accepted the feed), and what an output does when the destination refuses it.

### B. OBS with our overlay page (works today; recommended for "with scores")

The overlay at `/embed/competitions/:id/overlay` is already built, transparent and shown to the organiser in Stream controls with a copy button. An organiser with a laptop adds it to OBS as a browser source over their camera, sets the delay to match their video, and streams from OBS to YouTube or Facebook. Switching cameras is OBS's job. Nothing in our API changes. Two gaps:

1. **Getting a phone camera into OBS.** OBS can't read our SFU. Today the organiser needs an HDMI or USB capture of a real camera, or the camera's USB webcam mode (to confirm per model). Nice-to-have later: a **program page** (`/program/:id?arena=`, not under `/embed/` so it can't be framed by other sites) that shows what a viewer sees, the on-air angle plus the app's own overlays, full-bleed at 1920 x 1080, joining as one ordinary anonymous viewer. OBS captures it as a browser source, so phone cameras and graphics reach YouTube with no capture card. Needs a real-OBS test (OBS's embedded Chromium should do WebRTC; to confirm). It would count as one viewer session against the cap.
2. **The "real OBS and vMix check" is still an open release item** (`docs/specs/event-day-tools.md`, "Verification — 29 October 2026": actual OBS/vMix source checks). Run it before telling organisers to rely on this.

### C. Server-side compositor (rejected for now)

Decode the on-air SFU track, render the overlay page in a headless browser, mix, encode, push RTMP. It is the only way to give phone cameras plus graphics to YouTube without a laptop. It needs an always-on process with a lot of CPU and a persistent network connection: a 1080p30 re-encode is on the order of several vCPUs, around the clock while live. The API on Vercel is a scale-to-zero container whose instances come and go (`CLAUDE.md`, Vercel gotcha) and `StreamSweeper` only runs while one is up, so it can't host long-running ffmpeg. It would be a separate service (a small VM or container host), a new vendor, a new failure mode on event day, and a second place where child footage is processed. Revisit only if organisers ask for it after A and B have been used at real events.

### Recommendation

1. Tell organisers who want scores on YouTube to use B now. No build.
2. Build A as the "Also stream to YouTube / Facebook" switch on RTMP camera slots (section 4). It is cheap, needs no laptop, and gives a clean camera feed.
3. Say clearly in the UI which of the two you are getting: camera only, or camera with scores (OBS).

### The stream key is a secret

A YouTube or Facebook stream key lets anyone broadcast to that organiser's channel.

- **Prefer not to hold it ourselves.** The API sends the key straight to Cloudflare in the output call, and we store only the output's `uid`, the platform, an enabled flag, who set it up and when, and a hint of the last four characters. If Cloudflare's API turns out to hand the key back on read (to confirm), our API still never forwards it.
- **If we must store it** (for example to rebuild an output), encrypt it at rest with the AES-GCM pattern in `AppleSecurity.Protect` (`api/Services/Apple/AppleSecurity.cs:36`), with a new encryption-key setting and a purpose string for stream keys.
- **Never returned to the browser after saving.** The request body carries it once; every response and every DTO carries only the hint. `Cache-Control: no-store` on the save call.
- **Never logged.** The Cloudflare client logs no bodies (as today), request-body logging stays off, and exception messages are replaced with a fixed one (the existing `SfuException` pattern). Add an API test that asserts a saved key does not appear in any response body or captured log line.
- **Revoke path.** "Stop sending" deletes the Cloudflare output and clears the hint. The UI tells the organiser to reset the key in YouTube Studio or Facebook after the event, because we can't.
- Only staff of that competition (`[Authorize(Policy = CompetitionStaff.Policy)]` plus `[CompetitionAccess]`) can set or stop it. Scorer links cannot: a camera volunteer's link must not be able to send the event somewhere else.

## 4. RTMP in (GoPro and DJI)

### What these cameras do

Both families can push a live stream to a custom RTMP address and key from their phone app (GoPro Quik; DJI Mimo), usually through a phone hotspot or Wi-Fi network. They send H.264 video and AAC audio. Exact models, maximum resolution, RTMP versus RTMPS, and whether the camera reconnects by itself after a drop are all **to confirm on the real cameras the owner has**; I have not verified any of it. Which models are in use is open question 1.

### Cloudflare side

Cloudflare Stream Live Inputs take RTMPS at `rtmps://live.cloudflare.com:443/live/` plus a stream key, and SRT in caller mode. Video must be H.264 and audio AAC; combined bitrate 2 to 14 Mbit/s (under 10 recommended, constant rather than variable); keyframe interval 2 to 10 seconds with closed GOPs; no B-frames for low-latency HLS. Plain `rtmp://` on port 1935 is also commonly accepted (to confirm). Creating an input: `POST /accounts/{account_id}/stream/live_inputs`; the reply holds `uid`, `rtmps.url` and `rtmps.streamKey`. (Docs read 30 October 2026.)

**Playback is the catch.** Cloudflare says plainly that RTMP or SRT inputs cannot be played with WHEP. So an RTMP camera can't use our sub-second SFU player. Viewers get HLS, or low-latency HLS (beta, needs recording mode `automatic` and `preferLowLatency`), which is several seconds behind at best. Cloudflare's docs give no latency figure; measure it on a real camera before promising anything.

The alternative, a server that converts RTMP into WebRTC for the SFU, is the same always-on worker rejected in 3C.

### How an input becomes a camera slot

Reuse `LiveStream` rather than inventing a second kind of camera, so the Camera tab, `selectAngle`, the ticker's Watch button and angle chips keep working.

- Add to `LiveStream`: `SourceKind` (0 Phone, 1 RtmpInput), `CfLiveInputUid`, and a small status for the input. Add a table for simulcast outputs (competition, stream, platform, Cloudflare output uid, key hint, enabled, notice accepted by and at, started and stopped at). Exact columns belong to the build PR.
- Status mapping: Starting (3, internal, never public) = waiting for the camera; Live = connected; Paused = dropped, shown to viewers as the existing "Back soon" card; Ended = removed. `GET /streams` already hides rows with `Generation < 1`, so the slot stays invisible until the first connection sets `Generation = 1`.
- Endpoints (staff only, `CompetitionStaff` + `[CompetitionAccess]`, never scorer links): create camera, show camera details, reset key (delete and recreate the input), remove. `GET /streams` gains `sourceKind` and, for RTMP slots, a playback address.
- **Who tells us it connected or dropped?** There is no browser heartbeat. Preferred: a Cloudflare Stream webhook for live input connected/disconnected (to confirm event names and signature scheme), verified with a shared secret, which updates the row and broadcasts `streamUpdated` through the existing hub path. Fallback: producers' pages poll a cached status endpoint. The sweeper's heartbeat rule and the 45-minute cap must **skip** RTMP slots, or they would be ended 3 minutes after creation.
- **Viewer side.** `StreamPlayer` currently only knows `MediaStream` (`StreamPlayer.tsx:107-112`). Add a second path for an HLS address: native `<video src>` on Safari and iOS, a lazily loaded `hls.js` elsewhere (keep it out of the main bundle for 3G). Overlays, the Watch button and full screen are the app's own and carry over.
- **Security headers.** The player's manifest and segments come from a Cloudflare Stream host, so `connect-src` and `media-src` need that host. Edit `SecurityHeadersMiddleware.cs` and `web/vercel.json` together (and the embed policy if the overlay ever needs it); `SecurityTests` fails if they differ and bans `*`.
- **Playback address and cost.** A public HLS manifest address can be pulled by anyone, outside our viewer cap, at $1 per 1,000 viewer-minutes. Use signed playback tokens (to confirm Cloudflare's signed-URL support for live inputs) minted by a rate-limited endpoint, so the address leaves our API only for people on the page and expires.
- **Camera details secret.** The RTMP address and key let anyone publish to our player. Show them to staff when the camera is created and again behind a "Show camera details" button (no-store, staff only, rate-limited), because setting up a camera app takes several tries on the day. "Reset key" replaces them. Never put them in a link, a QR code on a public page or a log. (The owner's brief said "shown once"; this softens that. See question 4.)

### Latency and replay

| | Phone (WebRTC via SFU) | RTMP camera (HLS or LL-HLS) |
| --- | --- | --- |
| Delay | Under about a second (spec target) | Several seconds, to measure |
| Replay and Follow-Cam | Works: the buffer records the live `MediaStream` (`replayBuffer.ts:474-475`) | **Not in v1.** Recording an HLS `<video>` needs `captureStream`, which iOS Safari doesn't give us (to confirm). The Replay tab says "Replays aren't available for this camera" |
| Score cards | Appear as the heat finishes | Would appear before the video shows the finish |

The score-card timing is the part that will feel wrong. Fix in the viewer: apply a per-camera delay (a setting on the slot, default to the measured value) to the overlay cues shown over that camera, in the same spirit as the OBS overlay's delay. Until that exists, hide automatic score cards over an RTMP camera rather than show results early. (Open question 6.)

### Uplink

One venue uplink can't carry everything. A phone broadcasting needs about 2.7 to 3.4 Mbit/s up; a GoPro or DJI at 1080p commonly wants 4 to 8 Mbit/s and Cloudflare asks for at least 2 combined. If the camera uses the organiser's phone hotspot and that phone is also publishing WebRTC, both fail. The setup screen should show a budget ("This camera needs about 3 Mbit/s. Phones broadcasting need about 3 each.") and default RTMP cameras to 720p at about 2.5 Mbit/s constant, not 1080p. Cloudflare re-encodes down to ladders for viewers, so the camera only has to send one good stream.

### When the camera drops

- The slot goes to Paused, viewers see "Back soon" (existing card), the producer's Camera tab shows a red "Camera dropped" with the details button.
- Whether the camera app re-dials by itself is camera-specific (to confirm). If not, someone must restart the stream in the camera app; the details screen says so.
- Simulcast: the YouTube side sees the feed stop. How long YouTube waits before ending the broadcast, and whether the output resumes by itself when the camera returns, are to confirm; don't promise it.
- No auto-switch to a phone camera in v1. The producer cuts manually, as for any camera.

## 5. Child safeguarding and UK GDPR

Context: riders are often under 18. The sign-up tick covers parental consent for riders appearing on "the live stream" and accepting event terms (`docs/decisions.md`, 22 October 2026). There is no per-rider filming opt-out and footage isn't close-up (`CLAUDE.md`, "Rider privacy"). A public YouTube or Facebook stream is a different audience and a different custodian from our own player.

- **Opt-in per event, default off.** The switch lives in the event's stream settings; nothing is sent until an organiser turns it on, per platform.
- **Default to Unlisted, but we can't enforce it.** YouTube's visibility belongs to the broadcast the organiser creates in YouTube Studio, not to the stream key, and Facebook's audience belongs to the Live post. Setting it for them would need Google or Facebook sign-in with broadcast-management permissions, which means app review and verification; rejected for v1. So the app shows a notice with a required tick, stored with who and when: "I have set this broadcast to Unlisted (or a private audience) and turned off comments, and the entry terms for this event allow it to be streamed on [platform]". Copy goes through the `humanise` skill when built.
- **Entry terms.** The tick says riders appear on "the live stream", which most people will read as our site. Whether it covers a third-party platform, a recording that stays online after the event, and comments from strangers is a question for the owner and probably for legal advice. If the wording changes, `CONSENT_VERSION` and `SignupTerms.WordingVersion` change together (`docs/decisions.md`, 22 October 2026), and people who signed up earlier never saw the new wording. Run the `mg-law-and-compliance-audit` skill before release.
- **Controller position.** Once video leaves for YouTube or Facebook, that platform is a separate controller with its own retention (YouTube normally keeps a recording unless the organiser turns it off; to confirm). The organiser is the controller for the decision to send it. The privacy page (`web/src/pages/PrivacyPage.tsx:73`, `:347-354`) says the stream goes through Cloudflare and that organisers can add YouTube or Twitch links; it must say, when this ships, that an organiser may also send the stream to YouTube or Facebook and what that means for retention.
- **Platform rules to confirm** before the first event: YouTube's "made for kids" setting (it restricts features such as personalised ads and comments, and is chosen when the broadcast is created); minimum age and account requirements for live streaming (YouTube has historically needed live streaming enabled on the channel, with a wait of up to a day the first time: enable it well before the event); Facebook's live video policies for minors and Page versus profile streaming. I did not verify any of these on an official page beyond the general help-centre wording on made for kids and unlisted.
- **Names on screen.** Our overlay uses team names, not rider names, and `RiderNames.Display` / `publicRiderName` handle initials in the app. Commentary and the camera's picture are outside that control. The notice says so.
- **Spectator filming** can't be controlled; the existing one-line notice stays.
- **Stopping.** One tap to stop sending. A competition ending, being deleted or the organiser losing their role also deletes its outputs and camera inputs (cascade in the Cloudflare cleanup path, so a key doesn't sit live after the event).

## 6. Break this

1. **Existing invariants.** Keep the Cloudflare token server-only, the two-phase publish, `[CompetitionAccess]` on every new endpoint (anonymous 401, Members and Managers 403, other trainers 404, scorer links refused), SignalR event names aligned with `web/src/live/useLiveHub.ts`, and API DTOs aligned with `web/src/types.ts`. A schema change needs an EF migration, an idempotent script, a SQLite guard and a Neon step before deploy (`CLAUDE.md`; the migrate-before-deploy automation in `docs/specs/auto-migrations.md` is agreed but not built, so until it is, the Neon step is manual). Agents stop and ask before writing a migration.
2. **Settled decisions.** Overlays stay drawn by the app, not burned in (`docs/decisions.md`, 16 October). Cloudflare Stream WHIP/WHEP was rejected for the main path on cost; this spec uses Stream only for RTMP cameras and their playback. "Lower third on the stream" is in the Rejected list of `docs/designs/design-decisions.md`: nothing here adds one. UI follows the house style and its pre-PR checklist, and UI work goes through Claude Design.
3. **Races and double taps.** Turning the switch on twice creates two outputs: serialise per competition with the existing `CompetitionStreamLocks` and make creation idempotent per (competition, platform). Webhook events can arrive out of order or twice: store the Cloudflare event time and ignore older ones. Two producers adding the same angle: the existing arena-and-angle uniqueness check at `StreamsController.cs:101-106` applies.
4. **iOS Safari and WebKit.** HLS must use native playback; autoplay only when muted and inline (as `StreamPlayer` already does); no element full screen on iPhone (in-app overlay stays); `captureStream` on a video element isn't available, hence no replay for RTMP cameras; test the installed PWA as well as Safari. The camera details screen needs long keys to be copyable: a copy button, not select-by-hand.
5. **3G and shared uplink.** See "Uplink". HLS segments are heavier than the SFU's adaptive layers for a viewer on poor signal; offer a 360p/audio-only choice (Cloudflare's ladder should provide lower renditions; to confirm). Do not offer RTMP cameras as the default angle for spectators on weak signal.
6. **Vercel scale-to-zero.** Everything in A is short REST calls to Cloudflare, which is fine. No long-running ffmpeg or sockets in the API. The webhook wakes a cold container, so it must answer fast and idempotently. Hub fan-out already goes through Redis. Anything that needs to run "every 30 seconds" (checking a dropped camera) can't rely on `StreamSweeper`; derive status from the webhook plus the last-seen time, and check lazily when a page asks.
7. **Cost runaway.**
   - Viewers of an RTMP camera pay $1 per 1,000 viewer-minutes: 200 viewers for 6 hours is about $72 for one camera, and a leaked public manifest has no cap. Mitigate with signed playback, a per-competition cap on concurrent RTMP viewers, a competition-level minutes budget with a hard stop and an email, and a Cloudflare billing alert (as already required for the SFU).
   - Simulcast minutes are small ($0.36 per destination for 6 hours) but an output left on for days isn't. Auto-off when the camera has been disconnected for a set time, when the competition's last session ends, and at a hard cap per day.
   - A maximum of two outputs per competition (one YouTube, one Facebook) even though Cloudflare allows 50.
   - Recording stays off.
   - The phone SFU path is unchanged: still the free 1 TB allowance.
8. **Key leakage.** YouTube keys, Facebook keys and RTMP camera keys never appear in responses after save, URLs, query strings, logs, error messages, analytics, the service worker cache (no new route in `web/src/offline/cachePolicy.ts`), the browser's local storage or an AI chat. The camera-details response is `no-store`. An organiser pasting a key into the wrong field (the RTMP URL box) is caught by a format check, not echoed.
9. **Event-day failure modes.**
   - Wrong or expired key: YouTube shows no data; the app can only say "sent", not "live on YouTube". Say that.
   - YouTube broadcast not started, or Studio not set to start automatically: nothing visible; the setup steps say so.
   - Camera overheats, battery dies or the phone hotspot sleeps: RTMP drops. The slot shows "Camera dropped"; the producer cuts to a phone.
   - Cloudflare Stream outage: RTMP cameras and simulcast fail, the phone SFU path (a separate product) may not. Producers can fall back to phones. The existing `StreamUrl` fallback link remains.
   - Wrong time: cues and score cards 5 to 15 seconds early over an RTMP camera (section 4).
   - Webhook not delivered: the slot sits at "Waiting"; the producer's page also polls status so a human can tell.
   - Organiser forgets to stop: auto-off rules above.
10. **UK law and safeguarding.** Section 5. Nothing is sent without an opt-in and a stored acknowledgement. No streaming of private data: the overlay snapshot is already public data only.
11. **Not-yet-verified.** Cloudflare Live Input plain-RTMP port, RTMPS destinations, webhook names, signed playback for live inputs, LL-HLS latency, per-output health, the GoPro and DJI behaviours, and YouTube and Facebook policies are all marked "to confirm" above and need a short spike before the first build PR.

## 7. Rejected

- **Nest cameras.** Google's Device Access programme costs $5 to join, gives only short streaming sessions and has no open, continuous live feed we could ingest. A Nest camera isn't a showground camera in any case (indoor/outdoor home use, tied to a Google account). Out, and `APP_DESIGN.md` and `NEXT_STEPS.md` stop asking which Nest model the club has.
- **Phone WebRTC cameras to YouTube/Facebook through Cloudflare alone.** Not possible: Stream's WebRTC input doesn't support restreaming, and the SFU has no RTMP output.
- **A server-side compositor or transcoder now.** Section 3C.
- **Converting RTMP cameras into SFU tracks** to keep sub-second delay. Same worker problem.
- **YouTube/Facebook sign-in and API control** (creating the broadcast, setting Unlisted, reading chat). App review, verification, token storage for children's event content, and a large surface. Revisit only after real demand.
- **Storing stream keys in plain text, in `look` JSON, in settings the browser can read back, or in a link.** Section 3.
- **Letting scorer links or camera links add RTMP cameras or simulcast.** Those links are given to volunteers and must not be able to redirect the event's video.
- **Recording on Cloudflare** for RTMP cameras (storage cost, retention, safeguarding). Revisit with the recordings work in `docs/specs/stream-controls-backend.md`.
- **Auto-switching "on air" between an RTMP camera and a phone on a drop.** Surprising for viewers; keep it manual.

## 8. Build order

Small PRs, each shippable on its own. None before the 31 October event; none with a migration without the owner's go-ahead.

0. **Spike (no code in the repo).** A throwaway Cloudflare Live Input, a real GoPro and DJI, and a free-plan YouTube channel: confirm RTMP and RTMPS addresses, whether the camera reconnects, outputs to YouTube and Facebook (RTMPS, health), webhook names, signed playback, LL-HLS latency, and how a viewer on Safari plays it. Write what was found into this spec, replacing "to confirm".
1. **Docs and OBS help.** An in-app "Stream to YouTube with OBS" help panel under `BroadcastSetup` (steps, delay, the safeguarding notice) and the real-OBS/vMix check from `event-day-tools.md`. UI plus `humanise` copy. No API change.
2. **Cloudflare Stream client and options.** `Streaming:Cloudflare:AccountId`, a Stream-scoped API token (separate from the SFU app token), customer code, webhook secret. A `StreamLiveClient` beside `CloudflareSfuClient`, with tests against `StubHttp`. Nothing is exposed yet.
3. **Schema + RTMP camera endpoints.** `SourceKind`, input uid, the simulcast output table, migration and Neon step, create/show/reset/remove endpoints, sweeper exemption, API tests (auth matrix, no key in responses).
4. **Webhook and status.** Signed webhook, ordering and idempotency, `streamUpdated` broadcast, polled fallback.
5. **Viewer HLS path.** `StreamPlayer` HLS source, lazy `hls.js`, signed playback, header changes in both places, per-camera overlay delay, Replay disabled with a message, web tests and the pre-PR UI checklist.
6. **Camera tab UI.** "Add a GoPro / DJI camera", details and status, uplink budget note, the dropped state.
7. **Simulcast switch.** Settings UI, notice and stored acknowledgement, output create/stop, auto-off rules, caps, privacy page update, tests. Run `mg-law-and-compliance-audit` and a security review (secrets, auth, headers) before merging.
8. **Optional: program page for OBS** (`/program/:id`), once step 1 shows organisers want phone cameras and graphics together.

## Open questions for the owner

Recommended answer first.

1. **Which GoPro and DJI models does the club use?** Recommended: tell me the exact models, so the spike checks those. RTMP support, maximum resolution and reconnect behaviour differ by model and I haven't verified any of it.
2. **Is a camera-only picture on YouTube/Facebook acceptable for the one-switch version?** Recommended: yes; scores on YouTube go through OBS (option B) for organisers who want them. The alternative is a server-side compositor, which I recommend against.
3. **Should the simulcast be per camera ("send this camera to YouTube") rather than "whatever is on air"?** Recommended: per camera. Following the on-air cut would reconnect YouTube on every switch.
4. **Show the camera's address and key whenever staff ask, or literally once?** Recommended: on demand, to staff of that event only, with a Reset key button. Once-only fails when a camera app needs three attempts on the day.
5. **Who may turn the YouTube/Facebook switch on?** Recommended: event admins and the owning organiser only, never scorer or camera links, and only after the notice tick.
6. **Until delay matching exists, hide automatic score cards over an RTMP camera?** Recommended: yes; early results over a delayed picture are worse than none.
7. **Do the entry terms need to say the stream may go to YouTube/Facebook and stay online?** Recommended: yes, get that wording checked (and run the law check) before the first public simulcast; earlier sign-ups wouldn't have seen it.
8. **Cap RTMP-camera viewers and set a spend limit?** Recommended: yes, a per-event minutes budget with a hard stop, plus a Cloudflare billing alert. Say what number suits you (200 viewers for 6 hours is about $72 per camera).
9. **Recording on Cloudflare for RTMP cameras?** Recommended: no, off; revisit with the recordings work.

## Docs to update when built

`APP_DESIGN.md` (the "RTMP external hardware camera ingestion" out-of-scope line and the Live streaming section), `docs/decisions.md` (this choice), `docs/specs/live-stream.md` ("Out" list), `NEXT_STEPS.md` (Cloudflare Stream setup, the billing alert, the Neon migration), `web/src/pages/PrivacyPage.tsx`, `CLAUDE.md` configuration list (new `Streaming__Cloudflare__*` keys), and the `mg-livestream-and-broadcast-audit` skill.

## Sources checked (30 October 2026)

- Cloudflare Stream: simulcasting, start a live stream, WebRTC (WHIP/WHEP) and pricing pages under `developers.cloudflare.com/stream/`.
- Google YouTube Help on made-for-kids and live streaming (general wording only); third-party guides for the ingest address and unlisted behaviour. Not read on an official page: Facebook Live policies, GoPro and DJI documentation.
