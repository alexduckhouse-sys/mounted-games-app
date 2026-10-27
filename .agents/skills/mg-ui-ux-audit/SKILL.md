---
name: mg-ui-ux-audit
description: Comprehensive UI, UX, slick minimalist visual polish, responsive layout (390x844 phone & 1440x900 desktop), 5-theme aesthetic, accessibility, and copywriting audit skill for the Mounted Games App (https://mounted-games-app.vercel.app + codebase).
---

# Mounted Games App — Slick Minimalist UI/UX & Visual Polish Audit Skill

Use this skill when running the **UI/UX Parent Agent** or when Claude, Codex, or Antigravity performs a duplicate UI/UX audit.

## Primary Aesthetic Lens: Slick, Minimalist, Effortless & Modern

The primary goal of this audit is to evaluate the **overall look, feel, minimalism, visual hierarchy, and slickness** of the live site (`https://mounted-games-app.vercel.app`) alongside the codebase (`web/src/`):
- **Minimalist & Uncluttered:** Every page should breathe. Flag visual noise, crowded cards, redundant badges/pills, competing borders, or walls of text that break the calm, minimalist aesthetic.
- **Instant Visual Hierarchy:** On every screen, the eye should immediately know (1) where I am, (2) what the primary status/score is, and (3) what the single main action is.
- **Slick Typography & Alignment:** Check tabular numbers (`font-variant-numeric: tabular-nums`) on scores/lanes/times, crisp baseline alignment in rows, consistent padding/radii, and awkward text wrapping or truncation on mobile (`390×844`) and desktop (`1440×900`).
- **Cohesive House Style (`docs/designs/design-decisions.md`):** Use `docs/designs/design-decisions.md` and `APP_DESIGN.md` as context for how components (`Sheet`, `ConfirmPopup`, `Toast`, `PageProblem`, `HatSilk`, `RoundStepper`, `RoundSearch`, `BibBadge`, `WeatherIcon`) are designed to work together cleanly.

---

## Multi-Agent Architecture (Parent → 4 Specialist UI/UX Subagents)

The **UI/UX Parent Agent** MUST spawn **4 specialist child subagents** in parallel, each inspecting both the live deployed site (`https://mounted-games-app.vercel.app`) and the source components (`web/src/`):

### Subagent U1 — Public Competition & Discovery Experience (`E1–E19`, `S1–S10`, `P1–P4`)
Inspect every public-facing screen for slick, minimalist sports-app polish:
1. **Home, Discovery, Seasons & Past Champions:**
   - Does the landing page feel like a premium, modern sports platform?
   - Are competition cards, season league tables, and historical archives clean, scannable, and free of clutter?
2. **Competition Hub, Overview, Heats, Standings & Finals:**
   - Are heat draws, lane badges (`L1–L6`), hat silks, and live standings tables effortless to scan at a glance?
   - Is the A Final cutoff line subtle and clear?
   - Do Team Sheets (`TeamSheet.tsx`), Rider/Horse stats, and Prize Giving views look balanced and well-proportioned?
3. **Entry Flow, Declarations, Pair-Ups & Announcements:**
   - Does the entry and stabling flow (`EntryForm.tsx`) feel lightweight and frictionless?
   - Are the Announcements feed and WhatsApp-style Message Threads clean and readable?

### Subagent U2 — Signed-In Dashboard, Club Shop, Organiser Suite & 10-Step Creator Wizard
Inspect every authenticated and organiser workflow:
1. **Signed-In Dashboard, Account, Invites & Club Shop:**
   - Does the signed-in dashboard surface action items, today's heats, and quick links with a clean, minimalist layout?
   - Does the Club Shop (`ClubShopPage.tsx`) feel like a polished storefront?
2. **10-Step Competition Creator Wizard (`web/src/pages/admin/creator/`):**
   - Walk all 10 steps (`Start`, `Dates`, `Money`, `Stabling`, `Arenas`, `Age groups`, `Finals`, `Races`, `Dec form`, `Done`).
   - Are step transitions, form controls, inline validation, and summary previews calm and uncluttered?
3. **Organiser Dashboard & Management Pages (`O1–O16`) + Site Admin:**
   - Check entries/stabling management, BACS approval, session/timetable controls, and Site Admin moderation screens for table density, spacing, and visual clarity.

### Subagent U3 — Ringside Phone Scoring, Broadcast Stream Desk, Pop-ups & Print Layouts
Inspect the high-pressure operational screens:
1. **Full-Screen Phone Scoring (`ScoringParts.tsx`, `RaceToolsSheet.tsx`):**
   - At `390×844`, does the scoring screen feel bold, unmistakable, and thumb-friendly with zero wasted space or accidental tap hazards?
2. **Stream Controls Desk (`StreamControlsPage.tsx`: `Overlay · Auto · Replay · Camera`) & Commentator Box:**
   - At `1440×900`, does the broadcast desk look like a sleek, modern production control room without visual chaos?
3. **Pop-ups, Bottom Sheets, Empty States, QR Codes & Print Layouts (`@media print`):**
   - Check the 8 pop-up/warning kinds (`ConfirmPopup.tsx`), `Sheet.tsx`, `Toast.tsx`, `PageProblem.tsx`, QR code modals/cards (ensuring a crisp white quiet-zone border in dark themes and valid target URLs), and printable judge/steward sheets for visual polish and consistency.

### Subagent U4 — Responsive Viewports (`390×844` & `1440×900`), 5 Themes, Lite Mode & Accessibility
Inspect cross-cutting visual quality across the live site:
1. **Phone (`390×844`) vs Desktop (`1440×900`) Layout Harmony:**
   - Hunt for horizontal scrollbars (`scrollWidth > clientWidth`), squashed flexbox items, awkward 2-line button wraps, or desktop screens with overly wide/unbalanced containers.
2. **All 5 Themes + Outdoor Daylight Readability:**
   - Check contrast, surface layering, border subtlety, and badge legibility across all 5 themes (especially high-contrast outdoor/daylight and dark themes).
3. **Lite Mode (`?lite=1`) & WCAG 2.2 AA Polish:**
   - Check focus rings (`:focus-visible`), tap target spacing (`>= 44×44px` on mobile), icon button labels, and how cleanly Lite Mode simplifies the UI.

---

## Required Output Format (Per Subagent & Parent Summary)

Every finding MUST include:
- **Category:** `VISUAL POLISH` | `MINIMALISM / CLUTTER` | `LAYOUT / RESPONSIVE` | `THEME / CONTRAST` | `UX FLOW / COPY` | `ACCESSIBILITY`
- **Severity:** `HIGH` (breaks visual layout, looks broken, or hurts usability) | `MEDIUM` (cluttered, inconsistent spacing/alignment, or awkward mobile wrap) | `LOW` (subtle polish opportunity to make the page look slicker)
- **Page / Route & Viewport:** e.g. `https://mounted-games-app.vercel.app/competitions/:id` at `390×844`
- **Component & Lines:** Clickable `[File.tsx](file:///Users/alexd/dev/mounted-games-app/web/src/...#L10-L25)` link
- **What It Looks Like Now vs How to Make It Slicker:** Concrete, actionable visual recommendation.
