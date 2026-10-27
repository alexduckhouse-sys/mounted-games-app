import { describe, expect, it } from 'vitest';
import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import type { CompetitionDetail, DeclarationForm } from '../types';
import { buildEventArchiveFiles, createZipArchive, crc32 } from './eventArchive';

const book = (sections: ResultsBook['sections'] = []): ResultsBook =>
  ({
    competition: { id: 1, name: 'C', location: 'L', startDate: '2031-06-14T09:00:00Z', endDate: null },
    isProvisional: false,
    includesPrivate: false,
    generatedAt: '2031-06-15T17:30:00Z',
    sections,
    eventAwards: [],
    refereeNotes: [],
  }) as unknown as ResultsBook;

const team = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  competitionId: 1,
  competitionSectionId: 5,
  sectionName: 'B Section',
  clubId: id,
  clubName: `Club ${id}`,
  suffix: '',
  displayName: `Team ${id}`,
  isHorsConcours: false,
  ...over,
});

const comp = (over: Record<string, unknown> = {}): CompetitionDetail =>
  ({
    id: 1,
    name: 'C',
    location: 'L',
    startDate: '2031-06-14T09:00:00Z',
    endDate: null,
    sections: [],
    teams: [],
    sessions: [],
    ...over,
  }) as unknown as CompetitionDetail;

const lines = (csv: string) => csv.split(/\r?\n/).filter(Boolean);

describe('eventArchive branches', () => {
  it('copes with a competition that has no teams, sessions or standings', () => {
    const files = buildEventArchiveFiles({
      competition: comp({ teams: undefined, sessions: undefined }),
      resultsBook: book(),
      generatedAt: '2031-06-15T18:00:00Z',
    });
    expect(lines(files['standings.csv'])).toHaveLength(1);
    expect(lines(files['timetable.csv'])).toHaveLength(1);
    expect(lines(files['declarations.csv'])).toHaveLength(1);
    expect(lines(files['entries-summary.csv'])).toHaveLength(1);
    const snap = JSON.parse(files['competition-snapshot.json']);
    expect(snap.teams).toEqual([]);
    expect(snap.competition.generatedAt).toBe('2031-06-15T18:00:00Z');
  });

  it('uses the results book standings when no custom standings exist, and ignores empty custom ones', () => {
    const b = book([
      {
        sectionId: 5,
        sectionName: 'B Section',
        format: 2,
        standings: [
          { rank: 2, teamId: 3, teamName: 'Gamma', clubName: 'G', totalPoints: 10, bonusPoints: 1, racesRun: 3, wins: 1, eliminations: 1, withdrawn: true },
        ],
        finals: [],
        awards: [],
      },
    ] as unknown as ResultsBook['sections']);
    const record = buildEventArchiveFiles({ competition: comp(), resultsBook: b, standingsBySection: { 5: [] } });
    expect(lines(record['standings.csv'])[1]).toBe('B Section,2,Gamma,G,10,1,3,1,1,Yes,');
    const map = buildEventArchiveFiles({ competition: comp(), resultsBook: b, standingsBySection: new Map() });
    expect(lines(map['standings.csv'])[1]).toBe('B Section,2,Gamma,G,10,1,3,1,1,Yes,');
  });

  it('defaults missing custom standings fields (bonus 0, no tie break, withdrawn flag)', () => {
    const b = book([
      { sectionId: 5, sectionName: 'S', format: 2, standings: [], finals: [], awards: [] },
    ] as unknown as ResultsBook['sections']);
    const files = buildEventArchiveFiles({
      competition: comp(),
      resultsBook: b,
      standingsBySection: {
        5: [{ teamId: 1, teamName: 'T', clubName: 'C', totalPoints: 4, racesRun: 1, wins: 0, eliminations: 0, withdrawn: true } as never],
      },
    });
    expect(lines(files['standings.csv'])[1]).toBe('S,1,T,C,4,0,1,0,0,Yes,');
  });

  it('writes timetable rows for empty sessions, default heat labels, finals, ordering and missing section names', () => {
    const files = buildEventArchiveFiles({
      competition: comp({
        sessions: [
          { id: 3, orderIndex: 2, name: 'Empty', sectionName: null, scheduledStart: null, isBreak: false, kind: 0, heats: [] },
          { id: 2, orderIndex: 1, name: 'Late', sectionName: 'S', scheduledStart: '10:00', isBreak: false, kind: 0 },
          { id: 5, orderIndex: 3, name: 'KindBreak', sectionName: null, scheduledStart: '11:00', isBreak: false, kind: 1, heats: [] },
          {
            id: 1,
            orderIndex: 1,
            name: 'Main',
            sectionName: 'S',
            scheduledStart: '09:00',
            isBreak: false,
            kind: 0,
            heats: [
              { id: 12, sessionId: 1, orderIndex: 2, raceRoundStage: 2, entries: undefined, races: undefined },
              {
                id: 11,
                sessionId: 1,
                orderIndex: 1,
                label: 'First',
                raceRoundStage: 0,
                entries: [
                  { id: 2, teamId: 2, teamName: 'Two', laneIndex: 1 },
                  { id: 1, teamId: 1, teamName: 'One', laneIndex: 0 },
                ],
                races: [
                  { id: 22, heatId: 11, name: 'Second', orderIndex: 2 },
                  { id: 21, heatId: 11, name: 'First', orderIndex: 2 },
                  { id: 20, heatId: 11, name: 'Zeroth', orderIndex: 1 },
                ],
              },
            ],
          },
        ],
      }),
      resultsBook: book(),
    });
    const rows = lines(files['timetable.csv']).slice(1);
    // session order ties broken by id: Main (id 1) before Late (id 2)
    expect(rows).toEqual([
      '1,Main,S,Session,09:00,First,Heat,L1: One | L2: Two,"Zeroth, First, Second"',
      '1,Main,S,Session,09:00,Heat 2,Final,,',
      '1,Late,S,Session,10:00,,,,',
      '2,Empty,,Session,,,,,',
      '3,KindBreak,,Break,11:00,,,,',
    ]);
  });

  it('writes declarations for teams in every state', () => {
    const form = (over: Partial<DeclarationForm>): DeclarationForm =>
      ({
        id: 1,
        competitionId: 1,
        competitionName: 'C',
        teamId: 1,
        teamName: 'T',
        submittedAt: null,
        isLocked: false,
        trainerName: 'Coach',
        termsAcceptedAt: null,
        riders: [],
        ...over,
      }) as unknown as DeclarationForm;
    const files = buildEventArchiveFiles({
      competition: comp({
        teams: [
          team(3, { sectionName: 'A', displayName: 'Zed', bibColour: 'Green' }),
          team(2, { sectionName: 'A', displayName: 'Alpha', bibDescription: 'Spots', bibColour: 'Pink', suffix: 'X' }),
          team(1, { sectionName: 'A', displayName: 'Alpha' }),
          team(4, { sectionName: 'B', displayName: 'Beta', isWithdrawn: true, isHorsConcours: true }),
        ],
      }),
      resultsBook: book(),
      declarationsByTeamId: new Map([
        // locked, terms accepted, no riders
        [2, form({ isLocked: true, termsAcceptedAt: '2031-01-01T00:00:00Z' })],
        [
          3,
          form({
            riders: [
              { id: 1, fullName: '  ', horseName: null, ponyHeightHands: null, isCaptain: false, isReserve: false, isGuestRider: false, useInitialOnly: false, noFilming: false, orderIndex: 0 },
            ] as never,
          }),
        ],
      ]),
    });
    const entries = lines(files['entries-summary.csv']).slice(1);
    // sorted by section, then name, then id
    expect(entries.map((e) => e.split(',')[1])).toEqual(['Alpha', 'Alpha', 'Zed', 'Beta']);
    expect(entries[0]).toBe('A,Alpha,Club 1,,,Active,No,0,');
    expect(entries[1]).toBe('A,Alpha,Club 2,X,Spots,Active,No,0,Coach');
    expect(entries[2]).toBe('A,Zed,Club 3,,Green,Active,No,1,Coach');
    expect(entries[3]).toBe('B,Beta,Club 4,,,Withdrawn,Yes,0,');

    const decs = lines(files['declarations.csv']).slice(1);
    expect(decs[1]).toBe('A,Alpha,Club 2,Spots,Coach,Yes,,,,,,,Yes');
    expect(decs[0]).toBe('A,Alpha,Club 1,,,No,,,,,,,No');
    expect(decs[2]).toMatch(/^A,Zed,Club 3,Green,Coach,No,.*,No,No,No,No$/);
  });
});

describe('createZipArchive details', () => {
  it('stores each file name, length and CRC, and handles an empty archive', () => {
    const empty = createZipArchive({});
    expect(empty).toHaveLength(22);
    const zip = createZipArchive({ 'a.txt': 'abc', 'é.csv': 'x,y' });
    const view = new DataView(zip.buffer);
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('abc')));
    expect(view.getUint32(18, true)).toBe(3);
    expect(view.getUint16(26, true)).toBe(5);
    // entry count in end-of-central-directory
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(2);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});
