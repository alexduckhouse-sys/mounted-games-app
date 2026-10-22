/** One team's place in the race being scored, before it is saved. */
export interface PendingPlace {
  teamId: number;
  place: number;
  eliminated: boolean;
}

/** Non-eliminated teams take places 1..n in order, with no gaps. Eliminated teams have no place (0). */
function renumber(list: PendingPlace[]): PendingPlace[] {
  let next = 0;
  return list.map((p) => (p.eliminated ? { ...p, place: 0 } : { ...p, place: ++next }));
}

function finishers(list: PendingPlace[]): number {
  return list.filter((p) => !p.eliminated).length;
}

/** Tap a team: it takes the next place, or drops out of the order if it already had one. */
export function tapTeam(list: PendingPlace[], teamId: number): PendingPlace[] {
  if (list.some((p) => p.teamId === teamId)) return renumber(list.filter((p) => p.teamId !== teamId));
  return [...list, { teamId, place: finishers(list) + 1, eliminated: false }];
}

/** Swipe a team out, or bring it back. A team brought back goes to the end of the order. */
export function toggleEliminated(list: PendingPlace[], teamId: number): PendingPlace[] {
  const existing = list.find((p) => p.teamId === teamId);
  if (!existing) return [...list, { teamId, place: 0, eliminated: true }];
  if (existing.eliminated) {
    const rest = list.filter((p) => p.teamId !== teamId);
    return [...rest, { teamId, place: finishers(rest) + 1, eliminated: false }];
  }
  return renumber(list.map((p) => (p.teamId === teamId ? { ...p, eliminated: true } : p)));
}
