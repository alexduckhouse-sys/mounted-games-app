# Race scoring: handoff

**Status:** proposal, ready to review.
**Proposal:** `docs/designs/scoring/Main.dc.html` (phone, 390 × 844). Clickable prototype from Claude Design; open it in the canvas and press Play.
**Replaces:** `ScoringSection` / `ScoreTile` in `web/src/pages/competition/SessionPage.tsx`.

## How it works

- **Race bar:** back / forward arrows with the full race name in the middle and "Race 3 of 5 · Scoring / Scored / Not scored" above it. No race timer.
- **Placing:** tap teams in finishing order; tap again to take the place back. First-time scoring keeps rows in lane order so nothing moves under your finger.
- **Eliminate:** press and hold a row (~650 ms). A red fill starts after 200 ms and the phone buzzes on eliminate. Tap an eliminated team to restore it. Keyboard: Delete.
- **Row border** is the team's bib colour; eliminated rows use a muted red border.
- **Correcting:** go back to a scored race and press Correct. Rows sort into finishing order and placed rows get a drag handle to reorder places (arrow keys on the handle also work).
- **Bottom bar:** "x of 6" over a six-segment progress bar (navy placed, red eliminated), plus Score override, Undo and Clear icon buttons. Submit unlocks once every team is placed, eliminated or overridden.
- **Submit** saves and jumps straight to the next unscored race, with a 3 s "saved and sent" message. On the last race it shows "Heat complete · Next heat".

## Score override

- Sliders button opens a sheet listing the teams with their current result.
- Per team: **Automatic** (finishing place), **Set points** (− / + stepper) or **Hors concours (HC)** (rides, no points).
- Set points and HC need a reason. Choosing Automatic removes the override.
- Overridden rows show an "HC" or "Manual" chip; totals use the override. Overrides are per race.

## Open

- HC rule: does the team behind an HC team keep its place points (current assumption) or move up?
- Does a mid-event HC change on the scoring screen also set `Team.IsHorsConcours`, or is it per race only?
- Model for manual points and override reason (per `RaceResult`?).
