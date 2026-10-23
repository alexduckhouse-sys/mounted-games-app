/**
 * Why a team did not finish a race. Every one scores 0 and has no place, and each shows its letters in
 * score grids, sheets and stream cards. The numbers match the API's ResultStatus.
 */
export const RESULT_STATUS = { Finished: 0, Eliminated: 1, DidNotStart: 2, DidNotFinish: 3, Retired: 4 } as const;
export type ResultStatusValue = (typeof RESULT_STATUS)[keyof typeof RESULT_STATUS];

export interface StatusChoice { value: ResultStatusValue; letter: string; label: string }

/** What a scorer can pick for a team that did not finish. */
export const STATUS_CHOICES: readonly StatusChoice[] = [
  { value: RESULT_STATUS.Eliminated, letter: 'E', label: 'Eliminated' },
  { value: RESULT_STATUS.DidNotStart, letter: 'DNS', label: 'Did not start' },
  { value: RESULT_STATUS.DidNotFinish, letter: 'DNF', label: 'Did not finish' },
  { value: RESULT_STATUS.Retired, letter: 'R', label: 'Retired' },
];

/**
 * The status of a result. A result that did not finish and has no status (saved before the choice
 * existed, or from an older phone) was an elimination.
 */
export function effectiveStatus(eliminated: boolean, status?: number | null): ResultStatusValue {
  if (!eliminated) return RESULT_STATUS.Finished;
  return STATUS_CHOICES.some((c) => c.value === status) ? (status as ResultStatusValue) : RESULT_STATUS.Eliminated;
}

/** "E", "DNS", "DNF" or "R"; null for a team that finished. */
export function statusLetter(eliminated: boolean, status?: number | null): string | null {
  const found = STATUS_CHOICES.find((c) => c.value === effectiveStatus(eliminated, status));
  return found ? found.letter : null;
}

/** "Eliminated", "Did not start" and so on; null for a team that finished. */
export function statusLabel(eliminated: boolean, status?: number | null): string | null {
  const found = STATUS_CHOICES.find((c) => c.value === effectiveStatus(eliminated, status));
  return found ? found.label : null;
}
