export interface CsvTeamImportRow {
  rowNumber: number;
  clubId: number | null;
  club: string;
  suffix: string;
  competitionSectionId: number | null;
  section: string;
  teamName: string;
  errors: string[];
}

export interface CsvTeamImportPreview {
  previewVersion: number;
  fingerprint: string;
  totalRows: number;
  validRows: number;
  rows: CsvTeamImportRow[];
}

export interface CloneCompetitionResult {
  competitionId: number;
  name: string;
  sections: number;
  teams: number;
  sessions: number;
  heats: number;
  races: number;
}

export interface PrintableCompetition {
  id: number;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string | null;
}

export interface PrintableTeam {
  teamId: number;
  teamName: string;
  clubName: string;
  suffix: string;
  lane: number;
}

export interface PrintableRace { raceId: number; name: string; orderIndex: number }
export interface PrintableHeat {
  heatId: number;
  label: string;
  scheduledStart: string | null;
  teams: PrintableTeam[];
  races: PrintableRace[];
}
export interface PrintableSession {
  sessionId: number;
  sectionName: string;
  sessionName: string;
  arenaName: string | null;
  orderIndex: number;
  heats: PrintableHeat[];
}
export interface PrintableDraw {
  competition: PrintableCompetition;
  sessions: PrintableSession[];
}

export interface PrintableScoreCell {
  teamId: number;
  teamName: string;
  placing: number | null;
  eliminated: boolean;
  points: number | null;
  /** The team's drawn lane in the heat. */
  lane?: number;
  /** What the team's bibs look like, if known. */
  bib?: string | null;
  /** The team had no lane this race and sat it out. */
  isSitOut?: boolean;
  /** Why a team that did not finish did not: 1 E, 2 DNS, 3 DNF, 4 R. */
  status?: number;
}
export interface PrintableScoreRace { raceId: number; name: string; teams: PrintableScoreCell[] }
export interface PrintableScoreHeat {
  heatId: number;
  label: string;
  sectionName: string;
  sessionName: string;
  scheduledStart: string | null;
  races: PrintableScoreRace[];
}
export interface PrintableScoreSheets {
  competition: PrintableCompetition;
  heats: PrintableScoreHeat[];
}

export interface PrintableResultRow {
  rank: number;
  teamId: number;
  teamName: string;
  clubName: string;
  totalPoints: number;
  racesRun: number;
  wins: number;
  eliminations: number;
}
export interface PrintableSectionResults {
  competitionSectionId: number;
  sectionName: string;
  results: PrintableResultRow[];
}
export interface PrintableResults {
  competition: PrintableCompetition;
  isProvisional: boolean;
  sections: PrintableSectionResults[];
}
