# Project decisions

## 2026-10-22: Deleting your own account
- Why: people must be able to remove themselves, and the privacy page promises it. `DELETE /api/auth/me` with the current password in the body does it (the same lockout as sign-in applies to wrong guesses).
- Refused: the shared admin account and any account with no password (admin-key sessions), with a message to ask an administrator; the last account in the Admin role.
- Rule: private data goes, event history stays with the person removed, ownership links are cleared. Each step is explicit in `AccountDeletionService`, not left to foreign-key cascades.
  - Deleted: trainer notes, push subscriptions, overlay looks, team supporter requests, competition team memberships, the saved rider roster (other people's children; declarations already made keep their own copy), private marketplace messages they wrote, sign-in roles/claims/logins/tokens.
  - Anonymised, kept: chat messages, marketplace posts, comments and reports (author link cleared, name becomes "Deleted user", IP address and post contact details cleared); declaration forms (`SubmittedByUserId` cleared); section signups (a payment record: account link and contact details cleared, the payer's name stays); private messages sent to them stay for their author, no longer addressed to anyone.
  - Ownership cleared: `Competition.CreatedByUserId` and `Team.TrainerUserId` become null. The competition or team carries on, an admin can run it, and a team shows as unclaimed.
  - Left as they are: audit columns that hold a bare user id with no foreign key (scoring audit, rulebook and overlay "updated by", `CompetitionCollaborator.AddedByUserId`, IP block creator, stream starter). With the account gone the id points at nobody.
  - Kept as an emptied shell (no migration): seasons, team profiles, season publications, event team links, catalogue items and event orders reference the account with non-nullable restricted keys. If the account owns any, the row stays but is anonymised in place: email and name replaced, phone and password cleared, roles removed, locked out for good, and catalogue items switched off. Everything else above still happens. The username is freed for reuse.
- Sessions end with the account: `LiveAccounts` turns away a token whose account is gone or emptied (checked on each request, cached for 60 seconds, so another API instance may accept it for up to a minute).
- Rejected: always anonymising in place (leaves a row for every leaver); cascading deletes through seasons and orders (would erase published results and payment records other people rely on); a migration to make those keys nullable (not worth it for this change; revisit if shells pile up).
- Files: `api/Services/AccountDeletionService.cs`, `api/Controllers/AuthController.cs`, `tests/MountedGames.Api.Tests/Auth/AccountDeletionTests.cs`, `web/src/pages/AccountPage.tsx`.

## 2026-10-22: Raw IP addresses are kept for 30 days
- Why: addresses on chat messages and marketplace posts, comments and reports exist so an admin can block an abusive poster. They shouldn't sit in the database for ever.
- Rule: after 30 days (`Privacy:IpRetentionDays`) `IpRetention` replaces each address with `h1:` plus a shortened HMAC-SHA256 of it, keyed from `Privacy:IpHashKey` (or derived from the JWT key). It runs shortly after start-up and every six hours, because the API scales to zero. A hashed address can't be blocked; the block action says so.
- Rejected: plain SHA-256 (the IPv4 space is small enough to reverse); clearing the value (loses the ability to spot a repeat poster inside the same event).
- Files: `api/Services/IpRetention.cs`, `api/Controllers/ChatController.cs`.

## 2026-10-22: Declarations need a coach or an organiser
- Why: any Trainer, Manager or Member could submit or overwrite a declaration for a team nobody had claimed.
- Rule: `POST /api/declaration-forms` needs the team's coach (`TrainerUserId`), an admin, the competition's owning Trainer or someone on its team. The web now lists only those teams.
- Also: `GET /api/geocode` is limited per IP (`RateLimits:GeocodePerMinute`, 20) because it can call the paid What3Words API, and an anonymous viewer can hold at most 5 streams open per IP (`Streaming:MaxViewersPerIp`).
- Files: `api/Controllers/DeclarationFormsController.cs`, `api/Security/RequestLimits.cs`, `api/Services/Streaming/ViewerRegistry.cs`, `web/src/pages/competition/DeclarationsTab.tsx`.

## 2026-10-15: Trainers organise their own competitions
- Why: self-service trainer registration must not grant access to another organiser's competition or entrant records.
- Rule: admins can use organiser endpoints for any competition; trainers can use them only where the stored `CreatedByUserId` matches their authenticated ID. Managers and members are not organisers.
- Rejected: admin-only creation; the user wants trainers to create competitions too. Global trainer access was rejected by the ownership confirmation.
- Existing admin-only scoring, timetable and moderation operations remain admin-only.
- Revisit if: delegated organisers are needed; add an explicit server-managed grant rather than widening a role globally.
- Files: `api/Auth/CompetitionAccessAttribute.cs`, `api/Auth/Roles.cs`, organiser controller actions and frontend organiser controls.
- Source: AI Control Centre security-review chat, 15 October 2026.

## 2026-10-22: Sharing links, calendars and QR codes
- Why: shared links showed a blank preview, and organisers and parents had no way to put heat times in a calendar or scan into an event or a team.
- Rule: link previews are answered by `web/middleware.ts` for preview crawlers only (not search engines), from public share cards, with every value escaped. A team's calendar feed is one link per team, managed by the team's trainer and anyone who can run the competition (`CompetitionManagers`: admins, the owning Trainer, competition admins); only a hash of its token is stored, regenerating replaces it, and it lists public timetable facts only. QR codes are generated in the browser. Followers don't get their own feed links; the trainer shares the team's link.
- Rejected: per-user feed tokens (a second table and revoke flow for little gain); signed-in-only feeds (calendar apps send no credentials); a QR web service (leaks the join key); the shareable team results card (not included for now).
- Files: `web/middleware.ts`, `web/src/lib/shareCard.ts`, `api/Controllers/CalendarController.cs`, `api/Controllers/ShareController.cs`, `api/Services/Calendar/`, `web/src/pages/eventTools/PosterPage.tsx`, `web/src/pages/TeamSharing.tsx`.
- Source: competitive-gaps point 6, decided 22 October 2026.

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
