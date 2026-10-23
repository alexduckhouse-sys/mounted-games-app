import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TERMS_PLACEHOLDER, TERMS_PLACEHOLDER_LABEL } from '../../../lib/termsTick';

/** The organiser's terms and conditions, read before the dec form is agreed. Plain text, never HTML. */
export function TermsDialog({ termsText, onClose }: { termsText?: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const terms = termsText?.trim() ?? '';
  return (
    <dialog ref={ref} aria-labelledby="dec-terms-title" onCancel={onClose}
      className="mg-font m-auto w-[calc(100%-32px)] max-w-xl rounded-2xl bg-[rgb(var(--mg-surface))] p-5 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.55)]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 id="dec-terms-title" className="mg-display flex-1 text-2xl font-bold leading-tight text-[rgb(var(--mg-heading))]">Terms and conditions</h2>
          <button type="button" className="mg-icon-btn" aria-label="Close" onClick={onClose}><X aria-hidden="true" className="h-[18px] w-[18px]" /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto text-[15px] leading-snug">
          {terms ? (
            <p className="m-0 whitespace-pre-wrap break-words">{terms}</p>
          ) : (
            <p className="m-0"><strong>{TERMS_PLACEHOLDER_LABEL}.</strong> {TERMS_PLACEHOLDER}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
