# Mobile redesign handoff: timetable, live & stream, heat scores

**Status:** decided, ready to build · **Date:** 16 Oct 2026
**Design canvas:** "MG App · Timetable arena selector" (Claude Design artifact), one row per page.
**Rendered reference:** [`mobile-redesign-proposal.html`](mobile-redesign-proposal.html) (390 × 844 phone artboards).
**Base:** build on `origin/main` (96f2aa2 or later). The local `main` checkout is behind and still has the old Inter/green UI, so ignore it.

All colours and type come from the existing tokens in `web/src/theme/skin.css` (`--mg-*`, Barlow / Barlow Condensed). No new palette.

---

## 1. Timetable: arena picker → button + bottom sheet

**Canvas artboard:** `D-Sheet.dc.html` ("D · Arena picker + sheet (new look)")
**File:** `web/src/pages/competition/TimetableBoard.tsx` (+ `timetable.css`)

### Decision
Replace the horizontally scrolling `.tt-arenas` chip row with **one picker button that opens a bottom sheet**.

Rejected: sticky segmented control (A), swipeable live arena cards (B), colour-coded merged timeline (C).

### Picker button
- Only rendered when `arenas.length > 1` (same condition as today).
- Stays **sticky** at `top: var(--mg-shell-h)`, same as `.tt-arenas` now, inside the white band.
- Full width, `min-height: 56px`, `border: 1.5px solid rgb(var(--mg-control))`, radius 10px, surface background.
- Contents, left to right:
  - map-pin icon (20px, heading colour)
  - stacked label: eyebrow `ARENA` (12px, 600, uppercase, letter-spacing .06em, muted) over the selected name (17px, 700, heading colour). With no arena chosen, the name reads "All arenas".
  - `mg-badge mg-badge-live` "Live" when the selected arena has a live row
  - chevron-down (muted)
- `aria-haspopup="dialog"`, `aria-expanded`.

### Bottom sheet
- `role="dialog"`, `aria-modal="true"`, `aria-label="Choose arena"`.
- Overlay `rgb(var(--mg-overlay) / .55)`. Tapping it closes the sheet.
- Sheet: surface background, top radius 20px, padding 10px 12px 28px (+ safe-area inset), drag handle (40×5, `--mg-control`).
- Header: "Choose arena" (Barlow Condensed 22, 700, heading) plus a 44px close (×) button.
- Options, each a `<button>` row with `min-height: 64px` and radius 10:
  - radio dot (22px; selected = 7px border in heading colour)
  - name (17px, 700) over a sub line (13px, muted)
  - right-hand badge: `Live` (mg-badge-live) or `Later` (outlined badge)
  - selected row background `rgb(var(--mg-tint))`, `aria-pressed="true"`
- First option is **All arenas** ("Everything, in running order"), then each arena in the existing order.
- Footer note (13px, muted): "We'll remember your arena on this phone."

### Sub-line rules (per arena, from `dayRows`)
1. A live row exists → `On now: {heat name}`, plus ` · running N min late` if it is late.
2. Otherwise the next upcoming row → `Starts HH:MM · {heat name}`.
3. Otherwise → `Finished`.

### Behaviour
- Picking calls the existing `chooseArena(name)`, so the `mg.tt.arena.{competitionId}` localStorage key still works, then closes the sheet.
- Esc closes the sheet. Trap focus while it is open and return focus to the picker button when it closes.
- Slide-up animation, turned off under `prefers-reduced-motion`.
- `.tt-live-dot` chip styles can go once the chip row is removed.

---

## 2. Live & stream: public is read-only, staff post

**Canvas artboards:** `Live-Public.dc.html`, `Live-Staff.dc.html`
**File:** `web/src/pages/competition/ChatTab.tsx` (Matt is doing the functionality; this section is the layout spec)

### Decisions
- **Only admins and trainers can post.** Everyone else sees banners and announcements only: no chat, no "name + team" identity form, no composer.
- Staff can post two kinds of thing:
  - an **announcement**, which goes into the list
  - a **banner**, which is pinned. There is **one banner at a time**, and a new one replaces the old.
- The page **must fit one phone screen without the page scrolling**. If space runs short, the announcements card scrolls inside itself.

### Public layout (top → bottom)
1. Shell header + ticker strip (unchanged).
2. Band: "Live & stream" (`mg-h1 mg-h1-sm`) + `mg-badge-live` when something is live.
3. **Stream player**, 16:9, radius 12. Its caption bar shows a Live badge, the stream name and a "Full screen" link.
4. **Pinned banner**:
   - colours: background `--mg-late-bg`, text `--mg-late-ink`
   - megaphone icon
   - text 16px/700, with "Pinned by organisers · HH:MM" (13px) underneath
   - `role="status"`
5. **Announcements**: `mg-section-head` with an "All N" link on the right, then a `mg-card mg-list` of the **latest 3**. Each row is a time (Barlow Condensed 15/700, muted, 40px column) plus text clamped to 2 lines.
6. Bottom tabs.

### Staff layout (admin / trainer)
Same structure, with these differences:
- **Band badge:** "Organiser" (tint background, heading text) instead of Live.
- **Stream:** collapses to one card row: thumbnail, "Stream is on" over the stream name, and a **Change** button (44px). This frees space for the composer.
- **Banner:** gains an **Unpin** button (44px target). The sub line reads "Pinned banner · everyone sees this".
- **Announcements:** each row is one line (ellipsis) with a 44px **delete** (bin) button.
- **Composer**, pinned above the bottom tabs, in a surface card with a 1.5px heading-colour border:
  - `mg-seg` switch: **Announcement | Pin as banner**
  - `mg-field` input (48px, 16px text so iOS doesn't zoom). Placeholder: "Write an announcement…" or "Banner text, replaces the pinned one".
  - 48px send button in `--mg-button`

### Open questions
- What should the public see when no stream URL is set: hide the player, or show a placeholder?
- Do banners expire, or stay until someone unpins them?
- Which role check should gate staff mode: `canOrganise()` or `canEdit()`?

---

## 3. Heat scores: slimmer top

**Canvas artboard:** `Scores-C.dc.html` ("Heat scores · PICKED")
**Files:** `web/src/pages/competition/HeatScores.tsx`, `heat.css`, and the shell (`components/AppShell.tsx`)

### Decisions
- On the heat page, **the shell header becomes a compact page bar**, and HeatScores' own white band (‹ Timetable link, badge, h1) is **removed**.
- **The ticker strip stays** under the compact bar.
- **The heat title moves into the empty corner of the score table**, above "Team".
- **No heat switcher.** We tried one; nobody would use it.
- The rotated race names stay. The numbered-columns-plus-key variant (B) was rejected.

### Compact bar (replaces the header on this page, ~60px)
- `mg-header` background, padding 8px 12px.
- Left: 44px back button (chevron-left, `aria-label="Back to timetable"`), styled like `mg-nav-btn`.
- Middle (flex 1): competition name (Barlow Condensed 18/700, ellipsis) over `{Section} heats · {Arena}` (13px, `--mg-header-sub`).
- Right: status badge (`mg-badge-live` "On now" / tint "Finished" / `mg-badge-soft` "Next"), then the 44px menu button.
- Suggested mechanism: let a page hand the shell a compact-bar config (back target, title, subtitle, badge) through context or an outlet prop, so other detail pages can reuse it.

### Ticker on this page
- Same strip as everywhere else (deep header colour, badge + text + › next button).
- Nice to have: skip the ticker item for the heat being viewed, since it's already on screen.

### Title in the table
- Table header height **92px → 104px**.
- The Team header cell (`th`, padding 10px 4px 8px 12px) holds a title block, then the "TEAM" label:
  - section eyebrow, e.g. `U12` (12px/700, uppercase, letter-spacing .08em, muted)
  - heat name, e.g. `Heat 2` (Barlow Condensed 28/700, heading)
  - meta line (13px/500, muted):
    - live: `Race N of M · {race name}` in `--mg-elim`, 600
    - finished: `HH:MM · Final result`
    - upcoming: `Starts HH:MM`
- Use a `div` inside the `th`, because headings aren't valid there. Keep a page `<h1>` for screen readers (sr-only, e.g. "U12 Heat 2 scores").
- With the `#` rank column (finished heats) the cell is narrower, but the title still fits.
- Everything else in the grid is unchanged: rotated names, running race in red, elimination 0 in red, Pts column, the two buttons underneath.

### Result
All six teams and both buttons fit on a 390×844 screen with no scrolling. Before this change the scores started about 300px down the page.

### Open question
- Apply the same compact bar to the **Toplist** page, which has the same stacked header?

---

## Not taken forward (for reference)
- Timetable options A, B and C, and the old-look reference screen (old UI from the stale local checkout).
- Heat scores options A (compact bar only) and B (bar + heat switcher + numbered race columns).
