import { describe, expect, it } from 'vitest';
import {
  buildArenaCrewRaceCardFromDiagram, buildArenaCrewTransitionDiff, buildOfflineArenaCrewPropSheet, filterRaceCardZones,
} from './arenaCrewSheet';
import type { Heat, Race, RaceTemplate, Session } from '../types';

const card = (elements: unknown[]) => buildArenaCrewRaceCardFromDiagram('R', 1, JSON.stringify(elements));
const zoneItems = (c: ReturnType<typeof card>, key: string) => c.card.zones.find((z) => z.zoneKey === key)!.items;

describe('buildArenaCrewRaceCardFromDiagram', () => {
  it('returns empty zones for missing, blank, malformed or non-array diagrams', () => {
    for (const json of [undefined, null, '', '   ', '{not json', '{"t":"pole"}', '"x"']) {
      const { card: c, propCounts } = buildArenaCrewRaceCardFromDiagram('R', 3, json, { raceId: 9, summary: 'S' });
      expect(c).toMatchObject({ raceId: 9, raceName: 'R', orderIndex: 3, bendingPolesPerLane: 0, summary: 'S' });
      expect(c.zones.map((z) => z.summaryText)).toEqual(['Clear', 'Clear', 'Clear']);
      expect(propCounts.size).toBe(0);
    }
  });

  it('defaults the race id and summary to null', () => {
    expect(buildArenaCrewRaceCardFromDiagram('R', 1).card).toMatchObject({ raceId: null, summary: null });
  });

  it('skips junk entries, lanes and midlines', () => {
    const c = card([null, 'x', 4, {}, { t: 'lane', poles: 4 }, { t: 'midline' }, { t: 'pole', anchor: 'pole1' }]);
    expect(c.propCounts.get('Bending pole')).toBe(1);
    expect(c.propCounts.size).toBe(1);
  });

  it('places elements by anchor, case-insensitively and ignoring blanks', () => {
    const c = card([
      { t: 'cone', kind: 'flag', anchor: ' START ' },
      { t: 'cone', kind: 'ball', anchor: 'gap0' },
      { t: 'cone', kind: 'bucket', anchor: 'Mid_4_Top' },
      { t: 'item', kind: 'bin', anchor: 'gap4' },
      { t: 'item', kind: 'cup', anchor: 'changeover' },
      { t: 'item', kind: 'mug', anchor: 'gap5' },
      { t: 'item', kind: 'hat', anchor: 'top' },
      { t: 'item', kind: 'sack', anchor: 'pole5' },
      { t: 'item', kind: 'ring', anchor: 'beyond' },
      { t: 'item', kind: 'baton', anchor: 'pole2' },
      { t: 'item', kind: 'rope', anchor: 'gap2' },
      { t: 'item', kind: 'tyre', anchor: 'mid_2' },
      { t: 'item', kind: 'bib', anchor: '   ', x: 5 },
    ]);
    expect(zoneItems(c, 'start')).toEqual(['1 × Ball cone per lane', '1 × Bib per lane', '1 × Flag cone per lane']);
    expect(zoneItems(c, 'top')).toHaveLength(7);
    expect(zoneItems(c, 'centre')).toEqual(['1 × Baton per lane', '1 × Rope per lane', '1 × Tyre per lane']);
  });

  it('falls back to the x position, then to the centre', () => {
    const c = card([
      { t: 'item', kind: 'a', x: 17.9 },
      { t: 'item', kind: 'b', x: 18 },
      { t: 'item', kind: 'c', x: 91.9 },
      { t: 'item', kind: 'd', x: 92 },
      { t: 'item', kind: 'e', anchor: 'unknown', x: 50 },
      { t: 'item', kind: 'f', anchor: 'unknown', x: 5 },
      { t: 'item', kind: 'g', x: 'far' },
      { t: 'item', kind: 'h' },
    ]);
    expect(zoneItems(c, 'start')).toEqual(['1 × A per lane', '1 × F per lane']);
    expect(zoneItems(c, 'top')).toEqual(['1 × D per lane']);
    expect(zoneItems(c, 'centre')).toEqual(['1 × B per lane', '1 × C per lane', '1 × E per lane', '1 × G per lane', '1 × H per lane']);
  });

  it('labels elements: poles, tables, real labels, positional labels, kinds, then the type', () => {
    const c = card([
      { t: 'in', anchor: 'pole1' },
      { t: 'table', anchor: 'pole1' },
      { t: 'item', label: ' Water jug ', anchor: 'pole1' },
      { t: 'item', label: '3', kind: 'cup', anchor: 'pole1' },
      { t: 'item', label: 'Pole 2', kind: 'sack', anchor: 'pole1' },
      { t: 'item', label: '1st cone', kind: 'ring', anchor: 'pole1' },
      { t: 'item', label: '  ', kind: ' ', anchor: 'pole1' },
      { t: 'cone', kind: '', anchor: 'pole1' },
      { t: 'cone', label: 7, kind: 'flag', anchor: 'pole1' },
    ]);
    expect(zoneItems(c, 'centre')).toEqual([
      '1 × Cone per lane',
      '1 × Cup per lane',
      '1 × Flag cone per lane',
      '1 × Item per lane',
      '1 × Ring per lane',
      '1 × Sack per lane',
      '2 × Table / stand per lane',
      '1 × Water jug per lane',
    ]);
  });

  it('counts nested items and ignores nested lanes, counting bending poles only in the centre', () => {
    const c = card([
      { t: 'pole', anchor: 'pole1', on: [{ t: 'item', kind: 'mug' }, { t: 'lane' }, { t: 'item', kind: 'mug', on: [{ t: 'item', kind: 'ball' }] }] },
      { t: 'pole', anchor: 'start' },
      { t: 'pole', anchor: 'top' },
      { t: 'cone', anchor: 'pole2', on: 'not an array' },
    ]);
    expect(c.card.bendingPolesPerLane).toBe(1);
    expect(c.propCounts.get('Bending pole')).toBe(3);
    expect(c.propCounts.get('Mug')).toBe(2);
    expect(c.propCounts.get('Ball')).toBe(1);
    // Poles sort ahead of everything else in a zone.
    expect(zoneItems(c, 'centre')).toEqual(['1 × Bending pole per lane', '1 × Ball per lane', '1 × Cone per lane', '2 × Mug per lane']);
  });
});

describe('buildArenaCrewTransitionDiff', () => {
  it('reports no changes for identical or empty counts', () => {
    expect(buildArenaCrewTransitionDiff(new Map(), new Map()).summaryText).toBe('No prop changes needed.');
  });
  it('omits sections with nothing in them and sorts keys', () => {
    const only = buildArenaCrewTransitionDiff(new Map([['Flag', 2]]), new Map());
    expect(only).toMatchObject({ bringIn: [], keepInRing: [], clearOut: ['2 × Flag per lane'], summaryText: 'Clear: 2 × Flag per lane' });
    const bring = buildArenaCrewTransitionDiff(new Map(), new Map([['Mug', 1], ['Ball', 3]]));
    expect(bring.summaryText).toBe('Bring in: 3 × Ball per lane, 1 × Mug per lane');
    const keep = buildArenaCrewTransitionDiff(new Map([['Pole', 4]]), new Map([['Pole', 4]]));
    expect(keep.summaryText).toBe('Keep: 4 × Pole per lane');
  });
  it('splits a partial change into keep plus bring in or clear', () => {
    const d = buildArenaCrewTransitionDiff(new Map([['A', 2], ['B', 5]]), new Map([['A', 3], ['B', 1]]));
    expect(d.keepInRing).toEqual(['2 × A per lane', '1 × B per lane']);
    expect(d.bringIn).toEqual(['1 × A per lane']);
    expect(d.clearOut).toEqual(['4 × B per lane']);
    expect(d.summaryText).toBe('Bring in: 1 × A per lane · Clear: 4 × B per lane · Keep: 2 × A per lane, 1 × B per lane');
  });
});

describe('filterRaceCardZones', () => {
  it('defaults to every zone and filters to one', () => {
    const { card: c } = card([]);
    expect(filterRaceCardZones(c)).toHaveLength(3);
    expect(filterRaceCardZones(c, 'centre').map((z) => z.zoneKey)).toEqual(['centre']);
    expect(filterRaceCardZones(c, 'top').map((z) => z.zoneKey)).toEqual(['top']);
  });
});

describe('buildOfflineArenaCrewPropSheet', () => {
  const tpl = (name: string, diagram: unknown[] | null, summary?: string | null): RaceTemplate => ({
    id: 1, name, isBuiltIn: false, diagramJson: diagram ? JSON.stringify(diagram) : undefined, summary,
  } as RaceTemplate);
  const race = (id: number, name: string, orderIndex: number, isComplete = false): Race => ({ id, heatId: 1, name, orderIndex, isComplete, results: [] });
  const heat = (races: Race[], extra: Partial<Heat> = {}): Heat => ({ id: 7, sessionId: 1, orderIndex: 2, entries: [], races, ...extra });
  const session = (extra: Partial<Session> = {}): Session => ({
    id: 1, competitionId: 1, competitionSectionId: 1, sectionName: 'S', name: 'Sess', status: 1, orderIndex: 1, isBreak: false, kind: 0, heats: [], ...extra,
  } as Session);

  it('returns an empty sheet with five lanes when there is no session', () => {
    for (const s of [null, undefined]) {
      expect(buildOfflineArenaCrewPropSheet(4, s, null, [])).toEqual({
        competitionId: 4, sessionId: null, sessionName: null, arenaName: null, heatId: null, heatLabel: null,
        lanesPerHeat: 5, currentRace: null, nextRace: null, transition: null, allHeatRaces: [],
      });
    }
  });

  it('uses the session planned races when the heat has none, matching templates by trimmed lowercase name', () => {
    const sheet = buildOfflineArenaCrewPropSheet(1, session({ plannedRaces: ['Flags', ' bending '] }), heat([]), [
      tpl(' FLAGS ', [{ t: 'cone', kind: 'flag', anchor: 'start' }], 'Fast one'),
      tpl('Bending', [{ t: 'pole', anchor: 'pole1' }]),
    ]);
    expect(sheet.allHeatRaces.map((c) => [c.raceName, c.orderIndex, c.raceId, c.summary])).toEqual([
      ['Flags', 1, null, 'Fast one'], [' bending ', 2, null, null],
    ]);
    expect(sheet.currentRace?.raceName).toBe('Flags');
    expect(sheet.nextRace?.raceName).toBe(' bending ');
    expect(sheet.transition?.bringIn).toEqual(['1 × Bending pole per lane']);
    expect(sheet.transition?.clearOut).toEqual(['1 × Flag cone per lane']);
  });

  it('plans nothing when there is neither a heat nor planned races', () => {
    const sheet = buildOfflineArenaCrewPropSheet(1, session(), null, []);
    expect(sheet).toMatchObject({ currentRace: null, nextRace: null, transition: null, allHeatRaces: [], heatId: null, heatLabel: null, arenaName: null, lanesPerHeat: 5 });
  });

  it('sorts the heat races, starts at the first incomplete one and has no next race at the end', () => {
    const h = heat([race(3, 'C', 3, false), race(1, 'A', 1, true), race(2, 'B', 2, false)]);
    const sheet = buildOfflineArenaCrewPropSheet(1, session(), h, []);
    expect(sheet.allHeatRaces.map((c) => c.raceName)).toEqual(['A', 'B', 'C']);
    expect(sheet.currentRace?.raceName).toBe('B');
    expect(sheet.nextRace?.raceName).toBe('C');

    const last = buildOfflineArenaCrewPropSheet(1, session(), heat([race(1, 'A', 1, true), race(2, 'B', 2, false)]), []);
    expect(last.currentRace?.raceName).toBe('B');
    expect(last.nextRace).toBeNull();
    expect(last.transition).toBeNull();
  });

  it('shows the last race as current when every race is complete', () => {
    const sheet = buildOfflineArenaCrewPropSheet(1, session(), heat([race(1, 'A', 1, true), race(2, 'B', 2, true)]), []);
    expect(sheet.currentRace?.raceName).toBe('B');
    expect(sheet.nextRace).toBeNull();
  });

  it('labels the heat and sizes the lanes from entries or the session, whichever is larger', () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({ id: i, teamId: i, teamName: 'T', laneIndex: i }));
    const big = buildOfflineArenaCrewPropSheet(1, session({ arenaName: 'Ring 1', lanesPerHeat: 4 }), heat([], { entries, label: '  ', orderIndex: 3 }), []);
    expect(big).toMatchObject({ heatId: 7, heatLabel: 'Heat 3', lanesPerHeat: 7, arenaName: 'Ring 1', sessionName: 'Sess', sessionId: 1 });
    const small = buildOfflineArenaCrewPropSheet(1, session({ lanesPerHeat: 8 }), heat([], { label: ' Final ' }), []);
    expect(small).toMatchObject({ heatLabel: 'Final', lanesPerHeat: 8 });
    const nullArena = buildOfflineArenaCrewPropSheet(1, session({ arenaName: undefined }), null, []);
    expect(nullArena.arenaName).toBeNull();
  });
});
