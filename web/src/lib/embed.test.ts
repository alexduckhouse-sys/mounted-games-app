import { describe, expect, it } from 'vitest';
import { competition, heat, race, result, session, standing } from '../test/factories';
import {
  clampEmbedHeight, clockText, contrastRatio, embedColours, embedHomePath, embedPath, embedPollMs, embedSearch, embedUrl, iframeSnippet,
  isCompetitionDetail, isEmbedPath, isSeasonStandings, isSeasonSummary, isStandingRows, normaliseAccent, parseEmbedOptions,
  recentHeatResults, timetableGroupTitle, timetableRowDay, visibleTimetableGroups,
} from './embed';
import { computeTimings } from './time';
import { groupRowsBySession, sessionOrdinals, timetableRows } from './timetableRows';

describe('isEmbedPath', () => {
  it('matches /embed/ followed by anything, case-sensitively', () => {
    expect(isEmbedPath('/embed/competitions/1/standings')).toBe(true);
    expect(isEmbedPath('/embed/')).toBe(true);
    for (const path of ['/embed', '/embedded/x', '/Embed/x', '/competitions/embed/x', '/']) expect(isEmbedPath(path)).toBe(false);
  });
});

describe('normaliseAccent', () => {
  it('accepts three or six hex digits with or without a hash and lower-cases them', () => {
    expect(normaliseAccent('#1E3466')).toBe('1e3466');
    expect(normaliseAccent('c2410c')).toBe('c2410c');
    expect(normaliseAccent('#abc')).toBe('aabbcc');
  });
  it.each(['', 'red', '#12345', '#1234567', 'zzzzzz', 'rgb(1,2,3)', 'url(x)', '1e3466;color:red', '#1e3466 ', 'expression(alert(1))'])('rejects %j', (value) => {
    expect(normaliseAccent(value)).toBeNull();
  });
  it('rejects missing values', () => {
    expect(normaliseAccent(null)).toBeNull();
    expect(normaliseAccent(undefined)).toBeNull();
  });
});

describe('parseEmbedOptions', () => {
  it('reads accent, theme and section', () => {
    expect(parseEmbedOptions('?accent=%231e3466&theme=dark&section=12')).toEqual({ accent: '1e3466', theme: 'dark', section: 12 });
    expect(parseEmbedOptions(new URLSearchParams('accent=abc'))).toEqual({ accent: 'aabbcc', theme: 'light', section: null });
  });
  it('falls back to the defaults for anything unrecognised', () => {
    expect(parseEmbedOptions('?accent=javascript:1&theme=neon&section=-3')).toEqual({ accent: null, theme: 'light', section: null });
    expect(parseEmbedOptions('?section=0')).toMatchObject({ section: null });
    expect(parseEmbedOptions('?section=1e3')).toMatchObject({ section: null });
    expect(parseEmbedOptions('')).toEqual({ accent: null, theme: 'light', section: null });
  });
});

describe('addresses and snippet', () => {
  it('builds embed paths for competitions and seasons', () => {
    expect(embedPath({ kind: 'competition', id: 7 }, 'timetable')).toBe('/embed/competitions/7/timetable');
    expect(embedPath({ kind: 'competition', id: 7 })).toBe('/embed/competitions/7/standings');
    expect(embedPath({ kind: 'season', id: 'a/b' }, 'results')).toBe('/embed/seasons/a%2Fb/standings');
  });
  it('only writes options that differ from the defaults', () => {
    expect(embedSearch({})).toBe('');
    expect(embedSearch({ accent: null, theme: 'light', section: null })).toBe('');
    expect(embedSearch({ accent: '#ABCDEF', theme: 'dark', section: 3 })).toBe('?accent=abcdef&theme=dark&section=3');
    expect(embedSearch({ accent: 'nope', section: -1 })).toBe('');
    expect(embedSearch({ section: 1.5 })).toBe('');
  });
  it('joins origin, path and options', () => {
    expect(embedUrl('https://x.test', { kind: 'competition', id: 2 }, 'results', { theme: 'dark' })).toBe('https://x.test/embed/competitions/2/results?theme=dark');
  });
  it('links back to the ordinary pages', () => {
    expect(embedHomePath({ kind: 'competition', id: 4 }, 'standings')).toBe('/competitions/4/toplists');
    expect(embedHomePath({ kind: 'competition', id: 4 }, 'timetable')).toBe('/competitions/4');
    expect(embedHomePath({ kind: 'season', id: 'abc' }, 'standings')).toBe('/seasons/abc');
  });
  it('clamps the height', () => {
    expect(clampEmbedHeight(10)).toBe(240);
    expect(clampEmbedHeight(5000)).toBe(1200);
    expect(clampEmbedHeight(333.4)).toBe(333);
    expect(clampEmbedHeight(Number.NaN)).toBe(520);
  });
  it('escapes attribute values in the iframe snippet', () => {
    const snippet = iframeSnippet('https://x.test/embed/competitions/1/standings?a=1&b=2', 'Tom "the" <Games>', 600);
    expect(snippet).toContain('src="https://x.test/embed/competitions/1/standings?a=1&amp;b=2"');
    expect(snippet).toContain('title="Tom &quot;the&quot; &lt;Games&gt;"');
    expect(snippet).toContain('height="600"');
    expect(snippet).toContain('loading="lazy"');
    expect(snippet).not.toContain('<script');
  });
});

describe('embedColours', () => {
  it('returns null without an accent', () => {
    expect(embedColours(null, 'light')).toBeNull();
  });
  it('keeps a readable accent as it is and picks the better text on a fill', () => {
    expect(embedColours('1e3466', 'light')).toEqual({ text: '30 52 102', fill: '30 52 102', onFill: '255 255 255' });
    expect(embedColours('ffff00', 'light')?.onFill).toBe('33 33 33');
  });
  it('nudges an unreadable accent until it reaches 4.5:1 on the background', () => {
    const dark = embedColours('1e3466', 'dark')!;
    expect(dark.fill).toBe('30 52 102');
    expect(contrastRatio(dark.text.split(' ').map(Number) as [number, number, number], [21, 30, 46])).toBeGreaterThanOrEqual(4.5);
    const light = embedColours('ffff00', 'light')!;
    expect(contrastRatio(light.text.split(' ').map(Number) as [number, number, number], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('embedPollMs', () => {
  it('polls quickly while something is on and slowly otherwise, backing off after failures', () => {
    expect(embedPollMs(true, 0)).toBe(30_000);
    expect(embedPollMs(false, 0)).toBe(180_000);
    expect(embedPollMs(true, 1)).toBe(60_000);
    expect(embedPollMs(true, 3)).toBe(300_000);
  });
});

describe('clockText', () => {
  it('shows hours and minutes', () => {
    expect(clockText(new Date(2026, 5, 1, 9, 5))).toBe('09:05');
  });
});

describe('recentHeatResults', () => {
  const entries = [{ id: 1, teamId: 1, teamName: 'Team 1', laneIndex: 1 }, { id: 2, teamId: 2, teamName: 'Team 2', laneIndex: 2 }, { id: 3, teamId: 3, teamName: 'Team 3', laneIndex: 3 }];
  const scored = (id: number, extra = {}) => heat(id, {
    entries,
    races: [race(id, { isComplete: true, results: [result(1, 1, { points: 3 }), result(2, 2, { points: 3 })] }), race(id + 100, { isComplete: true, results: [result(1, 2, { points: 2 }), result(2, 1, { points: 2 })] })],
    ...extra,
  });

  it('ranks teams by heat points, shares ties, lists unscored entries last and skips unscored heats', () => {
    const sessions = [session(1, { heats: [scored(10, { label: 'Heat A' }), heat(11, { entries })] })];
    const [only, ...rest] = recentHeatResults(sessions, null);
    expect(rest).toEqual([]);
    expect(only.title).toBe('Senior Teams · Session 1 · Heat A');
    expect(only.complete).toBe(true);
    expect(only.rows.map((r) => [r.teamName, r.place, r.points])).toEqual([['Team 1', 1, 5], ['Team 2', 1, 5], ['Team 3', null, null]]);
  });
  it('marks a heat in progress, names finals and drops qualifier heats', () => {
    const sessions = [session(1, { orderIndex: 1, heats: [
      heat(20, { label: 'Heat 1', orderIndex: 1, races: [race(1, { isComplete: false, results: [result(1, 1, { points: 2 })] })] }),
      scored(21, { label: 'A Final', raceRoundStage: 2, orderIndex: 2 }),
      scored(22, { raceRoundStage: 1, orderIndex: 3 }),
      scored(23, { raceRoundStage: 2, orderIndex: 4 }),
    ] })];
    const results = recentHeatResults(sessions, null);
    expect(results.map((r) => r.key)).toEqual(['heat-23', 'heat-21', 'heat-20']);
    expect(results[0].title).toBe('Senior Teams · Final · Heat 4');
    expect(results[1].title).toBe('Senior Teams · A Final');
    expect(results[2].complete).toBe(false);
    expect(results[2].title).toBe('Senior Teams · Session 1 · Heat 1');
  });
  it('orders newest first across sessions, filters by age group and ignores breaks', () => {
    const sessions = [
      session(1, { orderIndex: 1, competitionSectionId: 5, heats: [scored(30)] }),
      session(2, { orderIndex: 2, competitionSectionId: 6, sectionName: 'Pairs', heats: [scored(31)] }),
      session(3, { orderIndex: 3, kind: 1, isBreak: true, heats: [scored(32)] }),
    ];
    expect(recentHeatResults(sessions, null).map((r) => r.key)).toEqual(['heat-31', 'heat-30']);
    expect(recentHeatResults(sessions, 5).map((r) => r.key)).toEqual(['heat-30']);
  });
});

describe('timetable helpers', () => {
  const at = (hour: number) => new Date(2026, 5, 1, hour).toISOString();
  const sessions = [
    session(1, { orderIndex: 1, status: 2, scheduledStart: at(9), heats: [heat(1, { scheduledStart: at(9), finishedAt: at(10) })] }),
    session(2, { orderIndex: 2, status: 2, scheduledStart: at(10), heats: [heat(2, { scheduledStart: at(10), finishedAt: at(11) })] }),
    session(3, { orderIndex: 3, status: 0, scheduledStart: at(12), heats: [heat(3, { scheduledStart: at(12) })] }),
  ];
  const rows = timetableRows(sessions, computeTimings(sessions), false);
  const groups = groupRowsBySession(rows);

  it('hides finished groups except the latest, unless asked for everything', () => {
    expect(visibleTimetableGroups(groups, false).map((g) => g.session.id)).toEqual([2, 3]);
    expect(visibleTimetableGroups(groups, true)).toHaveLength(3);
    expect(visibleTimetableGroups([], false)).toEqual([]);
  });
  it('titles race groups and leaves other sessions without a heading', () => {
    const ordinals = sessionOrdinals(sessions);
    expect(timetableGroupTitle(groups[0], ordinals)).toBe('Senior Teams · Session 1');
    const finals = groupRowsBySession(timetableRows([session(9, { name: 'Seniors Final', heats: [heat(9, { raceRoundStage: 2 })] })], new Map(), false));
    expect(timetableGroupTitle(finals[0], new Map())).toBe('Senior Teams · Finals');
    const breaks = groupRowsBySession(timetableRows([session(8, { kind: 1, isBreak: true })], new Map(), false));
    expect(timetableGroupTitle(breaks[0], new Map())).toBeNull();
  });
  it('puts a row without a time on the first day', () => {
    expect(timetableRowDay({ ...rows[0], effective: null }, '2026-06-01')).toBe('2026-06-01');
    expect(timetableRowDay(rows[2], '2026-01-01')).toBe('2026-06-01');
  });
});

describe('shape checks', () => {
  it('accept what the API sends and reject anything else', () => {
    expect(isCompetitionDetail(competition())).toBe(true);
    expect(isCompetitionDetail({ id: 1 })).toBe(false);
    expect(isCompetitionDetail(null)).toBe(false);
    expect(isCompetitionDetail([])).toBe(false);
    expect(isStandingRows([standing(1, 3)])).toBe(true);
    expect(isStandingRows([{ teamId: 'x' }])).toBe(false);
    expect(isStandingRows({})).toBe(false);
    expect(isSeasonSummary({ title: 'T', rounds: [] })).toBe(true);
    expect(isSeasonSummary({ title: 'T' })).toBe(false);
    expect(isSeasonStandings({ standings: [{ teamProfileId: 'a', totalPoints: 1 }] })).toBe(true);
    expect(isSeasonStandings({ standings: [{ teamProfileId: 1, totalPoints: 1 }] })).toBe(false);
    expect(isSeasonStandings({})).toBe(false);
  });
});
