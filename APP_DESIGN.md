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
- **Heats are the unit** users care about, not sessions. Each row in the timetable is one heat, titled `{Section name} — Heat N`.
- Time chip is **big and bold**, primary visual anchor on the left.
- **Breaks / briefings / custom items are not "sessions"** — render as distinct coloured strips (amber/sky/violet) with no session framing.
- **IN ARENA** and **DONE** badges are per-heat. (Active heat = first not-complete heat inside a live session.)
- Each heat row lists its **teams** with a bib-coloured circle "avatar" (suffix letter inside) — placeholder for future team photos.
- Mobile-first: bigger base text, compact paddings, reflow gracefully on narrow screens.
- After the last race heat of the timetable, show a **Create Finals** call-to-action (admin only) that seeds a finals session from current standings.

## Competition creation/edit (wizard) — target design
- **Full-page editor** at `/admin/competitions/new` and `/admin/competitions/:id` — not a modal. Same component, edit mode prefills.
- **Basics**: name, venue, dates, **competition start time**, map/coords, description.
- **Sections**: format + age group, one per section.
- **Per section** (new): name the session, list its **races**, and set **mins per heat for that section**. Heat start times cascade from the competition start time using each section's heat duration.
- **Teams**: add teams during creation, scoped to a section, with club + suffix. **No bib colour input**. **No rider entry** in the wizard — dec forms are submitted by trainers later and fill up over time.
- **Review** then submit.

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
- Built-ins are seeded from `RaceLibrarySeed` — the canonical PC Mounted Games **Team** versions (~59 races, e.g. Bending, Mug Changes, Five Mug, Tubular Flag, Ball and Socket, PGSports Pole, Spell EGUK, Stepping Stones, Sword, Tack Shop, …). Pairs / JV variants can be added by admins via the UI.
- Diagrams stored as a JSON spec (`pole`, `cone`, `item`, `table`, `midline` element types with 0–100 positions along the lane). Rendered as SVG.
- Public-facing arena setup view at `/competitions/:id/arena` shows the live heat's race with a Next-race walkthrough.

## Live streaming
- **One stream per competition** (`Competition.StreamUrl`). YouTube and Twitch are auto-embedded; other URLs link out.
- Admins set/clear the stream from the chat tab's sidebar; viewers see it embedded above the chat.

## Chat moderation
- Admins click any chat message to reveal Delete and **Block IP** buttons. Block IP uses the IP captured when the message was posted (`ChatMessage.IpAddress`) and adds it to `IpBlocks`. System messages and old messages without a recorded IP can't be blocked.
- Deletion broadcasts via the SignalR `chatMessageDeleted` event so other clients drop the message live.
