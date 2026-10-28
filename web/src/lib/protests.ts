import { tr } from '../i18n/translate';
import { ProtestStatus, type Protest } from '../types';

/** The words for each protest status, as staff see them. */
export const PROTEST_STATUS_LABELS: Record<ProtestStatus, string> = {
  get [ProtestStatus.Open]() { return tr('ops2.protest.open'); },
  get [ProtestStatus.Upheld]() { return tr('ops2.protest.upheld'); },
  get [ProtestStatus.Dismissed]() { return tr('ops2.protest.dismissed'); },
  get [ProtestStatus.Withdrawn]() { return tr('ops2.protest.withdrawn'); },
};

export type ProtestTone = 'warn' | 'good' | 'grey';

/** Open protests want attention; decided ones are settled; withdrawn ones are just history. */
export function protestTone(status: ProtestStatus): ProtestTone {
  if (status === ProtestStatus.Open) return 'warn';
  return status === ProtestStatus.Withdrawn ? 'grey' : 'good';
}

/** "Race 2 · Heat 1" for a race, or "Whole heat · Heat 1"; the heat falls back to its place in the session. */
export function protestWhere(protest: Pick<Protest, 'raceName' | 'raceId' | 'heatLabel' | 'heatOrder'>): string {
  const heat = protest.heatLabel?.trim() || tr('ops2.protest.heatN', { n: protest.heatOrder });
  const race = protest.raceId == null ? tr('ops2.protest.wholeHeat') : (protest.raceName?.trim() || tr('ops2.protest.race'));
  return `${race} · ${heat}`;
}

/** The open protests that stop this race being signed off: its own, and any against its whole heat. */
export function protestsBlocking(protests: readonly Protest[], raceId: number, heatId: number): Protest[] {
  return protests.filter((p) => p.status === ProtestStatus.Open && p.heatId === heatId && (p.raceId == null || p.raceId === raceId));
}

/** What a decision still needs before it can be saved, or null when it's ready. A withdrawal needs no note. */
export function decisionProblem(outcome: ProtestStatus, decision: string): string | null {
  if (outcome === ProtestStatus.Open) return tr('ops2.protest.chooseOutcome');
  if (outcome === ProtestStatus.Withdrawn) return null;
  return decision.trim() ? null : tr('ops2.protest.needDecision');
}

/** The names of races marked under review, in order, for the public "Under review" line. */
export function underReviewNames(columns: ReadonlyArray<{ label: string; underReview: boolean }>): string[] {
  return columns.filter((column) => column.underReview).map((column) => column.label);
}

/** A fresh id for a create request, so a retry on poor signal doesn't log the protest twice. */
export function protestRequestId(random: () => string = defaultRandom): string {
  return `protest-${random()}`;
}

function defaultRandom(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Window event fired when protests may have changed (a hub nudge, a reconnect or a save on this phone). */
export const PROTESTS_CHANGED_EVENT = 'mg:protests';

export function announceProtestsChanged(): void {
  window.dispatchEvent(new Event(PROTESTS_CHANGED_EVENT));
}
