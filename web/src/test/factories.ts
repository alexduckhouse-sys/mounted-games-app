import type { ChatMessage, CompetitionDetail, Heat, Race, ResultRow, Session, StandingRow, Team } from '../types';

/** Minimal valid records for tests; override only what the test is about. */
export const result = (teamId: number, placing: number | null, extra: Partial<ResultRow> = {}): ResultRow => ({
  id: teamId * 10 + (placing ?? 0), teamId, teamName: `Team ${teamId}`, placing, eliminated: false, points: 0, ...extra,
});

export const race = (id: number, extra: Partial<Race> = {}): Race => ({
  id, heatId: 1, name: `Race ${id}`, orderIndex: id, isComplete: false, results: [], ...extra,
});

export const heat = (id: number, extra: Partial<Heat> = {}): Heat => ({
  id, sessionId: 1, orderIndex: id, entries: [], races: [], ...extra,
});

export const session = (id: number, extra: Partial<Session> = {}): Session => ({
  id, competitionId: 1, competitionSectionId: 5, sectionName: 'Teams Seniors', name: `Session ${id}`,
  status: 0, orderIndex: id, isBreak: false, kind: 0, heats: [], ...extra,
});

export const team = (id: number, extra: Partial<Team> = {}): Team => ({
  id, competitionId: 1, competitionSectionId: 5, sectionName: 'Seniors', clubId: 1, clubName: 'Club',
  suffix: '', displayName: `Team ${id}`, isHorsConcours: false, ...extra,
});

export const standing = (teamId: number, totalPoints: number): StandingRow => ({
  teamId, teamName: `Team ${teamId}`, clubName: 'Club', totalPoints, racesRun: 0, wins: 0, eliminations: 0,
});

export const chat = (id: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, competitionId: 1, authorName: 'Organiser', body: 'Hello', type: 2, createdAt: new Date().toISOString(), adminOnly: false, ...extra,
});

export const competition = (extra: Partial<CompetitionDetail> = {}): CompetitionDetail => ({
  id: 1, name: 'Spring Games', startDate: '2026-06-01', isActive: true, isArchived: false,
  sections: [], teams: [], sessions: [], staffChatEnabled: true, ...extra,
});

/** An Axios-shaped failure, as `isNetworkError` and `outcomeOfError` expect it. */
export const axiosError = (response?: { status: number; data?: unknown }, code?: string) =>
  Object.assign(new Error('request failed'), { isAxiosError: true, response, code });
