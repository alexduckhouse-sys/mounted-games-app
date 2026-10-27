import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import type { CompetitionDetail, DeclarationForm, StandingRow } from '../types';
import {
  ARCHIVE_FILE_NAMES,
  buildEventArchiveFiles,
  crc32,
  createZipArchive,
  eventArchiveFileName,
  fetchEventArchive,
} from './eventArchive';

function sampleCompetition(): CompetitionDetail {
  return {
    id: 42,
    name: 'County Championship 2031',
    location: 'Showground Arena',
    startDate: '2031-06-14T09:00:00Z',
    endDate: '2031-06-15T17:00:00Z',
    isActive: true,
    isArchived: false,
    sections: [
      { id: 5, competitionId: 42, ageGroup: 'U12', format: 2, displayName: 'Under 12 Teams', priceMinor: 0 },
    ],
    teams: [
      {
        id: 1,
        competitionId: 42,
        competitionSectionId: 5,
        sectionName: 'Under 12 Teams',
        clubId: 10,
        clubName: 'Oak Pony Club',
        suffix: 'A',
        displayName: 'Oak A',
        bibColour: 'Red',
        bibDescription: 'Red & Gold',
        isHorsConcours: false,
      },
      {
        id: 2,
        competitionId: 42,
        competitionSectionId: 5,
        sectionName: 'Under 12 Teams',
        clubId: 11,
        clubName: 'Beech Pony Club',
        suffix: 'B',
        displayName: 'Beech B',
        bibColour: 'Blue',
        isHorsConcours: true,
        isWithdrawn: true,
      },
    ],
    sessions: [
      {
        id: 100,
        competitionId: 42,
        competitionSectionId: 5,
        sectionName: 'Under 12 Teams',
        name: 'Session 1',
        status: 2,
        orderIndex: 1,
        scheduledStart: '09:30',
        isBreak: false,
        kind: 0,
        heats: [
          {
            id: 200,
            sessionId: 100,
            orderIndex: 1,
            label: 'Heat 1',
            raceRoundStage: 0,
            entries: [
              { id: 1, teamId: 1, teamName: 'Oak A', laneIndex: 0 },
              { id: 2, teamId: 2, teamName: 'Beech B', laneIndex: 1 },
            ],
            races: [
              { id: 300, heatId: 200, name: 'Bending', orderIndex: 1, isComplete: true, results: [] },
              { id: 301, heatId: 200, name: 'Flag', orderIndex: 2, isComplete: true, results: [] },
            ],
          },
        ],
      },
      {
        id: 101,
        competitionId: 42,
        competitionSectionId: null,
        sectionName: null,
        name: 'Lunch Break',
        status: 0,
        orderIndex: 2,
        scheduledStart: '12:30',
        isBreak: true,
        kind: 1,
        heats: [],
      },
    ],
  };
}

function sampleBook(): ResultsBook {
  return {
    competition: { id: 42, name: 'County Championship 2031', location: 'Showground Arena', startDate: '2031-06-14T09:00:00Z', endDate: '2031-06-15T17:00:00Z' },
    isProvisional: false,
    includesPrivate: true,
    generatedAt: '2031-06-15T17:30:00Z',
    sections: [
      {
        sectionId: 5,
        sectionName: 'Under 12 Teams',
        format: 2,
        standings: [
          { rank: 1, teamId: 1, teamName: 'Oak A', clubName: 'Oak Pony Club', finalLabel: 'A Final', totalPoints: 28, bonusPoints: 2, racesRun: 6, wins: 4, eliminations: 0, withdrawn: false },
        ],
        finals: [],
        awards: [],
      },
    ],
    eventAwards: [],
    refereeNotes: [{ sectionName: 'Under 12 Teams', heatLabel: 'Heat 1', raceName: 'Bending', teamName: 'Oak A', statusLetter: null, note: 'Internal steward note' }],
  };
}

describe('eventArchive (#100)', () => {
  it('builds all six self-contained archive files and formats minor rider names via publicRiderName', () => {
    const declarations: Record<number, DeclarationForm> = {
      1: {
        id: 90,
        competitionId: 42,
        competitionName: 'County Championship 2031',
        teamId: 1,
        teamName: 'Oak A',
        submittedAt: '2031-06-13T18:00:00Z',
        isLocked: true,
        trainerName: 'Coach Sarah',
        termsAcceptedAt: '2031-06-13T18:00:00Z',
        riders: [
          {
            id: 1,
            fullName: 'Oliver Smith',
            horseName: 'Biscuit',
            ponyHeightHands: 13.2,
            isCaptain: true,
            isReserve: false,
            isGuestRider: false,
            useInitialOnly: true,
            noFilming: false,
            orderIndex: 0,
          },
          {
            id: 2,
            fullName: 'Ava Jones',
            horseName: 'Comet',
            ponyHeightHands: null,
            isCaptain: false,
            isReserve: true,
            isGuestRider: true,
            useInitialOnly: false,
            noFilming: false,
            orderIndex: 1,
          },
        ],
      },
    };

    const files = buildEventArchiveFiles({
      competition: sampleCompetition(),
      resultsBook: sampleBook(),
      declarationsByTeamId: declarations,
      generatedAt: '2031-06-15T18:00:00Z',
    });

    expect(Object.keys(files)).toEqual([...ARCHIVE_FILE_NAMES]);
    expect(files['results-book.csv']).toContain('Event,County Championship 2031');
    expect(files['standings.csv']).toContain('Under 12 Teams,1,Oak A,Oak Pony Club,28,2,6,4,0,No,');
    expect(files['timetable.csv']).toContain('1,Session 1,Under 12 Teams,Session,09:30,Heat 1,Heat,L1: Oak A | L2: Beech B,"Bending, Flag"');
    expect(files['timetable.csv']).toContain('2,Lunch Break,,Break,12:30,,,,');

    // Declarations CSV protects useInitialOnly riders and includes teams without declarations.
    expect(files['declarations.csv']).toContain('Oliver S.,Biscuit,13.2,Yes,No,No,Yes');
    expect(files['declarations.csv']).not.toContain('Oliver Smith');
    expect(files['declarations.csv']).toContain('Ava Jones,Comet,,No,Yes,Yes,Yes');
    expect(files['declarations.csv']).toContain('Under 12 Teams,Beech B,Beech Pony Club,Blue,,No,,,,,,,No');

    // Entries summary CSV
    expect(files['entries-summary.csv']).toContain('Under 12 Teams,Oak A,Oak Pony Club,A,Red & Gold,Active,No,2,Coach Sarah');
    expect(files['entries-summary.csv']).toContain('Under 12 Teams,Beech B,Beech Pony Club,B,Blue,Withdrawn,Yes,0,');

    // Snapshot JSON strips private referee notes
    const snapshot = JSON.parse(files['competition-snapshot.json']);
    expect(snapshot.competition.name).toBe('County Championship 2031');
    expect(snapshot.resultsBook.refereeNotes).toEqual([]);
  });

  it('supports Map-based standings with tieBreakReason and Map-based declarations', () => {
    const standingsMap = new Map<number, ReadonlyArray<StandingRow>>([
      [
        5,
        [
          {
            teamId: 1,
            teamName: 'Oak A',
            clubName: 'Oak Pony Club',
            totalPoints: 28,
            bonusPoints: 0,
            racesRun: 6,
            wins: 4,
            eliminations: 0,
            withdrawn: false,
            tieBreakReason: 'Ahead of Beech B on Countback (4× 1st places vs 2× 1st places)',
          },
        ],
      ],
    ]);
    const decMap = new Map<number, DeclarationForm>();
    const files = buildEventArchiveFiles({
      competition: sampleCompetition(),
      resultsBook: sampleBook(),
      standingsBySection: standingsMap,
      declarationsByTeamId: decMap,
    });
    expect(files['standings.csv']).toContain('Ahead of Beech B on Countback (4× 1st places vs 2× 1st places)');
  });

  it('packs files into a valid ZIP archive with PK signatures and matching CRC-32', () => {
    const files = {
      'hello.txt': 'Hello Mounted Games!',
      'second.csv': 'Team,Points\r\nOak A,30',
    };
    const zipBytes = createZipArchive(files);
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);

    // End of central directory signature at the end (offset = length - 22)
    const eocdOffset = zipBytes.length - 22;
    expect(zipBytes[eocdOffset]).toBe(0x50);
    expect(zipBytes[eocdOffset + 1]).toBe(0x4b);
    expect(zipBytes[eocdOffset + 2]).toBe(0x05);
    expect(zipBytes[eocdOffset + 3]).toBe(0x06);

    // Standard CRC-32 check vector: "123456789" -> 0xCBF43926
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('generates a safe archive filename and fetches the archive from the API', async () => {
    expect(eventArchiveFileName('County Championship 2031!')).toBe('County_Championship_2031_archive.zip');
    expect(eventArchiveFileName('   ')).toBe('competition_archive.zip');

    const getSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      competitionId: 42,
      competitionName: 'County Championship',
      fileName: 'county-championship-archive.zip',
      generatedAt: '2031-06-15T18:00:00Z',
      files: {},
    });

    const dto = await fetchEventArchive(42);
    expect(getSpy).toHaveBeenCalledWith('/competitions/42/archive');
    expect(dto.competitionId).toBe(42);
    getSpy.mockRestore();
  });
});
