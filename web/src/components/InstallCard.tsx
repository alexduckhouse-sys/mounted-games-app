import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { countVisit, dismissNudge, nudgeAllowedOn, nudgeDismissed, NUDGE_FROM_VISIT } from '../lib/installNudge';
import { useT } from '../i18n/LanguageContext';
import { InstallAppSheet } from './InstallAppSheet';
import { Notice } from './Notice';

/**
 * A small card at the top of the page suggesting the app goes on the Home Screen. Phones only, from the third
 * visit, never once installed, and not on kiosks, camera, scoring or message pages. The cross puts it away for good;
 * Settings keeps an Install row.
 */
export function InstallCard({ pathname, className = '' }: { pathname: string; className?: string }) {
  const t = useT();
  const { way, phone } = usePwaInstall();
  // Counting is idempotent within a browser session, so it is safe in the initialiser (StrictMode runs it twice).
  const [visit] = useState(countVisit);
  const [dismissed, setDismissed] = useState(nudgeDismissed);
  const [open, setOpen] = useState(false);

  const offered = way === 'prompt' || way === 'ios-safari' || way === 'ios-other';
  if (!open && (!phone || !offered || dismissed || visit < NUDGE_FROM_VISIT || !nudgeAllowedOn(pathname))) return null;

  function putAway() {
    dismissNudge();
    setDismissed(true);
  }

  return (
    <>
      {!dismissed && way !== 'installed' && (
        <Notice tone="info" icon={Smartphone} role={null} className={className}
          actionLabel={t('shell.install.showMe')} onAction={() => setOpen(true)} onDismiss={putAway} dismissLabel={t('shell.install.dontShow')}>
          {way === 'prompt' ? t('shell.install.cardPrompt') : t('shell.install.cardIos')}
        </Notice>
      )}
      {open && <InstallAppSheet onClose={() => setOpen(false)} />}
    </>
  );
}
