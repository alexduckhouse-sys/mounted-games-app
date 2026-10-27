---
name: mg-navigation-consolidation-and-inline-ux-audit
description: Back-button destination accuracy, context-preserving navigation, page consolidation, and inline/in-page expansion (keeping users in flow instead of yanking them to another page, e.g. viewing a heat table inside the team view) audit skill for the Mounted Games App.
---

# Mounted Games App — Back-Buttons, Page Consolidation & In-Place UX Audit Skill

Use this skill for **Parent Agent #10 (`navigation-consolidation-parent`)** and for Claude/Codex cross-checks.

## Mission
Solve three closely related navigation and information-architecture problems across `https://mounted-games-app.vercel.app` and `web/src/`:
1. **Back Buttons Must Take You Back to the Exact Right Place:** Never dump a user at a generic or wrong page when they click a Back button or close a view.
2. **Keep Users In-Flow (Inline Expansion / Sheet Instead of Full-Page Jumps):** Stop yanking users out of their current page just to inspect related data (for example, when viewing a team on the Teams page/sheet and wanting to see their Heat table, that Heat table should expand/appear right there in the page or sheet rather than navigating away to a separate page).
3. **Combine Fragmented Pages:** Identify separate routes/pages that are too thin, repetitive, or split across multiple URLs and should be consolidated into a single cohesive screen.

---

## Multi-Agent Architecture (Parent → 3 Specialist Navigation & Consolidation Subagents)

The **Navigation & Consolidation Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent NC1 — Back-Button Destination & Navigation Context Audit
1. **Audit Every Back Button, Breadcrumb & Close Action Across `web/src/`:**
   - Grep and inspect every back link/button (`← Back`, `Back to ...`, `navigate(-1)`, `navigate('/...')`, `<Link to=...>` used as a back action) across `web/src/pages/` and `web/src/components/`.
2. **Trace Multi-Entry-Point Destinations:**
   - What happens when a user reaches a **Team page / TeamSheet**, **Heat view**, **Rider/Horse profile**, **Entry/Dec form**, **Organiser sub-page (`operations/*`)**, **Scoring screen**, or **Stream Controls** from *different* starting places (e.g. from Home ticker vs Standings tab vs Heats tab vs My Teams dashboard vs Search vs Season page)?
   - Does clicking the page's Back button take them back to a **hardcoded URL** (wrong!) instead of returning them to the exact tab, section filter, and scroll position they actually came from (with a sensible fallback if they landed via a direct shared link)?
3. **Wizard, Sheet & Modal Back Behaviour:**
   - Check the 10-step Creator Wizard, Entry flow steps, and `Sheet` / `BottomSheet` components: what happens when the user clicks the UI Back button vs the browser/phone Back button?

### Subagent NC2 — In-Place / Inline Views vs Unnecessary Page Jumps ("Don't Yank Me Out of the Page")
1. **The Flagship Case — Viewing a Heat Table from a Team View (`TeamSheet.tsx`, Team Pages, `HeatViews.tsx`):**
   - When a user is looking at a Team (on the Teams page, TeamSheet, or Team profile) and wants to see a Heat they are in (the full Heat table with all lanes, teams, and race-by-race scores), currently they shouldn't have to leave the Team view and lose their context.
   - Audit how the full **Heat table** can be rendered **inline right inside the Team view** (e.g. expanding the heat card in-place or toggling the full heat table inside the page) so the user can inspect every lane and race score without leaving the page.
2. **Hunt Every Other "Unnecessary Page Jump" Across the Entire App:**
   - **Standings → Team / Heat breakdown:** Can you expand a team's heat-by-heat breakdown or tap a heat score in Standings to see that heat table inline without losing the Standings table?
   - **Heats / Sessions → Race Rules / Equipment diagram:** When clicking a race name in a heat, does it open cleanly in-place / in a sheet rather than navigating away to the Rules Library page?
   - **Organiser Dashboard (`operations/*`) → Quick Actions:** Where does an organiser currently get bounced to a separate page to do a 5-second task (like approving a BACS payment, checking a single team's dec form, editing a delay, or swapping a race) that could happen inline on the same page?
   - **Signed-In Dashboard → My Teams / My Signups / Dec Forms:** Which items currently bounce the user across 3 different routes when they could expand inline on the dashboard?
   - **Seasons / Stats → Competition or Rider summary:** Where can quick previews appear inline before committing to a full page navigation?

### Subagent NC3 — Page Consolidation & Route Tree Simplification (`web/src/App.tsx`)
1. **Full Route Map Audit (`web/src/App.tsx`):**
   - List every route in `App.tsx` across `competition/`, `operations/`, `admin/`, `commerce/`, `seasons/`, `stats/`, `eventTools/`, and `profile/`.
2. **Identify Pages That Should Be Combined:**
   - Look for pairs or groups of pages where a user has to hop back and forth between two routes to complete one mental task (e.g. separate operations subpages that belong together, separate competition info/details/announcements/contact subviews, separate stats/records views, or separate account/profile/club views).
   - For each candidate consolidation, explain:
     - Which routes/components should merge,
     - What the combined layout looks like on `390×844` phone and `1440×900` desktop (keeping it slick and minimalist, never cluttered), and
     - Which old routes should redirect cleanly so existing links never break.

---

## Required Output Format
1. **Back-Button Bug & Context-Loss Table:** Every screen where Back goes to the wrong place or loses tab/section/scroll state, with exact `[File.tsx](file:///...)` links.
2. **In-Place / Inline Opportunities Ranked by Impact:** Starting with inline Heat Tables inside Team views, listing every place where an inline expansion or sheet should replace a page jump.
3. **Page Consolidation Blueprint:** Concrete route-merging proposals with before/after route maps and component links.
