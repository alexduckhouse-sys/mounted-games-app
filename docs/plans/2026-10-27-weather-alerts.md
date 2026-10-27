# Weather alerts for organisers, and the rain-delay forecaster

Stacked on #203 (`codex/leftover-integration`), which rewrites the ticker, shell and weather files this touches. Design: the Claude Design "Weather alert for organisers" canvas, option A (one line in the top lines). Settled with the owner: organisers only, spectators see nothing new (the organiser tells them through an announcement).

## What the organiser gets

On an event day, when thunder or heavy rain is forecast within about 2 hours of the venue, one quiet line appears under the notice line, on every page of the event:

| State | Line | Tap |
| --- | --- | --- |
| Warning (thunder) | Thunder likely from about 14:00 · What to do | "Thunder on the way" sheet |
| Warning (rain) | Heavy rain from about 13:00 · Tell everyone | "Heavy rain on the way" sheet |
| Paused for weather | Paused for thunder. We'll say when it's clear | nothing (plain text) |
| All clear | No thunder since 15:15 · Start again | "Start again?" sheet |

The warning sheet has a "Pause racing" switch (on for thunder, off for rain), an "Arenas" row (only with more than one arena), an editable announcement, "Pause and tell everyone" (or "Tell everyone" with the switch off) and "Not now". The start-again sheet has "Continue and tell everyone" and "Not yet". Both sheets carry one forecaster line: "If you start again at 15:20, the last race finishes about 17:45."

## Data flow

1. `CompetitionPage` renders `<WeatherAlert>` with the loaded competition. It owns the logic and the two sheets, and publishes the line through `WeatherLineContext`. `AppShell` renders `<WeatherLine>` inside the sticky header stack, below `TopBarTicker`. The context has a safe default, so the shell works without a provider (existing tests).
2. `useDayForecast` fetches `GET /api/weather/forecast?lat&lon&date=<today>` (existing endpoint, existing server cache, existing `weather` HttpClient, so `StubHttp` already covers it). No API change for the forecast. Polls every 10 minutes (20 in lite mode) and on tab focus after 5 minutes. The server holds a forecast for 30 minutes per rounded location, so any number of organisers cost at most one Open-Meteo call per 30 minutes per API instance. Browsers and the CDN also reuse it for 10 minutes (`public, max-age=600`).
3. `lib/weatherAlert.ts` (pure) turns the hourly data into hazard runs and works out which line to show from: the forecast, the time, the sessions' pause notes, and this device's snooze.
4. Pausing and telling everyone is one request: `POST .../sessions/pause` with `{ arenaName, reason, announcement }`. Start again is `POST .../sessions/resume` with `{ arenaName, announcement }`. Telling everyone without pausing (rain, switch off) is `POST .../sessions/weather-notice`.

### Why the API changed (small, no schema change)

- The chat announcement endpoint is Admin-only, but pausing is open to every organiser (owner Trainer, competition team). Posting the announcement from inside the pause/resume request means a Trainer who owns the event can use the whole flow, and the pause and the message cannot half-succeed.
- A pause now records why it happened as `[pausefor:thunder]` (or `rain`) in `Session.Notes`, next to `[paused:<ms>]`. That is what lets the line say "Paused for thunder", lets a second organiser's phone show the same thing, and stops "Start again" being offered after a pause for something else (a vet, say). `Notes` is already a free-text string with internal tags, so this needs no migration. `resume` strips both tags. The web hides the tag with the other internal tags.
- Existing endpoints keep working with the old bodies (all new fields are optional).

## Thresholds (written down so they can be argued with)

Hourly data from the existing forecast endpoint; an hour is "hazardous" when:

- Thunder: WMO `weather_code` 95, 96 or 99.
- Heavy rain: `precipitation` at least 4 mm in the hour (the Met Office "heavy" line), or at least 2.5 mm with `precipitation_probability` at least 70%.

Other numbers:

- Look-ahead 2 hours: a run shows once it starts within 2 hours, or is under way, and until it ends.
- Runs: hazardous hours at most one clear hour apart count as one run (one storm, not two).
- Thunder beats rain when both are in the window.
- Clear: for thunder, 30 minutes after the last thunder hour ended and at least 30 minutes after the pause; for rain, 15 minutes. Nothing hazardous may start within the next 2 hours. The 30 minutes is the usual advice to wait after the last thunder.
- Snooze ("Not now"): lasts until one hour after the run ends. A forecast that shifts the run by an hour, or stretches it, stays snoozed because the run still starts before that time. A new storm that starts after that shows again. Stored in `localStorage` per competition (`mg.weather.snooze.<id>`).
- Acting on a run (Pause and tell everyone, Tell everyone) also snoozes it, so continuing manually from the timetable page does not bring the same warning back.

## Who sees it, and when

All of: `canOrganise(competition)`, the competition has coordinates, today (device clock) is one of the event's days (start to end date, or a day with a scheduled session), and the event still has an unfinished race. Spectators, entrants and organisers on other days see nothing. Hourly data only covers today, so a warning does not look past midnight.

## Not annoying

One weather line at most. No toast, sound or push. It uses the ticker's own entrance animation (`ticker-line`, switched off for reduced motion) and nothing else. "Not now" hides it for that run. A failed or empty forecast shows nothing (fail quiet), and the last good forecast is used for up to an hour so one failed poll does not make a warning vanish. The "Paused for ..." line comes from the sessions, not the forecast, so it does not depend on the forecast loading; when the forecast is missing it drops the promise "We'll say when it's clear".

## Rain-delay forecaster

`lib/rainDelay.ts` (pure): `estimateLastRaceFinish(sessions, restartAt, { arenaName, nowMs })` marks the unfinished sessions in the arena (or all) as paused from the earlier of the existing pause or now, then calls `computeTimings` with `nowMs = restartAt`. `computeTimings` already turns "now minus paused at" into the delay and cascades it through the arena's later sessions, so no new timetable maths. The answer is the latest end of an unfinished race session, rounded to 5 minutes. Pause sheet: restart is 30 minutes after the forecast thunder ends (rain: when it ends), rounded up to 5 minutes. Start-again sheet: restart is now. When there is nothing to estimate (no times, nothing left to run) the line is left out.

## Edge cases

- **No coordinates / no forecast / offline:** no warning line. The service worker does not cache the forecast URL, so offline is a plain failure.
- **Multi-day events:** only today's date is fetched. Snoozes and the pause state are per competition; a pause note left over from an earlier day still shows "Paused for thunder" for that organiser on the next event day, which is true (the arena is still paused) and the organiser can resume from the timetable.
- **Several arenas:** the Arenas row picks all arenas or one. Start again resumes each arena that is paused for weather, one request per arena (the announcement goes with the first request only).
- **Already paused:** a pause for another reason is left alone when weather pauses it too, except that it gains the reason tag (its original `[paused:<ms>]` time is kept, so no pause time is lost). If every unfinished session is already paused, the sheet leaves out the switch and only tells everyone.
- **Forecast flipping:** the warning is a pure function of the latest forecast. Runs are merged across a one-hour gap, the snooze outlives a shifted run, and the clear line needs the 30-minute wait, so a single odd poll cannot start and stop alerts. A clear line goes back to the paused line if thunder returns.
- **BST/GMT:** the forecast is requested with `timezone=auto`; hours are turned into instants with the response's `utc_offset_seconds`, and shown in the device's clock like the rest of the app. The hold endpoint fix below is the one place the server turned typed clock times into UTC.
- **Two devices:** pause state and its reason live in the sessions, shared by the live hub. Snooze is per device by design (the brief), so the second phone may still show a warning the first one dismissed; once either pauses or tells everyone, the other updates through the sessions.
- **Event finished** (no unfinished race session): nothing shows.

## Existing bug fixed alongside

`SessionsController.HoldCompetition` read the typed resume time ("14:30") as UTC, so in BST it was an hour late. It now treats it as UK clock time with `CompetitionSetup.FromLondonWallClock`, which `CompetitionSetup` and the e-mails already use, and takes the day from the first session's UK date. A full date-time string with no zone is read the same way. Tests cover a BST and a GMT date, and the old test that encoded the bug is corrected.

## Tests

- API: BST and GMT hold, pause reason tag and announcement, resume announcement, tag stripping, invalid reason, weather-notice authorisation and validation.
- Web: hazard detection and thresholds, clear logic, snooze, forecaster, the hook (poll, fail quiet, stale), the component (every state, both sheets, arenas, errors), the shell line, catalogue completeness.
