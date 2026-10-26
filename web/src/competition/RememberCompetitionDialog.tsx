import { useEffect, useId, useRef, useState } from 'react';
import { useCurrentCompetition } from './CurrentCompetitionContext';
import { useStillMotion } from '../lite/useStillMotion';

/** How long the banner takes to leave once answered (skin.css `.mg-remember.is-closing`). */
const LEAVE_MS = 160;

/**
 * A small banner above the bottom tabs offering to keep this competition for next time (a cookie) or just for this
 * visit. It doesn't block the page: people can carry on and answer whenever they like.
 */
export function RememberCompetitionDialog() {
  const { current, setRememberChoice } = useCurrentCompetition();
  const still = useStillMotion();
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function answer(choice: 'remember' | 'visit') {
    if (still) { setRememberChoice(choice); return; }
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(() => setRememberChoice(choice), LEAVE_MS);
  }

  return (
    <section role="region" aria-labelledby={titleId} className={`mg-remember${closing ? ' is-closing' : ''}`}>
      <div className="mg-remember-copy">
        <h2 id={titleId} className="mg-remember-title">Save quick access on this device?</h2>
        <p className="mg-remember-text">{current?.name ?? 'This competition'} opens straight away next time. We keep a cookie for six months, and you can turn it off in Settings.</p>
      </div>
      <div className="mg-remember-acts">
        <button type="button" className="kit-pill kit-pill-fill" disabled={closing} onClick={() => answer('remember')}>Save</button>
        <button type="button" className="kit-pill" disabled={closing} onClick={() => answer('visit')}>No thanks</button>
      </div>
    </section>
  );
}
