# Entries-open emails and nearest-first events (27 October 2026)

Status: built on `feat/entries-open-emails` (merged as part of #211); review fixes on `fix/entries-digest-security`. Settled by the user: everyone on the opt-in list gets every newly opened event; we never ask anyone where they are; when we can infer roughly where someone is, show nearest first.

## What "opened" means

A competition is **open for entries** when it is not archived, not a demo (`EventCommerceSettings.IsDemo`), has not finished (`(EndDate ?? StartDate) >= today`), has at least one section, is not `SignupsLocked`, and its `CompetitionEntrySettings.EntriesCloseAt` has not passed. One rule, `EntriesOpenRule`, used by the digest. (The picker's own `EntriesOpen` tag is unchanged.)

There is no "opened at" column, so "newly opened" is the first time the rule is true while the competition is not in `EntriesDigestCompetitions` (its primary key is the competition id, so a competition is announced at most once, ever).

## Data model (migration `AddEntriesDigest`)

| Table | Key columns |
| --- | --- |
| `EntriesDigestRuns` | `Id`, `RunDate` (unique, string: the UK date `yyyy-MM-dd`, or `baseline`), `ClaimedAt`, `Status` (Sending, Done, Baseline), `Manual`, `Competitions`, `Total`, `CompletedAt` |
| `EntriesDigestCompetitions` | `CompetitionId` (PK, plain int, no FK), `RunId` (FK, cascade), and the frozen text and dates the email is made from: `Name`, `Location`, `StartDate`, `EndDate`, `Latitude`, `Longitude`, `EntriesCloseAt` (see "Security review fixes") |
| `EntriesDigestRecipients` | `Id`, `RunId` (FK, cascade), `OptInId`, `Status` (Pending, Claimed, Sent, Failed, Skipped), `ClaimedAt`, `ClaimToken`, `Attempts`; unique `(RunId, OptInId)` |

No address is stored: a recipient row holds the opt-in id, and the address is read from `EmailOptIns` at send time (so an unsubscribe is honoured to the last moment). No location column anywhere.

## Claim and idempotency

1. **Claim the day.** One `SaveChanges` inserts the run (unique `RunDate`), its competitions (unique competition id) and one recipient per distinct active address (lowest opt-in id per lower-cased address). It is one transaction, so a run is whole or absent. If the insert throws (`DbUpdateException`, a unique clash from another instance), the loser clears its change tracker and carries on with whatever run exists. Same code on SQLite and Postgres because it relies only on a unique index and the exception type, not on provider SQL.
2. **Claim a batch.** As in `CustomEmailService`: `ExecuteUpdate` marks up to N pending (or stale-claimed, or failed-with-attempts-left-and-15-minutes-old) rows `Claimed` with a fresh token; the batch then works only on rows carrying its token; settling a row is conditional on that token.
3. **Send.** Each message carries `Idempotency-Key: entries-digest-{runId}-{optInId}`, so a crash between the provider accepting and our settle cannot double-send within the provider's window. The claim goes stale after 2 minutes.
4. **Finish.** When no row is pending, claimed, or failed with attempts left (3), the run becomes Done.
5. A run older than two days with rows left is closed and the rest marked Skipped, so a Monday digest never arrives on Wednesday.

## Triggers

- `NotificationScheduler.TickAsync` (every minute while an instance is up) calls `EntriesDigestService.TickAsync`: continue unfinished runs; if it is 18:00 to 22:59 UK time and today has no run and something is pending, claim today and work for up to ~40 s.
- First ever tick (no run at all): a **baseline** run records the competitions already open as announced and sends nothing, so switching this on never mails a backlog.
- Site-admin card on Admin → Email: pending events, recipient count, last run, and **Send now** (confirm + expected count, like custom emails). It claims today's run early (so the evening tick finds it claimed) and works one batch per call; the page repeats until nothing remains.
- **Vercel cron: not added.** See "Cron" below.

## Ordering and location

Per recipient at send time: venues of competitions they entered (signups by account or contact address), trained (`Team.TrainerUserId`) or supported (accepted `TeamSupporter`), last ten non-demo ones with coordinates, averaged. Matching an opt-in address to an account is by normalised email. No history means date order. Competitions without coordinates go after located ones, by date. Nearest first; ties by date, then id. The email shows no distance.

`GET /api/competitions/picker/near-you` (new; `/picker` stays identical for every viewer, so the offline cache rule holds): origin = signed-in user's history, else the proxy-keyed rough position of the connection, else none. It loads the whole upcoming set (bounded at 500), sorts (today's events first, then nearest-first with unlocated last, or soonest-first), then pages in memory, so page boundaries are right. It returns `locationKnown`, the sort used, and `distances` (whole miles) for the page. `Cache-Control: no-store`. The web falls back to the public picker when this call fails, so offline behaviour is unchanged.

Rough position of a connection: `web/middleware.ts` copies `x-vercel-ip-latitude/longitude`, rounded to one decimal place, into `X-MG-Client-Lat/Lon` next to the IP and the proxy key. `ProxyClientIpMiddleware` trusts them only when the key matches, re-validates and re-rounds, puts them in `HttpContext.Items` for that request, and always strips the headers. Never logged, never stored.

## Privacy

Nothing about location is persisted: no column, no log line, no cache (`no-store`). Privacy page gets one sentence. Opt-in wording and its version are unchanged (the promise "email me when new competitions open" is exactly what the digest does).

## Cron

Vercel documents cron jobs for Vercel Functions: an HTTP GET to the production URL with `Authorization: Bearer $CRON_SECRET`, always in UTC. The API runs as a container service under `services`; the docs list no `crons` key for services and none for the container runtime, and I cannot try a deployment here. Adding an unverified `crons` entry to the root `vercel.json` could break the API deploy, so it is skipped. Cost: the evening send happens only if an instance is awake between 18:00 and 22:59 UK time (any visitor wakes one); otherwise it waits for the next evening, or an admin presses Send now. Follow-up if wanted: verify crons on a preview deployment, then add a `CRON_SECRET`-protected GET that calls the same `TickAsync`; it is idempotent, so two UTC entries (17:00 and 18:00) would cover BST and GMT.

## Risks and how each is tested

| Risk | Handling | Test |
| --- | --- | --- |
| Double send across instances | unique `RunDate`, unique `(RunId, OptInId)`, claim token, idempotency key | two concurrent `TickAsync` calls produce one run and one message per person; second `SendNow` sends nothing new |
| Run interrupted half-way | recipient rows persist; stale claims retaken; next tick continues | budget of one message per call, then resume; abandoned claim older than 2 minutes is retaken |
| Failed sends | up to 3 attempts, 15 minutes apart, then left as failed | provider failure marks Failed, not Sent; retry only after the wait |
| Clock change weekend | UK date and hour come from `Europe/London` (manual rule as fallback when the zone database is missing) | 24 Oct 17:30 UTC is 18:30 BST (sends), 26 Oct 17:30 UTC is 17:30 GMT (waits), 26 Oct 18:00 UTC sends; rule test for the fallback |
| Unsubscribed mid-run | address re-checked per recipient | unsubscribe after claim, before send: Skipped, no message |
| No coordinates | unlocated after located, by date | ordering test for the picker and the email |
| Email disabled | tick and Send now do nothing; no run is claimed, nothing is marked announced; 409 for Send now | tick with email off leaves the pending list intact |
| Header spoofing | location headers read only with a valid proxy key; always stripped | wrong or missing key ignored; out-of-range and non-numeric values ignored; precision re-rounded |
| Demo and locked events | rule excludes demo/locked/closed; re-checked at send time for each recipient | demo never announced; locked before claim not announced; locked after claim dropped from the email |
| SQLite vs Postgres | no provider SQL in claim code; schema guard test for SQLite; migration script checked by eye against the EF output | `EntriesDigestSchemaTests`; whole suite on SQLite |
| Backlog on first deploy | baseline run | first tick sends nothing and records open events |
| Admin endpoints | `Roles.Admin` | anonymous 401, non-admin 403 |

## Security review fixes (27 October 2026)

A read-only review of PR #205 found these; each was checked in the code first.

- **Venue history through `near-you` (medium).** Accounts can be created for addresses nobody has confirmed, so matching the token's email against `SectionSignups.ContactEmail` let someone read where a family competes from the distances returned. `LocationInference.FromHistoryAsync(userId)` now matches on the account only (entries, trained teams, accepted follows). The address match stays in `ForAddressAsync`, used only to order the digest sent to that same mailbox. Test: an account whose email equals another entry's contact address, with no entries of its own, gets `LocationKnown=false` and no distances.
- **Organiser text sent to the whole list (medium).** The claim now copies each competition's name, venue, dates, coordinates and close time into `EntriesDigestCompetitions`, and every batch sends from those frozen values (the live check only decides whether the event is still open). PR #205 had already been merged (through the integration PR #211) when this review was fixed, so `AddEntriesDigest` (`20261027161822`) is left exactly as merged and a second, additive migration does the work: `20261027204636_FreezeEntriesDigestCompetitionText` adds the seven columns to `EntriesDigestCompetitions` (a backfill copies the current competition text into any row from a run claimed before it, so such a run still sends) and the `IX_SectionSignups_ContactEmail` index. The idempotent script, snapshot and SQLite guard (`CREATE TABLE` plus `EnsureColumn` for a file with the earlier table) were done together.
- **Age gate.** `Competition.CreatedAt` exists, so the rule is: a competition is announced only when `CreatedAt` is at least 6 hours old (`EntriesOpenRule.SettleTime`). That is "new" in the claim, the pending list and Send now; the per-recipient re-check of a frozen run does not apply it. It is simpler than recording a first-seen-open time (no extra table, and it works while no instance is up). Limit: it measures from when the event was created, not from when entries opened, so an old event that is unlocked later is announced at once. A name an admin dislikes can be fixed, or the event archived or locked, in the window; an archived, locked or closed event is dropped before it is sent.
- **`near-you` rate limit (low).** New `near-you` policy, per signed-in user or IP, `RateLimits:NearYouPerMinute` (60). The web already falls back to `/picker` on a 429. `ContactEmail` is written normalised (`EmailAddresses.TryNormalise` lower-cases it), so the `ToLower()` in `ForAddressAsync` is gone, and `IX_SectionSignups_ContactEmail` is added in the same new migration (and as a SQLite guard).
- **One-click unsubscribes lost to the per-IP limit (low).** `unsubscribe-one-click` has its own policy: a validly signed token is limited per token, so Gmail or Yahoo's shared servers don't hit a per-IP cap; anything that doesn't verify (how abuse looks) stays at 10 a minute per IP. The page endpoint `unsubscribe` is unchanged.
- **Abandoned claims retried without limit (low).** A stale `Claimed` row is retaken only while `Attempts < MaxAttempts`; one past it is marked `Failed` and counts as failed for good, so the run can finish.
