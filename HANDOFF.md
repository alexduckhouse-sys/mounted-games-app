# Gemini integration handoff — 25 October 2026

## Source and integration

- Gemini source: `feat/consolidate-pages-and-tokens`, commit `df05777`.
- The earlier source snapshots are already merged in PRs #142, #143 and #144. PR #144 is live at main commit `c263df3`.
- This final delta is being reviewed on `feat/gemini-scoring-handoff`. The merge preserves the fixes made while reviewing those earlier snapshots.
- Keep new Gemini edits separate from this committed source until they have their own handoff.

## Database

This delta adds no EF migrations. `AddEquineVaccineCertification` and `AddScorerLinkScope` were applied and verified in production before PR #142.

The source handoff also named `20261025093000_AddSignupIpAddress` and `20261025101500_AddTimetableDelaysAndClubJoinPin`, but neither migration exists in source commit `df05777`. Do not attempt to apply them. Account creation limits use hashed IP claims, and the existing session directives implement timetable pause/delay. The source does not implement the claimed club join PIN or historical cross-competition pace endpoint.

## New code in this delta

- Full-page phone scoring, race navigation, hold-to-eliminate and score-override controls.
- Commentator prompts and post-race summaries on session and scoped scorer pages.
- Searchable race selectors and ordered race lists, including custom races.
- Lane-order preference in Settings and card-control visibility in the competition creator.
- Announcement pinning and the separate Contact organisers page.
- Updated regression tests and test fixtures.

## Review notes

- Preserve official standings and scoped scorer permissions; a partial local summary is not an official section ranking.
- Retain protected-race checks when editing session race lists.
- Do not apply score or HC changes before confirmation.
- Retain the PR #144 stream command, overlay-save, permission and clipboard error handling.
- Create replacement announcement banners before deleting the old banner.
- The card-visibility switch is device-local, not a shared competition setting. The creator explains this.
- The privacy contact address remains a placeholder until the owner confirms the correct address.

## Validation

- `npm --prefix web run lint`: passed.
- `npm run build`: passed. One existing EF1002 warning remains in `DbInitializer`; no build errors.
- Node tests: 121 passed.
- Vitest: 258 files, 3,472 tests passed. Coverage: 99.33% statements, 97.41% branches, 99.52% functions, 99.88% lines.
- Focused scoring regressions: 143 passed; independent scoring/access review closed.
- Phone browser smoke checks: organiser session scoring, restricted scorer link, Settings, finishing-order taps and the override dialog. No runtime errors or page overflow.
- No API code or schema changes relative to PR #144. Its final CI passed 2,183 API tests; this PR will rerun the full CI suite before merge.
- GitHub PR checks and production deployment remain the final shipping steps.
