import { useCurrentCompetition } from './CurrentCompetitionContext';
import { Sheet } from '../components/Sheet';

/** Bottom sheet asking whether to keep this competition for next time (a cookie) or just for this visit. */
export function RememberCompetitionDialog() {
  const { current, setRememberChoice } = useCurrentCompetition();
  return (
    <Sheet
      title="Remember this competition?"
      description={`We’ll save a cookie on this phone for six months, so ${current?.name ?? 'it'} opens straight away next time. You can change this in Settings.`}
      onClose={() => setRememberChoice('visit')}
      initialFocus="[data-remember]"
    >
      {({ close }) => (
        <>
          <div className="kit-acts">
            <button type="button" data-remember className="kit-pill kit-pill-fill" onClick={() => close(() => setRememberChoice('remember'))}>Remember</button>
            <button type="button" className="kit-pill" onClick={() => close(() => setRememberChoice('visit'))}>No thanks</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
