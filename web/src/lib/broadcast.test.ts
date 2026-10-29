import { describe, expect, it } from 'vitest';
import { broadcastOptions, broadcastPresentation, broadcastSource, isBroadcastSnapshot, type BroadcastSnapshot } from './broadcast';

const base: BroadcastSnapshot = { revision: 8, serverTime: '2026-10-29T12:00:30Z', observedAt: '2026-10-29T12:00:00Z',
  playbackAt: '2026-10-29T12:00:00Z', expiresAt: '2026-10-29T12:00:45Z', hidden: false, warmingUp: false,
  graphics: { competitionName: 'Example show', arena: 'Main arena', current: null, next: null, score: null, standings: [], banner: null, sponsors: [], cues: [] } };
const score = { raceId: 1, raceName: 'Bending', heatLabel: 'Heat 1', rows: [] };

describe('broadcast', () => {
  it('validates bounded options and safely encodes arena names', () => {
    expect(broadcastOptions(new URLSearchParams('arena=Arena+1&delay=120&section=2'))).toEqual({ arena: 'Arena 1', delay: 120, section: 2, valid: true });
    for (const query of ['arena=a&delay=121', 'arena=a&delay=-1', 'arena=a&delay=NaN', 'arena=a&section=0', 'delay=0']) expect(broadcastOptions(new URLSearchParams(query)).valid).toBe(false);
    expect(broadcastSource(2, 'A & B', 30, 4)).toBe('/embed/competitions/2/overlay?arena=A+%26+B&delay=30&section=4');
  });
  it('validates the public payload before rendering it', () => {
    expect(isBroadcastSnapshot(base)).toBe(true);
    expect(isBroadcastSnapshot({ ...base, graphics: null })).toBe(true);
    for (const value of [null, {}, { ...base, revision: NaN }, { ...base, serverTime: 'bad' }, { ...base, graphics: { ...base.graphics, standings: [{}] } }, { ...base, graphics: { ...base.graphics, current: {} } }]) expect(isBroadcastSnapshot(value)).toBe(false);
  });
  it('stays transparent during warm-up, hide, missing data and stale connection', () => {
    expect(broadcastPresentation(null, 100, 100)).toBeNull();
    expect(broadcastPresentation({ ...base, hidden: true }, 100, 100)).toBeNull();
    expect(broadcastPresentation({ ...base, warmingUp: true }, 100, 100)).toBeNull();
    expect(broadcastPresentation(base, 100, 15_100)).toBeNull();
    expect(broadcastPresentation(base, 100, 100)).not.toBeNull();
  });
  it('expires a cue on the delayed timeline, not the wall-clock arrival', () => {
    const value = { ...base, graphics: { ...base.graphics!, cues: [{ revision: 1, commandId: 'one', kind: 'score', action: 'show', startsAt: '2026-10-29T11:59:59Z', expiresAt: '2026-10-29T12:00:05Z', payload: score }] } };
    expect(broadcastPresentation(value, 100, 100)?.score).toEqual(score);
    expect(broadcastPresentation(value, 100, 5100)?.score).toBeNull();
  });
  it('uses the newest command and skip only suppresses its own race', () => {
    const cue = { revision: 1, commandId: 'one', kind: 'score', action: 'show', startsAt: '2026-10-29T11:59:59Z', expiresAt: '2026-10-29T12:00:10Z', payload: score };
    const graphics = { ...base.graphics!, score, cues: [{ ...cue, revision: 2, commandId: 'two', action: 'skip' }, cue] };
    expect(broadcastPresentation({ ...base, graphics }, 0, 0)?.score).toBeNull();
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, score: { ...score, raceId: 2 } } }, 0, 0)?.score?.raceId).toBe(2);
  });
  it('honours selected cards and accepts unranked standings', () => {
    const standings = [{ teamId: 7, teamName: 'Example unranked', totalPoints: 0, place: null, joint: false }];
    const graphics = { ...base.graphics!, score, standings, card: 'toplist' };
    expect(isBroadcastSnapshot({ ...base, graphics })).toBe(true);
    expect(broadcastPresentation({ ...base, graphics }, 0, 0)).toMatchObject({ score: null, standings });
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, card: 'result' } }, 0, 0)).toMatchObject({ score, standings: [] });
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, card: 'none' } }, 0, 0)).toMatchObject({ score: null, current: null, next: null, standings: [] });
  });

  it('validates complete graphics and rejects broken public contracts', () => {
    const row = { teamId: 1, name: 'Example team', bibColour: null, lane: 1, sitOut: false, hc: false, place: 1, joint: false, points: 4, eliminated: false };
    const heat = { heatId: 1, label: 'Heat 1', sessionName: 'Morning', sectionId: 2, sectionName: 'Open', raceId: 1, raceName: 'Bending', started: true, rows: [row] };
    const podium = { action: 'show', sectionName: 'Open', champions: true, places: [{ teamId: 1, teamName: 'Example team', place: 1, points: 4 }] };
    const cue = { revision: 1, commandId: 'one', kind: 'podium', action: 'show', startsAt: base.playbackAt, expiresAt: base.expiresAt, payload: podium };
    const graphics = { ...base.graphics!, current: heat, next: { ...heat, sectionId: null, raceId: null, raceName: null }, score: { ...score, rows: [row], expiresAt: base.expiresAt },
      sponsors: [{ name: 'Example sponsor', logoData: null }], podium, cues: [cue], card: 'podium', toplistRows: 3, background: '#112233', accent: '#ABCDEF' };
    expect(isBroadcastSnapshot({ ...base, graphics })).toBe(true);
    expect(isBroadcastSnapshot({ ...base, graphics: { ...graphics, current: { ...heat, rows: [{ ...row, lane: null, place: null, points: null, bibColour: 'blue', sitOut: true }] } } })).toBe(true);
    for (const patch of [
      { current: { ...heat, rows: [{ ...row, points: '4' }] } }, { current: { ...heat, rows: [{ ...row, joint: null }] } },
      { current: { ...heat, sectionId: '2' } }, { next: { ...heat, raceId: '1' } }, { current: { ...heat, rows: [null] } },
      { score: { ...graphics.score, expiresAt: 'bad' } }, { score: { ...score, rows: [{}] } },
      { podium: { ...podium, places: [{ teamId: 1, teamName: null, place: 1, points: 4 }] } },
      { sponsors: [{ name: 'Example', logoData: 3 }] }, { sponsors: [null] }, { toplistRows: '3' }, { card: 1 },
      { background: 'url(example)' }, { accent: null }, { cues: [{ ...cue, kind: 'private' }] },
      { cues: [{ ...cue, kind: 'score', payload: score }] , podium: { ...podium, champions: null } },
      { cues: [{ ...cue, expiresAt: 'bad' }] },
    ]) expect(isBroadcastSnapshot({ ...base, graphics: { ...graphics, ...patch } })).toBe(false);
    expect(isBroadcastSnapshot({ ...base, observedAt: 'bad' })).toBe(false);
    expect(isBroadcastSnapshot({ ...base, graphics: { ...graphics, cues: [{ ...cue, kind: 'score', payload: score }] } })).toBe(true);
  });
  it('switches line-ups and podiums with the chosen card and expires automatic scores', () => {
    const heat = { heatId: 1, label: 'Heat 1', sessionName: 'Morning', sectionId: null, sectionName: 'Open', raceId: null, raceName: null, started: false, rows: [] };
    const podium = { action: 'show', sectionName: 'Open', champions: false, places: [] };
    const graphics = { ...base.graphics!, current: heat, next: { ...heat, heatId: 2 }, podium, score: { ...score, expiresAt: '2026-10-29T12:00:03Z' } };
    expect(broadcastPresentation({ ...base, graphics }, 0, 3000)?.score).toBeNull();
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, card: 'next' } }, 0, 0)?.current?.heatId).toBe(2);
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, card: 'lanes' } }, 0, 0)?.current?.heatId).toBe(1);
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, card: 'podium' } }, 0, 0)?.podium).toEqual(podium);
    const cue = { revision: 4, commandId: 'show', kind: 'podium', action: 'show', startsAt: base.playbackAt, expiresAt: base.expiresAt, payload: podium };
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, cues: [cue] } }, 0, 0)?.podium).toEqual(podium);
    expect(broadcastPresentation({ ...base, graphics: { ...graphics, cues: [cue, { ...cue, revision: 5, action: 'hide' }] } }, 0, 0)?.podium).toBeNull();
    expect(broadcastPresentation({ ...base, graphics: null }, 0, 0)).toBeNull();
    expect(broadcastOptions(new URLSearchParams('arena=Arena+1'))).toEqual({ arena: 'Arena 1', delay: 0, section: null, valid: true });
    expect(broadcastSource(1, 'Main', 0)).toBe('/embed/competitions/1/overlay?arena=Main&delay=0');
  });

});
