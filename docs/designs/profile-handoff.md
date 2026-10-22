# Profile page: handoff

**Status:** decided, ready to build.
**Proposal:** `docs/designs/profile-proposal.html` (clickable).
**Route:** new `/me`, reached from a 5th bottom tab **Me** (signed-in users only) and from the avatar in the menu. Public users keep the 4 tabs.

## Layout (phone, top to bottom)

1. **Header band:** avatar initials, name, role badge (`mg-badge` style: Team manager / Trainer / Member / Admin), club name, edit button.
2. **Needs you:** shown only when there's something to do. The count is shown in the section head and as a red badge on the Me tab.
   - Approval cards: initials, name, "Wants to join as {role}", **Approve** / **Decline** (44px). The card disappears on action.
   - Missing dec form row (red tint): "Dec form needed: {team}", "Due {date}", links to the dec form.
3. **My club:** list rows: Teams, Saved riders, Dec forms (x of y submitted), Members (approve and manage roles).
4. **Account:** Notifications toggle, Sign out.

## Notes

- Approvals follow the club hierarchy in NEXT_STEPS §2. Managers see trainer and member requests for their club. Admins see manager requests.
- The menu drops its account and club links and goes back to navigation only.
- No helper text. Empty sections are hidden.
