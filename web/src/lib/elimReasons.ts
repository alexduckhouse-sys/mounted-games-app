import { RESULT_STATUS } from './resultStatus';

/** Why a team is out of a race. The text is kept as the team's private referee note; a non-finish also sets the result status. */
export interface ElimReason { key: string; label: string; status: number }

export const OTHER_REASON = 'other';

export const ELIM_REASONS: readonly ElimReason[] = [
  { key: 'flag', label: 'Missed a flag or pot', status: RESULT_STATUS.Eliminated },
  { key: 'equipment', label: 'Dropped equipment', status: RESULT_STATUS.Eliminated },
  { key: 'lanes', label: 'Crossed lanes', status: RESULT_STATUS.Eliminated },
  { key: 'course', label: 'Wrong course', status: RESULT_STATUS.Eliminated },
  { key: 'dns', label: 'Did not start', status: RESULT_STATUS.DidNotStart },
  { key: 'dnf', label: 'Did not finish', status: RESULT_STATUS.DidNotFinish },
  { key: 'retired', label: 'Retired', status: RESULT_STATUS.Retired },
  { key: OTHER_REASON, label: 'Other', status: RESULT_STATUS.Eliminated },
];

/** Which choice a saved note matches: a preset label, else Other (and the note is the free text). Null when there is no note. */
export function reasonKeyOf(note: string | undefined): string | null {
  const text = note?.trim();
  if (!text) return null;
  return ELIM_REASONS.find((r) => r.key !== OTHER_REASON && r.label === text)?.key ?? OTHER_REASON;
}

/** The note to store for a choice: the preset's wording, or the free text for Other. */
export function noteFor(key: string, freeText: string): string {
  const reason = ELIM_REASONS.find((r) => r.key === key);
  return !reason || reason.key === OTHER_REASON ? freeText.trim() : reason.label;
}

export function statusFor(key: string): number {
  return ELIM_REASONS.find((r) => r.key === key)?.status ?? RESULT_STATUS.Eliminated;
}
