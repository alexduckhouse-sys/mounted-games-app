import { useId, useState, type FormEvent } from 'react';
import { Sheet } from '../../components/Sheet';
import { delayInWords } from '../../lib/timetableRows';
import '../../components/sitePages.css';

/**
 * Running late: move an arena's times by the minutes the organiser types (a minus for earlier). Opened from the
 * pencil in the timetable's header; the move goes live as soon as Shift is tapped. There is no Pause, but a
 * timetable paused before can be set going again from here.
 */
export function DelaySheet({ arena, lateMinutes, paused, busy, pace, onShift, onContinue, onClose }: {
  /** The arena being changed, or empty for every arena. */
  arena: string;
  lateMinutes: number;
  paused: boolean;
  busy: boolean;
  /** Recent minutes per race, when there are enough races to say. */
  pace: number | null;
  onShift: (minutes: number) => Promise<boolean>;
  onContinue: () => void;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  return (
    <Sheet
      title={arena ? `${arena} timing` : 'Timing'}
      description={lateMinutes > 0 ? `Running ${delayInWords(lateMinutes)} late` : 'Running on time'}
      initialFocus="input"
      onClose={onClose}
    >
      {({ close }) => {
        async function shift(event: FormEvent) {
          event.preventDefault();
          const parsed = Number(minutes);
          if (!Number.isInteger(parsed) || parsed === 0 || parsed < -720 || parsed > 720) {
            setError('Enter a whole number of minutes from -720 to 720, but not 0.');
            return;
          }
          setError(null);
          // The page's own notice sits behind the sheet, so a failure is said here too.
          if (await onShift(parsed)) close();
          else setError('Couldn’t move the times. Check your signal and try again.');
        }
        return (
          <form className="tt-delay-form" noValidate onSubmit={(event) => void shift(event)}>
            <div className="tt-delay-row">
              <label htmlFor={fieldId}>Move times by</label>
              <input
                id={fieldId}
                type="number"
                inputMode="numeric"
                min={-720}
                max={720}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="0"
                aria-describedby={`${fieldId}-hint`}
                className="tt-delay-input"
              />
              <span aria-hidden="true">min</span>
            </div>
            <p id={`${fieldId}-hint`} className="sp-note">A minus moves them earlier, for example −10.</p>
            {error && <p className="tt-delay-error" role="alert">{error}</p>}
            {pace != null && <p className="sp-note">Races are taking about {pace.toFixed(1)} minutes each.</p>}
            <div className="kit-acts">
              <button type="submit" className="kit-pill kit-pill-fill" disabled={busy || !minutes.trim()}>Shift</button>
              {paused && <button type="button" className="kit-pill" disabled={busy} onClick={onContinue}>Continue the timetable</button>}
            </div>
          </form>
        );
      }}
    </Sheet>
  );
}
