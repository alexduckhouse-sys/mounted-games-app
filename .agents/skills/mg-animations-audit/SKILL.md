---
name: mg-animations-audit
description: Comprehensive motion, transition, micro-interaction, 60fps performance, prefers-reduced-motion, Lite-Mode, AND new slick micro-animation opportunity audit skill for the Mounted Games App (https://mounted-games-app.vercel.app + Framer Motion & CSS animations).
---

# Mounted Games App — Animations, Motion & Micro-Interaction Polish Skill

Use this skill for the **Animations Parent Agent**.

## Dual Mission:
1. **Hunt Broken / Janky / Missing Animations:** Find abrupt mounts/unmounts, layout shifts, dropped frames, broken gesture timers, or missing `prefers-reduced-motion` / Lite-Mode fallbacks on `https://mounted-games-app.vercel.app` and in `web/src/`.
2. **Propose Slick Minimalist Micro-Animations:** Identify places where the site currently feels too static or abrupt and recommend tastefully restrained, 60fps micro-animations (using transform/opacity or Framer Motion) that elevate the site's minimalist sports-app feel without slowing down ringside users.

---

## Multi-Agent Architecture (Parent → 3 Specialist Motion Subagents)

The **Animations Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent A1 — Navigation Shell, Bottom Sheets, Pop-ups/Warnings & Steppers
1. **Bottom Sheets (`Sheet.tsx`) & Pop-ups (`ConfirmPopup.tsx`, `Toast.tsx`):**
   - Check open/close curves, backdrop fade synchronisation, scroll-lock cleanup on unmount, rapid double-tap behaviour, and where subtle spring/ease-out polish would make modals feel more tactile.
2. **Navigation & Tab Transitions (`App.tsx`, Competition Tabs, Creator Wizard 10 Steps):**
   - Check active tab indicators, route switches, accordion/disclosure panels, and step transitions in `web/src/pages/admin/creator/` for layout jumps or abrupt cuts.
3. **Interactive Controls (`RoundStepper.tsx`, `RoundSearch.tsx`, Hat Silks, Filter Chips):**
   - Check press states (`:active` scale/opacity), focus transitions, and number increment micro-feedback.

### Subagent A2 — Live Scoring Interactions, Standings Row Climbs, Ticker & Celebrations
1. **Full-Screen Phone Scoring (`ScoringParts.tsx`, `RaceToolsSheet.tsx`):**
   - **Tap vs Hold Gesture:** Verify the `0–250ms` tap (assigns next finish place) vs `250ms–600ms` radial fill ring (marks **Eliminated (E)**). Ensure the progress ring starts smoothly at `250ms`, completes at `600ms`, and cancels cleanly on `pointerup` / `pointercancel`.
   - **Saved Tick & Undo Feedback:** Verify the `"Saved"` indicator and undo/reset animations feel crisp and reassuring under rapid thumb tapping.
2. **Standings Leaderboard Row Climbs & Live Results Ticker:**
   - When SignalR pushes `RaceScored`, verify leaderboard rows smoothly animate to their new rank (`layout` / FLIP) and points counters/deltas highlight cleanly without layout thrashing.
   - Check the Live Results Ticker (`LiveResultsTicker.tsx`) for smooth, jitter-free scrolling/transitions.
3. **Podium / Finals & Prize Giving Moments:**
   - Check how Finals qualification and Prize Giving ("Last to First" reveal) animate, and propose tastefully slick reveal animations where currently static.

### Subagent A3 — Broadcast Stream Overlays, Follow-Cam Replay, Reduced-Motion & Lite-Mode 60fps
1. **Broadcast Stream Overlays (`OverlayTab.tsx`, `DeskOverlays.tsx`, `/embed/`):**
   - Check enter/exit transitions for live broadcast graphics (Heat Line-Up, Race Results, Leaderboard, Podium) so they never pop abruptly on stream.
   - Check Auto-Director (`useStreamAuto.ts`, `useStreamAutomation.ts`) timer progress indicators.
2. **Instant Replay Follow-Cam (`ReplayEditor.tsx`, `replayFrame.ts`):**
   - Verify keyframe interpolation for pan/crop/zoom (`transform: translate3d(...) scale(...)`) is hardware-accelerated and jitter-free at 60fps.
3. **`prefers-reduced-motion: reduce` & Lite Mode (`?lite=1`):**
   - Verify that every animation respects `@media (prefers-reduced-motion: reduce)` and `?lite=1` while preserving essential state feedback (like the hold-to-eliminate indicator).

---

## Required Output Format (Per Subagent & Parent Summary)

Every finding MUST be tagged as either:
- **[BUG / JANK / MISSING FALLBACK]** — Broken transition, layout jump, non-composited CSS property (`top`/`left`/`height`), or missing reduced-motion handling.
- **[NEW POLISH OPPORTUNITY]** — Specific, tasteful micro-animation recommendation to make a static interaction feel slicker.

Include:
- **Severity / Impact:** `HIGH` | `MEDIUM` | `LOW`
- **Route & Component:** Clickable `[File.tsx](file:///Users/alexd/dev/mounted-games-app/web/src/...#L10-L30)` + CSS file link
- **Exact CSS / Framer Motion Recommendation:** Exact easing curve, duration (`150ms–280ms`), and `transform`/`opacity` properties to use.
