import { describe, expect, it } from 'vitest';
import {
  buildArenaCrewRaceCardFromDiagram,
  buildArenaCrewTransitionDiff,
  buildOfflineArenaCrewPropSheet,
  filterRaceCardZones,
} from './arenaCrewSheet';
import type { Heat, RaceTemplate, Session } from '../types';

describe('arenaCrewSheet (#4)', () => {
  const fiveFlagDiagram = JSON.stringify([
    { t: 'cone', kind: 'flag', anchor: 'start', on: [{ t: 'item', kind: 'flag' }, { t: 'item', kind: 'flag' }, { t: 'item', kind: 'flag' }, { t: 'item', kind: 'flag' }] },
    { t: 'pole', anchor: 'pole1' },
    { t: 'pole', anchor: 'pole2' },
    { t: 'pole', anchor: 'pole3' },
    { t: 'pole', anchor: 'pole4' },
    { t: 'cone', kind: 'flag', anchor: 'changeover', on: [{ t: 'item', kind: 'flag' }] },
  ]);

  const twoMugDiagram = JSON.stringify([
    { t: 'pole', anchor: 'pole1', on: [{ t: 'item', kind: 'mug' }] },
    { t: 'pole', anchor: 'pole2' },
    { t: 'pole', anchor: 'pole3', on: [{ t: 'item', kind: 'mug' }] },
    { t: 'pole', anchor: 'pole4' },
  ]);

  it('splits race diagram elements into Start/Finish, Centre Poles 1-4, and Changeover/Top Line zones', () => {
    const { card } = buildArenaCrewRaceCardFromDiagram('Five Flag', 1, fiveFlagDiagram);
    expect(card.bendingPolesPerLane).toBe(4);
    expect(card.zones[0].zoneKey).toBe('start');
    expect(card.zones[0].items).toEqual(['4 × Flag per lane', '1 × Flag cone per lane']);
    expect(card.zones[1].zoneKey).toBe('centre');
    expect(card.zones[1].items).toEqual(['4 × Bending pole per lane']);
    expect(card.zones[2].zoneKey).toBe('top');
    expect(card.zones[2].items).toEqual(['1 × Flag per lane', '1 × Flag cone per lane']);

    expect(filterRaceCardZones(card, 'start')).toHaveLength(1);
    expect(filterRaceCardZones(card, 'all')).toHaveLength(3);
  });

  it('computes transition diff (Bring in / Clear / Keep) between Current Race and Next Race', () => {
    const race1 = buildArenaCrewRaceCardFromDiagram('Five Flag', 1, fiveFlagDiagram);
    const race2 = buildArenaCrewRaceCardFromDiagram('Two Mug', 2, twoMugDiagram);
    const diff = buildArenaCrewTransitionDiff(race1.propCounts, race2.propCounts);

    expect(diff.bringIn).toEqual(['2 × Mug per lane']);
    expect(diff.clearOut).toEqual(['5 × Flag per lane', '2 × Flag cone per lane']);
    expect(diff.keepInRing).toEqual(['4 × Bending pole per lane']);
    expect(diff.summaryText).toContain('Bring in: 2 × Mug per lane');
    expect(diff.summaryText).toContain('Keep: 4 × Bending pole per lane');
  });

  it('builds an offline arena crew sheet for the active heat', () => {
    const templates: RaceTemplate[] = [
      { id: 1, name: 'Five Flag', isBuiltIn: true, diagramJson: fiveFlagDiagram },
      { id: 2, name: 'Two Mug', isBuiltIn: true, diagramJson: twoMugDiagram },
    ];
    const heat: Heat = {
      id: 50,
      sessionId: 10,
      label: 'Heat 1',
      orderIndex: 1,
      entries: [],
      races: [
        { id: 501, heatId: 50, name: 'Five Flag', orderIndex: 1, isComplete: false, results: [] },
        { id: 502, heatId: 50, name: 'Two Mug', orderIndex: 2, isComplete: false, results: [] },
      ],
    };
    const session: Session = {
      id: 10,
      competitionId: 1,
      competitionSectionId: 2,
      sectionName: 'U15',
      name: 'U15 Session 1',
      arenaName: 'Arena 1',
      status: 1,
      orderIndex: 1,
      isBreak: false,
      kind: 0,
      lanesPerHeat: 5,
      heats: [heat],
    };

    const sheet = buildOfflineArenaCrewPropSheet(1, session, heat, templates);
    expect(sheet.currentRace?.raceName).toBe('Five Flag');
    expect(sheet.nextRace?.raceName).toBe('Two Mug');
    expect(sheet.transition?.bringIn).toEqual(['2 × Mug per lane']);
  });

  it('sets out the pairs version of each race for a pairs session', () => {
    const heat: Heat = { id: 60, sessionId: 11, label: 'Heat 1', orderIndex: 1, entries: [], races: [{ id: 601, heatId: 60, name: 'Five Flag', orderIndex: 1, isComplete: false, results: [] }] };
    const session: Session = { id: 11, competitionId: 1, competitionSectionId: 3, sectionName: 'Open Pairs', name: 'Pairs 1', arenaName: 'Arena 1', status: 1, orderIndex: 1, isBreak: false, kind: 0, lanesPerHeat: 5, heats: [heat] };
    const templates: RaceTemplate[] = [
      { id: 1, name: 'Five Flag', isBuiltIn: true, summary: 'Team', diagramJson: '[{"t":"item","kind":"flag","anchor":"start"},{"t":"item","kind":"flag","anchor":"beyond"},{"t":"item","kind":"flag","anchor":"beyond"}]' },
      { id: 2, name: 'Five Flag (Pairs)', isBuiltIn: true, summary: 'Pairs', baseName: 'Five Flag', format: 1, diagramJson: '[{"t":"item","kind":"flag","anchor":"start"}]' },
    ];
    expect(buildOfflineArenaCrewPropSheet(1, session, heat, templates, 1).currentRace?.summary).toBe('Pairs');
    expect(buildOfflineArenaCrewPropSheet(1, session, heat, templates).currentRace?.summary).toBe('Team');
  });
});
