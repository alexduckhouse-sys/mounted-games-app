# Docs index

What each document is for and how far to trust it. When a doc and the code disagree, the code wins: fix the doc or flag it. Dates are the last substantive edit.

## Read first

| File | Use it for | State |
| --- | --- | --- |
| `designs/design-decisions.md` | The house style for all pages (public, organiser, on the day, site admin): looks, controls, buttons, copy, navigation and per-page decisions picked by the owner (25–26 October 2026). **Start here for any UI/UX work or audit** | Current (2026-10-26) |
| `../CLAUDE.md` (`../AGENTS.md`) | Repo-wide agent guide, commands, architecture, deployment and security invariants (`api/CLAUDE.md`, `web/CLAUDE.md`, `tests/CLAUDE.md` cover each area) | Current (2026-10-28) |
| `../APP_DESIGN.md` | Goals, scope and agreed domain behaviour. Read before changing behaviour, and update it when a decision lands | Current (2026-10-28) |
| `decisions.md` | Settled architecture, domain and security decisions (with rejected alternatives and file paths). Check before reopening a question | Current (2026-10-28) |
| `../PRODUCT_DETAILS.md` | End-to-end competition lifecycle from entries through live scoring, streaming, seasons and payouts, by role | Current (2026-10-28) |
| `../NEXT_STEPS.md` & `../BUGS.md` | Cross-chat to-do list, confirmed Q&A decisions and code-verified bug catalogue | Current (2026-10-28) |

## Audited Workspace Skills (`../.agents/skills/`)

| Skill | Use it for |
| --- | --- |
| `mg-security-audit` | Zero-trust OWASP, auth, MasterAdmin/locks/blocks, IDOR, child safeguarding (`UseInitialOnly`, `NoFilming`), GDPR PII redaction, CSP/`/embed/`, SignalR and rate-limit audit |
| `mg-ui-ux-audit` | Slick minimalist visual polish, responsive phone (`390×844`) & desktop (`1440×900`), 5 themes, Lite mode, WCAG 2.2 AA, `designs/design-decisions.md` and copywriting (`humanise`) audit |
| `mg-animations-audit` | Framer Motion & CSS motion, `250ms→600ms` hold-to-eliminate, climbing rows, saved tick, celebrations, stream overlays, Follow-Cam replay, `prefers-reduced-motion`, 60fps and new micro-animation opportunities audit |
| `mg-fresh-persona-walkthrough` | Strict zero-repo-access ("black-box / fresh eyes") 10-persona walkthrough skill (`P1`–`P10`) for testing live user journeys on `https://mounted-games-app.vercel.app` without reading source code |
| `mg-domain-and-data-integrity-audit` | Mounted Games scoring maths, Heat-Heat-Final, final options (`HasFinal`, `CarryPointsIntoFinal`, `DoublePointsInFinal`), tie-breakers, timetable delay cascades and DB schema parity audit |
| `mg-performance-and-offline-audit` | Showground 3G/poor-signal resilience, offline scoring outbox sync, SignalR reconnect reconciliation, bundle/code-splitting and battery/CPU hygiene audit |
| `mg-livestream-and-broadcast-audit` | Cloudflare SFU WebRTC ingest/WHEP playback, multi-camera switching, Stream Controls (`Overlay · Auto · Replay · Camera`), Follow-Cam replay editor, Commentator Desk and `/embed/` resilience audit |
| `mg-growth-and-scalability-audit` | Concurrent user capacity modelling, SQLite vs Neon Postgres scaling, SignalR `LiveHub` thundering-herd/fan-out analysis, EF Core N+1 detection, showground shared-NAT rate-limit safety and viral growth loops audit |
| `mg-irritants-and-annoyances-audit` | Premature offline/reconnecting banners, cold-start loading flickers, SignalR live-update input/scroll clobbering, lost filter/tab state on Back navigation, iOS `<16px` auto-zoom, toast spam and thumb-zone touch hazard audit |
| `mg-navigation-consolidation-and-inline-ux-audit` | Back-button destination accuracy, context-preserving navigation, inline/in-page expansion (e.g. viewing heat tables directly inside team views instead of jumping pages) and route/page consolidation audit |
| `mg-missing-features-and-gaps-audit` | Half-wired settings/buttons, backend-to-frontend parity gaps, unimplemented spec promises and real-world Mounted Games missing features audit |
| `mg-contract-and-null-safety-audit` | C# API DTO (`ApiDtos.cs` / `CommerceDtos.cs` / `StatsDtos.cs`) vs TypeScript (`web/src/types.ts`) contract parity, enum alignment, SignalR payload matching and runtime null/undefined safety audit |
| `mg-copy-and-humanise-audit` | UK English spelling, `humanise` natural copywriting, developer-jargon removal, error message friendliness and transactional/custom email template audit |
| `mg-dead-code-and-duplication-audit` | Dead code, orphaned files/components, unused CSS classes, duplicate frontend/backend helpers, pointless wrappers and tech-debt cleanup audit |
| `mg-money-and-commerce-audit` | Entry fees, stabling maths, BACS references, Club Shop pricing/variants/stock concurrency, seller payouts, floating-point rounding and currency formatting audit |
| `mg-production-readiness-and-ops-audit` | Production readiness, silent failure / swallowed catch blocks, PWA service worker update traps, Vercel scale-to-zero duplicate background jobs, third-party outage resilience and destructive-action safety audit |
| `mg-timezones-and-multiday-audit` | Timezone handling, BST→GMT Daylight Saving Time clock-change weekend, multi-day competition rollover, HeatRing countdowns, declaration deadlines and `.ics` calendar feed accuracy audit |

Multi-model audit reports live in `audits/antigravity/`, `audits/claude/`, and `audits/codex/` so duplicate runs across models can be compared cleanly.

## Reference

| File | Use it for | State |
| --- | --- | --- |
| `pc-mounted-games-race-rules-2026.md` | Pony Club race rules (text extracted from the official PDF, one very long line). Search it with `grep -o`; don't read it whole | Source material |
| `neon-setup.md` | Neon Postgres: local runs against a branch, `npm run db:migrate`, verification | Current (2026-10-28) |
| `security-review.md` | Security review (15–26 October): headers, rate limits, proxy IPs, dependency updates, remaining limits | Current for what it covers |
| `connection-performance.md` | Work done for slow or patchy venue connections (Lite mode, public cache, score outbox) | Current |
| `test-coverage-handoff.md` | API and web test suite status and coverage gates (95% API line coverage, 97% web coverage) | Current |
| `competitive-gaps.md` | Competitor research and ranked gaps for selling the app; all points decided and shipped | Reference (2026-10-22) |
| `plans/2026-10-27-codex-debate-handoff.md` | Consolidated multi-model audit synthesis and implementation handoff (27 October 2026) | Current (2026-10-27) |

## Specs and designs

| File | Use it for |
| --- | --- |
| `designs/design-decisions.md` | Settled house style and per-page UI/UX rules (25–27 October 2026), including the pre-PR UI checklist |
| `specs/scoring-page-redesign.md` | Full-screen phone scoring (`ScoringSection` + `ScoringParts`), lane cards, hold-to-eliminate, race tools and between-heat views |
| `specs/creator-wizard.md` | 10-step competition creator wizard (`web/src/pages/admin/creator/`) |
| `specs/live-stream.md` | Live video through the Cloudflare Realtime SFU: flows, API, limits |
| `specs/stream-controls-backend.md` | Server spec for Stream controls (`Overlay · Auto · Replay · Camera`): auto rules, stored race recordings, viewer renderers |
| `specs/event-platform.md` | Scope for seasons, event tools, shops and operations |
| `specs/before-the-day-hub-and-duty-wizard.md` | Before the day hub on `/operations` (#293) and the per-heat duties wizard (#289, #299) |
| `specs/stream-recordings.md` | Proposed: keeping live streams to watch later (YouTube links first) |
| `designs/*.html` & `designs/*-handoff.md` | Self-contained HTML design previews and handoff notes; open `.html` files in a browser rather than reading markup |

## Elsewhere

- `../README.md` & `../web/README.md`: quick-start, commands, architecture and links to `CLAUDE.md`.
- `../DEPLOY.md`: older Render and Fly walkthroughs from May 2026 (marked historical in its banner; live hosting is Vercel + Neon Postgres as documented in `../CLAUDE.md`).
