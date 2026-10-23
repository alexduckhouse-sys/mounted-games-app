# Dec form: handoff

**Status:** decided, ready to build.
**Proposals:** `docs/designs/dec-form-proposal.html` (laptop) and `docs/designs/dec-form-mobile-proposal.html` (phone). Both are clickable prototypes.
**Replaces:** the rider grid in `web/src/pages/competition/DeclarationsTab.tsx`.

## How it works

- One team per dec form: **5 riders** plus an optional **non-riding reserve**. There are no rider numbers, no riding order and no captain.
- Click or tap an empty slot to open the rider panel (a side panel on laptop, a bottom sheet on phone).
  - Pick a **saved rider** (SavedRiders for the club, minus anyone already in the team) to fill every field, or type a new one.
  - Rider fields: **Rider**, **Date of birth**, **Pony**, **Height (hh)**.
  - The reserve only asks for Rider and Date of birth.
  - **Add rider** is enabled once the required fields are filled. The next empty slot then opens automatically.
- Click a filled rider to edit them, or use × to clear the slot.
- Form-level fields: **Team name** (also the page title), **Bibs** (one description for the team), **Trainer name**, **Phone number**, **Notes for the organisers** (optional).
- One agreement at the end: **"I agree to the terms and conditions"** sits next to Submit. **Submit dec form** is enabled only when all 5 riders are in and the box is ticked.
- Header shows **"Dec form due by Fri 23 Oct, 18:00"**. After submitting, a banner says it can still be changed until then.

## Field mapping

| UI | Model |
|---|---|
| Rider | `RiderEntry.FullName` (+ `SavedRiderId` when picked) |
| Date of birth | `RiderEntry.DateOfBirth` |
| Pony | `RiderEntry.HorseName` |
| Height (hh) | **new:** `RiderEntry.PonyHeightHands` and `SavedRider.PonyHeightHands` (decimal, e.g. 13.2) |
| Reserve | `RiderEntry.IsReserve = true`, no pony fields |
| Bibs | `RiderEntry.BibColour` (same value on every rider) or a new `DeclarationForm.BibDescription` |
| Team name | `Team.Name` (editable, defaults to "{Club} {suffix}") |
| Trainer name | **new:** `DeclarationForm.TrainerName` (defaults to the signed-in user's name) |
| Phone number | `submittedByPhone` |
| Notes | `DeclarationForm.Notes` |
| Terms agreed | **new:** `DeclarationForm.TermsAcceptedAt` (+ user id) |

## Removed

- `IsCaptain` and `OrderIndex` from the UI (keep the columns, default them).
- Per-rider privacy and filming options.
- The grid-cols-12 inline row editor and helper copy.

## Open

- Terms and conditions link target and text.
