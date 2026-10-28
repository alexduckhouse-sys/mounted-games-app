# Saving live streams for later

Status: draft for the owner's review (28 October 2026). Nothing is built yet.

## Why

People want to watch an event's stream again afterwards. Today the live stream (Cloudflare Realtime SFU, see `live-stream.md`) is never recorded. Only the organiser's device keeps a 30-minute rolling buffer for instant replays (`web/src/live/replayBuffer.ts`). Recording should cost nothing to start with and allow a paid option later.

## Stage 1: free, via YouTube (now)

- The live page already takes a competition stream link (`PUT /competitions/{id}/stream-url`; the "Stream settings" sheet on the live page). An organiser who streams to YouTube Live and pastes the link gets the recording kept by YouTube for free.
- Changes:
  - After the event, the link stays on the event page as "Watch again" instead of disappearing when the event ends.
  - The organiser can add more than one link (one per day or arena), each with a label.
  - A short help line in Stream settings: "Stream to YouTube and paste the link here. YouTube keeps the recording."
- Limits: viewers leave our player, so there are no overlays, toplist cards or Follow-Cam replays on the recording, and NoFilming teams aren't protected by us. The organiser must handle that on YouTube, and the help line says so.

## Stage 2: free, recorded on the broadcasting phone (optional)

- The publishing device records what it sends (MediaRecorder, as the replay buffer does) in chunks to IndexedDB. After the session it offers "Save recording", which downloads the file so the organiser can upload it wherever they like.
- Costs nothing to run. The catches: it uses the phone's storage and battery, recording stops if the page closes, and there's no hosting.

## Stage 3: paid, recorded by the server (later)

- Record on Cloudflare's side (or bridge the SFU to a recording service) and host the recordings on the event page with our own player, overlays and NoFilming rules applied.
- It's charged per minute stored and watched. Check current Cloudflare prices and limits before choosing, and set a per-event cap so a long weekend can't run up a surprise bill.

## Recommendation

Do Stage 1 now (small and web-only). Then decide between Stages 2 and 3 once we know how many people watch again.

## Safeguarding

Any recording we host ourselves (Stage 3) must respect `NoFilming` and `UseInitialOnly`, and needs a takedown route for a parent's request. Don't host anything until that's designed. Stages 1 and 2 leave hosting with the organiser, and the help text says what they're responsible for.
