import { useEffect, useId, useRef, useState } from 'react';
import { useCurrentCompetition } from './CurrentCompetitionContext';
import { useStillMotion } from '../lite/useStillMotion';
import { useT } from '../i18n/LanguageContext';
import { useSwipeToClose } from '../hooks/useSwipeToClose';

/** How long the banner takes to leave once answered (skin.css `.mg-remember.is-closing`). */
const LEAVE_MS = 200;

/**
 * A small banner above the bottom tabs offering to keep this competition for next time (a cookie) or just for this
 * visit. It doesn't block the page: people can carry on and answer whenever they like. Swiping it down counts as
 * "just this visit".
 */
export function RememberCompetitionDialog() {
  const t = useT();
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
  const { ref, handlers, style, dragging } = useSwipeToClose<HTMLElement>(() => answer('visit'), !closing);

  return (
    <section ref={ref} role="region" aria-labelledby={titleId} {...handlers} style={style} className={`mg-remember${dragging ? ' is-dragging' : ''}${closing ? ' is-closing' : ''}`}>
      <div className="mg-remember-copy">
        <h2 id={titleId} className="mg-remember-title">{t('shell.remember.title')}</h2>
        <p className="mg-remember-text">{t('shell.remember.text', { name: current?.name ?? t('shell.remember.thisCompetition') })}</p>
      </div>
      <div className="mg-remember-acts">
        <button type="button" className="kit-pill kit-pill-fill" disabled={closing} onClick={() => answer('remember')}>{t('shell.remember.save')}</button>
        <button type="button" className="kit-pill" disabled={closing} onClick={() => answer('visit')}>{t('shell.remember.decline')}</button>
      </div>
    </section>
  );
}
