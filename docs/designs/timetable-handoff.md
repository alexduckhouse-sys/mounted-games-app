# Timetable page: design handoff

Settled on 27 October 2026. Nothing here is built yet. The source of truth is the **Decisions** board on the Design canvas, <https://claude.ai/artifact/4VPP38bJqE1Won4SW9hmAP>. Re-read it before building, because the user edits it there.

On the canvas, the top row is the current design: Decisions, "Timetable with filter sheet · current design" (`Sheet-Working`), F4 and E. The rows below hold the earlier options and say which one was chosen.

Goal: more function with fewer and smaller buttons, so there is less chrome above the first heat. Today there is about 236 px of it: header 56, ticker 44, filter strip 44, late line 52 and the delay row 40.

## Decided

| Area | Decision | Code today |
| --- | --- | --- |
| Ticker position | A dock just above the tab bar (layout C), on every competition page, not only the timetable. | `components/TopBarTicker.tsx`, `TickerContext.tsx`, `AppShell.tsx` |
| Ticker animation | Push up: the new line pushes the old one off the top (0.45 s, `cubic-bezier(.65,0,.35,1)`). It holds each line for 3.5 s, or 6 s for a notice, and stops while the list or the filter sheet is open. No progress line. No amber flash when a notice arrives. | `lib/ticker.ts` |
| Ticker list | Tapping the ticker opens every update above it. Tapping anywhere else closes the list, and the ticker carries on. | |
| Filters | One filter button beside the ticker (F4), with a count badge when an arena or age group is set. The chosen filters show as removable chips at the top of the list. The header subtitle says what you're looking at, for example "Tuesday · All ages". | `TimetableBoard.tsx` `.tt-strip` dropdowns go |
| Filter sheet | Developed from S3. A bottom sheet with a scrim behind it: day tabs, then age group tiles, then an arena slider, then "Show N heats". | |
| Day tabs | They fill the full width of the sheet's top bar and show the day name only ("Tuesday"), with no date and no "Today". 19px Barlow Condensed bold; the chosen day is navy with a 3px underline. | |
| Age group tiles | A two-column grid. Each tile shows the name (19px condensed bold) and what's on, for example "3 heats · on now" or "2 heats · next 10:30". There's no "All ages" tile: with no tile chosen you see every age, and tapping the chosen tile again clears it. | |
| Arena | A segmented slider (All arenas / Main / Arena 2) with a white thumb. | |
| Session headings | Same as the live site: 15px capitals, `.tt-group-title h2`. | `timetable.css` |
| Breaks | Each break gets its own heading line above it, like a session: "BREAK" on the left and the arena and length on the right ("Main · 55 min"), then the time and name row underneath. Breaks are not counted as heats. | |
| Late and early | Plain "+10" (amber `#8A5A00`) or "−5" (green `#1F6B43`) text beside the heat name. No crossed-out planned time and no box. | `TimetableBoard.tsx` |
| Announcements | Shown once, in the ticker. The `AnnouncementPop` card goes. This is my reading of "don't double show"; the user can change it on the board. | `CompetitionPage.tsx` (pop-up plus ticker items) |
| Delay row | The +15 / +30 / −15 / Pause / ±min / Apply row goes. A delay becomes a custom number of minutes typed in organiser edit mode, and it goes live straight away. | `TimetableBoard.tsx` shift row; `TimetableBoard.test.tsx` covers it and needs updating |
| Organiser edit mode | Organisers edit the timetable in place from a pencil on the page (board E): one amber bar at the top of the list where they type the minutes and tap Shift. **Paused: don't build yet.** | |

## Motion (match the live site)

- Colours, borders and backgrounds ease over 150 ms with `cubic-bezier(.22,1,.36,1)` (`--mg-ease-out`, `--mg-dur-fast`).
- Press: buttons shrink to `scale: .96` in 90 ms and spring back over 260 ms with `cubic-bezier(.34,1.56,.64,1)`. This is the same `--mg-press-t` pattern as `.mg-nav-btn` and `.kit-pill` in `theme/skin.css`. Full-width day tabs and the ticker line use `.98`.
- Day tabs: the underline glides to the tapped day (300 ms, ease-out). The tiles and the list slide 18 px in from the side of the tapped day and fade in (260 ms).
- Arena slider: the white thumb glides to the tapped arena (300 ms, ease-out).
- With `prefers-reduced-motion` all of this is off.

## Still open (ask before building)

- Pause and continue: today's Pause goes with the delay row. Keep it in edit mode, or drop it?
- Build order: the page first (ticker, filters and sheet), then edit mode.

## Gotcha found on the canvas

The Design canvas runtime wraps every `{{hole}}` in `<span class="sc-interp">`. A descendant rule such as `.gt span { font-size: 12px }` then shrinks the text inside `.gt h2`. Use child selectors (`.gt > span`). The live app's `.tt-group-title > span` already does.
