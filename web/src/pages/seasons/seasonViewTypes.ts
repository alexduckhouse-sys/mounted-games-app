import axios from 'axios';
import type { SectionFormat } from '../../types';

export interface SeasonSettings {
  title: string;
  year: number;
  format: SectionFormat;
  ageGroup: string;
  bestResultsToCount: number | null;
  placePoints: { place: number; points: number }[];
}
export interface SeasonRoundView {
  id: string;
  competitionId: number;
  competitionName: string;
  competitionDate: string;
  competitionSectionId: number;
  sectionName: string;
  orderIndex: number;
  isIncluded: boolean;
  publishedVersion: number | null;
  publishedAt: string | null;
  publicationIsCurrent: boolean;
}
export interface SeasonView extends SeasonSettings {
  id: string;
  rounds: SeasonRoundView[];
  canManage: boolean;
}
export interface StandingView {
  rank: number;
  teamProfileId: string;
  teamName: string;
  clubName: string;
  totalPoints: number;
  rounds: { roundId: string; eventRank: number; seasonPoints: number; counted: boolean }[];
}
export interface StandingsView { standings: StandingView[] }
export interface PublicationView {
  roundId: string;
  sourceFingerprint: string;
  nextVersion: number;
  rankingBasis: string;
  results: { teamProfileId: string; teamName: string; eventRank: number; eventPoints: number; seasonPoints: number }[];
}
export function seasonError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    for (const value of [data?.detail, data?.message, data?.title]) {
      if (typeof value === 'string' && value.length) return value;
    }
  }
  return fallback;
}
