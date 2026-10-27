import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { RefineSwitchRow } from '../refine/Refine';
import { delayInWords } from '../../lib/timetableRows';
import '../../components/sitePages.css';

const STEP = 5;

/**
 * Running late: move an arena's times later or earlier in steps of five minutes, or pause it. Opened by tapping the
 * "running late" line on the timetable. The move is sent on Done; pausing happens as soon as it's switched.
 */
export function DelaySheet({ arena, lateMinutes, paused, busy, pace, onShift, onPause, onClose }: {
  /** The arena being changed, or empty for every arena. */
  arena: string;
  lateMinutes: number;
  paused: boolean;
  busy: boolean;
  /** Recent minutes per race, when there are enough races to say. */
  pace: number | null;
  onShift: (minutes: number) => Promise<boolean>;
  onPause: () => void;
  onClose: () => void;
}) {
  const [move, setMove] = useState(0);

  async function done() {
    if (move !== 0 && !(await onShift(move))) return;
    onClose();
  }

  return (
    <Sheet
      title={arena ? `${arena} timing` : 'Timing'}
      description={lateMinutes > 0 ? `Running ${delayInWords(lateMinutes)} late` : 'Running on time'}
      onClose={onClose}
    >
      <div className="rf-row">
        <span className="rf-grow rf-t1">Move times</span>
        <span className="sp-stepper" role="group" aria-label="Move times">
          <button type="button" aria-label={`${STEP} minutes earlier`} disabled={busy || move <= -60} onClick={() => setMove(move - STEP)}>
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <output aria-live="polite" className="!min-w-[64px]">{move > 0 ? `+${move}` : move} min</output>
          <button type="button" aria-label={`${STEP} minutes later`} disabled={busy || move >= 180} onClick={() => setMove(move + STEP)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>
      <RefineSwitchRow label="Pause the timetable" on={paused} disabled={busy} onChange={onPause} />
      {pace != null && <p className="sp-note">Races are taking about {pace.toFixed(1)} minutes each.</p>}
      <div className="kit-acts">
        <button type="button" className="kit-pill kit-pill-fill" disabled={busy} onClick={() => void done()}>Done</button>
      </div>
    </Sheet>
  );
}
