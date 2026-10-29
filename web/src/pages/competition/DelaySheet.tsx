import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '../../components/Sheet';
import { formatDelayDuration } from '../../lib/time';
import { useT } from '../../i18n/LanguageContext';
import '../../components/sitePages.css';

/**
 * Running late: move an arena's times by the minutes the organiser types (a minus for earlier). Opened from the
 * pencil in the timetable's header; the move goes live as soon as Shift is tapped. There is no Pause, but a
 * timetable paused before can be set going again from here. To change the order or add a break, it links to the
 * organiser's Timetable & draw page.
 */
export function DelaySheet({ arena, lateMinutes, paused, busy, pace, rearrangeTo, onShift, onContinue, onClose }: {
  /** The arena being changed, or empty for every arena. */
  arena: string;
  lateMinutes: number;
  paused: boolean;
  busy: boolean;
  /** Recent minutes per race, when there are enough races to say. */
  pace: number | null;
  /** The organiser's Timetable & draw page, where sessions can be dragged into a new order and breaks added. */
  rearrangeTo?: string;
  onShift: (minutes: number) => Promise<boolean>;
  onContinue: () => void;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const t = useT();
  const late = Math.max(0, Math.round(lateMinutes));

  return (
    <Sheet
      title={arena ? t('competition.timetable.delayTitleArena', { arena }) : t('competition.timetable.delayTitle')}
      description={lateMinutes > 0 ? t('competition.timetable.late', { delay: late >= 60 ? formatDelayDuration(late) : t('competition.timetable.minutes', { count: late }) }) : t('competition.timetable.delayOnTime')}
      initialFocus="input"
      onClose={onClose}
    >
      {({ close }) => {
        async function shift(event: FormEvent) {
          event.preventDefault();
          const parsed = Number(minutes);
          if (!Number.isInteger(parsed) || parsed === 0 || parsed < -720 || parsed > 720) {
            setError(t('competition.timetable.delayRange'));
            return;
          }
          setError(null);
          // The page's own notice sits behind the sheet, so a failure is said here too.
          if (await onShift(parsed)) close();
          else setError(t('competition.timetable.delayMoveFailed'));
        }
        return (
          <form className="tt-delay-form" noValidate onSubmit={(event) => void shift(event)}>
            <div className="tt-delay-row">
              <label htmlFor={fieldId}>{t('competition.timetable.delayMoveBy')}</label>
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
              <span aria-hidden="true">{t('competition.timetable.delayUnit')}</span>
            </div>
            <p id={`${fieldId}-hint`} className="sp-note">{t('competition.timetable.delayHint')}</p>
            {error && <p className="tt-delay-error" role="alert">{error}</p>}
            {pace != null && <p className="sp-note">{t('competition.timetable.delayPace', { minutes: pace.toFixed(1) })}</p>}
            <div className="kit-acts">
              <button type="submit" className="kit-pill kit-pill-fill" disabled={busy || !minutes.trim()}>{t('competition.timetable.delayShift')}</button>
              {paused && <button type="button" className="kit-pill" disabled={busy} onClick={onContinue}>{t('competition.timetable.delayContinue')}</button>}
            </div>
            {rearrangeTo && <Link className="ev-text-btn" to={rearrangeTo}>{t('competition.timetable.delayRearrange')}</Link>}
          </form>
        );
      }}
    </Sheet>
  );
}
