---
name: mg-irritants-and-annoyances-audit
description: Dedicated UX irritant, premature offline/reconnecting banner, loading flicker, scroll-reset, live-update input clobbering, toast spam, iOS auto-zoom, and everyday annoyance hunting skill for the Mounted Games App (https://mounted-games-app.vercel.app + codebase).
---

# Mounted Games App — Irritants, False Alarms & Everyday Annoyances Audit Skill

Use this skill for **Parent Agent #9 (Irritants & Annoyances Parent Agent)** and for Claude/Codex cross-checks.

## Mission
Hunt down every **micro-irritant, false alarm, premature banner, flicker, scroll jump, input clobber, and everyday annoyance** that makes a user sigh, lose their place, or distrust the app on `https://mounted-games-app.vercel.app` and in `web/src/`.

---

## Multi-Agent Architecture (Parent → 3 Specialist Irritant-Hunting Subagents)

The **Irritants & Annoyances Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent IA1 — Premature Offline / Reconnecting Warnings, Cold-Start Flickers & Toast Spam
1. **Offline & Reconnecting Banners Appearing Too Fast (`web/src/offline/`, `web/src/live/`, `AppShell.tsx`, `TopBarTicker.tsx`):**
   - Inspect every place `navigator.onLine`, SignalR connection state (`Reconnecting`, `Disconnected`), or failed API requests trigger a visible banner, pill, or warning.
   - **The Irritant:** Does an "Offline" or "Reconnecting..." notice appear *instantly* on initial page load before SignalR connects, during a brief 300ms mobile signal handover, or while the Vercel API container wakes from scale-to-zero cold start?
   - Verify whether there is a proper **grace period / debounce** (e.g. `2500ms–4000ms` of sustained disconnect or confirmed offline state) before alarming the user, and whether it dismisses smoothly the instant connectivity returns.
2. **Loading / Empty-State / Error Flickers (`PageProblem.tsx`, route loads, tab switches):**
   - When switching tabs or waiting on an API call, does the UI briefly flash `"No competitions found"`, `"0 teams"`, `"Not found"`, or a jarring spinner for `<150ms` before the real data arrives?
   - Check if cached data (`web/src/offline/`) is shown immediately while revalidating silently in the background (`stale-while-revalidate`), or if the screen blanks out on every tab switch.
3. **Toast & Banner Spam (`Toast.tsx`, pop-ups, sticky bars):**
   - Check if routine actions trigger redundant toasts, if multiple toasts stack and obscure the bottom navigation bar or primary CTA on a `390×844` phone, or if toasts lack a quick swipe/tap-to-dismiss.

### Subagent IA2 — Live-Update Clobbering, Scroll Resets, Filter Loss & Navigation Traps
1. **SignalR Live Updates Clobbering Active User Work (`useLiveHub.ts`, competition & organiser pages):**
   - **The Irritant:** Suppose a user has a bottom sheet open, is typing a message/entry/declaration, is halfway through editing a race/heat, or is scrolled halfway down a long standings/heats page when a `RaceScored` or `CompetitionUpdated` SignalR event arrives.
   - Does the incoming refetch **reset local component state**, close their open `Sheet`/`ConfirmPopup`, wipe their partially typed form input, or jump their scroll position back to the top?
2. **Scroll Position & Filter/Tab State Reset on Back Navigation:**
   - If a user filters heats by "Under 12s" or searches for a rider, clicks a team/heat, and presses Back, does the app forget their selected section/filter/tab and dump them back on the default tab at scroll `0`?
3. **Modal / Sheet Scroll-Lock & Back-Button Traps (`Sheet.tsx`, `ConfirmPopup.tsx`, `BottomSheet.tsx`):**
   - Check if `document.body.style.overflow = 'hidden'` can ever get stuck if a route changes while a sheet is open (locking page scroll permanently until refresh).
   - Check if pressing the phone's hardware/browser Back button while a full-screen sheet is open yanks the user completely off the page instead of closing the sheet, or traps them in a redirect loop.

### Subagent IA3 — Form Annoyances, iOS Auto-Zoom, Premature Validation & Touch Hazards
1. **iOS Safari `< 16px` Input Auto-Zoom Irritant (`390×844` Phone):**
   - Audit every `<input>`, `<select>`, and `<textarea>` across `web/src/` CSS (`kit.css`, `eventPages.css`, `sitePages.css`, `wizard.css`, Tailwind classes). Any input with computed `font-size < 16px` (`1rem`) on mobile forces iOS Safari to zoom the screen in when tapped and leaves the viewport zoomed in after closing the keyboard.
2. **Premature / Nagging Validation & Lost Form Work:**
   - Do forms show red error text on the first keystroke before the user has finished typing?
   - Do number steppers or text inputs jump cursor position or reject intermediate typing (like clearing a number field to type `12` and having it snap to `0` so you end up typing `012`)?
   - Does clicking outside a sheet with unsaved form input accidentally discard 5 minutes of typing without warning or draft persistence?
3. **Thumb-Zone Touch Hazards & Sticky Overlap on Phone (`390×844`):**
   - Check if sticky bottom bars, floating action buttons, or the bottom tab bar overlap the last row of a table or the "Save" button at the bottom of a page (`padding-bottom` / `env(safe-area-inset-bottom)`).
   - Check if destructive buttons ("Reset", "Clear", "Delete", "Eliminate") sit right next to primary buttons without enough separation or confirmation.

---

## Required Output Format
Every irritant finding MUST include:
- **Irritant Severity:**
  - `RAGE-INDUCING` (wipes user input, locks scroll, false-alarms constantly, or blocks buttons)
  - `HIGHLY ANNOYING` (flashes offline/error banners prematurely, loses scroll/tab state on Back, iOS auto-zooms)
  - `MILDLY IRRITATING` (brief layout jump, redundant toast, missing keyboard `inputMode`)
- **Trigger Scenario:** Exact step-by-step description of how a real user triggers the annoyance on `https://mounted-games-app.vercel.app` or in the code.
- **File & Line Links:** Clickable `[File.tsx](file:///Users/alexd/dev/mounted-games-app/web/src/...#L10-L30)` links.
- **Clean Fix:** Concrete debounce, state-preservation, or CSS fix.
