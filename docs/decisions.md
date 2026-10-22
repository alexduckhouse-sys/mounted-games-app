# Project decisions

## 2026-10-15: Trainers organise their own competitions
- Why: self-service trainer registration must not grant access to another organiser's competition or entrant records.
- Rule: admins can use organiser endpoints for any competition; trainers can use them only where the stored `CreatedByUserId` matches their authenticated ID. Managers and members are not organisers.
- Rejected: admin-only creation; the user wants trainers to create competitions too. Global trainer access was rejected by the ownership confirmation.
- Existing admin-only scoring, timetable and moderation operations remain admin-only.
- Revisit if: delegated organisers are needed; add an explicit server-managed grant rather than widening a role globally.
- Files: `api/Auth/CompetitionAccessAttribute.cs`, `api/Auth/Roles.cs`, organiser controller actions and frontend organiser controls.
- Source: AI Control Centre security-review chat, 15 October 2026.

## 2026-10-22: Owners and their competition team run the day
- Why: events are run by the organiser and helpers (co-organisers, ring scorers, line judges, commentators, stream producers), not by global admins. This was decided by the user in the 22 October review.
- Rule: scoring, sessions, finals and timetable endpoints are open to the competition's owner (a Trainer whose ID is the stored `CreatedByUserId`), to people on that competition's team (`CompetitionCollaborators`, any account type), and to admins. They're gated by the `CompetitionStaff` policy (Admin, Trainer, or on at least one team) plus `[CompetitionAccess]`, which checks the particular competition and returns 404 otherwise. Only the owner or an admin changes the team; a helper can leave.
- Still admin-only: deleting a competition or section, chat moderation, private trainer chat, global data (race templates, clubs, IP blocks, trainer approval).
- Session actions that take team IDs reject teams from another competition.
- Supersedes: "Existing admin-only scoring, timetable and moderation operations remain admin-only" in the 15 October entry, apart from moderation.
- Files: `api/Auth/CompetitionStaffPolicy.cs`, `api/Auth/CompetitionAccessAttribute.cs`, `api/Controllers/CompetitionTeamController.cs`, `ScoringController`, `SessionsController`, `CompetitionsController`.

## 2026-10-22: One competition admin role instead of helper jobs
- Why: the user wants helpers to "do whatever they need to", not to be split into scorers, line judges and so on.
- Rule: everyone on a competition's team is a competition admin, with everything the owner has for that event: day-of running, entrant sign-ups and declarations, the event shop (listing approval, manual payments and refunds), CSV team import, saved overlay looks, and adding or removing other competition admins. Nobody can remove the owner. The access check lives in `CompetitionManagers` and is shared by `[CompetitionAccess]`, commerce and event tools.
- Still not for competition admins: deleting the competition or a section (site admins only), season leagues (owner-based), and duplicating an event unless they also hold a Trainer account, since the copy belongs to whoever makes it.
- No migration: `CompetitionCollaborators.Role` stays, with one value (`CompetitionAdmin = 0`), so narrower roles could return without a schema change.
- Supersedes: the five helper roles and the co-organiser-only entrant and shop rule in the entry below.
- Files: `api/Auth/CompetitionManagers.cs`, `api/Auth/CompetitionAccessAttribute.cs`, `api/Controllers/CompetitionTeamController.cs`, `CommerceController`, `EventToolsController`, `DeclarationFormsController`, `web/src/pages/competition/CompetitionTeamCard.tsx`.

## 2026-10-16: Admins approve new trainers
- Why: trainer signup was open to anyone, and trainers can create public competitions and (with live video) broadcast on them.
- Rule: self-service trainer signup creates a Member with a `TrainerRequest` role; an admin approves (Member becomes Trainer) or declines on the admin page. Approved users must sign in again, because roles travel in the JWT. Existing trainers and admin-created accounts are unchanged.
- Rejected: a shared signup code (it leaks); leaving signup open (strangers could stream to the public site).
- No migration: roles are seeded at startup from `Roles.All`.
- Files: `api/Auth/Roles.cs`, `api/Controllers/AuthController.cs`, `api/Controllers/TrainerRequestsController.cs`, `web/src/pages/admin/TrainerRequestsSection.tsx`, `web/src/components/TrainerAccountNotice.tsx`.

## 2026-10-16: Live video through the Cloudflare Realtime SFU
- Why: organisers want to broadcast the arena from a phone to 50–200 spectators with under a second of delay; a phone can't upload a copy per viewer.
- Rule: the API alone talks to Cloudflare (`Streaming:Cloudflare:*`), so no browser ever sees the app token or SFU session ids. Broadcasters (admins, and the trainer who created the competition, via `[CompetitionAccess]`) publish over HTTP in two phases (`POST` then `/ready`); spectators negotiate anonymously over the live hub (`WatchStream`/`AnswerStream`) with opaque watch ids, a global session cap, a token bucket and a per-connection limit.
- Overlays (now-racing strip, announcements, Back soon, viewer count, and later score cards and admin banners) are drawn by the app over the video, never burned into it.
- Rejected: Cloudflare Stream WHIP/WHEP (about $1 per 1,000 viewer-minutes and no viewer counts); a phone-to-phone mesh over SignalR (a phone's upload can't serve every viewer); YouTube Live (can't broadcast from our site); LiveKit Cloud (free plan too small for 200 viewers).
- Not yet: recording and replays (the client's decision), Nest or RTMP cameras, a player that floats across pages.
- Files: `docs/specs/live-stream.md`, `api/Controllers/StreamsController.cs`, `api/Services/Streaming/`, `api/Hubs/LiveHub.cs`, `web/src/live/stream*.ts`, `web/src/components/stream/`.
- Source: live stream chat in the AI Control Centre, 16 October 2026.
