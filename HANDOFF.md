# Gemini integration handoff — 25 October 2026

## Source and integration

- Gemini source: `feat/consolidate-pages-and-tokens`, commit `6606fb6`.
- The earlier source snapshots are already merged in PRs #142–#145. PR #145 is live at main commit `3d9503e`, including source commit `df05777`.
- This final delta is being reviewed on `feat/gemini-backend-handoff`. The merge preserves the fixes made while reviewing those earlier snapshots.
- Keep new Gemini edits separate from this committed source until they have their own handoff.

## Database

This delta adds no EF migrations. `AddEquineVaccineCertification` and `AddScorerLinkScope` were applied and verified in production before PR #142.

The source handoff also named `20261025093000_AddSignupIpAddress` and `20261025101500_AddTimetableDelaysAndClubJoinPin`, but neither migration exists in source commit `6606fb6`. Do not attempt to apply them. Account creation limits use hashed IP claims, and the existing session directives implement timetable pause/delay. The source does not implement the claimed club join PIN or historical cross-competition pace endpoint.

## New code in this delta

- Server-backed `UseRefereeCards` configuration and referee-card/flag fields in competition, team, heat and standings responses.
- Team-card assignment and clearing without changing historical result notes.
- A heat-scoped missing-team call endpoint and cleanup when scoring starts.
- Server-side announcement pin/unpin support.
- A documented frontend queue in `NEXT_STEPS.md`; it is future work, not part of this backend release.

## Review notes

- Preserve the server-selected payout club and referee-card configuration through declaration-form save/reset.
- Ordinary bib or flag updates must not forge or overwrite trusted referee-card metadata.
- Card changes must preserve historical scoring notes and audit records.
- Ring calls must remain scoped to their heat and must not convert private messages to public announcements.
- Preserve admin-only announcement moderation. The explicit ring-call endpoint is available to competition staff.
- Serialise concurrent pin changes and heat-start/ring-call writes.
- The current frontend still uses its existing device-local card-visibility switch and legacy generic ring-call posts. Wiring the new backend capabilities is queued frontend work.
- The privacy contact address remains a placeholder until the owner confirms the correct address.

## Validation

- Full API suite: 2,211 passed, four Redis-dependent skips locally; 96.53% line coverage.
- Final nested/cross-tag regressions: 88 focused tests passed after the last sanitisation fix; eight regression cases failed before that fix.
- Chat/scoring/scorer-link regressions: 144 passed, including concurrent pin/call/start and lost commit acknowledgement cases.
- `npm run build`: passed; no build errors.
- PostgreSQL pending-model guard passed against the unchanged migration snapshot. The existing bib column is now an EF concurrency token; there is no relational schema change or migration to apply.
- Web source is unchanged from PR #145 (3,472 web tests and all 97% coverage gates passed there). The PR will run both complete CI suites before merge.
- Production rollout and health checks are the final shipping steps.
