import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useT } from '../../i18n/LanguageContext';

/** The slim header and single column shared by the sign in and sign up screens. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="skin flex min-h-screen flex-col">
      <header className="mg-header">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 py-3 pl-4 pr-3">
          <Link to="/" className="mg-logo" aria-label={t('auth.frame.home')}>MG</Link>
          <span className="mg-display min-w-0 flex-1 truncate text-lg font-bold">Mounted Games</span>
          <Link to="/" className="mg-nav-btn !px-0" aria-label={t('common.close')}><X aria-hidden="true" className="h-5 w-5" /></Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-6 pt-7">{children}</main>
    </div>
  );
}
