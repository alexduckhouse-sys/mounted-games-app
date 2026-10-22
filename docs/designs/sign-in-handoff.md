# Sign in: handoff

**Status:** decided, ready to build.
**Proposal:** `docs/designs/sign-in-proposal.html` (clickable).
**Replaces:** the Sign in and Organiser tabs in `web/src/pages/LoginPage.tsx`.

## Layout

- Title **Sign in**, then **Email**, **Password**, **Forgotten password?** link, then **Sign in** (disabled until both fields are filled).
- Wrong credentials: red border on the password field and "Email or password is wrong." under it. No banner.
- "New here? **Create an account**" goes to sign up.
- At the bottom, a quiet link **Organiser with a shared key** swaps the form to a single **Organiser key** field, with **Back to sign in**.

## Removed

- The 3-tab switcher, intro sentence, demo credentials, PBKDF2 note.
- Header "Back to public view" becomes a × close button.
