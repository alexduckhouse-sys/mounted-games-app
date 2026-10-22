# Members: handoff

**Status:** decided, ready to build.
**Proposal:** `docs/designs/members-proposal.html` (clickable).
**Route:** `/me/members`, from **My club → Members** on the profile page. Visible to team managers (their club) and admins (any club).

## Layout

1. **Waiting for you:** join requests (initials, name, "Wants to join as {role}"), with **Approve** / **Decline**. Approve moves the person into the right group. The section is hidden when empty. Its count drives the Me tab badge.
2. **Team managers / Trainers / Members:** one list per role. Row: initials, name, one sub-line (teams for trainers, "Parent of …" for members), and a chevron.
3. Tap a row to expand it inline: a 3-way role switch (Team manager / Trainer / Member) and **Remove from club** in red.
4. Your own row shows "You" and can't be edited.

## Rules (NEXT_STEPS §2)

- Managers approve trainers and members in their club. Admins approve managers.
- Changing someone to Team manager by a non-admin should create an admin approval rather than apply at once. That state isn't shown in the proposal.
- Removing someone keeps their saved riders on the club.
