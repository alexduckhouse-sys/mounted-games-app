# Event platform improvements

Agreed scope, 16 October 2026. Deliver in four reviewable PRs; streaming and display overlays belong to another session.

## Decisions

- Preserve the current phone-first MG visual language, using Claude Design for new screens.
- Public favourites expose public timetable/results/announcements only. Private supporter access continues to require the existing account and team permission flow.
- Rulebooks are editable text with title, edition and source link. They do not execute scoring rules.
- Preserve existing points, elimination and HC rules. Use explicit run-off resolution for qualification ties; do not silently pick a winner.
- Season owners configure points awarded for event finishing places and how many results count. Do not label defaults as official governing-body rules.
- Signed-in sellers own a reusable item catalogue and submit selected items to selected competitions. Organisers approve the listings on their competitions. Catalogue items survive an event ending.
- Event shops support organiser items (tickets, camping, merchandise) and approved seller items. First version is collection at the event; no shipping or seller payouts.
- Fake payments work only on explicitly marked demo competitions. No card details or real payment integrations. Ordinary paid entries remain pending until manually confirmed; free entries are paid automatically.
- Preserve the signed-in entry requirement introduced by PR #26 when integrating. Do not merge or deploy from this task.

## PR boundaries and acceptance criteria

1. **Event confidence:** public favourites remembered on this device; one next-heat/results view without login; saved/queued/conflicting score states are clear; retries and concurrent edits cannot silently overwrite scores. Build and test recovery paths, with a documented real-phone rehearsal remaining if unavailable.
2. **Competition operations:** deterministic draw preview balancing opponents, lanes and heat sizes across sessions; explicit apply; protect scored heats. Result corrections retain before/after, actor and reason; signed-off results require explicit reopening. Organiser-only readiness reports missing declarations, unpaid entries, incomplete teams, overlaps and equipment checklist. Public rulebook text, owner/admin editing.
3. **Commerce:** owner-scoped catalogue CRUD; organiser approval of competition listings; public approved listings; signed-in buyer orders; authoritative prices and quantities; atomic stock checks; idempotent demo payment success/failure/cancel/refund with labelled test receipts. Real events cannot call fake payment endpoints. Entry checkout uses the same fake provider boundary. All ownership and non-demo denial cases tested.
4. **Seasons and organiser tools:** stable team profiles explicitly linked to event teams; configurable season scoring/counting rules; confirmed event results feed standings with explicit ties; history shows public information only. Preview-first CSV team import; duplicate event setup without scores/private declarations/orders; printable draw, score sheets and results.

## Implementation contract

- Add feature DTOs in separate files, and controllers under distinct routes. Keep existing JSON enum representation (numbers).
- New EF entities use `IEntityTypeConfiguration<T>` in feature-owned files. Parent integrates model discovery, SQLite additive upgrades, PostgreSQL migrations/scripts and shared entity fields. Workers use `db.Set<T>()` for new entities.
- Parent owns `Program.cs`, `Data/AppDbContext.cs`, `Data/Migrations/**`, `Services/DbInitializer.cs`, `Dtos/ApiDtos.cs`, `web/src/types.ts`, `web/src/App.tsx`, navigation, package files and this document.
- Workers own their named feature files only, including isolated tests; no pushing, publishing, production databases, secrets, installs or unrelated changes.
- Build, full API/web tests, current coverage gates and diff review before each PR. Explicitly report browser/device verification gaps. Keep migrations additive and prepare scripts without applying them to production.

## Delivery checks

- Existing scoring examples still pass; duplicate/retried requests cannot duplicate effects.
- Anonymous users cannot see private records or perform seller/organiser writes; authenticated users cannot change other owners' records.
- Test payments never appear as real revenue or ordinary paid receipts.
- Empty, loading, error, offline and completed states are present in the new pages.
- Record final competitor gaps based on implemented and verified behaviour, not this plan.
