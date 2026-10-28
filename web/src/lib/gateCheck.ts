// Unused in web UI yet — reserved for iOS / upcoming wiring
import type { GateCheckStatus, Heat } from '../types';

export const GATE_CHECK_STATUSES = ['at-gate', 'warming-up', 'missing'] as const;

export const GATE_CHECK_LABELS: Record<Exclude<GateCheckStatus, null>, string> = {
  'at-gate': 'At gate',
  'warming-up': 'Warming up',
  missing: 'Missing',
};

const GATE_TAG_RE = /\[gate:(\d+):(\d+)=(at-gate|warming-up|missing)\]/g;
const INTERNAL_TAGS_RE = /\s*\[(?:paused|pausefor|shift|scoring|gate|pts):[^\]]*\]\s*/g;

function gateKey(heatId: number, teamId: number): string {
  return `${heatId}:${teamId}`;
}

/** Parse all `[gate:<heatId>:<teamId>=<status>]` tags from `Session.notes`. */
export function parseGateChecks(
  notes: string | null | undefined,
): Record<string, Exclude<GateCheckStatus, null>> {
  const out: Record<string, Exclude<GateCheckStatus, null>> = {};
  if (!notes) return out;
  for (const match of notes.matchAll(GATE_TAG_RE)) {
    const heatId = Number(match[1]);
    const teamId = Number(match[2]);
    const status = match[3] as Exclude<GateCheckStatus, null>;
    if (Number.isFinite(heatId) && Number.isFinite(teamId)) {
      out[gateKey(heatId, teamId)] = status;
    }
  }
  return out;
}

/** Read a single lane's gate check-in status for a heat and team. */
export function getGateCheckStatus(
  notes: string | null | undefined,
  heatId: number,
  teamId: number,
): GateCheckStatus {
  const map = parseGateChecks(notes);
  return map[gateKey(heatId, teamId)] ?? null;
}

/** Update or clear a single `[gate:<heatId>:<teamId>=<status>]` tag inside `Session.notes`. */
export function applyGateCheckTag(
  notes: string | null | undefined,
  heatId: number,
  teamId: number,
  status: GateCheckStatus,
): string | null {
  const targetPattern = new RegExp(`\\s*\\[gate:${heatId}:${teamId}=[^\\]]*\\]\\s*`, 'g');
  const cleaned = (notes ?? '').replace(targetPattern, ' ').trim();
  if (!status) return cleaned.length > 0 ? cleaned : null;
  const tag = `[gate:${heatId}:${teamId}=${status}]`;
  return cleaned.length > 0 ? `${cleaned} ${tag}` : tag;
}

/** Cycle through gate check-in states on successive taps: `null -> 'at-gate' -> 'warming-up' -> 'missing' -> null`. */
export function nextGateCheckStatus(current: GateCheckStatus): GateCheckStatus {
  if (current === null) return 'at-gate';
  if (current === 'at-gate') return 'warming-up';
  if (current === 'warming-up') return 'missing';
  return null;
}

/** Summarise how many lanes in a heat are at the gate, warming up, or marked missing. */
export function countHeatAtGate(
  notes: string | null | undefined,
  heat: Pick<Heat, 'id' | 'entries'>,
): { atGate: number; warmingUp: number; missing: number; total: number } {
  const map = parseGateChecks(notes);
  let atGate = 0;
  let warmingUp = 0;
  let missing = 0;
  for (const entry of heat.entries) {
    const status = map[gateKey(heat.id, entry.teamId)];
    if (status === 'at-gate') atGate += 1;
    else if (status === 'warming-up') warmingUp += 1;
    else if (status === 'missing') missing += 1;
  }
  return { atGate, warmingUp, missing, total: heat.entries.length };
}

/** True when the heat has at least one team and every lane is checked in `'at-gate'`. */
export function isHeatReadyAtGate(
  notes: string | null | undefined,
  heat: Pick<Heat, 'id' | 'entries'>,
): boolean {
  if (heat.entries.length === 0) return false;
  const { atGate, total } = countHeatAtGate(notes, heat);
  return atGate === total;
}

/** Remove internal state tags (`[paused:...]`, `[shift:...]`, `[scoring:...]`, `[gate:...]`) from `Session.notes`. */
export function stripInternalSessionNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  return notes.replace(INTERNAL_TAGS_RE, ' ').replace(/\s+/g, ' ').trim();
}
