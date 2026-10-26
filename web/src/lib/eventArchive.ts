import { api } from '../api';
import type { ResultsBook } from '../pages/eventTools/resultsBookTypes';
import type { CompetitionDetail, DeclarationForm, EventArchiveDto, StandingRow } from '../types';
import { safeFilename, toCsv } from './csv';
import { resultsBookToCsv, safeCell } from './resultsBookCsv';
import { publicRiderName } from './riderNames';

export const ARCHIVE_FILE_NAMES = [
  'results-book.csv',
  'standings.csv',
  'timetable.csv',
  'declarations.csv',
  'entries-summary.csv',
  'competition-snapshot.json',
] as const;

export interface BuildEventArchiveInput {
  competition: CompetitionDetail;
  resultsBook: ResultsBook;
  standingsBySection?: ReadonlyMap<number, ReadonlyArray<StandingRow>> | Record<number, ReadonlyArray<StandingRow>>;
  declarationsByTeamId?: ReadonlyMap<number, DeclarationForm> | Record<number, DeclarationForm>;
  generatedAt?: string;
}

function getMapOrRecord<T>(
  key: number,
  source?: ReadonlyMap<number, T> | Record<number, T>,
): T | undefined {
  if (!source) return undefined;
  if (source instanceof Map) {
    return (source as ReadonlyMap<number, T>).get(key);
  }
  return (source as Record<number, T>)[key];
}

const row = (cells: ReadonlyArray<string | number | null | undefined>) => cells.map(safeCell);

/**
 * Builds the 6 self-contained organiser archive files (`results-book.csv`, `standings.csv`,
 * `timetable.csv`, `declarations.csv`, `entries-summary.csv`, and `competition-snapshot.json`).
 */
export function buildEventArchiveFiles(input: BuildEventArchiveInput): Record<string, string> {
  const {
    competition,
    resultsBook,
    standingsBySection,
    declarationsByTeamId,
    generatedAt = new Date().toISOString(),
  } = input;

  const resultsBookCsv = resultsBookToCsv(resultsBook);

  // 2. standings.csv
  const standingsRows: Array<Array<string | number>> = [];
  for (const section of resultsBook.sections) {
    const customStandings = getMapOrRecord(section.sectionId, standingsBySection);
    if (customStandings && customStandings.length > 0) {
      customStandings.forEach((s, index) => {
        standingsRows.push(
          row([
            section.sectionName,
            index + 1,
            s.teamName,
            s.clubName,
            s.totalPoints,
            s.bonusPoints ?? 0,
            s.racesRun,
            s.wins,
            s.eliminations,
            s.withdrawn ? 'Yes' : 'No',
            s.tieBreakReason ?? '',
          ]),
        );
      });
    } else {
      for (const s of section.standings) {
        standingsRows.push(
          row([
            section.sectionName,
            s.rank,
            s.teamName,
            s.clubName,
            s.totalPoints,
            s.bonusPoints,
            s.racesRun,
            s.wins,
            s.eliminations,
            s.withdrawn ? 'Yes' : 'No',
            '',
          ]),
        );
      }
    }
  }
  const standingsCsv = toCsv(
    ['Section', 'Position', 'Team', 'Club', 'Points', 'BonusPoints', 'RacesRun', 'Wins', 'Eliminations', 'Withdrawn', 'TieBreakReason'],
    standingsRows,
  );

  // 3. timetable.csv
  const timetableRows: Array<Array<string | number>> = [];
  const sortedSessions = [...(competition.sessions ?? [])].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  for (const session of sortedSessions) {
    const isBreak = session.isBreak || session.kind === 1;
    if (isBreak || !session.heats || session.heats.length === 0) {
      timetableRows.push(
        row([
          session.orderIndex,
          session.name,
          session.sectionName ?? '',
          isBreak ? 'Break' : 'Session',
          session.scheduledStart ?? '',
          '',
          '',
          '',
          '',
        ]),
      );
      continue;
    }

    const sortedHeats = [...session.heats].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
    for (const heat of sortedHeats) {
      const lanes = [...(heat.entries ?? [])]
        .sort((a, b) => a.laneIndex - b.laneIndex)
        .map((e) => `L${e.laneIndex + 1}: ${e.teamName}`)
        .join(' | ');
      const races = [...(heat.races ?? [])]
        .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
        .map((r) => r.name)
        .join(', ');
      timetableRows.push(
        row([
          session.orderIndex,
          session.name,
          session.sectionName ?? '',
          'Session',
          session.scheduledStart ?? '',
          heat.label ?? `Heat ${heat.orderIndex}`,
          heat.raceRoundStage === 2 ? 'Final' : 'Heat',
          lanes,
          races,
        ]),
      );
    }
  }
  const timetableCsv = toCsv(
    ['SessionOrder', 'Session', 'Section', 'Kind', 'ScheduledStart', 'Heat', 'Stage', 'Lanes', 'Races'],
    timetableRows,
  );

  // 4. declarations.csv & 5. entries-summary.csv
  const declarationRows: Array<Array<string | number>> = [];
  const entriesRows: Array<Array<string | number>> = [];
  const sortedTeams = [...(competition.teams ?? [])].sort(
    (a, b) =>
      a.sectionName.localeCompare(b.sectionName) ||
      a.displayName.localeCompare(b.displayName) ||
      a.id - b.id,
  );

  for (const team of sortedTeams) {
    const form = getMapOrRecord(team.id, declarationsByTeamId);
    const riders = form?.riders ?? [];

    entriesRows.push(
      row([
        team.sectionName,
        team.displayName,
        team.clubName,
        team.suffix,
        team.bibDescription ?? team.bibColour ?? '',
        team.withdrawnAt ? 'Withdrawn' : 'Active',
        team.isHorsConcours ? 'Yes' : 'No',
        riders.length,
        form?.trainerName ?? '',
      ]),
    );

    if (riders.length === 0) {
      declarationRows.push(
        row([
          team.sectionName,
          team.displayName,
          team.clubName,
          team.bibDescription ?? team.bibColour ?? '',
          form?.trainerName ?? '',
          form?.isLocked ? 'Yes' : 'No',
          '',
          '',
          '',
          '',
          '',
          '',
          form?.termsAcceptedAt ? 'Yes' : 'No',
        ]),
      );
      continue;
    }

    for (const rider of riders) {
      declarationRows.push(
        row([
          team.sectionName,
          team.displayName,
          team.clubName,
          team.bibDescription ?? team.bibColour ?? '',
          form?.trainerName ?? '',
          form?.isLocked ? 'Yes' : 'No',
          publicRiderName({ fullName: rider.fullName, useInitialOnly: Boolean(rider.useInitialOnly) }),
          rider.horseName?.trim() ?? '',
          rider.ponyHeightHands ?? '',
          rider.isCaptain ? 'Yes' : 'No',
          rider.isReserve ? 'Yes' : 'No',
          rider.isGuestRider ? 'Yes' : 'No',
          form?.termsAcceptedAt ? 'Yes' : 'No',
        ]),
      );
    }
  }

  const declarationsCsv = toCsv(
    ['Section', 'Team', 'Club', 'Bib', 'Trainer', 'Locked', 'Rider', 'Pony', 'PonyHeightHands', 'Captain', 'Reserve', 'Guest', 'TermsAccepted'],
    declarationRows,
  );
  const entriesSummaryCsv = toCsv(
    ['Section', 'Team', 'Club', 'Suffix', 'Bib', 'Status', 'HorsConcours', 'DeclaredRiders', 'SubmittedTrainer'],
    entriesRows,
  );

  // 6. competition-snapshot.json
  const snapshotJson = JSON.stringify(
    {
      competition: {
        id: competition.id,
        name: competition.name,
        location: competition.location,
        startDate: competition.startDate,
        endDate: competition.endDate,
        generatedAt,
      },
      sections: competition.sections,
      teams: sortedTeams.map((t) => ({
        id: t.id,
        displayName: t.displayName,
        clubName: t.clubName,
        sectionId: t.competitionSectionId,
        sectionName: t.sectionName,
        isHorsConcours: t.isHorsConcours,
        withdrawnAt: t.withdrawnAt ?? null,
      })),
      resultsBook: {
        ...resultsBook,
        refereeNotes: [],
      },
    },
    null,
    2,
  );

  return {
    'results-book.csv': resultsBookCsv,
    'standings.csv': standingsCsv,
    'timetable.csv': timetableCsv,
    'declarations.csv': declarationsCsv,
    'entries-summary.csv': entriesSummaryCsv,
    'competition-snapshot.json': snapshotJson,
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Packs a map of `{ [filename]: textContent }` into a standard uncompressed ZIP archive (`Uint8Array`)
 * with zero external dependencies.
 */
export function createZipArchive(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const entries = Object.entries(files).map(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);
    const crc = crc32(dataBytes);
    return { nameBytes, dataBytes, crc };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const entry of entries) {
    localSize += 30 + entry.nameBytes.length + entry.dataBytes.length;
    centralSize += 46 + entry.nameBytes.length;
  }

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;
  const localOffsets: number[] = [];

  for (const entry of entries) {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true); // Local file header signature
    view.setUint16(offset + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(offset + 6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(offset + 8, 0, true); // Compression method (0 = store)
    view.setUint16(offset + 10, 0, true); // Last mod file time
    view.setUint16(offset + 12, 0, true); // Last mod file date
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.dataBytes.length, true);
    view.setUint32(offset + 22, entry.dataBytes.length, true);
    view.setUint16(offset + 26, entry.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;
    out.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
    out.set(entry.dataBytes, offset);
    offset += entry.dataBytes.length;
  }

  const centralDirOffset = offset;
  entries.forEach((entry, index) => {
    view.setUint32(offset, 0x02014b50, true); // Central directory file header signature
    view.setUint16(offset + 4, 20, true); // Version made by
    view.setUint16(offset + 6, 20, true); // Version needed to extract
    view.setUint16(offset + 8, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(offset + 10, 0, true); // Compression method (0 = store)
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.dataBytes.length, true);
    view.setUint32(offset + 24, entry.dataBytes.length, true);
    view.setUint16(offset + 28, entry.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index], true);
    offset += 46;
    out.set(entry.nameBytes, offset);
    offset += entry.nameBytes.length;
  });

  const centralDirSize = offset - centralDirOffset;
  view.setUint32(offset, 0x06054b50, true); // End of central directory signature
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralDirSize, true);
  view.setUint32(offset + 16, centralDirOffset, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}

export function eventArchiveFileName(competitionName: string): string {
  const safe = safeFilename(competitionName).replace(/_+$/, '') || 'competition';
  return `${safe}_archive.zip`;
}

export async function fetchEventArchive(competitionId: number): Promise<EventArchiveDto> {
  return api.get<EventArchiveDto>(`/competitions/${competitionId}/archive`);
}
