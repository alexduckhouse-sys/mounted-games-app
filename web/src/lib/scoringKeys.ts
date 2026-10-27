/**
 * Scoring with a Bluetooth keypad, page-turner or foot pedal. These pair with a phone as a keyboard, so a key press is
 * all we get: this file turns one into a scoring action. It has no React or DOM dependencies so it is easy to test.
 *
 * | Key                          | Action                                                      |
 * | ---------------------------- | ----------------------------------------------------------- |
 * | 1–9                          | That lane crossed the line next (the same as tapping it)    |
 * | . or - then 1–9              | Eliminate that lane (the same as holding it)                |
 * | Enter                        | Save scores                                                 |
 * | Backspace, z, ←, Page Up     | Undo                                                        |
 * | →, Page Down                 | Save if the race isn't saved yet, otherwise the next race   |
 * | Escape                       | Forget a . or - that hasn't been followed by a lane yet     |
 *
 * Numeric keypad keys are read by their physical position (`code`), so they still work with Num Lock off, when the
 * keypad would otherwise send arrows and Page Up/Down.
 */

export type ScoringKeyAction =
  | { kind: 'place'; lane: number }
  | { kind: 'eliminate'; lane: number }
  | { kind: 'save' }
  | { kind: 'undo' }
  | { kind: 'advance' }
  /** A . or - was pressed: the next lane number eliminates. */
  | { kind: 'arm' }
  /** Escape after . or -: nothing will be eliminated. */
  | { kind: 'disarm' };

/** The parts of a `KeyboardEvent` this file reads. */
export interface KeyPress {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export interface KeyResult {
  /** What to do, or null to leave the key alone (the browser keeps its default). */
  action: ScoringKeyAction | null;
  /** Whether the next lane number eliminates. */
  armed: boolean;
}

/** How long a . or - waits for its lane number before it is forgotten, so a stray press can't eliminate a team later on. */
export const ELIMINATE_PREFIX_MS = 3000;

const NUMPAD: Record<string, string> = {
  Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4', Numpad5: '5', Numpad6: '6', Numpad7: '7', Numpad8: '8', Numpad9: '9',
  NumpadDecimal: '.', NumpadSubtract: '-', NumpadEnter: 'Enter',
};

/** The key as a scorer meant it: numeric keypad keys by position, everything else by the character it sends. */
function normalise(press: KeyPress): string {
  return (press.code && NUMPAD[press.code]) || press.key;
}

/**
 * Turns one key press into a scoring action. `armed` says whether a . or - is waiting for its lane number. Shortcuts
 * with Ctrl, Cmd or Alt, held-down repeats and keys typed into an input method are never scoring keys.
 */
export function scoringKeyAction(press: KeyPress, armed: boolean): KeyResult {
  if (press.ctrlKey || press.metaKey || press.altKey || press.repeat || press.isComposing) return { action: null, armed };
  const key = normalise(press);
  if (/^[1-9]$/.test(key)) {
    const lane = Number(key);
    return { action: armed ? { kind: 'eliminate', lane } : { kind: 'place', lane }, armed: false };
  }
  // A comma is the numeric keypad's decimal key on some layouts.
  if (key === '.' || key === '-' || key === ',' || key === 'Decimal' || key === 'Subtract') return { action: { kind: 'arm' }, armed: true };
  if (key === 'Escape') return { action: armed ? { kind: 'disarm' } : null, armed: false };
  if (key === 'Enter') return { action: { kind: 'save' }, armed: false };
  if (key === 'Backspace' || key === 'z' || key === 'Z' || key === 'ArrowLeft' || key === 'PageUp') return { action: { kind: 'undo' }, armed: false };
  if (key === 'ArrowRight' || key === 'PageDown') return { action: { kind: 'advance' }, armed: false };
  return { action: null, armed };
}

/** The parts of a DOM element this file reads. */
export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const PRESSABLE = 'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="tab"], [role="option"], [role="radio"]';
const ARROW_WIDGETS = '[role="tablist"], [role="menu"], [role="menubar"], [role="listbox"], [role="radiogroup"], [role="slider"], [role="tree"], [role="grid"]';
/** Marks a lane card on the scoring screen (see `ScoreRow`). */
export const LANE_CARD_ATTR = 'data-scoring-lane';

/**
 * Whether the focused element should keep a key to itself instead of it scoring:
 * - anything you type into (inputs, text areas, selects, contenteditable) keeps every key;
 * - a focused button or link keeps Enter, so keyboard users can still press it, except a lane card, where Enter
 *   saves (a phone often leaves the last tapped card focused, and Enter would otherwise take that team's place away);
 * - tabs, menus and lists keep their arrow keys.
 */
export function targetKeepsKey(target: KeyTarget | null | undefined, press: KeyPress): boolean {
  if (!target) return false;
  const tag = target.tagName?.toUpperCase() ?? '';
  if (TYPING_TAGS.has(tag) || target.isContentEditable) return true;
  const key = normalise(press);
  const inside = (selector: string) => Boolean(target.closest?.(selector));
  if (key === 'Enter' && inside(PRESSABLE) && !inside(`[${LANE_CARD_ATTR}]`)) return true;
  if (key.startsWith('Arrow') && inside(ARROW_WIDGETS)) return true;
  return false;
}

/** Something covering the scoring screen (a confirmation, sheet, menu drawer or race tools) takes the keys while it is open. */
export const OPEN_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"], dialog[open]';
