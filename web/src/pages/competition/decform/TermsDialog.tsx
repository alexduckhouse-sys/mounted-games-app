import { Sheet } from '../../../components/Sheet';
import { useT } from '../../../i18n/LanguageContext';

/** The organiser's terms and conditions, read before the dec form is agreed. Plain text, never HTML. */
export function TermsDialog({ termsText, onClose }: { termsText?: string | null; onClose: () => void }) {
  const t = useT();
  const terms = termsText?.trim() ?? '';
  return (
    <Sheet title={t('entries.terms.title')} description={t('entries.terms.description')} onClose={onClose}>
      {({ close }) => (
        <>
          <div className="kit-sheet-text max-h-[50dvh] overflow-y-auto" data-no-swipe>
            {terms ? (
              <p className="m-0 whitespace-pre-wrap break-words">{terms}</p>
            ) : (
              <p className="m-0"><strong>{t('entries.terms.placeholderLabel')}.</strong> {t('entries.terms.placeholder')}</p>
            )}
          </div>
          <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" onClick={() => close()}>{t('common.close')}</button></div>
        </>
      )}
    </Sheet>
  );
}
