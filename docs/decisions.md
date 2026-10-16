# Project decisions

## 2026-10-15: Trainers organise their own competitions
- Why: self-service trainer registration must not grant access to another organiser's competition or entrant records.
- Rule: admins can use organiser endpoints for any competition; trainers can use them only where the stored `CreatedByUserId` matches their authenticated ID. Managers and members are not organisers.
- Rejected: admin-only creation; the user wants trainers to create competitions too. Global trainer access was rejected by the ownership confirmation.
- Existing admin-only scoring, timetable and moderation operations remain admin-only.
- Revisit if: delegated organisers are needed; add an explicit server-managed grant rather than widening a role globally.
- Files: `api/Auth/CompetitionAccessAttribute.cs`, `api/Auth/Roles.cs`, organiser controller actions and frontend organiser controls.
- Source: AI Control Centre security-review chat, 15 October 2026.
