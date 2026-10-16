import { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Lock, Unlock, Menu } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { CompetitionPickerDialog } from '../competition/CompetitionPicker';
import { RememberCompetitionDialog } from '../competition/RememberCompetitionDialog';
import { competitionDateText } from '../lib/competitionDates';
import { competitionIdFromPath } from '../lib/routes';
import { PageLoadBoundary } from './PageLoadBoundary';
import { NavigationDrawer } from './NavigationDrawer';
import { TopBarTicker } from './TopBarTicker';
import { BottomTabs } from './BottomTabs';
import { useCompetitionMeta } from './competitionMeta';
import { PageSkeleton } from './Skeletons';
import { TrainerAccountNotice } from './TrainerAccountNotice';

export function AppShell() {
  const { user, hasRole, editorMode, setEditorMode } = useAuth();
  const { current, rememberChoice, storageError } = useCurrentCompetition();
  const { meta } = useCompetitionMeta();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const choosingCompetition = ['/', '/competitions', '/competitions/past'].includes(location.pathname);
  const competitionId = competitionIdFromPath(location.pathname);
  // Public pages get the EGUK look; signed-in tools (dashboard, teams, admin) keep their own.
  const publicPage = choosingCompetition || competitionId != null || location.pathname === '/chat';
  const shown = meta && meta.id === competitionId ? meta : null;
  const title = shown?.name ?? (current && current.id === competitionId ? current.name : null);
  const subtitle = shown ? [competitionDateText(shown.startDate, shown.endDate), shown.location?.trim()].filter(Boolean).join(' · ') : '';

  // Sticky bits further down the page sit under the header, whatever its height.
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const publish = () => document.documentElement.style.setProperty('--mg-shell-h', `${bar.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => observer?.disconnect();
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <div ref={barRef} className="sticky top-0 z-30">
        <header className="mg-header">
          <div className="mx-auto flex max-w-5xl items-center gap-2.5 py-3 pl-4 pr-3">
            <Link to="/" className="mg-logo" aria-label="Mounted Games home">MG</Link>
            {title ? (
              <button type="button" onClick={() => setPickerOpen(true)} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left">
                <span className="mg-display truncate text-lg font-bold leading-tight">{title}</span>
                {subtitle && <span className="mg-header-sub truncate text-[13px] leading-tight">{subtitle}</span>}
                <span className="sr-only">. Change competition</span>
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate text-base font-semibold">Mounted Games</span>
            )}
            {!user && choosingCompetition && <Link to="/login" className="mg-nav-btn">Sign in</Link>}
            {hasRole('Admin') && (
              <button onClick={() => setEditorMode(!editorMode)} className="mg-nav-btn" aria-label={editorMode ? 'Switch to view mode' : 'Switch to edit mode'} aria-pressed={editorMode}>
                {editorMode ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </button>
            )}
            <button onClick={() => setMenuOpen(true)} className="mg-nav-btn !px-0" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-5 w-5" /></button>
          </div>
        </header>
        {competitionId != null && <TopBarTicker />}
      </div>
      <main className={publicPage
        ? `skin mx-auto w-full max-w-5xl flex-1 px-4 ${competitionId != null ? 'pb-28' : 'pb-10'}`
        : 'mx-auto w-full max-w-5xl flex-1 px-3 py-3 sm:px-4 sm:py-5'}>
        {storageError && <p role="status" className={publicPage ? 'mg-notice mt-4' : 'mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900'}>{storageError}</p>}
        <TrainerAccountNotice />
        <PageLoadBoundary page={location.pathname}>
          <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
        </PageLoadBoundary>
      </main>
      {competitionId != null && <BottomTabs competitionId={competitionId} />}
      {menuOpen && <NavigationDrawer onClose={() => setMenuOpen(false)} onChangeCompetition={() => { setMenuOpen(false); setPickerOpen(true); }} />}
      {pickerOpen && <CompetitionPickerDialog onClose={() => setPickerOpen(false)} />}
      {current && !choosingCompetition && rememberChoice === 'ask' && !pickerOpen && !menuOpen && <RememberCompetitionDialog />}
    </div>
  );
}
