# MG App — Product Details (v2)

The Mounted Games app (the **MG App**) is a full-stack tool for running a
Mounted Games competition end to end — from public entries through live
scoring to post-event standings — on phones in a field.

- **Frontend**: React + Vite + TypeScript + Tailwind + Framer Motion (`/web`),
  installable as a PWA with offline shell + 24h API cache.
- **Backend**: ASP.NET Core 10 + EF Core + SQLite + SignalR + Identity/JWT (`/api`).
- **Realtime**: SignalR powers chat, session status, scoring, steward calls.
- **Push**: VAPID Web Push for background "your team's up" notifications.

## Who it's for

1. **Organisers** — set up a comp, take public entries, lock signups, form
   teams, schedule sessions, run the day. Trainers can also organise (they
   self-promote by creating a comp); admins have a shared key.
2. **Trainers** — see their teams, submit dec forms, share a supporter join
   key with parents, get a notification when their team is on deck.
3. **Supporters** — anyone with a team's join key can follow that team's
   schedule and dec forms.
4. **Stewards** — volunteers on a phone, anonymous, can mark eliminations
   from the lane they're watching; admins confirm via banner before scoring.
5. **Spectators** — public timetable, live scoring, chat, equipment list,
   stream embed (YouTube / Twitch), shop / marketplace.

## v2 competition lifecycle

```
 ┌─ Organiser ─────────────────────────────────────────────────────────────┐
 │ 1. Create comp: name, dates, venue, organiser, payment destination,    │
 │    sections + per-section prices.                                       │
 │ 2. Share the comp link. Public sees Details tab with a Pay £X button   │
 │    per section.                                                         │
 │ 3. Mark signups Paid as money lands (Refund / Cancel also one-click).  │
 │ 4. When entries close → Format page:                                   │
 │      a. Close signups (public form disappears)                          │
 │      b. Auto-bin paid signups into teams (Pony Club, A/B/C)             │
 │      c. Open editor wizard to pick sessions / races / lanes             │
 │      d. Heats are generated; equipment list auto-computes               │
 │ 5. Day-of: heat status, scoring, steward calls, live feed, weather.    │
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
- `/admin/competitions/:id/format` walks the organiser through close-signups →
  preview team bin → commit → hand-off to the editor wizard.
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

### Steward mode
- Public `/competitions/:id/steward` page — pick the lane you're watching;
  one big "Mark ELIMINATED" button.
- Reports queue as advisory `StewardCall` rows; admin's scoring screen
  shows a banner with Apply / Dismiss.
- IP-blocked and per-IP+team+race rate-limited.

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
- Self-identify with a Pony Club affiliation (sourced from the canonical
  clubs list, not just the comp's teams).
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

### Admin: View only vs Edit mode
- Admins land in View only — destructive controls are hidden until they
  flip Edit mode in the header.
- Trainers (organisers) don't have this toggle — they're always-on for
  their own comps.

### Offline + PWA
- Installable home-screen app, brand-colour splash.
- Workbox SW: shell precached; `/api/*` NetworkFirst with 4s timeout +
  24h cache fallback; `/hubs/*` NetworkOnly.

### Themes
- Meadow, Stable Night, Ocean, Sunset.

## What v2 deliberately doesn't ship

- **Real online payments.** The Pay button is a confirmed placeholder —
  shows the modal, records a Pending signup, organiser confirms manually.
  Stripe Connect drops into that same flow without UI changes.
- **Drag-to-reorder team formation.** Auto-bin commits in one shot; manual
  edits happen via the Teams tab after.
- **Per-individual admin accounts.** Shared admin key only.

## Stack notes for engineers

- SQLite migrations are additive: `DbInitializer.SeedAsync` calls
  `EnsureColumnAsync` for every v2 column rather than relying on EF
  migration files — letting existing DBs upgrade without touching `mg.db`.
- The frontend talks to the API at `/api` (Vite dev-server proxy in
  development; same-origin in production).
- All public endpoints respect the `IpBlocks` table.
- New since v1: shop/, signups/, push subscriptions, steward calls,
  supporter join keys, per-race timing clocks, multi-arena timetable,
  PWA, push notifications, equipment calculator.
