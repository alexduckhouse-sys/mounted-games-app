import { useState, type ReactNode } from 'react';
import { Copy, House, Share, SquarePlus, type LucideIcon } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useT } from '../i18n/LanguageContext';
import { Sheet } from './Sheet';

/** Only used on iOS, where an iPad says iPad or (asking for desktop pages) Macintosh. */
function deviceName(): 'iPhone' | 'iPad' {
  return /iPad|Macintosh/.test(navigator.userAgent) ? 'iPad' : 'iPhone';
}

/** Puts the words between asterisks in bold, so translators can keep the button names inside a sentence. */
function withBold(text: string): ReactNode {
  return text.split('*').map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : part));
}

function Step({ n, icon: Icon, children }: { n: number; icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="mg-install-step">
      <span className="mg-install-n" aria-hidden="true">{n}</span>
      <Icon className="mg-install-icon" aria-hidden="true" strokeWidth={2} />
      <span>{children}</span>
    </li>
  );
}

/**
 * How to put the app on the Home Screen, for whatever this browser is: Chromium gets one Install button for its own
 * prompt; Safari on an iPhone or iPad gets three short steps; other iPhone browsers are sent to Safari. Pass
 * `forNotifications` when it opens from a notification switch, so the reason comes first.
 */
export function InstallAppSheet({ onClose, forNotifications = false }: { onClose: () => void; forNotifications?: boolean }) {
  const t = useT();
  const { way, promptInstall } = usePwaInstall();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const device = deviceName();
  const pushReason = t('shell.install.pushReason', { device });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  }

  if (way === 'ios-safari') {
    return (
      <Sheet title={t('shell.install.addTitle')} onClose={onClose}
        description={forNotifications ? pushReason : t('shell.install.iosIntro', { device })}>
        {({ close }) => (
          <>
            <ol className="mg-install-steps" aria-label={t('shell.install.steps')}>
              <Step n={1} icon={Share}>{withBold(t('shell.install.step1'))}</Step>
              <Step n={2} icon={SquarePlus}>{withBold(t('shell.install.step2'))}</Step>
              <Step n={3} icon={House}>{withBold(t('shell.install.step3'))}</Step>
            </ol>
            {forNotifications && <p className="kit-sheet-text">{t('shell.install.turnOnAgain')}</p>}
            <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" onClick={() => close()}>{t('common.done')}</button></div>
          </>
        )}
      </Sheet>
    );
  }

  if (way === 'ios-other') {
    return (
      <Sheet title={t('shell.install.safariTitle')} onClose={onClose}
        description={`${t('shell.install.safariIntro')}${forNotifications ? ` ${pushReason}` : ''}`}>
        {({ close }) => (
          <>
            <p className="kit-sheet-text">{t('shell.install.safariHow')}</p>
            {copied && <p role="status" className="kit-sheet-text">{copied === 'yes' ? t('shell.install.copied') : t('shell.install.copyFailed')}</p>}
            <div className="kit-acts">
              <button type="button" className="kit-pill kit-pill-fill" onClick={() => { void copyLink(); }}><Copy className="h-4 w-4" aria-hidden="true" />{t('shell.install.copyLink')}</button>
              <button type="button" className="kit-pill" onClick={() => close()}>{t('common.done')}</button>
            </div>
          </>
        )}
      </Sheet>
    );
  }

  if (way === 'prompt') {
    return (
      <Sheet title={t('shell.install.title')} onClose={onClose} description={t('shell.install.promptIntro')}>
        {({ close }) => (
          <div className="kit-acts">
            <button type="button" className="kit-pill kit-pill-fill" onClick={() => { void promptInstall().then(() => close()); }}>{t('shell.install.install')}</button>
            <button type="button" className="kit-pill" onClick={() => close()}>{t('common.notNow')}</button>
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title={way === 'installed' ? t('shell.install.installedTitle') : t('shell.install.title')} onClose={onClose}
      description={way === 'installed' ? t('shell.install.installedText') : t('shell.install.otherText')}>
      {({ close }) => <div className="kit-acts"><button type="button" className="kit-pill kit-pill-fill" onClick={() => close()}>{t('common.done')}</button></div>}
    </Sheet>
  );
}
