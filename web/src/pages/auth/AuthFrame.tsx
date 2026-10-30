import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { BackLink } from '../../components/BackLink';
import { useT } from '../../i18n/LanguageContext';

/** The slim header and single column shared by the sign in and sign up screens. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const t = useT();
  // The close button keeps its 44px target and focus ring (from .mg-header) but rests without a border.
  // Where they came from: the page that sent them here, else the page before in the app, else home.
  const from = (useLocation().state as { from?: string } | null)?.from;
  return (
    <div className="skin flex min-h-screen flex-col">
      <header className="mg-header">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 py-3 pl-4 pr-3">
          <Link to="/" className="mg-logo" aria-label={t('auth.frame.home')}>MG</Link>
          <span className="mg-display min-w-0 flex-1 truncate text-lg font-bold">Mounted Games</span>
          {from
            ? <Link to={from} className="mg-nav-btn !border-transparent !px-0" aria-label={t('common.close')}><X aria-hidden="true" className="h-5 w-5" /></Link>
            : <BackLink to="/" className="mg-nav-btn !border-transparent !px-0" aria-label={t('common.close')}><X aria-hidden="true" className="h-5 w-5" /></BackLink>}
        </div>
      </header>
      <main className="mg-swap mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7">{children}</main>
    </div>
  );
}
