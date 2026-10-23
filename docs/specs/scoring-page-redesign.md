# Scoring page redesign

Scope: the heat scoring screen (`SessionPage`, staff) and the scorer-link page (`ScorerPage`, `/score`), which share `ScoringSection`. `ArenaPage` shows no scoring controls (it lists teams in a heat), so it is unchanged. No scoring maths, API or schema change. A tutorial mode is planned later and is not part of this.

## Screen, in words (phone first)

1. Heat tabs (unchanged).
2. **Race stack**, one card per race, in running order:
   - Finished race: one line, "Race 1 · Litter Lifter · 1 Bravo · 2 Charlie · Alpha out", with a Correct button that reopens it.
   - Current race (open): rows in lane order. Each row: lane badge, team name, bib swatch and name under it ("Red bib"), then the place badge or OUT, a small Out/Back in button and (organisers only) an HC button. Under the rows, one line: "Swipe a team down to eliminate it." Then Undo, Clear and Race complete.
   - Upcoming race: its name and its lanes in a compact list.
3. **Between races**: after a race is complete, an announcer card for the latest finished race: placings, who went out and why, running totals, and after a heat's last race, the heat result or, in a qualifier, who goes through and who does not.
4. **Next round lanes** (heat-heat-final): when a qualifier is finished, the lanes of the final; when the final is finished, the lanes of the next heat.
5. **Heat table** in the newer look (`heat-grid`, the same as the public heat scores), rows in lane order, then **Race rules** (one button per race).
6. **Lane view** for the current race. At 768px and wider it sits in the left column with the race stack on the right (it used to be the right-aligned control above the rows); on a phone it stacks after the race rows.
7. **Organiser tools** (collapsed, organisers only): lane rotation, qualifiers per heat, Set up heats. The header row (back arrow, Rules, Set up heats) is gone.

## Interpretation, point by point

- Lane order: `inLaneOrder` (`lib/laneOrder.ts`) sorts by the rotated lane for the race (`positionFor`), sit-outs after the lane holders, greyed and not tappable. It depends only on the race, so placing or eliminating never moves a row.
- Bib colour: `BibSwatch` (dot with a ring so white and black bibs show in all five themes, plus the name, so colour is never the only cue).
- Hints: the per-tile "swipe elim" and "tap a team" text is gone; one swipe line sits under the current race. A small Out button keeps elimination possible without a swipe (keyboard and assistive tech).
- "More" is removed. Its Did not start, Did not finish and Retired choices move into the elimination sheet.
- Elimination sheet: on Race complete, if any team is eliminated, a sheet asks why for each: missed a flag or pot, dropped equipment, crossed lanes, wrong course, did not start, did not finish, retired, other (free text). The reason is stored as the team's existing private referee note (PR #103), and a non-finish reason also sets the result status. No schema change. On a scorer link the sheet is skipped, because a link cannot write referee notes (API rule); the elimination is saved without a reason.
- Announcer summary: standings use the heat's own points. Ties are ordered by the section's tie-break rule, mirroring `TieBreaker.cs` (countback on places, or last race); run-off and manual say the organiser decides. HC teams are listed after the ranked teams and are never ranked or qualified. In a qualifier, the top N placings (session `qualifiersPerHeat`, default 3) go through, exactly as `RaceFinalService` picks them; an eliminated team is out, and others are "placed 4th, top 3 go through".
- Next round lanes: the final's real entries when the server has filled them; otherwise a provisional interleave (Q1 first, Q2 first, ...) like `RaceFinalService`, labelled provisional. After the final, the next heat's drawn lanes (the next unfinished heat, or the first heat of the next race session).
- Undo: a stack of the last 10 actions for the current race. Placing, elimination, status and reason changes undo one at a time. When the draft is empty, Undo reverses the last save of that race: if it is still waiting in the outbox the queued save is cancelled (and the one it replaced is restored); if it has been sent, a correcting update with the earlier results goes through the outbox (reason "Undo"). If there were no earlier results, the race is reopened for editing and the scorer saves a correction.
- HC: organisers can mark a team Hors Concours from its row after a confirmation ("Competes but doesn't score; removed from standings and finals seeding"). It uses the existing `PUT /competitions/{id}/teams/{teamId}` `isHorsConcours` call that Teams uses, and is reversible the same way. The row shows an HC tag, and the summary treats the team as HC at once.

## Tests

Vitest: lane order helper, stacked races, undo (draft and outbox), elimination sheet, summary, next-round lanes, HC. Existing SessionPage and ScorerPage tests are updated for the new markup.
