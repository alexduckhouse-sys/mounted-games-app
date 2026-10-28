import { useT } from '../../../i18n/LanguageContext';
import { DecFormConfigEditor } from '../DecFormConfig';
import { StepHeading } from './controls';

/**
 * What the dec form asks. An existing competition shows the setup editor, which saves on its own. A new one
 * doesn't exist yet, so it explains the starting point: the basics, which can be added to straight after publishing.
 */
export function DecFormStep({ competitionId, canChange }: { competitionId: number | null; canChange: boolean }) {
  const t = useT();
  return (
    <section aria-label={t('admin.creator.step.dec')} className="flex flex-col">
      <StepHeading>{t('admin.creator.step.dec')}</StepHeading>
      {competitionId != null
        ? <div className="mt-3"><DecFormConfigEditor competitionId={competitionId} readOnly={!canChange} /></div>
        : (
          <div className="cw-card mt-3">
            <div className="cw-panel">
              <p className="cw-t1" style={{ fontWeight: 500 }}>
                {t('admin.creator.dec.basics')}
              </p>
              <p className="cw-t2">
                {t('admin.creator.dec.later')}
              </p>
            </div>
          </div>
        )}
    </section>
  );
}
