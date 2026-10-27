// Wire types for the daily "entries are open" email (api/Dtos/EntriesDigestDtos.cs). Enums travel as numbers.

/** 0 sending, 1 done, 2 baseline (the very first run, which only records what was already open). */
export type EntriesDigestRunStatus = 0 | 1 | 2;

export interface EntriesDigestRun {
  id: number;
  /** The UK date it was claimed for, `yyyy-MM-dd`. */
  runDate: string;
  status: EntriesDigestRunStatus;
  manual: boolean;
  competitions: number;
  total: number;
  sent: number;
  /** Gave up on after several tries. */
  failed: number;
  skipped: number;
  /** Still to try, including failed ones that will be retried. */
  remaining: number;
  claimedAt: string;
  completedAt: string | null;
}

export interface EntriesDigestStatus {
  canSend: boolean;
  cannotSendBecause: string | null;
  recipients: number;
  pendingCount: number;
  pending: { id: number; name: string; startDate: string; location: string | null }[];
  last: EntriesDigestRun | null;
  todayClaimed: boolean;
  /** When the evening run may next start (now, if it is due). */
  nextSendUtc: string;
}

export function isEntriesDigestStatus(value: unknown): value is EntriesDigestStatus {
  const status = value as Partial<EntriesDigestStatus> | null | undefined;
  return !!status && typeof status.canSend === 'boolean' && typeof status.pendingCount === 'number'
    && typeof status.recipients === 'number' && Array.isArray(status.pending);
}
