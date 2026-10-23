# Project decisions

## 2026-10-22: A test payment page for demo events, and nothing else
- Why: the owner decided against real payments for now (competitive-gaps point 2), but the product must still show a complete entry flow in a sales demo.
- Rule: after a paid sign-up on a **demo event** the entrant goes to `/me/signups/:id/test-payment`: a page that asks for no card details, offers pay, declined card and cancel, then shows a receipt marked TEST. Real events keep "pay the organiser directly" and a Pending entry, and never reach the fake provider. The server enforces it: `demo-checkout` and `demo-refund` return 403 on a non-demo event (404 for someone else's entry), every outcome replays idempotently by key, and demo mode cannot be turned on once an event has paid entries (so a real event cannot be made payable by test).
- The mark is the existing `EventCommerceSettings.IsDemo`, not a new field. The review seeder now sets it on its eight events; competition cards, the picker and every tab of the event show "Demo event".
- Money: test payments are flagged (`TestPaymentRecord.IsTest`) and `RealIncome.ForCompetitionAsync` is the one place for organiser totals and the committee report; it returns nothing for demo events and skips test orders. The organiser's signup list and CSV label demo payments as test.
- Rejected: a new "isDemo" column on competitions (a second mark to keep in step); card-style inputs that accept test numbers (the page should never look like it collects card details).
- Not changed: the shop checkout still uses the older card-style demo form (`DemoPaymentFlow`); its API answers 409 rather than 403 on a real event.
- Files: `web/src/pages/commerce/TestEntryPaymentPage.tsx`, `DemoEntryPayment.tsx`, `web/src/components/DemoEventNotice.tsx`, `api/Controllers/CommerceController.cs`, `api/Services/Commerce/RealIncome.cs`, `api/Services/ReviewCompetitionSeeder.cs`.

## 2026-10-22: Sign-up terms tick and organiser terms text
- Why: the app streams juniors live, and entries recorded no acceptance of terms or parental consent. The filming opt-out itself is the `NoFilming` choice (rider privacy, PR #63); this adds the consent and terms side without replacing it.
- Rule: the public sign-up form has one required tick covering parental consent for the riders on the entry (including appearing on the live stream, with any limits set by the "No close-up filming or photos" box) and acceptance of the event terms. The API refuses a signup without it, or with an out-of-date wording version, and stores on the signup that it was ticked, who ticked it, when (UTC) and the wording version. The version also names the terms shown (`...+terms:default` or a short digest of the organiser's text), so the exact text can be traced.
- Terms: `Competition.TermsText` is optional plain text edited in the competition editor and shown in an expandable block beside the tick. If empty, the form shows a short placeholder labelled as one. No legal wording is built in. Duplicating an event copies the terms.
- Public stream: one sentence near the video says filming by spectators on their own phones can't be controlled.
- Not done: a per-rider "may be filmed" answer, heat warning screens and an organiser list (superseded by #63). Signups made before this have no recorded tick.
- Changing the tick text: change `CONSENT_VERSION` (`web/src/lib/termsTick.ts`) and `SignupTerms.WordingVersion` together.
- Files: `api/Services/SignupTerms.cs`, `api/Controllers/SignupController.cs`, `web/src/components/TermsTickBox.tsx`, `web/src/pages/admin/CompetitionEditor.tsx`.

## 2026-10-22: Withdrawals, no-shows, rider swaps and the re-draw
- Why: teams scratch and riders get swapped on the day, and the draw didn't react (`docs/competitive-gaps.md`, point 5). Decided the same day: the organiser marks a team out and swaps a rider; the app previews a re-draw of unscored heats and applies it only when confirmed. Trainer-side requests are not included.
- Team status: `Team.EntryStatus` (Active, Withdrawn, NoShow). The reason, actor and time live in `TeamStatusEvent`, organiser-only, never on the team row or any public DTO. Public DTOs carry only `isWithdrawn`.
- Going out removes the team from every unscored heat at once (so the public timetable, followed-team views and scoring see the remaining teams) and remembers its lanes. "Unscored" means no race in the heat has results, is complete, started, finished or signed off, the heat isn't started or finished, and its session isn't finished (`HeatProtection`). Scored and signed-off heats keep the team and its points; nothing is rewritten and no `Result` row is touched.
- Reversible until a draw is applied: reinstating puts the team back in the heats it left. Once a section draw or a re-draw has been applied for its section since, it is refused with a pointer to the timetable editor (`DrawChange` records every applied draw).
- Standings: a withdrawn team stays in the standings with its scored points and a `withdrawn` flag; HC rules are unchanged. Finals seeding (`POST /finals`, the finals boundary, populate-from-standings and populating a race final) leaves withdrawn teams out, so a team that cannot ride never takes a finalist place. Season standings are untouched (confirmed event results stand). Ambiguity for the owner: the toplist cut-off line still counts a withdrawn team's row, so the visible line can sit one place lower than the real finalist count.
- Re-draw: `GET /sections/{id}/redraw/preview`, `POST /sections/{id}/redraw/apply`. It works only on the unscored heats of each race session in the section (finals sessions and race-finals rounds are skipped), keeps teams where they are, closes lanes up, and moves the fewest teams: a heat that would hold fewer than two teams is merged away, sizes are balanced to within one, and the session's lane limit is respected when set. Teams that must move go where they have met the fewest of the heat's teams (the existing draw's opponent rule), with a stable hash as the tie-break. Same timetable, same answer. This is a cut-down use of the existing draw idea rather than a full reshuffle, so riders already told their heat keep it.
- Apply is one Serializable transaction guarded by the preview's fingerprint and a client request id (unique per competition in `DrawChange`): a stale preview gives 409, a retry of the same request returns the stored answer and changes nothing, a failed write rolls everything back. After the commit each changed session is broadcast as `sessionUpdated`, so phones and followed-team notifications recompute. The slip notification is client-side from heat times, so a re-draw that moves times by 15 minutes or more triggers it as before.
- Rider swap: `POST /competitions/{id}/declaration-forms/{formId}/swap`. The reserve takes the seat (and the captain badge), the rider goes to the reserves. Only the team's current declaration. Every declaration is locked on submit, so a swap always needs the explicit override and a reason. `RiderSwapEvent` keeps before/after, actor, time, reason and whether the lock was overridden. The trainer's own declaration flow is not widened.
- Also: withdrawn teams can't be added to heats by hand (409), are skipped when heats are generated, are left out of the section draw, and stop appearing in readiness (missing or incomplete declarations).
- Rejected: deleting the team's `HeatEntry` rows lazily at apply time (the public timetable would keep showing a team that has gone); a full reshuffle of every unscored heat (moves teams who were told their heat); writing withdrawal data onto `Team` (leaks through DTOs).
- Files: `api/Services/Operations/{HeatProtection,TeamEntryService,WithdrawalRedrawService,RiderSwapService}.cs`, `api/Controllers/WithdrawalsController.cs`, `api/Entities/Operations/{TeamStatusEvent,DrawChange,RiderSwapEvent}.cs`, migration `AddWithdrawalsAndSwaps`, `web/src/pages/operations/{EntriesPanel,RedrawPreviewView,RiderSwapSheet}.tsx`.

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

## 2026-10-22: Scorer links for volunteers without accounts
- Why: a volunteer scorer shouldn't need an account (or the shared admin key) to score one arena for a day. Accounts stay for people who run the event; links are the narrower, throwaway option decided in `docs/competitive-gaps.md` point 1.
- Rule: anyone who can run a competition (owner, competition admin, site admin) makes a link for one arena with the scorer's name. The link can enter or replace scores for heats in that competition and arena, and read that arena's timetable. Nothing else: no clock, sign-off, reopen, timetable, finals, teams, entries, chat or private data. Anything outside its arena is 404.
- The token is 256 random bits, kept in the URL fragment (`/score#t=…`, so it stays out of server logs and Referer headers) and sent in `X-Scorer-Token`. Only its SHA-256 hash is stored; it's shown once and never logged or returned again. Unknown 404, expired or revoked 410, missing 401, repeated unknown tokens from one address 429.
- Expiry: the end of the day after the competition's end date by default (an event running late still works); the organiser may choose earlier, not later. Revoking is immediate. Every score the link enters is recorded as "Scorer link: {name}" in the score history (`RaceScoreEvent.ActorLabel`).
- Rejected: a short PIN (guessable, so it would need rate limits doing the work of entropy); putting the token in the path or query (logged and sent as Referer); a link that can start and stop the clock (the clock is a staff action).
- Migration: `AddScorerLinks` adds the `ScorerLinks` table and `RaceScoreEvent.ActorLabel`; additive only.
- Files: `api/Entities/ScorerLink.cs`, `api/Auth/ScorerLinkAccess.cs`, `api/Controllers/ScorerLinksController.cs`, `api/Controllers/ScorerController.cs`, `web/src/pages/ScorerPage.tsx`, `web/src/pages/competition/ScorerLinksCard.tsx`, `web/src/offline/scorerLink.ts`.

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
