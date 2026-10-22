# Create competition (desktop): handoff

**Status:** decided, ready to build.
**Proposal:** `docs/designs/create-competition-proposal.html` (open in a browser).
**Replaces:** the 3-step wizard in `web/src/pages/admin/CompetitionEditor.tsx` (Basics → Sections → Review) for `/admin/competitions/new` and `/admin/competitions/:id/edit`.

## What changes

- One scrolling page instead of steps. No Review step and no public preview.
- Five numbered parts, each with an `mg-section-head`-style rule (2px navy underline, Barlow Condensed uppercase):
  1. **About the competition:** Name (2fr) + Icon (1fr), then Organiser.
  2. **When:** Starts date, start time, Ends date ("Same day" placeholder), end time, in one 4-column row.
  3. **Where:** Venue, then Postcode + what3words (optional). A map-pin-check icon inside the postcode field shows a successful geocode. No separate "Look up coordinates" button: geocode on blur.
  4. **What people can enter:** sections as a table. Columns: Format, Age group, Price, Max, delete. "Add a section" is the last row.
  5. **Payment and notes:** Where entry fees go (optional), Notes for riders (optional).
- Sticky footer: "Draft saved hh:mm" on the left, then **Save draft** (secondary) and **Publish and open entries** (primary).
- Content max-width 880px, centred. Inputs 48px tall (44px inside the table). Page background `#F7F7F7`.

## Field mapping (no API changes)

| UI | State / payload |
|---|---|
| Name | `name` |
| Icon | `icon` (COMPETITION_ICONS) |
| Organiser | `organiserName` |
| Starts / at | `startDate`, `startTime` |
| Ends / at | `endDate` (empty = same day), `endTime` |
| Venue | `location` |
| Postcode, what3words | `postcode`, `what3Words` → `/geocode` fills `lat`, `lon` |
| Section row | `SectionDraft.format`, `ageGroup`, `priceGbp`, `maxParticipants` |
| Where entry fees go | `paymentDestination` |
| Notes for riders | `description` |

## Removed from this page

- Review step and its summary.
- "Teams in the final" (`finalistCount`): set later in Format / Form teams.
- Apple Maps URL and manual lat/lon: keep them behind a "More location options" disclosure only if they're still needed. They aren't shown in the proposal.
- Helper and intro copy, the PBKDF2-style explanatory notes and the `text-[10px]` hints.

## Kept behaviour

- Draft autosave to `competitionEditor:new` / `competitionEditor:edit:{id}`. The footer shows the last save time.
- Slim create: competition + sections only. Races, sessions and heats stay in the Format flow.
- Validation unchanged: name, start date and start time required. Every section needs an age group. Show errors inline under the field, not in a banner.
