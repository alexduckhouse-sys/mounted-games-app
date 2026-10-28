import { describe, expect, it } from 'vitest';
import type { StatsGame, StatsRun, StatsSummary } from '../types';
import { distinctNames, gameAveragePoints, gameRunsLine, headlineFacts, runDescription, runLabels, runPlaceText } from './profileStats';

const summary = (extra: Partial<StatsSummary> = {}): StatsSummary => ({
  competitions: 4, entries: 4, placedEntries: 4, firsts: 1, seconds: 3, thirds: 0, averagePlace: 1.75,
  entriesWithFinals: 3, finalsReached: 3, aFinals: 3, aFinalPercent: 100, races: 50, wins: 22, winPercent: 44,
  points: 195, maxPoints: 264, pointQuotaPercent: 73.9, ...extra,
});
const run = (extra: Partial<StatsRun> = {}): StatsRun => ({ competitionName: 'EGUK National Championships', startDate: '2026-08-22T00:00:00', place: 2, eliminated: false, points: 5, maxPoints: 6, ...extra });
const game = (extra: Partial<StatsGame> = {}): StatsGame => ({ name: 'Bending', races: 7, wins: 4, winPercent: 57.1, nonFinishes: 0, points: 32, maxPoints: 40, pointQuotaPercent: 80, ...extra });

describe('headlineFacts', () => {
  it('gives races won, points per race, average place and podiums', () => {
    expect(headlineFacts(summary())).toEqual([
      { value: '44%', label: 'Races won (22 of 50)' },
      { value: '3.9', label: 'Points per race' },
      { value: '1.8', label: 'Average place' },
      { value: '4', label: 'Podiums in 4 competitions' },
    ]);
  });
  it('uses dashes when there is nothing to divide, and the singular for one competition', () => {
    const facts = headlineFacts(summary({ races: 0, wins: 0, winPercent: null, points: 0, averagePlace: null, competitions: 1, firsts: 0, seconds: 0 }));
    expect(facts.map((fact) => fact.value)).toEqual(['—', '—', '—', '0']);
    expect(facts[3].label).toBe('Podiums in 1 competition');
  });
});

describe('distinctNames', () => {
  it('takes off the words every competition starts with', () => {
    expect(distinctNames(['EGUK National Championships', 'EGUK English Team Championships', 'EGUK Winter Pairs'])).toEqual(['National Championships', 'English Team Championships', 'Winter Pairs']);
  });
  it('leaves names alone when they share no start, or when there is only one distinct name', () => {
    expect(distinctNames(['National', 'English'])).toEqual(['National', 'English']);
    expect(distinctNames(['EGUK National', 'EGUK National'])).toEqual(['EGUK National', 'EGUK National']);
    expect(distinctNames([])).toEqual([]);
  });
  it('never strips a name to nothing', () => {
    expect(distinctNames(['EGUK', 'EGUK Winter'])).toEqual(['EGUK', 'EGUK Winter']);
  });
});

describe('runLabels', () => {
  it('names each run by what makes its competition different, with its month', () => {
    const labels = runLabels([run(), run({ competitionName: 'EGUK English Team Championships', startDate: '2026-09-19T00:00:00' })]);
    expect(labels).toEqual([['National', 'Aug'], ['English', 'Sep']]);
  });
  it('adds the year when the runs span more than one', () => {
    expect(runLabels([run({ startDate: '2025-10-03' }), run({ startDate: '2026-08-22' })]).map((lines) => lines[1])).toEqual(['Oct 25', 'Aug 26']);
  });
  it('drops the month when the date is not a date', () => {
    expect(runLabels([run({ startDate: 'soon' })])).toEqual([['EGUK']]);
  });
});

describe('runPlaceText and runDescription', () => {
  it('shows the place, E for a run put out and a dash for one with no place', () => {
    expect(runPlaceText(run({ place: 1 }))).toBe('1st');
    expect(runPlaceText(run({ place: 3 }))).toBe('3rd');
    expect(runPlaceText(run({ eliminated: true, place: null }))).toBe('E');
    expect(runPlaceText(run({ place: null }))).toBe('–');
    expect(runPlaceText(run({ place: 0 }))).toBe('–');
  });
  it('writes the whole run out in words', () => {
    expect(runDescription(run({ place: 2, points: 4 }))).toBe('EGUK National Championships, 2026-08-22: 2nd, 4 points');
    expect(runDescription(run({ eliminated: true, place: null, points: 1 }))).toBe('EGUK National Championships, 2026-08-22: put out, 1 point');
    expect(runDescription(run({ place: null }))).toContain('not placed');
  });
});

describe('gameRunsLine', () => {
  it('gives the best and worst run and the wins', () => {
    expect(gameRunsLine(game({ races: 3, wins: 1 }), [run({ points: 6 }), run({ points: 3 }), run({ points: 5 })])).toBe('Every Bending run · best 6, worst 3, won 1 of 3');
  });
  it('says so when only the latest runs are listed, and copes with none', () => {
    expect(gameRunsLine(game({ races: 50 }), [run({ points: 2 })])).toBe('Latest 1 run of Bending · best 2, worst 2, won 4 of 50');
    expect(gameRunsLine(game({ races: 0, wins: 0 }), [])).toBe('Bending · won 0 of 0');
  });
});

describe('gameAveragePoints', () => {
  it('uses the API figure, else works it out, else is null', () => {
    expect(gameAveragePoints(game({ averagePoints: 4.6 }))).toBe(4.6);
    expect(gameAveragePoints(game({ averagePoints: null, points: 32, races: 7 }))).toBe(4.6);
    expect(gameAveragePoints(game({ averagePoints: undefined, races: 0, points: 0 }))).toBeNull();
  });
});
