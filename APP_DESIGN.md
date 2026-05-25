# Mounted Games — App Design

> Source of truth for the goals of this app. **Read this before starting any change** and update it as decisions land. Avoid scope creep that isn't reflected here.

## What the app is for
A live scoring, timetable and team-management tool for Mounted Games competitions. It must work well on phones for trainers and the public at the show, and be quick for admins to set up beforehand.

## Audiences
- **Public** (default — no login). Sees timetable, current heat, results, standings, chat (read).
- **Trainer** (username + password, self-service signup at `/login` → Sign up tab). Submits dec forms for any team in the comp that isn't already claimed by another trainer. Manages their team's saved riders. Passwords hashed by ASP.NET Identity (PBKDF2).
- **Admin** (shared key, no individual accounts). Sets up competitions, edits timetable, controls heat status, creates finals.

## Core domain model
- **Club** — pony club (reference data).
- **Team** = Club + suffix (e.g. "Stockport A"). Grouped by **Section**.
- **Section** = Format (Pairs / Teams / Individual) + Age group.
- **Session** belongs to a Section. Contains **Heats**. Heats contain **Races** with results per team.
- **Rider** entries are submitted per-competition via **dec forms**. Trainers also keep a reusable saved roster per team.

## Scoring rule
- 1st place = points equal to the size of the largest heat in the session.
- Elimination = 0 points.
- Standings = sum across all races.

## Timetable UX (rules of the road)
- **Heats are the unit** users care about, not sessions. Each row in the timetable is one heat, titled `{Section name} — Heat N`. When the underlying session has a distinct name (e.g. `Seniors · Session 2`), that part is included so trainers can tell which session a heat belongs to: `{Section name} · {Session name} — Heat N`.
- Time chip is **big and bold**, primary visual anchor on the left.
- **Heat times** cascade from the section's session start by default. If `Heat.ScheduledStart` is set (admin pinned it via the row's "Pin time" button), that overrides the cascade and resets the cursor for following heats. Endpoint: `PUT /competitions/:cid/sessions/:sid/heats/:hid/scheduled-start`.
- **Breaks / briefings / custom items are not "sessions"** — render as distinct coloured strips (amber/sky/violet) with no session framing.
- **IN ARENA** and **DONE** badges are per-heat. (Active heat = first not-complete heat inside a live session.)
- Each heat row lists its **teams** with a bib-coloured circle "avatar" (suffix letter inside) — placeholder for future team photos.
- Mobile-first: bigger base text, compact paddings, reflow gracefully on narrow screens.
- After the last race heat of the timetable, show a **Create Finals** call-to-action (admin only) that seeds a finals session from current standings.
- **Find my team**: the timetable shows a "Find my team" search above the heat list (`TeamQuickSearch` in `SessionsTab.tsx`). Picking a team highlights its next heat plus the full list of heats with times. Trainers also see this on `/teams` (`MyTeamsPage`).

## Competition creation/edit (wizard) — target design
- **Full-page editor** at `/admin/competitions/new` and `/admin/competitions/:id` — not a modal. Same component, edit mode prefills.
- **Basics**: name, venue, **start date+time**, **end date+time**, map/coords, description.
- **Sections**: format + age group, one per section. Age group options include `Under 10/12/14/15/17`, `Open`, `Juniors`, `Seniors`, `Novices`.
- **Per section**: name the session, list its **races**, set **mins per heat** and **max teams per heat**, and pick the **run-off race** (defaults to `2 Flag`). Heat start times cascade from the competition start time using each section's heat duration. Admins can later **pin** individual heats to a specific time from the timetable.
- **Default race list per section** auto-populates from **Zone 2026** or **Area 2026** lists based on the section's Race-list toggle plus (format, age group): Pairs → `*_PAIRS`; Teams + Junior/Novice → `*_JUNIORS`; Teams + Senior/Open → `*_SENIORS`. Changing scope / format / age refreshes the list only when the admin hasn't customised it. Both scopes use `2 Flag` as the spare / run-off race.
- **Teams**: add teams during creation, scoped to a section, with club + suffix. **No bib colour input**. **No rider entry** in the wizard — dec forms are submitted by trainers later and fill up over time.
- **Review** then submit.
- **Draft persistence**: the wizard auto-saves to `localStorage` under `competitionEditor:new` (or `:edit:{id}`). Reloading or accidentally navigating away preserves the draft until submit, which clears it. A "Discard draft" button in the header wipes it deliberately. On edit, the server fetch is skipped if a local draft exists (so the user's in-progress edits aren't clobbered).

## Admin surface — target design
- A single **Edit / Create competition** tab in Admin is the place to create or edit any competition's metadata, sections, sessions and teams.
- Each row in the admin comp list has an Edit button that opens the full-page editor pre-populated.
- Other surfaces (timetable, teams page, etc.) **don't host competition-level editing** any more — they're for running and watching the event.
- Status toggles on heats (In Arena / Finished / Reset) stay in the timetable since they're operational, not configuration.

## In-arena information — target design
- Between heats (and at session transitions), surface a **summary of the next teams' dec forms** so the next-up teams know they're on deck and viewers can see riders/horses about to compete.
- Dec forms are submitted incrementally; the UI should gracefully handle "no dec form yet" for an upcoming team.

## Team / club pickers — rules
- Default to showing **only teams that have a dec form submitted**.
- Toggle exposes **all pony clubs** so admins can add a team on the fly.
- No bib-colour inputs in team admin. Club-level bib colour stays (clubs page) since that's where bibs are actually defined.

## Geocoding (lat/lon)
- The wizard's Basics step accepts **postcode** and **what3words**; either can auto-fill latitude/longitude via the `GET /api/geocode` preview button (anonymous endpoint).
- Server-side fallback chain when lat/lon aren't explicitly set: **Apple Maps URL → postcode (postcodes.io, no key) → what3words (api.what3words.com, needs `What3Words:ApiKey` config)**.
- Postcode is sent in requests as a transient field — not persisted to the DB. If/when persistence is needed, add a `Postcode` column to `Competition` and a migration.

## What we are deliberately *not* building (yet)
- Team photo uploads (placeholder avatar uses bib colour + suffix letter; can be added when a photo URL field is added to Team).
- Per-heat status endpoint (heat status is derived from session status + race completion until we need otherwise).
- Per-individual-admin accounts (shared admin key only).

## Open questions to confirm with the user
- "Times for each section heat" — is this a single start time per session that cascades, or a manually-set start per heat? Current wizard uses cascading; user request implies admin should be able to set them.
- "Add teams … and their _" (sentence cut off) — likely "and their riders/dec form", but confirm before building the rider-entry step inside the wizard.
- Where do bibs live now that they're off teams? They stay on the club record (existing). Confirm no other place needs them.

## Teams
- **Hors Concours (HC)**: teams can be flagged as HC. They still ride in heats but are excluded from standings + finals seeding. Admin toggles per team in the Teams tab.

## Clubs
- The seed is the canonical UK Pony Clubs list (see `DbInitializer.SeedAsync`). The seeder is additive — it never deletes clubs that already exist (they may have teams attached). To reset, drop `mg.db`.

## Sessions and finals
- **Round-robin ordering**: when creating a comp, all sections' Session 1 run first (in section order), then all Session 2, etc. Each section picks its own session count.
- **Section display name** drops the "Teams" format word (e.g. "Under 12", not "Teams Under 12"). Pairs / Individual keep theirs.
- **Race-finals format** (per-section toggle, `CompetitionSection.UsesRaceFinals`). When on, each race in the section's list becomes a **round of 3 heats** linked by `Heat.RaceRoundId`:
  - `Q1` and `Q2`: random split of section teams. Score is **1 per finisher / 0 per elimination** (`Heat.RaceRoundStage = Qualifier`, applied by `ScoringService`).
  - `Final`: starts empty. Admin clicks **Populate final** → enters top-N → server takes top-N placings from each qualifier and **interleaves lanes** as `Q1[1], Q2[1], Q1[2], Q2[2], …` up to the session's `LanesPerHeat`. Scores normally (placing × largest heat size) and adds to the qualifier total.
  - Endpoints: `POST /sessions/:sid/generate-race-finals` (called by wizard), `POST /sessions/:sid/heats/:hid/populate-race-final` (called by timetable button).
  - Each heat runs **one** race in this format. The "Mins / heat" in the wizard should reflect a single race's duration when race-finals is on.
- **Finals** heats are labelled `A Final`, `B Final`, `C Final`, … (top group first). Teams flagged HC are excluded from seeding.
- **Two ways to create finals**:
  - *Create + populate* (existing): pick TopN, races, lanes — server seeds heats with current top teams.
  - *Scaffold only* (new): tick "Scaffold only" in the modal. Creates the finals session with empty A/B/C Final heats and races/timing pre-set. Later, an admin clicks **Populate from standings** on the timetable to fill them. Endpoint: `POST /competitions/:id/sessions/:sid/populate-finals`.
- **Tie warning**: the create-finals modal calls `/finals/boundary` and warns admin when teams are tied on points at the qualification cutoff.
- **Move to next day**: admin button pushes all unstarted sessions forward by 24h (POST `/competitions/:id/shift-day?days=1`).

## Scoring
- **Editing existing race results**: when admin clicks a completed race tab in `SessionPage`, the scoring tiles pre-fill with the saved placings/eliminations. Submitting overwrites cleanly — the API already does `RemoveRange(race.Results)` on every POST.
- **Heat-end transition**: when the heat the admin is scoring transitions from in-progress → complete, a `HeatEndOverlay` shows the next heat's dec forms and a Continue button that advances `activeHeatId` (so the UI doesn't loop back to the just-finished heat).

## Race library
- Built-in races + admin-added customs live in the `RaceTemplates` table. Built-ins can't be deleted. Admin manages them at `/admin/rules`.
- Built-ins are seeded from `RaceLibrarySeed` — the canonical PC Mounted Games **Team** versions (~59 races, e.g. Bending, Mug Changes, Five Mug, Tubular Flag, Ball and Socket, PGSports Pole, Spell EGUK, Stepping Stones, Sword, Tack Shop, …) plus zone/area sponsored aliases. Pairs / JV variants can be added by admins via the UI.
- **Diagram spec** stored as JSON. Element types: `pole`, `cone`, `item`, `in` (admin-editable "table"; `table` kept as legacy alias). Each non-midline element has an editable `label`. Positions can be absolute (`x: 0-100`) or anchored to a landmark — `start`, `finish`, `midline`, `changeover` or `poleN` — with an optional `offset`. Equipment stacks via `on: DiagramElement[]` — children render above the parent.
- **Editor:** `components/DiagramEditor.tsx`. Toolbar to add elements, click-to-place on the lane, drag-with-snap to anchors, inline label editing, "Add equipment on this" to stack. Lives inside the Admin → Race Rules form. A "Show JSON" toggle exposes the raw spec for power users.
- Public-facing arena setup view at `/competitions/:id/arena` shows the live heat's race with a Next-race walkthrough. Set-up rules are shown expanded by default below the diagram.

## Live streaming
- **One stream per competition** (`Competition.StreamUrl`). YouTube and Twitch are auto-embedded; other URLs link out.
- Admins set/clear the stream from the chat tab's sidebar; viewers see it embedded above the chat.

## Steward mode
- Public/anonymous **`/competitions/:id/steward`** page so volunteer stewards can report eliminations from a phone.
- Steward picks the lane they're watching (1..heatSize). The page resolves which team is currently in that lane for the active race using the same `displayLaneFor` rotation as the scoring screen, then offers one big **Mark ELIMINATED** button.
- Reports are stored as `StewardCall` rows (RaceId + TeamId + LaneIndex + ReporterName + IpAddress). Endpoint `POST /api/races/:rid/steward-calls` is anonymous; IP-blocked addresses are rejected, and a per-IP+team+race rate-limit prevents spam (one call per minute).
- Admin's scoring screen (SessionPage) subscribes via SignalR and renders a `StewardCallBanner` above the scoring tiles for the active race. Each pending call has **Apply elim** (toggles the team into the pending placings as eliminated and dismisses the call) and a dismiss-only button. Live events: `stewardCall`, `stewardCallResolved`.
- When admin submits a race result, all pending calls for that race are auto-purged by `ScoringService.ApplyRaceResultsAsync` so they don't reappear on next view.
- Stewards see the live list of pending calls below their report button for transparency.

## Chat moderation
- Admins click any chat message to reveal Delete and **Block IP** buttons. Block IP uses the IP captured when the message was posted (`ChatMessage.IpAddress`) and adds it to `IpBlocks`. System messages and old messages without a recorded IP can't be blocked.
- Deletion broadcasts via the SignalR `chatMessageDeleted` event so other clients drop the message live.

## Chat UX (per-competition isolation)
- Chat is bound to a single competition. Each `ChatTab` shows the current comp name in its own header so users can tell which feed they're posting on.
- The team-affiliation picker in chat sources from `/clubs` (Pony Club branches + admin-added customs), not just the comp's entered teams — supporters from any club can self-identify.
- When a user opens a different comp's chat than the one they last posted to, a yellow banner warns them and offers a one-click switch back. The last-posted comp is persisted to `mg.lastChatComp` in `localStorage`.

## Supporter join-by-key (team profile sharing)
- Each `Team` has an optional `SupporterJoinKey` (8-char unambiguous code, generated by the trainer). New table `TeamSupporters { TeamId, UserId, Status }` tracks Pending / Accepted memberships.
- **Trainer flow:** in `/teams` (My Teams), each owned team card has a **Supporters** expandable block — generate / rotate / revoke the key, and accept/kick supporters from the same panel.
- **Supporter flow:** any authenticated user lands on `/teams` (route opened up beyond Trainer/Admin). A **Join a team** card at the top accepts a key. The request becomes a Pending row; the trainer accepts; the supporter then sees the team in their own My Teams list with a `Supporter` badge and gets the team's heat schedule and dec forms.
- Endpoints: `POST/DELETE /api/teams/:id/supporter-key`, `GET /api/teams/:id/supporters`, `POST /api/teams/join`, `PUT /api/team-supporters/:id/accept`, `DELETE /api/team-supporters/:id`. The `/api/trainer/my-teams` response now annotates each team with `relationship: "trainer" | "supporter"` and (trainer-only) `supporterJoinKey`.

## Trainer / supporter notifications
- **Foreground-only** browser notifications via the Web Notification API. Hook: `useTeamNotifications` (`web/src/hooks/`). Toggle lives in the My Teams header.
- Fires when:
  - A race session for one of your teams is **1 hour away** (5-min window).
  - A **briefing is 30 minutes away**.
  - The schedule has **slipped ≥ 15 minutes** ahead or behind. Re-fires at every 10-min slip bucket (15, 25, 35, …).
- Dedupe keys in `localStorage` under `mg.notify.fired:*` prevent re-firing the same alert. A 30-second polling tick checks conditions while the tab is open.
- Honest limitation: with no service worker / VAPID push, notifications stop the moment the tab closes. Background push is a future hardening pass.

## Live timing
- Heat-level `ScheduledStart` (per-heat pinning) overrides the cascade for that heat onwards. See *Timetable UX* and *Heat scheduling* in memory.
- `computeTimings` (`web/src/lib/time.ts`) flags `shifted=true` only when scheduled vs effective differ by **≥ 5 minutes** — smaller drifts round into the same 5-min display slot and don't trigger amber rendering.
- Timing updates propagate live via the existing SignalR `sessionUpdated` / `resultsUpdated` events, so when a heat finishes early/late every later heat's time updates without a refresh.

## Weather chips
- `WeatherNow` lives in the timetable toolbar — refreshes every 15 min from `/api/weather/current`, shows the venue's current icon + temperature + wind.
- `WeatherAt` lives on each heat row next to the time chip — hourly forecast for the heat's expected time, from `/api/weather/at`.
- Both are no-ops when the comp has no lat/lon set (the wizard's geocode lookup usually fills these in).

## Declarations entry points
- The global `/declarations` page (`DeclarationsIndexPage`) now has a **Submit dec form** CTA at the top. If a current competition is set, it deep-links to that comp's Declarations tab. Otherwise it pops an inline comp picker.

## Multi-arena timetable
- `Session.ArenaName` groups the timetable per arena. When a comp has more than one arena in use, `SessionsTab` renders an arena tab-strip with an "All" view that columns the arenas side-by-side, plus a per-arena single-column view.
- Single-arena (or unnamed) comps fall back to the original single-list view.

## CSV exports
- **Timetable export** — button on the SessionsTab toolbar. One row per heat (or per break/briefing) with: date, time, arena, section, session, heat label, status, teams.
- **Dec forms export** — button on the DeclarationsTab. One row per rider with: team, captain/reserve flags, name, DOB, horse, bib, submitter, phone, submission timestamp, notes.
- Both use the helpers in `web/src/lib/csv.ts` — client-side BOM-prefixed UTF-8 CSV with proper quoting; Excel-friendly.

## Reference docs
- `docs/pc-mounted-games-race-rules-2026.md` — full PC Mounted Games Race Rules 2026 text. Used as the source of truth when refreshing `RaceLibrarySeed` (senior + pairs + JV variants) and tuning diagrams.

## PWA + offline
- `vite-plugin-pwa` generates a Workbox service worker (`dist/sw.js`) on every build. Manifest declares the app as installable to a phone's home screen (`Mounted Games`, brand-colour splash).
- **Precache**: shell (JS/CSS/HTML) so the app shell loads offline.
- **Runtime caching**: `/api/*` is `NetworkFirst` with a 4s timeout and a 24-hour cache fallback — the timetable, comp detail, race templates and weather all open instantly when offline (showing the last good response). `/hubs/*` (SignalR) is `NetworkOnly` because realtime is meaningless from cache.
- SW registration in `web/src/pwa.ts` shows a "new version ready" prompt on update.

## Draft auto-save (other forms)
- **Dec form** drafts auto-save to `mg.draft.decform:{compId}` while the trainer is typing — riders, notes, phone. Restored on reload, cleared on submit or Cancel-with-confirmation. (Wizard auto-save was already in place for comp creation.)
- **Scoring placings** per-race auto-save to `mg.draft.scoring:{heatId}:{raceId}` — the admin's pending placings survive a reload mid-scoring.
