# Sign up: handoff

**Status:** decided, ready to build.
**Proposal:** `docs/designs/sign-up-proposal.html` (clickable).
**Replaces:** the Sign up tab in `web/src/pages/LoginPage.tsx`.

## Fields

- **Your name**, **Email**, **Password**.
- **Club** (required): free text with suggestions from existing clubs. If nothing matches exactly, show **Add "{typed}"**, which creates the club on submit (NEXT_STEPS §2: never drop to null).
- **I am a:** radio cards, 56px: **Rider or parent** (Member), **Trainer**, **Team manager**.
- After a club is picked, one line shows the approver: "Approved by {club}'s team manager." For Team manager it shows "Approved by Mounted Games admins."
- **Create account** is disabled until every field is filled and a club is picked.

## After submit

- Screen: "Request sent to {club}", one sentence saying who approves, then **Follow a competition** and **Go to my profile**.
- The account is usable at once for following competitions and messaging the organisers. Club features unlock on approval (see the profile handoff).

## Removed

- The 3-tab switcher. Sign in is a link at the bottom, and the organiser shared key moves to the sign-in page as a small link.
- Username field (email only), password-rule hint text, PBKDF2 note, demo credentials.
