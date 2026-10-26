import { Sheet } from '../../../components/Sheet';
import { TERMS_PLACEHOLDER, TERMS_PLACEHOLDER_LABEL } from '../../../lib/termsTick';

/** The organiser's terms and conditions, read before the dec form is agreed. Plain text, never HTML. */
export function TermsDialog({ termsText, onClose }: { termsText?: string | null; onClose: () => void }) {
  const terms = termsText?.trim() ?? '';
  return (
    <Sheet title="Terms and conditions" description="The organiser’s terms for this competition." onClose={onClose}>
      {({ close }) => (
        <>
          <div className="kit-sheet-text max-h-[50dvh] overflow-y-auto" data-no-swipe>
            {terms ? (
              <p className="m-0 whitespace-pre-wrap break-words">{terms}</p>
            ) : (
              <p className="m-0"><strong>{TERMS_PLACEHOLDER_LABEL}.</strong> {TERMS_PLACEHOLDER}</p>
            )}
          </div>
          <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" onClick={() => close()}>Close</button></div>
        </>
      )}
    </Sheet>
  );
}
