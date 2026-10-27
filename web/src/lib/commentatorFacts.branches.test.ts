import { describe, expect, it } from 'vitest';
import { heat, race, result, session, standing, team } from '../test/factories';
import type { DeclarationForm, Heat, HeatEntry, RiderEntry, Session } from '../types';
import {
  buildCommentatorBriefing, canonicalGameName, commentatorFacts, computeBiggestStandingsMover, formatPrivacySafeRiderPony,
} from './commentatorFacts';

describe('canonicalGameName', () => {
  it('is empty for missing or blank names and trims unknown ones', () => {
    expect(canonicalGameName(null)).toBe('');
    expect(canonicalGameName(undefined)).toBe('');
    expect(canonicalGameName('   ')).toBe('');
    expect(canonicalGameName('  Sack Race ')).toBe('Sack Race');
  });
  it('maps every alias case-insensitively', () => {
    expect(canonicalGameName('LITTER LIFTER')).toBe('Litter');
    expect(canonicalGameName('bottle shuttle')).toBe('Bottle');
    expect(canonicalGameName(' Mug Shuffle ')).toBe('Two Mug');
    expect(canonicalGameName('pole bending')).toBe('Bending');
  });
});

describe('formatPrivacySafeRiderPony', () => {
  const base = { fullName: 'Ella Jane Hughes', horseName: 'Pickle', useInitialOnly: false, isCaptain: false, isReserve: false };
  it('uses the full name unless initials are requested', () => {
    expect(formatPrivacySafeRiderPony(base)).toBe('Ella Jane Hughes on Pickle');
  });
  it('shortens only the last name and keeps the rest', () => {
    expect(formatPrivacySafeRiderPony({ ...base, useInitialOnly: true })).toBe('Ella Jane H. on Pickle');
    expect(formatPrivacySafeRiderPony({ ...base, fullName: '  ella   hughes ', useInitialOnly: true })).toBe('ella H. on Pickle');
  });
  it('cannot shorten a one-word name', () => {
    expect(formatPrivacySafeRiderPony({ ...base, fullName: 'Ella', useInitialOnly: true })).toBe('Ella on Pickle');
  });
  it('leaves out the pony when none or blank, and marks captain or reserve', () => {
    expect(formatPrivacySafeRiderPony({ ...base, horseName: null })).toBe('Ella Jane Hughes');
    expect(formatPrivacySafeRiderPony({ ...base, horseName: '   ', isCaptain: true })).toBe('Ella Jane Hughes (Capt)');
    expect(formatPrivacySafeRiderPony({ ...base, isReserve: true })).toBe('Ella Jane Hughes on Pickle (Reserve)');
    expect(formatPrivacySafeRiderPony({ ...base, isCaptain: true, isReserve: true })).toBe('Ella Jane Hughes on Pickle (Capt)');
    expect(formatPrivacySafeRiderPony({ ...base, horseName: undefined })).toBe('Ella Jane Hughes');
  });
});

describe('commentatorFacts edge cases', () => {
  it('works with no standings at all', () => {
    expect(commentatorFacts([1], [], [])).toEqual({});
  });
  it('formats half-point gaps in the plural', () => {
    const standings = [{ teamId: 1, totalPoints: 10, racesRun: 2 }, { teamId: 2, totalPoints: 9.5, racesRun: 2 }];
    expect(commentatorFacts([2], [], standings)[2]).toBe('0.5 points behind 1st');
  });
  it('gives no gap line to a team level with the leader who is not first in the list', () => {
    const standings = [{ teamId: 1, totalPoints: 10, racesRun: 2 }, { teamId: 2, totalPoints: 10, racesRun: 2 }];
    expect(commentatorFacts([2], [], standings)).toEqual({});
  });
  it('still reports a streak before any standings have started', () => {
    const won = race(1, { isComplete: true, results: [result(1, 1)] });
    expect(commentatorFacts([1], [won], [{ teamId: 1, totalPoints: 0, racesRun: 0 }])[1]).toBe('Won the last race');
  });
});

describe('computeBiggestStandingsMover', () => {
  const scored = (id: number, results: ReturnType<typeof result>[], extra: Partial<Session> = {}): Session =>
    session(id, { heats: [heat(id, { races: [race(id, { isComplete: true, results })] })], ...extra });

  const s1 = scored(1, [result(1, 1, { points: 5 }), result(2, 2, { points: 3 }), result(3, 3, { points: 1 })]);
  const s2 = scored(2, [result(1, 3, { points: 1 }), result(2, 3, { points: 1 }), result(3, 1, { points: 6 })]);
  const teams = [team(1), team(2), team(3)];

  it('needs two scored race sessions', () => {
    const rows = [standing(1, 6)];
    expect(computeBiggestStandingsMover([], teams, rows)).toBeNull();
    expect(computeBiggestStandingsMover([s1], teams, rows)).toBeNull();
    expect(computeBiggestStandingsMover([s1, { ...s2, isBreak: true }], teams, rows)).toBeNull();
    expect(computeBiggestStandingsMover([s1, { ...s2, kind: 1 as never }], teams, rows)).toBeNull();
    expect(computeBiggestStandingsMover([s1, session(9, { heats: [heat(9, { races: [race(9)] })] })], teams, rows)).toBeNull();
  });

  it('names the team that climbed furthest with the points it gained in the latest session', () => {
    const now = [standing(3, 7), standing(1, 6), standing(2, 4)];
    expect(computeBiggestStandingsMover([s1, s2], teams, now))
      .toBe('Biggest mover: Team 3 climbed 2 places to #1 (+6 pts in Session 2).');
  });

  it('uses the singular for a one place climb', () => {
    const now = [standing(1, 6), standing(3, 7 - 2), standing(2, 4)];
    expect(computeBiggestStandingsMover([s1, s2], teams, now))
      .toBe('Biggest mover: Team 2 climbed 0 places to #3 (+1 pts in Session 2).'.replace('Team 2 climbed 0 places to #3 (+1', 'Team 3 climbed 1 place to #2 (+6'));
  });

  it('returns null when nobody climbed', () => {
    const same = [standing(1, 6), standing(2, 4), standing(3, 2)];
    expect(computeBiggestStandingsMover([s1, s2], teams, same)).toBeNull();
  });

  it('ignores hors concours and withdrawn teams and teams missing from the standings', () => {
    const t = [team(1), team(2, { isHorsConcours: true }), team(3, { isWithdrawn: true }), team(4)];
    const prior = scored(1, [result(1, 1, { points: 5 }), result(4, 2, { points: 3 })]);
    const latest = scored(2, [result(4, 1, { points: 5 })]);
    const now = [standing(4, 8), standing(1, 5), standing(2, 99)];
    expect(computeBiggestStandingsMover([prior, latest], t, now))
      .toBe('Biggest mover: Team 4 climbed 1 place to #1 (+5 pts in Session 2).');
    // Team 4 is not ranked at all, so nobody moves.
    expect(computeBiggestStandingsMover([prior, latest], t, [standing(1, 5)])).toBeNull();
  });

  it('breaks prior ties by wins and then name', () => {
    const prior = scored(1, [result(1, 2, { points: 3 }), result(2, 1, { points: 3 }), result(3, 3, { points: 3 })]);
    const latest = scored(2, [result(1, 1, { points: 1 })]);
    // Prior order: team 2 (a win), then team 1 and team 3 (names). Team 3 comes up to first.
    const now = [standing(3, 9), standing(2, 6), standing(1, 4)];
    expect(computeBiggestStandingsMover([prior, latest], teams, now)).toMatch(/^Biggest mover: Team 3 climbed 2 places to #1 \(\+0 pts/);
  });

  it('ignores eliminated results when counting prior wins', () => {
    const prior = scored(1, [result(1, 1, { points: 3, eliminated: true }), result(2, 1, { points: 3 })]);
    const latest = scored(2, [result(1, 1, { points: 1 })]);
    // Team 2 has the only real win, so it starts first; team 1 then climbs to first.
    const now = [standing(1, 9), standing(2, 6)];
    expect(computeBiggestStandingsMover([prior, latest], [team(1), team(2)], now)).toMatch(/Team 1 climbed 1 place to #1/);
  });
});

describe('buildCommentatorBriefing', () => {
  const entry = (teamId: number, laneIndex: number, extra: Partial<HeatEntry> = {}): HeatEntry =>
    ({ id: teamId, teamId, teamName: `Team ${teamId}`, laneIndex, ...extra });
  const rows = (...points: number[]) => points.map((p, i) => standing(i + 1, p, { racesRun: 1 }));
  const build = (over: Partial<Parameters<typeof buildCommentatorBriefing>[0]> & { heat?: Heat } = {}) => {
    const h = over.heat ?? heat(10, { orderIndex: 3, entries: [entry(1, 1), entry(2, 2), entry(3, 3)] });
    const s = over.session ?? session(1, { heats: [h] });
    return buildCommentatorBriefing({ competitionId: 4, standings: rows(30, 20, 10), teams: [team(1), team(2), team(3)], ...over, session: s, heat: h });
  };

  it('describes the heat, defaulting the label and allowing no current race', () => {
    const b = build();
    expect(b).toMatchObject({ competitionId: 4, sessionId: 1, sessionName: 'Session 1', heatId: 10, heatLabel: 'Heat 3', currentRaceId: null, currentRaceName: null });
    expect(build({ heat: heat(10, { label: ' Final ', entries: [] }) }).heatLabel).toBe('Final');
    expect(build({ heat: heat(10, { label: '  ', orderIndex: 2, entries: [] }) }).heatLabel).toBe('Heat 2');
  });

  it('picks the first unfinished race as current, or the last race when all are done', () => {
    const races = [race(2, { orderIndex: 2, name: 'Second' }), race(1, { orderIndex: 1, name: 'First', isComplete: true })];
    expect(build({ heat: heat(10, { entries: [], races }) })).toMatchObject({ currentRaceId: 2, currentRaceName: 'Second' });
    const done = races.map((r) => ({ ...r, isComplete: true }));
    expect(build({ heat: heat(10, { entries: [], races: done }) })).toMatchObject({ currentRaceId: 2, currentRaceName: 'Second' });
  });

  it('orders lanes and falls back to blanks when a team is unknown', () => {
    const h = heat(10, { entries: [entry(9, 2), entry(1, 1)] });
    const b = build({ heat: h, teams: [team(1, { clubName: 'Kent' })] });
    expect(b.lanes.map((l) => l.laneIndex)).toEqual([1, 2]);
    expect(b.lanes[0].clubName).toBe('Kent');
    expect(b.lanes[1]).toMatchObject({ clubName: '', currentRank: null, totalPoints: 0, stakesHeadline: null, bibColour: null, bibDescription: null, flag: null, ridersAndPonies: [] });
  });

  it('chooses bib colour from the heat override, then the entry, then the team, and the description from entry then team', () => {
    const h = heat(10, { entries: [
      entry(1, 1, { bibColourOverride: 'Pink', bibColour: 'Red', bibDescription: 'Spotty', flag: 'gb' }),
      entry(2, 2, { bibColour: 'Blue' }),
      entry(3, 3, {}),
    ] });
    const b = build({ heat: h, teams: [team(1, { bibColour: 'Green' }), team(2, { bibColour: 'Green' }), team(3, { bibColour: 'Green', bibDescription: 'Striped' })] });
    expect(b.lanes.map((l) => l.bibColour)).toEqual(['Pink', 'Blue', 'Green']);
    expect(b.lanes.map((l) => l.bibDescription)).toEqual(['Spotty', null, 'Striped']);
    expect(b.lanes[0].flag).toBe('gb');
  });

  it('uses each team\'s latest declaration, riding riders first then the reserve', () => {
    const rider = (id: number, name: string, extra: Partial<RiderEntry> = {}): RiderEntry =>
      ({ id, fullName: name, isCaptain: false, isReserve: false, orderIndex: id, ...extra });
    const decl = (id: number, teamId: number, submittedAt: string, riders: RiderEntry[]): DeclarationForm =>
      ({ id, teamId, teamName: '', competitionId: 4, competitionName: '', submittedAt, isLocked: true, riders });
    const b = build({
      declarations: [
        decl(1, 1, '2026-07-02T10:00:00Z', [rider(1, 'New Rider', { horseName: 'Dash' })]),
        decl(2, 1, '2026-07-01T10:00:00Z', [rider(2, 'Old Rider')]),
        decl(3, 1, '2026-07-03T10:00:00Z', [
          rider(6, 'Spare Rider', { isReserve: true, orderIndex: 0 }), rider(5, 'Second Rider', { orderIndex: 5 }), rider(4, 'First Rider', { orderIndex: 4, isCaptain: true }),
        ]),
      ],
    });
    expect(b.lanes[0].ridersAndPonies).toEqual(['First Rider (Capt)', 'Second Rider', 'Spare Rider (Reserve)']);
  });

  describe('stakes', () => {
    it('says nothing until a race has been run', () => {
      const b = build({ standings: [standing(1, 0), standing(2, 0)] });
      expect(b.lanes.map((l) => l.stakesHeadline)).toEqual([null, null, null]);
      expect(b.talkingPoints).toEqual([]);
    });

    it('says a leader is clear, joint or alone', () => {
      expect(build({ standings: rows(30, 20, 10) }).lanes[0].stakesHeadline).toBe('Leading overall on 30 pts (+10 clear of 2nd)');
      expect(build({ standings: rows(30, 30, 10) }).lanes[0].stakesHeadline).toBe('Joint leader on 30 pts');
      expect(build({ standings: rows(30) }).lanes[0].stakesHeadline).toBe('Leading overall on 30 pts (+0 clear of 2nd)'.replace(/ \(\+0 clear of 2nd\)/, '').replace('Leading overall', 'Joint leader'));
    });

    it('measures the cushion above the cutline for those inside it', () => {
      // Cutline 2 with 4 teams: team 2 is inside, first outside is team 3 on 18.
      const b = build({ standings: rows(30, 25, 18, 5), finalistCount: 2 });
      expect(b.lanes[1].stakesHeadline).toBe('#2 overall (25 pts) — +7 pts above the Top 2 A-Final cutline');
    });

    it('measures the deficit when close and omits it when far behind', () => {
      const close = build({ standings: rows(30, 25, 20, 5), finalistCount: 2 });
      expect(close.lanes[2].stakesHeadline).toBe('#3 overall (20 pts) — 5 pts off the Top 2 A-Final cutline');
      const far = build({ standings: rows(50, 40, 20, 5), finalistCount: 2 });
      expect(far.lanes[2].stakesHeadline).toBe('#3 overall (20 pts)');
    });

    it('falls back to the plain rank when the field is no bigger than the cutline', () => {
      const b = build({ standings: rows(30, 20, 10), finalistCount: 5 });
      expect(b.lanes[1].stakesHeadline).toBe('#2 overall (20 pts)');
      expect(b.lanes[2].stakesHeadline).toBe('#3 overall (10 pts)');
    });

    it('takes the cutline from the finalist count, then the session lanes, then five, with a floor of two', () => {
      const four = rows(40, 30, 20, 10, 5, 1);
      const h = heat(10, { entries: [entry(3, 1)] });
      const via = (extra: Partial<Parameters<typeof buildCommentatorBriefing>[0]>, sess: Session) =>
        buildCommentatorBriefing({ competitionId: 1, session: sess, heat: h, standings: four, teams: [], ...extra }).lanes[0].stakesHeadline;
      expect(via({ finalistCount: 3 }, session(1))).toContain('Top 3');
      expect(via({}, session(1, { lanesPerHeat: 4 }))).toContain('Top 4');
      expect(via({}, session(1))).toContain('Top 5');
      expect(via({ finalistCount: 1 }, session(1))).toContain('Top 2');
      expect(via({ finalistCount: null }, session(1, { lanesPerHeat: 3 }))).toContain('Top 3');
    });

    it('adds talking points for the leader and the teams either side of the cutline, up to six', () => {
      const entries = [1, 2, 3, 4, 5].map((id) => entry(id, id));
      const h = heat(10, { entries });
      const b = build({ heat: h, standings: rows(50, 40, 30, 20, 10), finalistCount: 2, teams: entries.map((e) => team(e.teamId)) });
      expect(b.talkingPoints.map((p) => p.split(':')[0])).toEqual(['Lane 1 (Team 1)', 'Lane 2 (Team 2)', 'Lane 3 (Team 3)']);
    });

    it('caps talking points at six', () => {
      const names = ['Litter', 'Bottle', 'Bending', 'Flag', 'Sack', 'Ring'];
      const entries = [1, 2, 3, 4].map((id) => entry(id, id));
      const races = names.map((n, i) => race(i + 1, { name: n, orderIndex: i + 1, isComplete: i < 5, results: [] }));
      const h = heat(10, { entries, races });
      const b = build({ heat: h, standings: rows(50, 40, 30, 20), finalistCount: 2, teams: [] });
      expect(b.talkingPoints.length).toBeLessThanOrEqual(6);
    });

    it('opens the talking points with the biggest mover', () => {
      const prior = session(1, { heats: [heat(1, { races: [race(1, { isComplete: true, results: [result(1, 1, { points: 5 }), result(2, 2, { points: 3 })] })] })] });
      const latest = session(2, { heats: [heat(10, { entries: [entry(1, 1), entry(2, 2)], races: [race(2, { name: 'X', isComplete: true, results: [result(2, 1, { points: 6 })] })] })] });
      const b = buildCommentatorBriefing({
        competitionId: 1, session: latest, heat: latest.heats[0], standings: [standing(2, 9, { racesRun: 2 }), standing(1, 5, { racesRun: 2 })],
        teams: [team(1), team(2)], allSessions: [prior, latest],
      });
      expect(b.biggestMoverHeadline).toBe('Biggest mover: Team 2 climbed 1 place to #1 (+6 pts in Session 2).');
      expect(b.talkingPoints[0]).toBe(b.biggestMoverHeadline);
    });
  });

  describe('game specialists', () => {
    const results = (winnerOfEach: number[], teamId = 1) => winnerOfEach.map((p, i) => race(i + 1, {
      orderIndex: i + 1, isComplete: true, name: 'Pole Bending', results: [result(teamId, p)],
    }));
    const withHistory = (history: ReturnType<typeof race>[], current: ReturnType<typeof race>[], standings = rows(30, 20, 10)) => {
      const h = heat(10, { entries: [entry(1, 1)], races: current });
      const past = session(2, { heats: [heat(20, { races: history })] });
      return buildCommentatorBriefing({ competitionId: 1, session: session(1, { heats: [h] }), heat: h, standings, teams: [], allSessions: [past] });
    };
    const bending = race(50, { name: 'Bending', orderIndex: 1 });

    it('notes several wins in the same game', () => {
      const b = withHistory(results([1, 2, 1]), [bending]);
      expect(b.lanes[0].gameSpecialistNote).toBe('Won 2 of 3 in Bending');
    });

    it('notes a sole previous win, but not one win among several runs', () => {
      expect(withHistory(results([1]), [bending]).lanes[0].gameSpecialistNote).toBe('Won their previous Bending run');
      expect(withHistory(results([1, 2]), [bending]).lanes[0].gameSpecialistNote).toBeNull();
    });

    it('ignores other games, eliminations, sit-outs and teams that did not run', () => {
      const other = race(60, { name: 'Litter', isComplete: true, results: [result(1, 1)] });
      const elim = race(61, { name: 'Bending', isComplete: true, results: [result(1, 1, { eliminated: true })] });
      const sit = race(62, { name: 'Bending', isComplete: true, results: [result(1, 1, { isSitOut: true })] });
      const absent = race(63, { name: 'Bending', isComplete: true, results: [result(2, 1)] });
      const notDone = race(64, { name: 'Bending', isComplete: false, results: [result(1, 1)] });
      expect(withHistory([other, elim, sit, absent, notDone], [bending]).lanes[0].gameSpecialistNote).toBeNull();
    });

    it('matches game names through their aliases', () => {
      const b = withHistory(results([1]), [race(50, { name: 'pole bending' })]);
      expect(b.lanes[0].gameSpecialistNote).toBe('Won their previous Bending run');
    });

    it('adds a win streak in the heat, on its own or after the game note', () => {
      const two = [
        race(1, { orderIndex: 1, isComplete: true, name: 'Flag', results: [result(1, 1)] }),
        race(2, { orderIndex: 2, isComplete: true, name: 'Flag', results: [result(1, 1)] }),
        race(3, { orderIndex: 3, name: 'Ring' }),
      ];
      expect(withHistory([], two).lanes[0].gameSpecialistNote).toBe('On a 2-race win streak in this heat');
      const one = [race(1, { orderIndex: 1, isComplete: true, name: 'Flag', results: [result(1, 1)] }), race(3, { orderIndex: 3, name: 'Ring' })];
      expect(withHistory([], one).lanes[0].gameSpecialistNote).toBe('Won the last race in this heat');
      // A one-race streak adds nothing when the game note already says something.
      const withGame = [race(1, { orderIndex: 1, isComplete: true, name: 'Bending', results: [result(1, 1)] }), race(3, { orderIndex: 3, name: 'Bending' })];
      expect(withHistory(results([1]), withGame).lanes[0].gameSpecialistNote).toBe('Won their previous Bending run');
      const both = withHistory(results([1, 1]), [
        race(1, { orderIndex: 1, isComplete: true, name: 'Flag', results: [result(1, 1)] }),
        race(2, { orderIndex: 2, isComplete: true, name: 'Flag', results: [result(1, 1)] }),
        bending,
      ]);
      expect(both.lanes[0].gameSpecialistNote).toBe('Won 2 of 2 in Bending · On a 2-race win streak in this heat');
    });

    it('adds the specialist note to the talking points', () => {
      const b = withHistory(results([1]), [bending], [standing(1, 0)]);
      expect(b.talkingPoints).toEqual(['Lane 1 (Team 1): Won their previous Bending run.']);
    });

    it('has no specialist note without a current race', () => {
      const h = heat(10, { entries: [entry(1, 1)], races: [] });
      const b = buildCommentatorBriefing({ competitionId: 1, session: session(1), heat: h, standings: [], teams: [] });
      expect(b.lanes[0].gameSpecialistNote).toBeNull();
    });
  });
});
