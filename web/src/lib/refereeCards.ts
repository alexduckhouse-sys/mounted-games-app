/** A disciplinary card on a team, or none. */
export type CardMark = 'yellow' | 'red' | null;

/** What the yellow card button does next: a first yellow, or a second one, which is a red. A red card swaps to yellow. */
export function afterYellow(card: CardMark): CardMark {
  return card === 'yellow' ? 'red' : 'yellow';
}

/** What the red card button does next: it gives a red card, or takes one off again. */
export function afterRed(card: CardMark): CardMark {
  return card === 'red' ? null : 'red';
}

/** The words on the yellow card menu item. */
export function yellowLabel(card: CardMark): string {
  return card === 'yellow' ? 'Second yellow (red card)' : 'Yellow card';
}

/** The words on the red card menu item. */
export function redLabel(card: CardMark): string {
  return card === 'red' ? 'Remove red card' : 'Red card';
}

/** The most points one team can be given by hand in a race. */
export const MAX_HAND_POINTS = 30;

/** One step of "Change points": whole points, never below nothing or above the limit. */
export function stepPoints(current: number, by: 1 | -1): number {
  return Math.min(MAX_HAND_POINTS, Math.max(0, current + by));
}
