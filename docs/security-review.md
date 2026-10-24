# Security review, 15 October 2026

## Dependency update, 24 October 2026

The web app uses Vite 8.3.5, covering the
[October development-server file access advisory](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22).
The combined Dockerfile uses Node 24.22.1 and a root `.nvmrc` selects the same
[patched LTS release](https://nodejs.org/en/blog/release/v24.22.1).
The API-only Vercel Dockerfile has no Node runtime. Existing CI selects Node 22.

The test project's SignalR client moves to 10.0.13, removing its vulnerable
transitive SignalR.Common package. The API already uses SignalR Redis 10.0.13.
See [Microsoft's advisory](https://github.com/advisories/GHSA-334f-vvp4-7g6p).
Compatible npm lockfile updates also remove five of the twelve dependency
audit findings present after installing the original Vite update.

The fresh npm audit still reports seven findings: four high through Vercel's
CLI configuration dependency on Zod, and three moderate through Tailwind 3's
PostCSS selector parser. npm proposes a Vercel functions downgrade and a
breaking Tailwind 4 migration; neither is applied or suppressed here.
Verification: 1,927 API tests passed (four Redis tests skipped locally), as did
121 Node tests, 2,923 Vitest tests, lint and the production build. Web coverage
passed all gates (99.95% lines, 97.25% branches). Fresh NuGet audits for the API
and test project report no vulnerable packages. Browser automation was
unavailable; Docker was not run. No hosting settings, database data or
credentials changed.

The review below records the earlier 15 October work. Its historical audit
and deployment statements do not describe the current deployment.

This review uses WhiteLabelApp's `app/src/lib/security-headers.ts`, `app/next.config.mjs` and `app/docs/08-security.md` as the reference. It is a source review with local regression tests, not a penetration test or a certification of the deployed service.

## Changes

- 22 October 2026, embeddable results widget: pages under `/embed/` (and only those) may be framed by any https page (`frame-ancestors https:`, no `X-Frame-Options`, `Cross-Origin-Resource-Policy: cross-origin`). Every other path keeps `frame-ancestors 'none'` and `DENY`. The CSP also gained `frame-src 'self'` so the organiser's preview loads; framing of other pages is still refused by their own headers. The widget shows public data only, ignores the visitor's sign-in and storage, and unknown `/embed/` paths show a message instead of redirecting into the app (a redirect would leave the full app inside a framable document). Clickjacking exposure is limited to read-only public pages with no controls that change data.

- The API and Vercel send matching security headers on pages, assets and errors. The production CSP blocks inline scripts, inline event handlers, framing and arbitrary resource origins. It permits the existing YouTube/Twitch embeds and Render live-score endpoint. Vite emits external scripts, so this policy uses same-origin scripts rather than copying Next.js's per-request nonce mechanism. Inline style attributes remain available for the existing React components; inline style elements are blocked.
- Admins retain access to all competitions. Trainers can create competitions and use organiser endpoints only for competitions they created. Manager and member accounts cannot use organiser endpoints. Existing admin-only scoring, timetable and moderation operations remain admin-only.
- Signup contact/payment records require organiser access. Public locked declarations omit dates of birth, phone numbers, notes and saved-rider references. Drafts are restricted to admins, their submitter, the team's trainer and the trainer who created the competition.
- Saved riders belong to the account that saved them. Selecting a club at signup does not grant access to that club's roster. Legacy records have no provable owner and remain available to admins; no owner is guessed during migration.
- Private marketplace messages no longer treat an anonymous user's null ID as a matching recipient. Push subscription URLs are restricted to supported browser push providers, checked again before delivery, and redirects are disabled. An account cannot take over another account's stored subscription.
- Password failures trigger account lockout. Login, registration and admin-key attempts have a separate rate limit. API writes have per-account limits for signed-in users and per-IP limits for anonymous users. Private API responses use `no-store`; the public offline-cache allowlist remains available.
- Production refuses file-based or short JWT/admin secrets and demo seeding. The shared admin account cannot use the old demo password login outside Development. Unexpected API errors return a generic response; Kestrel omits its server header and limits request bodies to 1 MiB.

## Before deployment

1. Apply `api/Data/Migrations/Scripts/20261015220000_AddSavedRiderOwnership.sql` to PostgreSQL before starting the updated API. This is the EF-generated idempotent script for `20261015220000_AddSavedRiderOwnership`. It adds one nullable column and does not delete existing records. SQLite's existing startup upgrade path adds the same column.
2. Supply `Jwt__Key` (at least 32 random bytes) and, if shared admin login is used, `Admin__Key` (at least 20 random bytes) through deployment secrets. Set `Database__SeedDemoData=false` outside Development. Repository defaults are deliberately rejected. No credentials were inspected, rotated or changed in this review.
3. Review any previously deployed demo accounts and rotate any secrets that ever matched repository defaults. Turning off seeding does not remove existing accounts or revoke previously issued tokens.
4. If the API sits behind a proxy, configure `Security__KnownProxies__0` and further indexed entries with the trusted immediate proxy IP addresses. Only one forwarding hop is accepted. Without an explicit list, forwarded headers are ignored: anonymous clients may share the proxy's rate-limit partition. Never trust arbitrary client-supplied `X-Forwarded-For` values. For the Vercel → Render path, whose proxy addresses aren't fixed, `web/middleware.ts` instead sends the visitor's IP with a shared secret (`MG_PROXY_KEY` on Vercel, `Security__ProxyKey` on Render, at least 32 bytes); `ProxyClientIpMiddleware` trusts the IP only when the secret matches and always strips both headers.
5. Check the deployed headers and browser behaviour on both hosting paths. A custom API/hub origin requires a deliberate CSP update. HSTS covers the serving host; subdomain inclusion and preload are not enabled without a DNS ownership decision.

## Verification and remaining limits

The security suite exercises HTTP refusal paths, private-field redaction, draft access, cross-competition and child-resource checks, saved-rider references, separate rate-limit partitions, matching API/Vercel headers, exception responses and legacy migration data preservation. Test data is fictional. PostgreSQL model/migration parity is checked in the test suite. The column addition and migration history entry were also applied and verified on an isolated Neon branch copied from production; the idempotency guard was rerun successfully. No application records were read. The new column operation is also exercised against a synthetic SQLite legacy table.

The review found and corrected a stale demo-seed test: the seeder already creates 5–6 teams per age group, while the test still expected four. No seeder behaviour was changed.

Runtime dependency advisories were addressed with same-major updates and patched .NET dependency pins. Tailwind 3 still brings build-time dependency advisories; npm proposes Tailwind 4, a breaking migration that needs its own stylesheet and browser regression pass. These findings are not suppressed.

This remains a shared-key admin system with bearer tokens stored in browser localStorage, a default one-day token lifetime, and no server-side token revocation. Rate limits are per process and reset on restart; multiple instances need a shared or edge limiter. The review did not verify production configuration, existing data, secret rotation, backups or monitoring. No production deployment or production database migration was performed. A browser connection was unavailable, so browser enforcement remains outstanding. The temporary Neon migration is ready for approval before the production change; production is still missing the column.

### Recorded check results

- API: release publish passed; 71 tests passed, including 34 security cases. One existing EF1002 warning remains in the SQLite schema helper, whose interpolated identifiers come from fixed internal calls.
- Frontend: production build and all 115 tests passed. Fresh-install lint reports 45 errors and six warnings; unchanged `origin/main` reports 46 errors and seven warnings with the same installed tools. No new file/rule findings were introduced. No lint rule was disabled.
- Dependency audit: no runtime npm advisories and no NuGet advisories. The full npm audit still reports seven Tailwind build-tool advisories (five high, two moderate).
- Release HTTP smoke test: pages, fingerprinted assets and API responses carry the security headers; private endpoints return 401 and `no-store` without authentication.
- Independent review: the reviewer identified the shared anonymous/organiser rate-limit partition; it was corrected and covered by a regression test.
