import { describe, expect, it } from 'vitest';
import { heat, race, result, session } from '../test/factories';
import { embedSearch, normaliseAccent, parseEmbedOptions, recentHeatResults, timetableGroupTitle } from './embed';

describe('strict option validation', () => {
  it('rejects values that are not strings, even when they would print as a colour', () => {
    expect(normaliseAccent(123456 as unknown as string)).toBeNull();
    expect(normaliseAccent({ toString: () => '123456' } as unknown as string)).toBeNull();
    expect(normaliseAccent('123456\n')).toBeNull();
    expect(normaliseAccent('##123456')).toBeNull();
    expect(normaliseAccent('123456;}body{display:none')).toBeNull();
  });

  it('only accepts the exact theme "dark"', () => {
    for (const theme of ['Dark', 'DARK', 'light', 'blue', '', 'dark ', 'dark,light']) expect(parseEmbedOptions(`theme=${encodeURIComponent(theme)}`).theme).toBe('light');
    expect(parseEmbedOptions('theme=dark').theme).toBe('dark');
  });

  it('drops a bad accent without affecting the other options', () => {
    expect(parseEmbedOptions('accent=red&theme=dark&section=3')).toEqual({ accent: null, theme: 'dark', section: 3 });
    expect(parseEmbedOptions('accent=%22%3E%3Cscript%3E').accent).toBeNull();
  });

  it.each(['0', '-1', '1.5', '1e3', 'abc', '', ' 5', '5 ', '0005', '+5', '1234567890', '99999999999999999999'])('rejects the section %j', (section) => {
    expect(parseEmbedOptions(`section=${encodeURIComponent(section)}`).section).toBeNull();
  });

  it('accepts the smallest and largest section ids', () => {
    expect(parseEmbedOptions('section=1').section).toBe(1);
    expect(parseEmbedOptions('section=999999999').section).toBe(999999999);
  });

  it('never writes an invalid accent or section into an address, and round-trips valid ones', () => {
    expect(embedSearch({ accent: 'javascript:1' })).toBe('');
    for (const section of [0, -3, 1.5, NaN, Infinity, 2 ** 60]) expect(embedSearch({ section })).toBe('');
    const options = { accent: '123abc', theme: 'dark' as const, section: 9 };
    expect(parseEmbedOptions(embedSearch(options))).toEqual(options);
  });
});

describe('heat titles and ordering edge cases', () => {
  const scored = (id: number, points: Array<[number, number]>) =>
    race(id, { isComplete: true, results: points.map(([teamId, p]) => result(teamId, null, { points: p })) });

  it('breaks ties by team name and shares the place', () => {
    const [only] = recentHeatResults([session(1, { heats: [heat(1, { races: [scored(1, [[2, 3], [1, 3], [3, 1]])] })] })], null);
    expect(only.rows.map((r) => [r.teamName, r.place])).toEqual([['Team 1', 1], ['Team 2', 1], ['Team 3', 3]]);
  });

  it('falls back to a numbered label and to the session name when there is no section name', () => {
    const [only] = recentHeatResults([session(1, { sectionName: null, name: 'Teams Juniors', heats: [heat(1, { label: '  ', races: [scored(1, [[1, 1]])] })] })], null);
    expect(only.title).toBe('Juniors · Session 1 · Heat 1');
  });

  it('titles finals by stage, label or session name, newest first', () => {
    const sessions = [
      session(1, { heats: [heat(1, { races: [scored(1, [[1, 1]])] })] }),
      session(2, { name: 'Finals', heats: [heat(2, { label: 'A', races: [scored(2, [[1, 1]])] })] }),
      session(3, { heats: [heat(3, { raceRoundStage: 2, label: 'Gold', races: [scored(3, [[1, 1]])] }), heat(4, { label: 'Grand Final', races: [scored(4, [[1, 1]])] })] }),
    ];
    expect(recentHeatResults(sessions, null).map((r) => r.title)).toEqual(['Seniors · Grand Final', 'Seniors · Final · Gold', 'Seniors · Final · A', 'Seniors · Session 1 · Heat 1']);
  });

  it('orders heats within a session by running order, newest first', () => {
    const sessions = [session(1, { heats: [heat(2, { orderIndex: 2, label: 'Second', races: [scored(2, [[1, 1]])] }), heat(1, { orderIndex: 1, label: 'First', races: [scored(1, [[1, 1]])] })] })];
    expect(recentHeatResults(sessions, null).map((r) => r.title.split(' · ').at(-1))).toEqual(['Second', 'First']);
  });

  it('titles a timetable group with no section name, with or without an ordinal', () => {
    const group = { key: 'g', session: session(1, { sectionName: null, name: 'Teams Juniors' }), race: true, rows: [{ group: 'Heats' }] } as unknown as Parameters<typeof timetableGroupTitle>[0];
    expect(timetableGroupTitle(group, new Map())).toBe('Juniors · Session 1');
    expect(timetableGroupTitle(group, new Map([[1, 3]]))).toBe('Juniors · Session 3');
  });
});
