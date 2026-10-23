import type { PrintableCompetition } from './eventToolsTypes';

export interface SpecialAward {
  id: number;
  competitionSectionId: number | null;
  title: string;
  recipient: string;
  note: string | null;
}

export interface ResultsBookStanding {
  rank: number;
  teamId: number;
  teamName: string;
  clubName: string;
  /** "A Final", "B Final"...; null where the age group has no finals. */
  finalLabel: string | null;
  /** Includes the bonus points. */
  totalPoints: number;
  bonusPoints: number;
  racesRun: number;
  wins: number;
  eliminations: number;
  withdrawn: boolean;
}

export interface ResultsBookFinalRow {
  rank: number;
  teamId: number;
  teamName: string;
  clubName: string;
  points: number;
  /** The points for each race of the final, or E, DNS, DNF, R or S. */
  raceCells: string[];
}

export interface ResultsBookFinal {
  label: string;
  sessionName: string;
  raceNames: string[];
  rows: ResultsBookFinalRow[];
}

export interface ResultsBookSection {
  sectionId: number;
  sectionName: string;
  format: number;
  standings: ResultsBookStanding[];
  finals: ResultsBookFinal[];
  awards: SpecialAward[];
}

export interface ResultsBookNote {
  sectionName: string;
  heatLabel: string;
  raceName: string;
  teamName: string;
  statusLetter: string | null;
  note: string;
}

export interface ResultsBook {
  competition: PrintableCompetition;
  isProvisional: boolean;
  /** True only in the organiser's copy, which carries the referee's private notes. */
  includesPrivate: boolean;
  generatedAt: string;
  sections: ResultsBookSection[];
  eventAwards: SpecialAward[];
  refereeNotes: ResultsBookNote[];
}

export interface PrintableEntryRider {
  name: string;
  pony: string | null;
  isCaptain: boolean;
  isReserve: boolean;
  isGuest: boolean;
}

export interface PrintableEntryTeam {
  teamId: number;
  teamName: string;
  clubName: string;
  bib: string | null;
  withdrawn: boolean;
  isHorsConcours: boolean;
  riders: PrintableEntryRider[];
}

export interface PrintableEntries {
  competition: PrintableCompetition;
  sections: { sectionId: number; sectionName: string; teams: PrintableEntryTeam[] }[];
}
