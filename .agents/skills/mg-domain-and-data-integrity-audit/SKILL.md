---
name: mg-domain-and-data-integrity-audit
description: >-
  Mounted Games domain rules, scoring maths, finals qualification, tie-breakers,
  timetable delay cascades, offline outbox idempotency, and database schema parity
  audit skill. Use when verifying that backend services, frontend calculations,
  printed sheets, calendar feeds, and season publications all agree 100%.
---

# Mounted Games App — Domain & Data Integrity Audit Skill

Goal: Verify that every Mounted Games rule, points calculation, tie-breaker, draw algorithm, timetable calculation, and database schema invariant agrees across `api/` and `web/src/`.

## Domain Invariants to Verify

1. **Standard Heat & Final Scoring (`ScoringService.cs`, `SectionScoring.cs`, `raceScoring.ts`, `toplist.ts`):**
   - Normal heat 1st-place points = largest active heat size in that session (`sessionBase - place + 1`).
   - Lettered Finals (`A Final`, `B Final`, `C Final`) score 1st-place points equal to the final heat's own active team count, doubled on save when `DoublePointsInFinal == true`.
   - `Eliminated` = `0 pts`; `Sit-Out` (`IsSitOut`) = `0 pts` displayed as **`S`** (never `0` or `E`); `IsHorsConcours` (`HC`) teams score `0` and compact competitive places behind them, and are excluded from standings and finals seeding.
   - Referee directives `[pts:N]` (exact override, not doubled) and `[adj:±N]` (shifts placing points, never applied twice on re-save) accept whole or `.5` half points only (`PointValues`).
   - `CarryPointsIntoFinal`: when `true`, finalist total = earlier + final + tack bonus; when `false`, finalist total = final points only (and ties break on final races only). Verify `StandingsService`, `toplist.ts`, `PrintableEventService`, and `SeasonPublicationService` all produce identical rankings and totals.
2. **Heat-Heat-Final (`UsesRaceFinals == true` — `RaceFinalService.cs`, `ScoringService.cs`, `HeatScores.tsx`):**
   - `Q1` and `Q2` award `1 pt` per non-eliminated finisher (`0` for eliminated).
   - Once both `Q1` and `Q2` are complete, `Final` auto-populates by interleaving `Q1[1], Q2[1], Q1[2], Q2[2]…` up to `QualifiersPerHeat` (skipping withdrawn and HC teams).
   - Non-eliminated Finalists score `finalHeatSize + 1 - place + 1` (`2 pts` for last non-eliminated place in the Final); eliminated Finalists score `0 pts`.
3. **Tie-Breaking & Finals Boundaries (`TieBreaker.cs`, `FinalsBoundary`, `raceSummary.ts`, `toplist.ts`):**
   - Every final tier cut-off (`A/B`, `B/C`, `last final / out`) is checked for point ties (`FinalsBoundary`).
   - Explicit `FinalsTieOrder` (`PUT /finals/tie-order`) or `+0.01` hidden run-off tie-breaker resolves ties first, followed by the section's `TieBreakRule` (`Countback` on 1sts, 2nds… or `LastRace`).
4. **Timetable Timing & Per-Arena Isolation (`web/src/lib/time.ts` vs `api/Services/Calendar/TimetableTimes.cs`):**
   - Confirm `MinutesPerHeat` is per whole heat (never multiplied by `raceCount`).
   - Confirm delays (`offsetMs`), `[paused:<ms>]`, and `[shift:±N]` cascade **per arena** (`arenaName`), never bleeding from Arena 1 into Arena 2.
   - Confirm `web/src/lib/time.ts` and `api/Services/Calendar/TimetableTimes.cs` stay in lockstep.
5. **Database Schema & Seeder Parity (`AppDbContext`, `Migrations/`, `DbInitializer`, `ReviewCompetitionSeeder`):**
   - Confirm every entity property mapped in `AppDbContext` matches `AppDbContextModelSnapshot.cs` (`PostgresMigrationSnapshotMatchesTheOwnershipModel`), has an idempotent SQL script in `api/Data/Migrations/Scripts/`, a SQLite guard in `DbInitializer` / `*SqliteSchema.cs`, and is cleaned up in `ReviewCompetitionSeeder.DeleteCompetitionGraphAsync`.
