# MG App — Product Details (v2)

The Mounted Games app (the **MG App**) is a full-stack tool for running a
Mounted Games competition end to end — from public entries through live
scoring to post-event standings — on phones in a field.

- **Frontend**: React + Vite + TypeScript + Tailwind + Framer Motion (`/web`),
  installable as a PWA with offline shell + 24h API cache.
- **Backend**: ASP.NET Core 10 + EF Core + SQLite + SignalR + Identity/JWT (`/api`).
- **Realtime**: SignalR powers chat, session status, scoring.
- **Push**: VAPID Web Push for background "your team's up" notifications.

## Who it's for

1. **Organisers** — set up a comp, take public entries, lock signups, form
   teams, schedule sessions, run the day. Trainers can also organise (they
   self-promote by creating a comp); admins have a shared key.
2. **Trainers** — see their teams, submit dec forms, share a supporter join
   key with parents, get a notification when their team is on deck.
3. **Supporters** — anyone with a team's join key can follow that team's
   schedule and dec forms.
4. **Spectators** — public timetable, live scoring, live feed (read-only),
   stream embed (YouTube / Twitch), shop / marketplace.

## v2 competition lifecycle

```
 ┌─ Organiser ─────────────────────────────────────────────────────────────┐
 │ 1. Create comp in the stepped creator: details, age groups, structure  │
 │    and timing (sessions, HHF, minutes, arena), races (optional).       │
 │    The comp gets a provisional timetable straight away.                │
 │ 2. Share the comp link. Public sees Details tab with a Pay £X button   │
 │    per section.                                                         │
 │ 3. Mark signups Paid as money lands (Refund / Cancel also one-click).  │
 │ 4. When entries close → On the day page (`/format`):                   │
 │      a. Close signups (public form disappears)                          │
 │      b. Auto-bin paid signups into teams (Pony Club, A/B/C)             │
 │      c. Settle race lists (anything chosen in the creator is there)     │
 │      d. Heats are generated around breaks; the timetable turns exact    │
 │ 5. Day-of: heat status, scoring, live feed, weather.                   │
 │ 6. Finals: create-and-populate or scaffold-and-populate-from-standings.│
 └────────────────────────────────────────────────────────────────────────┘
```

## Features

### Public signup (v2)
- Per-section `Pay £X` button opens a "online payment coming soon — pay
  organiser directly" modal showing the comp's payment destination, then
  records a Pending signup.
- Free sections skip the modal and auto-mark Paid.
- `SignupsLocked` toggle on Competition: when on, the public form disappears
  and the API rejects new entries.
- Refunded / Cancelled / Delete actions on every signup row.
- Per-section CSV export and a comp-level CSV export for offline reconciling.
- Logged-in users see every signup they've made at `/me/signups`, with
  payment status, comp date and (once formed) which team they're on.

### Format-after-signups (v2)
- `/admin/competitions/:id/format` (titled "On the day") walks the organiser
  through close-signups → preview team bin → commit → race lists → generating
  the exact timetable. Structure is set in the creator (`docs/specs/creator-wizard.md`).
- Auto-formation rule: paid signups are grouped by Pony Club (free-text match
  against the canonical list, "Unaffiliated" as fallback) then split into
  teams of N (default 4 for Teams, 2 for Pairs, 1 for Individual). Extras
  spill into A / B / C teams of the same club.
- Preview-first: see exactly which signups land on which team before commit.
- Optional "replace unused existing teams" so the organiser can re-run
  formation after marking more signups paid.

### Timetable
- Heat-as-row layout, big bold time chip on the left, IN ARENA / DONE
  badges per heat. Bib-coloured team avatars.
- Heat times cascade from session start with per-heat pinning override.
- Multi-arena view with per-arena tabs and an "All" side-by-side view.
- Live shifted-time chip when reality drifts ≥ 5 min from schedule.
- Per-heat weather forecast (Open-Meteo, hourly).

### Live scoring
- Tap teams in finishing order — 1st = size of the largest heat in the
  session, last place = 1, eliminated = 0.
- Long-press / right-click to mark eliminated.
- Per-race start/stop clock; results auto-broadcast via SignalR.
- Mid-race scoring drafts auto-save per-race to localStorage so a refresh
  doesn't lose pending placings.
- Heat-end overlay surfaces next-up dec forms before the next heat starts.

### Finals
- Standard: create-and-populate (TopN by points → A/B/C Finals).
- Scaffold: empty A/B/C Final heats, fill later from current standings.
- Tie warning at the qualification cutoff.
- Race-finals format per-section: each race becomes Q1 + Q2 + Final round.

### Dec forms
- Trainer fills riders for their team per-competition; saves to a roster
  for re-use. Auto-saved drafts per comp.
- Bib colour, captain / reserve flags, DOB, horse name, optional notes.
- CSV export.
- "Submit dec form" CTA on the global `/declarations` page.

### Race library
- ~60 built-in PC Mounted Games races with rules text and drag-editable
  diagrams (poles + cones + items + stations, equipment stacks via `on:`).
- Admin can add customs at `/admin/rules`.
- Override map (`RaceLibraryUpdates`) pushes canonical rule refreshes
  on every API startup to existing DBs.

### Equipment calculator
- Walks every race in every session, multiplies counts by the largest
  heat size, dedupes across sessions taking the MAX per kind+bucket.
- Per-comp endpoint + expandable block on the Details tab.

### Chat / live feed
- One feed per comp, SignalR-backed.
- Only admins and trainers post. Admin posts are public; trainer posts
  are private to the admins (and the trainer who sent them).
- Yellow banner if you've drifted to a different comp's chat than the one
  you last posted to.
- Admin: delete + block-IP per message.
- Per-comp stream URL (YouTube / Twitch auto-embedded) above the chat.

### Trainer + supporter notifications
- Foreground (browser Notification API) and background (VAPID push)
  fires when:
  - A team's session is 1 hour away.
  - A briefing is 30 minutes away.
  - The schedule slips ≥ 15 minutes.
- Per-trainer dedupe keys in localStorage.

### Shop / marketplace
- Public `/shop` page with image posts (client-side resized, base64),
  public + private comment threads, reports, IP-block enforcement.

### Admin dashboard
- Admins see one dashboard on Me: what needs them, quick actions, today's events and site admin. There is no Edit mode switch.

### Offline + PWA
- Installable home-screen app, brand-colour splash.
- Workbox SW: shell precached; `/api/*` NetworkFirst with 4s timeout +
  24h cache fallback; `/hubs/*` NetworkOnly.

### Themes
- `EGUK` (default), `Meadow`, `Stable Night`, `Ocean`, `Sunset`.

## What is deliberately out of scope right now

- **Real online payment card processing.** Real events record Pending entries for manual BACS/direct organiser confirmation; demo events (`EventCommerceSettings.IsDemo`) use the labelled no-card test payment flow (`/me/signups/:id/test-payment`).
- **Drag-to-reorder team formation.** Auto-bin commits in one shot; manual edits happen via the Teams / Timetable & draw pages after.

## Stack notes for engineers

- Postgres (Neon) in production with EF Core migrations (`npm run db:migrate`); SQLite locally and in tests with additive startup guards in `DbInitializer` / `*SqliteSchema.cs`.
- The frontend talks to the API at `/api` (Vite dev-server proxy in development; Vercel rewrite to `mounted-games-api` in production, forwarding client IP via `MG_PROXY_KEY`).
- All public endpoints respect `IpBlocking.IsIpBlockedAsync` (raw IPs and keyed HMAC network hashes from blocked accounts).
- Visual house style, Refine controls, button hierarchy and copywriting rules are defined in [`docs/designs/design-decisions.md`](./docs/designs/design-decisions.md).

## v3 & v4 additions (23–26 October 2026)

- **10-step competition creator, saved starting points & entry-first public view:** competitions are set up in the redesigned 10-step wizard (`/admin/competitions/new` and `:id`) from scratch, copied from a past event, or loaded from a saved `StartingPoint` (`CompetitionSetup`: setup only, never teams/scores/entrants). Includes searchable nation/flag icons, structure, timing, HHF, hatband colours, per-final race lists (`A/B/C Final`), final scoring switches (`HasFinal`, `CarryPointsIntoFinal`, `DoublePointsInFinal`), and adaptive `"Dec form questions"`.
- **Redesigned Set-Up & Organiser Pages (`/competitions/:id/*`):** `Preparations` (`operations`), `Event details` (`event-details` with save-as-you-go cards look, Yellow/Red card switches and per-section tack scoring table), `Sections & races` (`sections`), `Entries & dec forms` (`entries`, grouped by section with Paid status pop, stabling, waitlists, Pair matchmaking and Guest Rider spots), `Timetable & draw` (`timetable-and-draw` with steppers, hatband colour helper and `⋯` menu), `Equipment` (`equipment`), and `Sponsors & sharing` (`sponsors-and-sharing`).
- **Full-screen phone scoring & volunteer Scorer QR links (`/score#t=...`):** full-screen scoring (`ScoringSection` + `ScoringParts`) with heat picker bar (`HeatViews`), race `‹ ›` switcher, `10px` solid left hatband bars, tap-to-place, press-and-hold to eliminate (`250 ms` → `600 ms`), `⋯` race tools (`RaceToolsSheet`: per-team HC, Yellow/Red cards, points override/adjustment), saved tick, climbing standings rows, and `BetweenHeats` next-heat view.
- **Stream controls (`Overlay · Auto · Replay · Camera`), Follow-Cam & Commentary Desk:** `/competitions/:id/stream-controls` provides 2-column overlay choice tiles, auto rules, a 30-minute IndexedDB circular replay buffer (`replayBuffer.ts`) with Follow-Cam keyframe editing (`ReplayInspector.tsx`) and `Cancel clip`, and multi-phone camera management, paired with `/competitions/:id/commentary` (PA Desk) and `/competitions/:id/tv` (TV Kiosk).
- **Announcements, WhatsApp-style message threads & swear filter:** `/competitions/:id/announcements` manages pinned notices and sent announcements; `/competitions/:id/messages/:userId` provides per-person message threads with `Block` in the header and server-side swear filtering (`SwearFilter`).
- **Site admin, Master Admin, invitations & custom audience emails:** `/admin` (`Needs you / Competitions / Manage the site`), `/admin/users`, `/admin/blocked` (account blocks + hashed `AccountIps`), `/invite#t=...` one-time 7-day email invitations (`AccountInvite`), `MasterAdmin` lock/block hierarchy, and batch-sent custom emails (`/admin/email`, `CustomEmailService`) with RFC 8058 one-click unsubscribe.
