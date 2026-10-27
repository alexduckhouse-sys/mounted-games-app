---
name: mg-performance-and-offline-audit
description: Showground 3G/poor-signal resilience, offline scoring outbox sync, SignalR reconnection, bundle/asset size, Core Web Vitals, and battery/CPU efficiency audit skill for the Mounted Games App (https://mounted-games-app.vercel.app + codebase).
---

# Mounted Games App — Performance, Offline & Poor-Signal Showground Audit Skill

Use this skill for the **Performance, Offline & Poor-Signal Parent Agent (Parent #6)**.

## Real-World Context: Rural Showgrounds on Congested Mobile Data
Mounted Games competitions take place in rural fields where 500+ spectators, trainers, and scorers share a single congested 3G/4G mast. The app must load fast on cold cache, survive packet loss and brief disconnects while scoring at the ring gate, and recover automatically when signal returns.

---

## Multi-Agent Architecture (Parent → 3 Specialist Performance & Offline Subagents)

The **Performance & Offline Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent PO1 — Bundle Size, Cold-Load Waterfall, Assets & Core Web Vitals (`https://mounted-games-app.vercel.app` & `web/`)
1. **JS/CSS Bundle & Code-Splitting Audit:**
   - Inspect Vite build output and `web/src/App.tsx` imports. Are heavy routes (e.g. Stream Controls, Replay Editor, Creator Wizard, Site Admin, Charts/PDF/Print) lazy-loaded (`React.lazy`), or does a parent checking scores on 3G download the entire broadcast desk and admin suite upfront?
2. **SVG Flags, Images, Fonts & Static Assets:**
   - Check how `web/public/flags/*.svg`, logos, horse/rider photos, and fonts are loaded and cached (`Cache-Control` headers in `web/vercel.json` and `api/Program.cs`).
3. **Render Performance & Re-render Storms:**
   - Audit React hooks and contexts (`AuthContext`, SignalR live listeners, `useStreamAutomation`, `LiveResultsTicker`) for unnecessary full-page re-renders on every tick or WebSocket message.

### Subagent PO2 — Offline Scoring Queue, Optimistic UI & Flaky Network Recovery
1. **Ringside Scoring Under Packet Loss (`ScoringParts.tsx`, offline outbox/queue):**
   - What happens when a ring scorer taps 1st–6th while their phone drops from 4G to offline mid-heat?
   - Are scores persisted locally (`localStorage` / IndexedDB), queued with idempotency keys, and replayed in order when connectivity returns?
   - What happens if two requests race or a `500`/`409` is returned when coming back online?
2. **Form Draft Persistence (Creator Wizard, Entry Form, Declaration Form):**
   - If a show secretary or trainer is on Step 8 of the Creator Wizard or filling out a 5-rider Declaration Form and refreshes or loses signal, is their draft saved locally or lost?
3. **Lite Mode (`?lite=1`) Effectiveness:**
   - Audit every place `isLite` / `?lite=1` is used across `web/src/`. Does Lite Mode actually reduce network payload, polling, video preload, and CPU usage on low-end phones, and where should Lite Mode do more?

### Subagent PO3 — SignalR `LiveHub` Reconnection, Polling Fallbacks & API Payload Efficiency
1. **SignalR Reconnect & State Reconciliation (`Hubs/LiveHub.cs` & Web Hub Client):**
   - When a client's WebSocket drops for 20 seconds (e.g. phone locked in pocket or 3G drop) and reconnects, does the client automatically re-join the competition group (`JoinCompetition`) AND refetch missed score updates so the leaderboard isn't stale?
2. **API Payload Size & Over-Fetching:**
   - Inspect the JSON payloads returned by `/api/competitions`, `/api/competitions/{id}`, `/api/stats`, and `/api/seasons` against `https://mounted-games-app.vercel.app`. Are any endpoints returning huge unpaginated arrays or redundant nested graphs on every tab switch?
3. **Battery & Background Tab Hygiene:**
   - Check all `setInterval`, `requestAnimationFrame`, `<video>`, and WebRTC loops to ensure backgrounded tabs pause non-essential work instead of draining phone batteries at the showground.

---

## Required Output Format
Each finding must include:
- **Severity:** `CRITICAL` | `HIGH` | `MEDIUM` | `LOW`
- **Category:** `BUNDLE / COLD LOAD` | `OFFLINE / DATA LOSS` | `SIGNALR RECONNECT` | `PAYLOAD / CACHING` | `BATTERY / CPU`
- **File & Line Links:** `[File.tsx](file:///Users/alexd/dev/mounted-games-app/...)`
- **Concrete Measurement & Fix:** Exact KB saved, ms reduced, or offline recovery behaviour to add.
