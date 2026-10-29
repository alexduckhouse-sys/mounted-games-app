export interface Policy { id: string; organisation: string; edition: string; sourceUrl: string | null; effectiveFrom: string | null; effectiveUntil: string | null; verifiedOn: string | null; automatic: boolean; mandatory: string[]; recommended: string[] }
export interface VenueRule { name: string; version: string; sourceUrl: string; effectiveFrom: string; effectiveUntil: string; maximumMonths: number | null; additionalDays: number; standDownDays: number; clearDays: boolean; manualReview: boolean }
export interface Settings { revision: number; policyVersionId: string; referenceDateBasis: string; venueRules: VenueRule[]; eventStartOn: string }
export interface Finding { code: string; message: string; sourceUrl: string | null; relevantOn: string | null }
export interface Evaluation { status: 'DatesMeetRules' | 'NeedsAttention' | 'MissingHistory' | 'OfficialReviewNeeded'; referenceOn: string | null; policyVersionId: string; mandatory: Finding[]; recommendations: Finding[]; review: Finding[]; nextRelevantOn: string | null }
export interface Evidence { id: number; revision: number; source: string; dates: string[]; completeHistory: boolean; arrivalOn: string | null; exceptionReview: boolean; notes: string | null; recordedAt: string; lastOtherVaccinationOn?: string | null; evaluation: Evaluation }
export interface Inspection { id: number; decision: string; reason: string; inspectedAt: string; evidenceId: number; evidenceRevision: number; settingsRevision: number; current: boolean; inspectedByUserId: string | null }
export interface Pony { riderEntryId: number; declarationFormId: number; teamId: number; teamName: string; ponyName: string; revision: number; horseId: string | null; identityChanged: boolean; legacyInspection: boolean; provisional: Evidence | null; verified: Evidence | null; inspection: Inspection | null; inspectionHistory: Inspection[] }
export interface Board { enabled: boolean; settings: Settings; policies: Policy[]; ponies: Pony[] }
export function latestEvidence(pony: Pony): Evidence | null {
  return [pony.provisional, pony.verified].filter((x): x is Evidence => x !== null).sort((a, b) => b.revision - a.revision)[0] ?? null;
}
export function message(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { detail?: string; message?: string } } })?.response?.data;
  return data?.detail ?? data?.message ?? fallback;
}
export function isBoard(value: unknown): value is Board {
  const board = value as Partial<Board> | null;
  return Boolean(board && typeof board.enabled === 'boolean' && Array.isArray(board.ponies) && Array.isArray(board.policies)
    && board.settings && typeof board.settings.revision === 'number' && Array.isArray(board.settings.venueRules));
}
