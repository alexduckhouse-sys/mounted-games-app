import { Notice } from '../Notice';
import { useT } from '../../i18n/LanguageContext';

/** The replay being cut: progress (blue-grey, with a bar that fills and a way to stop it) or a problem strip when it couldn't be made. */
export function ReplayPreparation({ progress, error, cancel }: { progress: number | null; error: string; cancel: () => void }) {
  const t = useT();
  return <>
    {progress !== null && <Notice tone="info" className="pointer-events-auto" actionLabel={t('teams.stream.cancelPrep')} onAction={cancel}
      extra={<span className="mg-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></span>}>{t('teams.stream.preparing', { percent: Math.round(progress * 100) })}</Notice>}
    {error && <Notice className="pointer-events-auto">{error}</Notice>}
  </>;
}
