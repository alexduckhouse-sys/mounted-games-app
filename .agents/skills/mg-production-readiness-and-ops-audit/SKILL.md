---
name: mg-production-readiness-and-ops-audit
description: Production readiness, silent failure / swallowed catch blocks, PWA service worker update traps, Vercel scale-to-zero duplicate background jobs, third-party outage resilience, and destructive-action safety audit skill for the Mounted Games App.
---

# Mounted Games App — Production Readiness, Silent Failures & Live-Event Ops Audit Skill

Use this skill for **Parent Agent #13 (`production-readiness-parent`)** and for Claude/Codex cross-checks.

## Mission
Ensure the Mounted Games platform (`https://mounted-games-app.vercel.app`, `api/`, `web/`) will not suffer catastrophic data loss, silent failures, stuck service workers, duplicate notifications, or unhandled crashes during a real live competition weekend.

---

## Multi-Agent Architecture (Parent → 3 Specialist Production-Readiness Subagents)

The **Production Readiness Parent Agent** MUST spawn **3 specialist child subagents** in parallel:

### Subagent PR1 — Silent Failures, Swallowed Exceptions & Error Boundary Audit (`api/` & `web/src/`)
1. **Swallowed `catch` Blocks (`web/src/` and `api/`):**
   - Grep and inspect every `catch` block across `web/src/` and `api/`.
   - Flag every place where an API failure, database write failure, score save error, payment/order update failure, or SignalR error is silently swallowed (`catch {}` or `catch { return null; }`) without informing the user or logging actionable diagnostics! (Distinguish legitimate `localStorage` quota `try/catch` guards from dangerous swallowed network/business errors.)
2. **React Error Boundaries & Unhandled Promise Rejections:**
   - Check what happens if a single component (e.g. a malformed JSON field in `SectionConfigJson`, `PlannedFinalRacesJson`, or a stream widget) throws during render: does an Error Boundary catch it cleanly and allow the user to recover, or does the entire app white-screen?

### Subagent PR2 — Vercel Scale-to-Zero Multi-Instance Hazards, Background Jobs & External Service Timeouts (`api/`)
1. **Multi-Instance Background Job Duplication (`NotificationScheduler.cs`, `StreamSweeper.cs`):**
   - Vercel scales API containers from `0` to `N` instances automatically.
   - When 3 API instances are running simultaneously, do all 3 instances run `NotificationScheduler` and `StreamSweeper` at the same time? Will parents receive **3 duplicate push notifications/emails** ("60 minutes until your heat"), or is there distributed locking / idempotency in DB/Redis?
   - Conversely, when scale-to-zero puts the API container to sleep 45 minutes before a morning session, what wakes `NotificationScheduler` up so the "60 minutes until your heat" alert actually fires on time?
2. **Outbound HTTP Timeouts, Retries & Circuit Breakers:**
   - Audit every outbound call (`CloudflareSfuClient`, `EmailService`, `GeocodingService`, `What3Words`, `Vapid`/WebPush, `Upstash Redis`). Are explicit timeouts configured on every `HttpClient`? If Cloudflare, Resend/SMTP, or Redis is slow or down, does it block request threads or degrade gracefully?

### Subagent PR3 — PWA Service Worker (`sw.ts`) Deploy Traps, Accidental Cascade Deletes & Legal/SEO Readiness
1. **PWA Service Worker Live-Event Hotfix Trap (`web/src/sw.ts`, `web/src/pwa.ts`, `vite.config.ts`):**
   - Suppose we deploy a critical bugfix at 10:30am on competition day. How quickly do scorers' and spectators' phones pick up the new service worker?
   - Can a user get trapped with a cached `index.html` referencing deleted hashed JS chunks (`ChunkLoadError: Failed to fetch dynamically imported module`) when navigating to a lazy-loaded route after a deploy? Verify whether `App.tsx` handles lazy-chunk load failures by auto-reloading once!
2. **Destructive Action Guards & Cascade Delete Data Loss (`api/Data/AppDbContext.cs`, Controllers):**
   - Trace what happens if an organiser accidentally deletes a Section, Session, Heat, Team, or Competition once entries/scores exist: does EF Core perform an unrecoverable `CASCADE DELETE` wiping out paid entries, declaration forms, or scored races without a server-side guard or soft-delete/confirmation?
3. **Production Deployment Config, Legal Pages & SEO/OpenGraph Sanity:**
   - Check `Dockerfile.vercel`, root `vercel.json`, `web/vercel.json`, `web/middleware.ts`, and `/privacy`, `/terms`, `/refunds`, `/cookies`, `/safeguarding` for any placeholder text, dev URLs, or missing production guards.

---

## Required Output Format
Rank every finding by production risk:
- `SHOWSTOPPER` — Could cause data loss, white-screen crash after deploy, or broken live event.
- `HIGH PRODUCTION RISK` — Silent failure, duplicate push/email spam, or unhandled third-party timeout.
- `MEDIUM / OPS HARDENING` — Edge-case resilience or operational visibility improvement.

Include clickable `[File](file:///...)` links, exact failure scenario, and concrete fix.
