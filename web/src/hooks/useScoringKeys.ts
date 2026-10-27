import { useEffect, useRef, useState } from 'react';
import {
  ELIMINATE_PREFIX_MS, OPEN_DIALOG_SELECTOR, scoringKeyAction, targetKeepsKey, type KeyTarget, type ScoringKeyAction,
} from '../lib/scoringKeys';

/** Set once a keypad key has scored something, so the chip stays for the rest of the browser session. */
const SEEN_KEY = 'mg.scoring.keypad';

function readSeen(): boolean {
  try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

function writeSeen(): void {
  try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* the chip still shows on this screen */ }
}

/**
 * Listens for a Bluetooth keypad, page-turner or foot pedal on the scoring screen (see `lib/scoringKeys.ts` for the
 * keys). `onAction` returns false when the action can't happen now (a lane that isn't racing, a saved race), and the
 * key is then left alone. Keys are ignored while `enabled` is false, while anything is typed into a field, while a
 * dialog or sheet is open, and when the page has already used the key (a focused lane card takes Backspace and
 * Delete to eliminate that lane).
 *
 * Returns true once a key has been handled in this browser session, for the "Keypad connected" chip.
 */
export function useScoringKeys(enabled: boolean, onAction: (action: ScoringKeyAction) => boolean | void): boolean {
  const [seen, setSeen] = useState(readSeen);
  const handler = useRef(onAction);
  const armedAt = useRef<number | null>(null);

  useEffect(() => { handler.current = onAction; });

  useEffect(() => {
    armedAt.current = null;
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      // A focused lane card turns Backspace and Delete into "eliminate this lane" and marks the key as used, so the
      // keypad's Backspace = undo doesn't run on top of it.
      if (event.defaultPrevented) return;
      if (document.querySelector(OPEN_DIALOG_SELECTOR)) return;
      if (targetKeepsKey(event.target as KeyTarget | null, event)) return;
      const now = Date.now();
      const armed = armedAt.current != null && now - armedAt.current <= ELIMINATE_PREFIX_MS;
      const { action, armed: stillArmed } = scoringKeyAction(event, armed);
      if (!action) {
        if (!stillArmed) armedAt.current = null;
        return;
      }
      armedAt.current = action.kind === 'arm' ? now : null;
      if (handler.current(action) === false) {
        armedAt.current = null;
        return;
      }
      event.preventDefault();
      writeSeen();
      setSeen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  return seen;
}
