# Approved event improvements: batches 1–4

29 October 2026. User approved planning and implementation of the first four delivery batches. External integration projects remain for separate review. Base: `2265ad64`. The initial delivery was local and uncommitted. The user subsequently authorised a pull request, merge and production migration; shipping verification is recorded below.

## Scope and acceptance

1. **Navigation:** keep Team profiles available with an event open; expose Prize-giving, announcements and Producer overlay; point legacy Format shortcuts to modern tools; surface declaration questions, hatbands and lane draw near the top of their pages; add direct sponsor and official-results export access. Preserve route permissions, old bookmarks, in-app Back and selected section. Do not restore the rejected Form teams control. Some controls described as hidden in the source audit are already inline at this base.
2. **Event reliability:** extend existing score handover with offline QR/PDF; preserve queue identity, duplicate/conflict handling and timing metadata. Add shared per-arena call-ups and private substitution requests/decisions using the existing audited swap service. Verify stale requests, competing staff actions and access restrictions. PDF generation must not need network access after the app and event have loaded.
3. **Timing:** persist explicit start taps before allowing scoring, keep an escape hatch, preserve offline timestamps across reload and replay before score sync. Distinguish inferred starts. Expose replay chapters with clamped three-second pre-roll and captured metadata. Produce advisory pace estimates from trustworthy samples; handle small samples, zero MAD, exceptional delays and pinned schedule times. Do not automatically change schedules during initial evaluation.
4. **Existing features:** saved setup templates and overlay looks, safer recognised team CSV headers with preview, accounting exports and user-triggered file/WhatsApp sharing. The existing CSV endpoint creates teams only: it must reject or explain incompatible rider/entry/payment records rather than reinterpret them. Native platform work, payment providers, live spreadsheet feeds, recording infrastructure, weather/hardware integrations are outside these four batches.

## Delivery and ownership

Navigation and final assembly: primary agent. Reliability, timing and feature completion: separate isolated worktrees. Reliability owns new schema and timing provenance migration; timing owns race DTO and score-start changes. Parent integrates shared pages and translation registrations. No package installations.

## Verification

- Relevant existing and new Vitest/API tests per batch; then web lint, typecheck/build, full web and API tests, with actual failures recorded.
- Navigation screenshots at 390×844 and 1440×900 using clearly synthetic event data; check all five themes, reduced motion/Lite and overflow.
- Offline score backup: decode QR round-trip, render PDF, reject malformed/cross-event input, preserve duplicate/conflict behaviour; verify offline generation.
- New API writes: anonymous/wrong role/other competition rejected; permitted owner/staff succeeds; repeat calls and concurrent approvals cannot duplicate effects.
- Schema: generated EF migration, idempotent PostgreSQL SQL and SQLite upgrade guard; no migration applied to production.
- Replay/predictor: boundaries, missing/legacy timing, finish-save delay, outliers/MAD zero, clip offsets and explicit advisory wording.
- Templates/imports/exports: ownership, setup-only copies, stale preview, decimal/refund correctness, spreadsheet injection and share fallback.

## Open facts to verify

Full supplier entry import needs genuine supplier column specifications (synthetic samples only); current scope supports the existing team import semantics. Predictions remain estimates until event data validates them. Documentation and current code disagree in several places; implementation and explicit user-approved scope take precedence over the older audit's exact click counts.

## Implemented

| Importance / delivery | Result |
| --- | --- |
| 1. Navigation | Team profiles remain available; Prize-giving, announcements, Producer overlay and exports have direct routes. Declaration questions and lane/hatband tools appear earlier. Legacy Format bookmarks redirect with their context. The message-thread page stays available because it contains account moderation controls. |
| 2. Event reliability | Offline score backups support multipart QR and downloadable, importable PDF. A shared collecting-ring callboard appears in scoring and commentary, with called badges for followers. Trainers can request substitutions; staff approve or decline against the current locked declaration. Requests remain private. |
| 3. Timing | Explicit flag-down starts persist offline, with a missed-start option. Start events sync before scores; rejected timing can be removed while retaining placings. Replay chapters use captured race times. Pace review uses filtered event/history samples and leaves published durations unchanged. Reverse-order offline uploads preserve aggregate timing. |
| 4. Existing features | Named setup templates and overlay looks, recognised team CSV headers and preview, accounting CSV presets, file sharing and WhatsApp announcement preparation. Receipt/refund exports retain the relevant recorded dates through cancellation and correction. |

The scoring screen opens calls and substitutions in compact sheets; the commentary desk and entries page show the expanded controls. No external messages are sent automatically.

## Review decisions and practical limits

- Existing scorer links are competition-wide in the current controller and tests, despite older documentation describing arena-only access. The new start action follows that existing boundary. Camera links cannot start races; the change does not grant general organiser actions.
- Start timestamps are explicit flag-down taps. Finish timestamps are the time the scorer saves the result; they are not stopwatch measurements. Pace review describes score slots accordingly.
- PDF points are provisional local previews. They are separate from submitted placings/manual point overrides; server scoring remains authoritative, including final and HC rules. Older backups without previews show that points are calculated on sync.
- Full supplier rider/payment imports require supplier column specifications. This implementation recognises supported team columns and rejects incompatible rider sheets.
- Accounting CSVs describe recorded manual receipts and refunds for a clearing account; they are not verified bank transactions. Missing historical payment dates cannot be reconstructed, so incomplete records must be resolved before export.
- A physical phone camera scan, native share targets, live PostgreSQL deployment and real event push delivery still need device/staging checks. QR/PDF generation, import and scheduling paths have automated coverage; no live user data was used.
- The additive database migration, PostgreSQL idempotent script and SQLite upgrade guards are prepared. Production migration and deployment have not been performed.

## Review findings resolved

Independent review identified a retry-strategy transaction issue in substitution creation, an unwired timing recovery action, and aggregate finish timestamps depending on offline upload order. All three were fixed with regression coverage. Its arena-boundary concern was checked against the existing controller and tests; the current competition-wide boundary is intentional in this implementation. Integration testing also caught and fixed an unscheduled-heat ordering regression.

## Final verification — 29 October 2026

| Check | Result |
| --- | --- |
| Full API test suite | 3,212 passed, seven Redis-dependent tests skipped, zero failed. |
| Web Node suite | 124 passed. |
| Full Vitest suite | 6,350 passed; two failed in the full run: EntriesPage waiting for its first loaded row, and lazy Welsh loading checking the document language before its update. |
| Isolated rerun of those two files | All 17 tests passed without code changes. These remain timing-sensitive suite checks; the full run is not reported as entirely green. |
| Focused assembled feature checks | 147 scoring/entries/outbox/timetable tests, 102 recovery/reliability/scoring tests, and 37 scorer-page tests passed; 132 timing/following tests passed after the unscheduled-order fix. |
| Web lint, non-incremental TypeScript checks and production build | Passed on the final source. |
| Browser review | Production-build screenshots at 390×844 and 1440×900; five themes for scoring and entries, normal and reduced motion/Lite checks, organiser tools, saved templates and looks. No horizontal overflow or page errors in the corrected synthetic fixtures. Calls and substitution sheets opened and closed correctly. |
| Backup review | QR/PDF recovery round-trips passed; generated PDF rendered and inspected, including provisional points. Physical camera scanning remains a device check. |
| Source delivery | 151 changed/new source, test and plan files copied to the attached review checkout and hash-verified. Diff whitespace check passed. No packages installed, commits, pushes or deployment. |

Coverage-percentage gates were not rerun. Before release, run those CI gates, exercise the migration on staging PostgreSQL, and check physical phone sharing/scanning and event push delivery. The implementation is ready for code review with the two full-suite timing flakes recorded above.


## Shipping verification

Merged current main (`e8bab743`) into the feature branch, preserving its security checks, translations, dock layout, competition read-revision migration and shared live connection. Call-ups now reuse the shared connection; private substitution polling stops while signed out or hidden. Start taps use the scoring rate-limit allowance. The latest migration designer includes the pre-existing competition read-revision entity, with no extra database operations.

- API: 3,321 passed, eight Redis-dependent tests skipped locally; line coverage 95.87% (95% required).
- Web: full suite passed after integration fixes; 124 Node tests passed. Coverage: statements 98.62%, branches 97.10%, functions 98.25%, lines 99.35% (97% required).
- Lint, TypeScript and production build passed. Merged phone/desktop layouts checked with synthetic data, without horizontal overflow or page errors.
- EF reports no pending model changes. The migration was applied twice successfully on isolated Neon branch `verify-event-improvements-20261029`; migration history, defaults, tables, keys and cascade constraints were verified.
- Production application and merge are recorded on the pull request after CI. The migration adds schema only; it does not delete existing records.
