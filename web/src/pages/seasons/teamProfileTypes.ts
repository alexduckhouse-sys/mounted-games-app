export interface TeamProfile {
  id: string;
  clubId: number;
  clubName: string;
  suffix: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
}

export interface EventTeamProfileLink {
  id: number;
  teamProfileId: string;
  competitionId: number;
  competitionName: string;
  teamId: number;
  teamName: string;
  linkedAt: string;
}

export interface TeamProfileHistoryResult {
  seasonId: string;
  seasonTitle: string;
  seasonYear: number;
  roundId: string;
  roundOrder: number;
  competitionName: string;
  competitionDate: string;
  publicationVersion: number;
  publishedAt: string;
  eventRank: number;
  eventPoints: number;
  seasonPoints: number;
}

export interface TeamProfileHistory {
  profile: TeamProfile;
  eventTeams: EventTeamProfileLink[];
  publishedResults: TeamProfileHistoryResult[];
}

export interface ClubOption {
  id: number;
  name: string;
}

export interface CompetitionSummaryOption {
  id: number;
  name: string;
  startDate: string;
}

export interface CompetitionTeamOption {
  id: number;
  clubId: number;
  suffix: string;
  displayName: string;
}

export interface CompetitionDetailOption {
  id: number;
  name: string;
  createdByUserId: string | null;
  teams: CompetitionTeamOption[];
}
