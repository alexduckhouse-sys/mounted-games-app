import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import type { CompetitionDetail, DeclarationForm, StandingRow } from '../types';
import { buildEventArchiveFiles, eventArchiveFileName, fetchEventArchive } from './eventArchive';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

// Sparse fixtures: the archive builder has to cope with optional fields being absent.
const loose = <T,>(value: unknown) => value as T;

function book(sections: unknown[]): ResultsBook {
  return loose<ResultsBook>({
    competition: { id: 1, name: 'Cup', location: 'Here', startDate: 'a', endDate: 'b' },
    isProvisional: false,
    includesPrivate: false,
    generatedAt: '2031-01-01T00:00:00Z',
    sections,
    eventAwards: [],
    refereeNotes: [],
  });
}

const baseStanding = {
  rank: 1,
  teamId: 1,
  teamName: 'Oak A',
  clubName: 'Oak',
  finalLabel: null,
  totalPoints: 10,
  bonusPoints: 1,
  racesRun: 2,
  wins: 1,
  eliminations: 0,
  withdrawn: false,
};

const section = (id: number, standings: unknown[] = [baseStanding]) => ({
  sectionId: id,
  sectionName: `Section ${id}`,
  format: 2,
  standings,
  finals: [],
  awards: [],
});

const comp = (extra: Record<string, unknown>) =>
  loose<CompetitionDetail>({
    id: 1,
    name: 'Cup',
    location: 'Here',
    startDate: 'a',
    endDate: 'b',
    sections: [],
    ...extra,
  });

const parseCsv = (csv: string) => csv.trim().split(/\r?\n/);

describe('buildEventArchiveFiles standings branches', () => {
  it('uses custom standings from a record, defaulting bonus and tie-break text', () => {
    const custom: StandingRow[] = [
      loose<StandingRow>({ teamName: 'A', clubName: 'CA', totalPoints: 5, racesRun: 1, wins: 0, eliminations: 0, withdrawn: true }),
      loose<StandingRow>({ teamName: 'B', clubName: 'CB', totalPoints: 4, bonusPoints: 2, racesRun: 1, wins: 0, eliminations: 1, withdrawn: false, tieBreakReason: 'Head to head' }),
    ];
    const files = buildEventArchiveFiles({
      competition: comp({}),
      resultsBook: book([section(5)]),
      standingsBySection: { 5: custom },
      generatedAt: 'fixed',
    });
    const lines = parseCsv(files['standings.csv']);
    expect(lines[1]).toContain('Section 5,1,A,CA,5,0,1,0,0,Yes');
    expect(lines[2]).toContain('Section 5,2,B,CB,4,2,1,0,1,No,Head to head');
    expect(JSON.parse(files['competition-snapshot.json']).competition.generatedAt).toBe('fixed');
  });

  it('falls back to the results book when the map entry is empty or missing', () => {
    const files = buildEventArchiveFiles({
      competition: comp({}),
      resultsBook: book([section(5, [{ ...baseStanding, withdrawn: true }]), section(6)]),
      standingsBySection: new Map<number, StandingRow[]>([[5, []]]),
    });
    const lines = parseCsv(files['standings.csv']);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Yes');
    expect(lines[2]).toContain('Section 6,1,Oak A');
  });

  it('reads custom standings from a Map', () => {
    const files = buildEventArchiveFiles({
      competition: comp({}),
      resultsBook: book([section(5)]),
      standingsBySection: new Map([[5, [loose<StandingRow>({ teamName: 'Mapped', clubName: 'M', totalPoints: 1, racesRun: 0, wins: 0, eliminations: 0 })]]]),
    });
    expect(files['standings.csv']).toContain('Mapped');
    expect(files['standings.csv']).not.toContain('Oak A');
  });
});

describe('buildEventArchiveFiles timetable branches', () => {
  it('copes with missing sessions entirely', () => {
    const files = buildEventArchiveFiles({ competition: comp({}), resultsBook: book([]) });
    expect(parseCsv(files['timetable.csv'])).toHaveLength(1);
  });

  it('writes break and heat-less sessions, ordering ties by id', () => {
    const files = buildEventArchiveFiles({
      competition: comp({
        sessions: [
          { id: 2, name: 'Second', orderIndex: 1, isBreak: false, kind: 1, heats: [] },
          { id: 1, name: 'First', orderIndex: 1, isBreak: false, kind: 0, sectionName: 'Sec', scheduledStart: '09:00' },
          { id: 3, name: 'Lunch', orderIndex: 2, isBreak: true, kind: 0, heats: [] },
        ],
      }),
      resultsBook: book([]),
    });
    const lines = parseCsv(files['timetable.csv']);
    expect(lines[1]).toBe('1,First,Sec,Session,09:00,,,,');
    expect(lines[2]).toBe('1,Second,,Break,,,,,');
    expect(lines[3]).toContain('Lunch,,Break');
  });

  it('names heats, marks finals and orders lanes, races and heats', () => {
    const files = buildEventArchiveFiles({
      competition: comp({
        sessions: [
          {
            id: 1,
            name: 'S',
            orderIndex: 1,
            isBreak: false,
            kind: 0,
            heats: [
              { id: 11, orderIndex: 2, raceRoundStage: 2, label: 'Grand Final', entries: [{ teamName: 'T2', laneIndex: 1 }, { teamName: 'T1', laneIndex: 0 }], races: [{ id: 2, orderIndex: 1, name: 'Flag' }, { id: 1, orderIndex: 1, name: 'Bend' }] },
              { id: 10, orderIndex: 2, raceRoundStage: 0 },
              { id: 9, orderIndex: 1, raceRoundStage: 0, label: null },
            ],
          },
        ],
      }),
      resultsBook: book([]),
    });
    const lines = parseCsv(files['timetable.csv']);
    expect(lines[1]).toContain('Heat 1,Heat,,');
    expect(lines[2]).toContain('Heat 2,Heat,,');
    expect(lines[3]).toContain('Grand Final,Final,L1: T1 | L2: T2,"Bend, Flag"');
  });
});

describe('buildEventArchiveFiles team and declaration branches', () => {
  const teams = [
    { id: 4, sectionName: 'B', displayName: 'Z', clubName: 'c', suffix: '', competitionSectionId: 1 },
    { id: 3, sectionName: 'A', displayName: 'Same', clubName: 'c', suffix: 'x', bibColour: 'Green', competitionSectionId: 1, isWithdrawn: true, isHorsConcours: true },
    { id: 2, sectionName: 'A', displayName: 'Same', clubName: 'c', suffix: 'y', bibDescription: 'Spots', bibColour: 'Red', competitionSectionId: 1 },
    { id: 1, sectionName: 'A', displayName: 'Alpha', clubName: 'c', suffix: 'z', competitionSectionId: 1 },
  ];

  it('handles no teams and no declaration source', () => {
    const files = buildEventArchiveFiles({ competition: comp({}), resultsBook: book([]) });
    expect(parseCsv(files['entries-summary.csv'])).toHaveLength(1);
    expect(JSON.parse(files['competition-snapshot.json']).teams).toEqual([]);
  });

  it('sorts teams by section, name and id and fills bib/status/trainer fallbacks', () => {
    const files = buildEventArchiveFiles({ competition: comp({ teams }), resultsBook: book([]) });
    const rows = parseCsv(files['entries-summary.csv']).slice(1);
    expect(rows.map((r) => r.split(',')[1])).toEqual(['Alpha', 'Same', 'Same', 'Z']);
    expect(rows[1]).toContain('Spots'); // id 2 before id 3
    expect(rows[2]).toContain('Green,Withdrawn,Yes,0,');
    expect(rows[0]).toContain(',,Active,No,0,');
    const decl = parseCsv(files['declarations.csv']).slice(1);
    expect(decl[0]).toMatch(/,No,,,,,,,No$/);
    const snap = JSON.parse(files['competition-snapshot.json']);
    expect(snap.teams.map((t: { id: number }) => t.id)).toEqual([1, 2, 3, 4]);
    expect(snap.teams[0].isWithdrawn).toBe(false);
    expect(snap.teams[2].isWithdrawn).toBe(true);
  });

  it('writes riders, a rider-less locked form and the accepted-terms flag', () => {
    const forms: Record<number, DeclarationForm> = {
      1: loose<DeclarationForm>({
        trainerName: 'Tina',
        isLocked: true,
        termsAcceptedAt: '2031-01-01',
        riders: [
          { fullName: 'Ann Brown', useInitialOnly: true, horseName: ' Biscuit ', ponyHeightHands: 12.2, isCaptain: true, isReserve: false, isGuestRider: true },
          { fullName: 'Cat Day' },
        ],
      }),
      2: loose<DeclarationForm>({ trainerName: 'Tom', isLocked: false, riders: [] }),
      3: loose<DeclarationForm>({ isLocked: true, termsAcceptedAt: '2031-01-02' }),
    };
    const files = buildEventArchiveFiles({
      competition: comp({ teams }),
      resultsBook: book([]),
      declarationsByTeamId: new Map(Object.entries(forms).map(([k, v]) => [Number(k), v])),
    });
    const decl = parseCsv(files['declarations.csv']).slice(1);
    expect(decl[0]).toContain('Tina,Yes,Ann B.,Biscuit,12.2,Yes,No,Yes,Yes');
    expect(decl[1]).toContain('Tina,Yes,Cat Day,,,No,No,No,Yes');
    expect(decl[2]).toContain('Tom,No,,,,,,,No');
    expect(decl[3]).toMatch(/,Yes,,,,,,,Yes$/);
    expect(parseCsv(files['entries-summary.csv'])[1]).toContain(',2,Tina');
  });
});

describe('archive file name and fetch fallbacks', () => {
  it('falls back to "competition" when the name has nothing usable', () => {
    expect(eventArchiveFileName('')).toBe('competition_archive.zip');
  });

  it('unwraps res.data, or returns the response itself when there is no data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { id: 1 } });
    await expect(fetchEventArchive(7)).resolves.toEqual({ id: 1 });
    vi.mocked(api.get).mockResolvedValueOnce({ id: 2 });
    await expect(fetchEventArchive(7)).resolves.toEqual({ id: 2 });
  });
});
