# Project decisions

## 2026-10-15: Trainers organise their own competitions
- Why: self-service trainer registration must not grant access to another organiser's competition or entrant records.
- Rule: admins can use organiser endpoints for any competition; trainers can use them only where the stored `CreatedByUserId` matches their authenticated ID. Managers and members are not organisers.
- Rejected: admin-only creation; the user wants trainers to create competitions too. Global trainer access was rejected by the ownership confirmation.
- Existing admin-only scoring, timetable and moderation operations remain admin-only.
- Revisit if: delegated organisers are needed; add an explicit server-managed grant rather than widening a role globally.
- Files: `api/Auth/CompetitionAccessAttribute.cs`, `api/Auth/Roles.cs`, organiser controller actions and frontend organiser controls.
- Source: AI Control Centre security-review chat, 15 October 2026.

## 2026-10-16: Admins approve new trainers
- Why: trainer signup was open to anyone, and trainers can create public competitions and (with live video) broadcast on them.
- Rule: self-service trainer signup creates a Member with a `TrainerRequest` role; an admin approves (Member becomes Trainer) or declines on the admin page. Approved users must sign in again, because roles travel in the JWT. Existing trainers and admin-created accounts are unchanged.
- Rejected: a shared signup code (it leaks); leaving signup open (strangers could stream to the public site).
- No migration: roles are seeded at startup from `Roles.All`.
- Files: `api/Auth/Roles.cs`, `api/Controllers/AuthController.cs`, `api/Controllers/TrainerRequestsController.cs`, `web/src/pages/admin/TrainerRequestsSection.tsx`, `web/src/components/TrainerAccountNotice.tsx`.
- Source: live stream chat in the AI Control Centre, 16 October 2026.
