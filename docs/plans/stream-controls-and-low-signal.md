# Plan: stream controls and low signal (21 October 2026)

Design board: `docs/designs/stream-controls-and-low-signal.html`. The decisions below came from the user on 21 October 2026. Don't reopen them.

## A. Admin stream controls

**Decided**
- Overlays are drawn by the viewer app over the video, as in v1. Nothing is burned into the video.
- Who controls them: the same people who can broadcast (Admins, plus the trainer who created the competition).
- Where: a separate producer screen (laptop or tablet), plus two quick buttons on the filming phone (banner, score card).
- **Score card:** shows the whole heat table, ordered by running total, with the points just added highlighted. It appears about 4 s after a race's results are saved and stays about 10 s. The producer can edit it (hide a row, fix a display name, change duration, skip, show now). Points are read-only, and edits never change results.
- **Video banners:** separate from the Live tab's pinned banner, with an optional "also pin in the app". There are three styles (ticker, lower bar, alert) and saved messages. A banner stays until it's cleared.
- **Now racing strip:** the current heat, race and the team in each lane. It follows the timetable automatically, or the producer forces it on or off.
- **Customisation:**
  - saved looks that can be reused across events (colours, logo, position, size, fields);
  - per-event tweaks;
  - a basic layout editor: show or hide a fixed set of elements (logo, viewer count, strip, score card, banner, clock, arena name), each with a simple position choice.
- **Instant replays:** later. They need recording.

**Main pieces**
1. **API.**
   - New `OverlayLook` (saved looks) and per-competition `StreamOverlayState`: active banner, strip mode, score card settings, element visibility, chosen look and overrides. This needs an EF migration plus a SQL script (the Neon procedure is in NEXT_STEPS).
   - Endpoints, using the `[CompetitionAccess]` broadcaster rule:
     - `GET/PUT /competitions/{id}/overlays`
     - CRUD for `/overlay-looks`
     - `POST .../overlays/score-card/{raceId}` (show now, skip, edit)
   - A hub event `overlayUpdated` to the competition group. Viewers get it with the streams state on join.
2. **Score card queue.**
   - Driven by the existing `resultsUpdated` event.
   - The server stamps `showAt = savedAt + delay` so every viewer shows the card at the same moment. Producer edits are stored as display overrides on the queued card.
   - Each card is built client-side from the heat's results, which are already on the phone.
3. **Viewer overlays.** Extend the StreamPlayer overlay layer (portrait and full screen) with the score card, three banner styles, the strip and the basic elements. The look is applied through CSS variables.
4. **Producer screen.**
   - A new route, `/competitions/:id/produce`, with a low-bitrate (simulcast low layer) preview of each angle.
   - Per-arena toggles, the banner composer, the score card queue, take buttons and keyboard shortcuts (1–3, Esc).
5. **Filming phone.** Two translucent buttons on the broadcaster page that fade when idle.
6. **Tests and checks.**
   - API tests: access, queue timing and edits.
   - Vitest: overlays and the producer screen.
   - Playwright with a fake camera through the dev SFU app.

**Suggested order**
1. Overlay state, hub event, banners and the strip.
2. Score card and queue.
3. Looks, per-event tweaks and the basic layout editor.
4. Producer screen polish.
5. Replays, later.

## B. Low signal (venues are usually "1 bar, slow but there")

**Decided**
- **Connection pill:** hidden while live. It shows "Reconnecting…", "Checking every 30 s" or "Offline · updated 12:04", and a tap retries.
- **Adaptive fallback:** when the live connection drops, check every 15 s on scoring and heat pages and every 30 s elsewhere, backing off to 60 s after repeated failures. Go back to live as soon as it reconnects.
- **Fast first view:** now/next plus the latest results first. The rest of the timetable loads afterwards.
- **Lite mode:** on automatically on a slow connection or Data Saver, with Auto/On/Off in Settings. It drops:
  - images (tap to load);
  - weather;
  - video autoload (a "Tap to watch" card);
  - animations;
  - chat until its tab is opened.
- **Images:** in normal mode, thumbnails load when scrolled into view and the full image loads on tap.
- **Weather:** cached on the server.

**Main pieces**
1. **Measure first.** Record a Slow 3G baseline on a production preview (first-view bytes, time to usable, request count), so each step can show its gain.
2. **Pill and fallback.**
   - A `useConnectionStatus` hook combining the hub state, `navigator.onLine` and the last successful fetch.
   - A small change feed, `GET /competitions/{id}/changes?since=…`, with ETag/304, so polling costs bytes only when something changed.
   - Today every reconnect reloads the whole competition. Switch that to the change feed as well.
3. **Fast first view.**
   - `GET /competitions/{id}/now`: current and next heats, the last few results, sections and arena names (a few KB).
   - The page renders from it first, then fetches the full detail in the background with ETag, so repeat visits are about free. The service worker caches both.
4. **Lite mode.**
   - A `LiteModeContext` reading `navigator.connection` (`saveData`, `effectiveType` of 2g, slow-2g, or 3g with high RTT) and the Settings override.
   - Framer `MotionConfig reducedMotion="always"`.
   - Gates in the image, weather, LiveVideo and ChatTab components.
5. **Images.**
   - Generate thumbnails when shop and marketplace images are uploaded (about 320 px WebP), and backfill existing ones.
   - Use `loading="lazy"` with a blurred placeholder, and load the full image on tap.
6. **Weather cache.** `GET /weather?lat&lon` on the API, cached for about 30 minutes in memory. The web stops calling the weather provider from each phone.

**Suggested order:** measure; pill and fallback; fast first view; lite mode; images; weather.

## Open points (to confirm when building)
- Lite mode's auto threshold: does a "3g" phone count as slow, or only 2g and Data Saver? Proposed: 3g counts only when RTT is over 600 ms.
- Scorers on bad signal: the outbox sends only while the app is open. Should it try Background Sync (Android only)?
- Hosting: the API moved to Vercel on 21 October (#43). Before events it needs the Redis backplane and shared state listed in `NEXT_STEPS.md`; the polling fallback also covers a missed live update in the meantime.
