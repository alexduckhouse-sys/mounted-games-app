---
name: mg-livestream-and-broadcast-audit
description: End-to-end Live Stream, Cloudflare SFU WebRTC ingest/WHEP playback, Multi-Camera switching, Stream Controls (Overlay, Auto, Replay, Camera), Instant Replay Follow-Cam crop/zoom, Commentator Box, and /embed/ broadcast resilience audit skill for the Mounted Games App.
---

# Mounted Games App — Live Stream & Broadcast Production Audit Skill

Use this skill for the **Live Stream & Broadcast Specific Parent Agent (Parent #7)**.

## Scope
Mounted Games App includes a full live broadcast production suite (`api/Controllers/StreamingController.cs`, `api/Services/Streaming/`, `web/src/pages/competition/StreamControlsPage.tsx`, `OverlayTab.tsx`, `AutoTab.tsx`, `ReplayTab.tsx`, `CameraTab.tsx`, `DeskOverlays.tsx`, `ReplayEditor.tsx`, Commentator views, and `/embed/`). This skill audits the entire pipeline from camera ingest to viewer playback and live overlays.

---

## Multi-Agent Architecture (Parent → 3 Specialist Broadcast Subagents)

The **Live Stream Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent LS1 — Cloudflare SFU WebRTC Pipeline, Camera Switching & `StreamSweeper` Resilience
1. **Ingest, Readiness & Viewer Playback (`StreamingController.cs`, `CloudflareSfuClient.cs`, `StreamSweeper.cs`):**
   - Trace the full lifecycle: `start` → WHIP/WebRTC camera publish → `ready` → viewer WHEP/WebRTC subscribe → heartbeat → `stop` or `StreamSweeper` cleanup.
   - What happens when a camera operator's phone/encoder briefly drops connection mid-heat? Does the stream recover without kicking all viewers off?
   - Check multi-camera / arena switching (`CameraTab.tsx`): can a producer switch angles smoothly without black-screen deadlocks or orphaned SFU tracks?
2. **Child Safeguarding in Live Broadcasts (`NoFilming` & `UseInitialOnly`):**
   - Verify what happens when a heat contains a rider flagged `NoFilming = true` or `UseInitialOnly = true`: does the Stream Controls desk, Commentator Box, and Auto-Overlay system prominently warn the producer/commentator and redact the rider's surname on broadcast overlays?

### Subagent LS2 — Stream Controls Desk (`Overlay · Auto · Replay · Camera`) & Auto-Director Logic
1. **Manual Overlays (`OverlayTab.tsx`, `DeskOverlays.tsx`, `useOverlayTiles.ts`, `streamOverlayTiles.ts`):**
   - Audit every overlay tile (Heat Line-Up, Current Race, Live Results, Section Standings, Finals Cutoff, Podium/Prize Giving, Announcements/Delays).
   - Verify state sync between the producer's Stream Controls desk and all connected viewers / `/embed/` iframes via SignalR (`LiveHub`). What happens if a viewer joins *after* an overlay was turned on?
2. **Auto-Director (`AutoTab.tsx`, `useStreamAuto.ts`, `useStreamAutomation.ts`, `streamAuto.ts`):**
   - Trace the automated triggers: when `RaceScored` or heat transitions happen, does Auto mode trigger the right overlay for the configured duration and dismiss it cleanly without getting stuck if another race is scored rapidly?

### Subagent LS3 — Instant Replay Follow-Cam Editor, Commentator Desk & `/embed/` Viewer Experience
1. **Instant Replay & Follow-Cam Keyframes (`ReplayTab.tsx`, `ReplayEditor.tsx`, `useControllerReplay.ts`, `useSavedReplays.ts`, `instantReplay.ts`, `replayFrame.ts`):**
   - Audit the ring-buffer capture, clip trimming, follow-cam crop/zoom keyframe editor, saved replays persistence, and "Play Replay to Stream" broadcast trigger.
   - Check edge cases: memory usage of buffered video chunks in browser RAM over a 4-hour competition session, Safari/iOS `MediaRecorder` / `HTMLVideoElement` compatibility, and aspect-ratio maths.
2. **Commentator Desk (`commentatorFacts.ts`, Commentator page) & Public `/embed/` Player:**
   - Check the Commentator view during live heats: does it auto-follow the active heat/race, show hat silks, rider/pony combos, trainer name, and fun facts clearly?
   - Check `/embed/:id` on mobile and desktop: autoplay muted behaviour, fullscreen controls, overlay scaling at `16:9` vs mobile portrait, and fallback UI when no stream is currently live.

---

## Required Output Format
Each finding must include:
- **Severity:** `CRITICAL` | `HIGH` | `MEDIUM` | `LOW`
- **Subsystem:** `SFU / WEBRTC` | `OVERLAYS / AUTO-DIRECTOR` | `INSTANT REPLAY` | `COMMENTATOR / SAFEGUARDING` | `EMBED / VIEWER`
- **File & Line Links:** Clickable `[File](file:///Users/alexd/dev/mounted-games-app/...)` links in both `api/` and `web/`
- **Failure Scenario & Concrete Fix:** Step-by-step description of what goes wrong during a live broadcast and how to harden it.
