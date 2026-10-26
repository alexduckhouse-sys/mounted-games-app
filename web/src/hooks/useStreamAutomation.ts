import { useCallback, useEffect, useRef, useState } from 'react';
import { autoContext, autoSteps, finishedRaces, type AutoState } from '../lib/streamAuto';
import { chooseCard, readCard, type OverlayTileId } from '../lib/streamOverlayTiles';
import type { CompetitionDetail, StreamOverlay } from '../types';
import type { OverlaySaveResult } from './useStreamOverlay';

type Save = (change: (overlay: StreamOverlay) => StreamOverlay) => Promise<OverlaySaveResult>;
type Card = Exclude<OverlayTileId, 'soon'>;

/** The card an Auto run is showing now and how long it stays, so the page can count it down. `run` changes with every step. */
export interface AutoRunStep { card: Card; seconds: number; run: number }

/**
 * Runs the Auto rules in this browser. When a race finishes it shows each card in turn for its time, then puts back
 * what was on screen. Choosing a card by hand stops the run. Nothing runs on the server yet, so it works only while
 * a page that uses this hook is open. Returns the step on screen, or null when no run is going.
 */
export function useStreamAutomation({ competition, overlay, saveOverlay, auto }: {
  competition: Pick<CompetitionDetail, 'sessions'>;
  overlay: StreamOverlay;
  saveOverlay?: Save;
  auto: AutoState;
}): { step: AutoRunStep | null } {
  const latest = useRef({ overlay, saveOverlay, auto });
  useEffect(() => { latest.current = { overlay, saveOverlay, auto }; });
  const seen = useRef<Set<number> | null>(null);
  const run = useRef<{ timer: ReturnType<typeof setTimeout> | null; base: Card; shown: Card | null } | null>(null);
  const [step, setStep] = useState<AutoRunStep | null>(null);
  const stepCount = useRef(0);

  const stop = useCallback((restore: boolean) => {
    const current = run.current;
    run.current = null;
    if (!current) return;
    setStep(null);
    if (current.timer) clearTimeout(current.timer);
    if (restore && current.shown && readCard(latest.current.overlay) === current.shown) {
      void latest.current.saveOverlay?.((o) => chooseCard(o, current.base)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const ids = new Set(finishedRaces(competition).map((race) => race.raceId));
    const before = seen.current;
    seen.current = ids;
    if (!before) return;
    const fresh = [...ids].filter((id) => !before.has(id));
    const { auto: rules, saveOverlay: save, overlay: now } = latest.current;
    if (fresh.length === 0 || !rules.on || !save) return;
    const context = autoContext(competition, fresh[fresh.length - 1]);
    const steps = context ? autoSteps(rules, context) : [];
    if (steps.length === 0) return;
    // A new race finishing replaces a run that is still going; the card that was on before it stays the one to go back to.
    const base = run.current?.base ?? readCard(now);
    if (run.current?.timer) clearTimeout(run.current.timer);
    const state: { timer: ReturnType<typeof setTimeout> | null; base: Card; shown: Card | null } = { timer: null, base, shown: null };
    run.current = state;

    const play = (index: number) => {
      if (run.current !== state) return;
      if (state.shown && readCard(latest.current.overlay) !== state.shown) { run.current = null; setStep(null); return; }
      if (index >= steps.length) { stop(true); return; }
      const step = steps[index];
      const card: Card = step.card;
      state.shown = card;
      stepCount.current += 1;
      setStep({ card, seconds: step.seconds, run: stepCount.current });
      void save((o) => chooseCard(o, card)).catch(() => {});
      state.timer = setTimeout(() => play(index + 1), step.seconds * 1000);
    };
    play(0);
  }, [competition, stop]);

  useEffect(() => () => stop(true), [stop]);
  return { step };
}
