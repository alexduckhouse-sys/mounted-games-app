---
name: mg-timezones-and-multiday-audit
description: Timezone handling, BST to GMT Daylight Saving Time clock-change weekend, multi-day competition rollover, HeatRing countdowns, declaration deadlines, and .ics calendar feed accuracy audit skill for the Mounted Games App.
---

# Mounted Games App — Timezones, BST↔GMT Clock Change & Multi-Day Dates Audit Skill

Use this skill for **Parent Agent #16 (`timezones-multiday-parent`)**.

## Mission
Hunt down every date, time, timezone, Daylight Saving Time (BST↔GMT clock change), and multi-day competition rollover bug across `api/` and `web/src/`.

---

## Multi-Agent Architecture (Parent → 3 Specialist Date & Timezone Subagents)

### Subagent TM1 — Session Start Times, `HeatRing` Countdowns, Delay Cascades & BST↔GMT Clock Change
1. Trace how session/heat start times are entered in the Creator Wizard (`RefineDateTimeRow`) and `TimetablePage`, stored in the DB (`DateTime` / `DateTimeOffset` UTC vs local), and displayed in `TimetableTab`, `TimetableBoard`, `HeatRing.tsx` (`lib/heatRing.ts`), and `useTodaysEvents.ts`.
2. **BST↔GMT Clock-Change Test:** What happens when an organiser creates a Sunday session *before* the October/March clock change (while their browser is in BST `UTC+1`) for a competition day that falls *after* the clock change (in GMT `UTC+0`), or when a spectator in France (`Europe/Paris`, `UTC+1`) views a UK competition (`Europe/London`)?

### Subagent TM2 — Multi-Day Competitions (Sat + Sun / 3-Day Championships) & "Today's Events" Rollover
1. Trace what happens on a 2-day or 3-day competition (`StartDate` to `EndDate`):
   - How do `useTodaysEvents.ts`, `NeedsYouPanel.tsx`, `TimetableTab.tsx`, `competitionPhase.ts`, and `NotificationScheduler.cs` behave on Day 1 evening vs Day 2 morning?
   - Check for string-slicing date bugs (e.g. `.slice(0, 10)` on UTC ISO strings which shifts 00:30 BST into the previous day!).

### Subagent TM3 — Declaration Deadlines (`decFormDeadline.ts`), `.ics` Calendar Feeds (`CalendarController.cs`) & Historical Date Sorting
1. Audit `web/src/lib/decFormDeadline.ts`, `api/Controllers/CalendarController.cs`, and `api/Services/Calendar/`.
2. Verify that `.ics` `DTSTART`/`DTEND` timestamps have valid UTC `Z` or `TZID` formatting so Apple Calendar, Google Calendar, and Outlook put heats at the exact right hour.
