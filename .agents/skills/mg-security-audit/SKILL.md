---
name: mg-security-audit
description: >-
  Comprehensive security, privacy, authentication, authorisation, multi-tenancy,
  child safeguarding, and rate-limiting audit skill for the Mounted Games App
  (ASP.NET Core 10 API + React 19 Vite PWA + SignalR + Cloudflare SFU + Vercel).
  Use when running security reviews, penetration-style code audits, or duplicate
  cross-model security checks across Claude, Codex, and Antigravity.
---

# Mounted Games App — Security & Privacy Audit Skill

Goal: Perform an exhaustive, zero-trust security and privacy audit of the Mounted Games App (`api/` and `web/`), verifying every finding against the actual code or integration tests before reporting.

## Hard Safety & Privacy Rules (Never Violate)
1. **Never** read, print, log, or transmit `.env` files, keys, tokens, `~/.claude/private-terms.txt`, `~/.claude/ai-control/token`, or `~/.claude/ai-control/approvals.key`.
2. **Never** put real personal data (addresses, dates of birth, phone numbers, medical notes) into prompts, logs, fixtures, or reports.
3. **Never** make destructive calls against production or Neon databases. Run automated security tests only against throwaway SQLite via `dotnet test tests/MountedGames.Api.Tests`.

---

## Audit Domains & Checklist (Split Across Subagents)

### Domain S1: Authentication, Account Lifecycle, Locks, Blocks & Rate Limits
- **Admin-key & Master Admin (`AuthController`, `AccountAccessController`, `Roles.cs`):**
  - Verify `POST /api/auth/admin-key` with an email requires a password, refuses locked/blocked accounts or blocked networks, and enforces `RateLimits:AccountsPerIp` (default 5 retained accounts per IP) and `RateLimits:AuthPerMinute` (default 5/min per IP).
  - Verify `POST /api/auth/master-admin` compares `MasterAdmin:KeyHash` in constant time, returns 404 when unset, refuses the shared admin-key session, and logs only the account ID.
  - Verify `Roles.MasterAdmin` cannot be granted via `/register` or `/api/admin/users/{id}/roles` by a non-MasterAdmin, and that only a MasterAdmin can lock/unlock or block/unblock an `Admin` or lift a MasterAdmin's lock/block (`LockedByMaster` / `BlockedByMaster`).
- **Session Revocation (`LiveAccounts.cs`):**
  - Confirm deleted, emptied-shell, locked (`LockedAt`), and blocked (`BlockedAt`) accounts have their active JWTs rejected on subsequent requests (`LiveAccounts` middleware/filter).
- **Email Invitations & Confirmation Tokens (`AccountInvitesController`, `AccountEmail.cs`):**
  - Confirm invite tokens (`/invite#t=...`) are 256-bit random values sent only in the URL fragment, stored only as SHA-256 hashes, single-use, 7-day expiry, and rate-limited.
  - Confirm email confirmation tokens (`AccountEmailService`) and unsubscribe tokens (`EmailUnsubscribeTokens`) are HMAC-bound and never logged.
- **Visitor IP & Rate Limiting (`ProxyClientIpMiddleware`, `RequestLimits.cs`, `IpBlocking.cs`):**
  - Confirm `X-Forwarded-For` is never read directly by controllers; client IP comes solely from `ProxyClientIpMiddleware` (trusted proxy or `MG_PROXY_KEY` == `Security:ProxyKey` in constant time, stripping headers afterward).
  - Confirm `IpBlocking.IsIpBlockedAsync` checks both raw IPs and keyed HMAC hashes (`AccountIps`), avoids blocking shared venue Wi-Fi (≥ 5 other accounts), and never leaks `BlockReason` outside `/api/admin/blocked-users`.

### Domain S2: Authorisation, IDOR & Multi-Tenant Competition/Club Isolation
- **Per-Competition Access (`[CompetitionAccess]`, `CompetitionStaffPolicy`, `CompetitionManagers`):**
  - Walk every controller action that mutates or reads staff-only competition data (`CompetitionsController`, `SessionsController`, `ScoringController`, `WithdrawalsController`, `DeclarationFormsController`, `SignupController`, `CommerceController`, `EventToolsController`, `SponsorsController`, `StreamsController`, `ChatController`, `ScorerLinksController`, `TackCheckController`).
  - Confirm every per-competition write has `[Authorize(Policy = CompetitionStaff.Policy)]` (or `Roles.Organiser` / `Roles.Admin`) **plus** `[CompetitionAccess(...)]` matching the route/resource ID, returning `404` (not `403`) to non-owners.
  - Confirm child resources (`sessionId`, `heatId`, `raceId`, `teamId`, `signupId`, `formId`, `sponsorId`) are verified to belong to the route `competitionId` (preventing cross-competition IDOR such as placing Competition B's team into Competition A's heat).
- **Scorer Links (`ScorerController`, `ScorerLinkAccess.cs`):**
  - Confirm `[ScorerLinkAccess]` tokens (`X-Scorer-Token`) can **only** read the scoped competition/session/heat timetable and submit/update scores for in-scope heats (`InScopeAsync`), and are rejected on every other authorised endpoint (`ScorerLinkTests`).
- **Club & Declaration Scoping (`ClubAccess.cs`, `DeclarationFormsController`, `ClubPayoutsController`):**
  - Confirm `ClubAccess.IsClubManagerAsync` re-checks the `Manager` role against the database (not just a stale JWT claim).
  - Confirm `DeclarationFormsController` allows private reads, drafts, submissions, and deletions only for competition staff, the team's assigned coach, the club's Manager, or a trusted self-entrant with `SignupMatchmaking.DeclarationAccessGranted == true` (never via a public supporter code or typed team name).
  - Confirm `ClubPayoutsController` restricts bank/responsible-person endpoints to that club's Manager or Admin (`403` to another club's Manager) and **never** persists, logs, or returns a full bank account number or IBAN (only sort code, last 4 digits, IBAN country).

### Domain S3: Child Safeguarding, UK GDPR & Sensitive Data Redaction
- **Children's Personal Data on Declarations (`Mappings.ToPublicDto`, `DecFormRules`):**
  - Confirm date of birth, weight, birth year/age group, equine passport number, membership number, emergency contact, medical notes, trainer phone, and custom question values are **always blanked/null** in `ToPublicDto` (`CanReadPrivate == false`), public exports, calendar feeds, embed widgets, and share cards.
- **Safeguarding Flags (`UseInitialOnly` & `NoFilming`):**
  - Confirm `RiderNames.Display` formats `UseInitialOnly` riders as `"First L."` on all public endpoints, scoreboards, print views, and `StatsService` searches (so searching by surname as a non-admin does not reveal a `UseInitialOnly` child).
  - Confirm `NoFilming` triggers the safeguarding notice for producers/broadcasters without exposing private rider details publicly.
- **Referee Notes & Internal Tags (`ResultStatuses.cs`, `Mappings.cs`):**
  - Confirm `Result.RefereeNote` and `TeamStatusEvent.Reason` are stripped from public DTOs and `StatsService`, and internal `[card:...]` / `[flag:...]` tags are never raw-printed in public `BibDescription` or forged by non-staff team updates (`Team.BibDescription` concurrency token + tag sanitisation).
- **Payment & Demo Isolation (`EventCommerceSettings.IsDemo`, `RealIncome.cs`):**
  - Confirm `demo-checkout` and `demo-refund` return `403` on non-demo competitions, demo mode cannot be enabled once real paid entries exist, and `RealIncome.ForCompetitionAsync` excludes demo events and test orders.

### Domain S4: CSP, Framing, XSS, File Uploads, SignalR & External Integrations
- **Security Headers & `/embed/` Clickjacking (`SecurityHeadersMiddleware.cs`, `web/vercel.json`):**
  - Confirm `SecurityHeadersMiddleware.cs` and `web/vercel.json` match byte-for-byte (`SecurityTests`), ban `*` and `unsafe-eval` in CSP, enforce `frame-ancestors 'none'` and `X-Frame-Options: DENY` on all app routes, and restrict `frame-ancestors https:` strictly to `/embed/*`.
  - Confirm `/embed/*` (`EmbedApp`) never accesses `localStorage`, `sessionStorage`, auth tokens, or service worker caches, and never redirects unknown `/embed/*` URLs into the main app.
- **Open Graph / Crawler SSR (`web/middleware.ts`, `web/src/lib/shareCard.ts`):**
  - Confirm every field interpolated into crawler HTML (`og:*`, `twitter:*`, `<title>`) passes through `escapeHtml` and comes strictly from `[PublicRead]` endpoints.
- **Binary Image Uploads (`SponsorLogos.cs`, `CustomEmailsController.cs`, `ShopController.cs`):**
  - Confirm sponsor logos (≤ 200 KB) and custom email images (≤ 500 KB) verify magic bytes against PNG/JPEG/WebP, **reject SVG** (preventing stored XSS), and serve with `X-Content-Type-Options: nosniff`.
- **SignalR Hub & Cloudflare SFU (`LiveHub.cs`, `StreamsController.cs`):**
  - Confirm `LiveHub` methods (`JoinCompetition`, `WatchStream`, `AnswerStream`) validate inputs, enforce viewer caps, never leak `comp:{id}:admins` events (such as private trainer chat) to public `comp:{id}` subscribers, and never expose Cloudflare SFU tokens or session IDs to clients.

---

## Reporting Format for Security Agents
For every finding:
1. **Severity:** `Critical` | `High` | `Medium` | `Low` | `Informational`
2. **Location:** Clickable `[File.cs](file:///.../File.cs#L10-L25)` link and endpoint/component name.
3. **Exploit Scenario:** Exact step-by-step request/action an attacker or unauthorized role would perform and what happens.
4. **Verification:** How you proved it in the code or via an xUnit/Vitest test.
5. **Recommended Fix:** Minimal, non-breaking fix that preserves all existing invariants.
