import { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronLeft, Lock, Unlock, Menu, RotateCw } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { RememberCompetitionDialog } from '../competition/RememberCompetitionDialog';
import { competitionDateText } from '../lib/competitionDates';
import { competitionIdFromPath, hasGlobalTabs } from '../lib/routes';
import { PageLoadBoundary } from './PageLoadBoundary';
import { NavigationDrawer } from './NavigationDrawer';
import { TopBarTicker } from './TopBarTicker';
import { ConnectionPill } from './ConnectionPill';
import { BottomTabs } from './BottomTabs';
import { GlobalTabs } from './GlobalTabs';
import { useCompetitionMeta } from './competitionMeta';
import { PageSkeleton } from './Skeletons';
import { useCompactPageBarState } from './CompactPageBarContext';
import './compact-page-bar.css';
import { TrainerAccountNotice } from './TrainerAccountNotice';
import { LiteChip } from '../lite/LiteChip';
import { initialsOf } from '../lib/profile';
import { useNeedsYou } from '../pages/profile/needsYou';

export function AppShell() {
  const { user, hasRole, editorMode, setEditorMode, canOrganise } = useAuth();
  const { current, rememberChoice, storageError } = useCurrentCompetition();
  const { meta } = useCompetitionMeta();
  const { config: compactBar, header: pageHeader } = useCompactPageBarState();
  const [menuOpen, setMenuOpen] = useState(false);
  // The Lite mode chip opens the menu with its settings showing.
  const [menuShowsSettings, setMenuShowsSettings] = useState(false);
  const openMenu = () => { setMenuShowsSettings(false); setMenuOpen(true); };
  const openLiteSettings = () => { setMenuShowsSettings(true); setMenuOpen(true); };
  const location = useLocation();
  const { count: needsYou } = useNeedsYou();
  const onProfile = location.pathname === '/me' || location.pathname === '/me/';
  const choosingCompetition = ['/', '/events', '/competitions', '/competitions/past'].includes(location.pathname);
  const competitionId = competitionIdFromPath(location.pathname);
  // Public pages get the EGUK look; signed-in tools (dashboard, teams, admin) keep their own.
  const globalTabs = hasGlobalTabs(location.pathname);
  const publicPage = choosingCompetition || competitionId != null || onProfile || globalTabs || location.pathname === '/me/members';
  // The tabs belong to a competition. The profile borrows the one being followed, if any.
  const tabsCompetitionId = competitionId ?? (onProfile ? current?.id ?? null : null);
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
          {compactBar ? (
            <div className="mg-compact-bar mx-auto max-w-5xl">
              <Link to={compactBar.backTo} className="mg-nav-btn !px-0" aria-label="Back to timetable"><ChevronLeft className="h-5 w-5" /></Link>
              <div className="mg-compact-copy">
                <span className="mg-compact-title">{compactBar.title}</span>
                <span className="mg-compact-subtitle">{compactBar.subtitle}</span>
              </div>
              <ConnectionPill fallback={
                <span className={`mg-badge ${compactBar.badge === 'live' ? 'mg-badge-live' : compactBar.badge === 'finished' ? 'mg-compact-finished' : 'mg-badge-soft'}`}>
                  {compactBar.badge === 'live' ? 'On now' : compactBar.badge === 'finished' ? 'Finished' : 'Next'}
                </span>
              } />
              <LiteChip onOpen={openLiteSettings} short />
              {hasRole('Admin') && (
                <button onClick={() => setEditorMode(!editorMode)} className="mg-nav-btn" aria-label={editorMode ? 'Switch to view mode' : 'Switch to edit mode'} aria-pressed={editorMode}>
                  {editorMode ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                </button>
              )}
              <button onClick={openMenu} className="mg-nav-btn !px-0" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-5 w-5" /></button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-5xl items-center gap-2.5 py-3 pl-4 pr-3">
              {pageHeader?.backTo
                ? <Link to={pageHeader.backTo} className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center text-white" aria-label={pageHeader.backLabel ?? 'Back'}><ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.25} /></Link>
                : <Link to="/events" className="mg-logo" aria-label="Mounted Games home">MG</Link>}
              {pageHeader?.plain ? (
                <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5">
                  <h1 className="mg-display truncate text-[22px] font-bold leading-none">{pageHeader.title}</h1>
                  {pageHeader.subtitle && <span className="mg-header-sub truncate text-[13px] leading-tight">{pageHeader.subtitle}</span>}
                </div>
              ) : pageHeader ? (
                <Link to="/events" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left !text-inherit !no-underline">
                  <span className="mg-display truncate text-[22px] font-bold leading-none">{pageHeader.title}</span>
                  <span className="mg-header-sub flex items-center gap-1 text-[13px] leading-tight">
                    <span className="truncate">{pageHeader.subtitle ?? title ?? 'Mounted Games'}</span>
                    <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
                  </span>
                  <span className="sr-only">. Change competition</span>
                </Link>
              ) : title ? (
                <Link to="/events" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left !text-inherit !no-underline">
                  <span className="mg-display truncate text-lg font-bold leading-tight">{title}</span>
                  {subtitle && <span className="mg-header-sub truncate text-[13px] leading-tight">{subtitle}</span>}
                  <span className="sr-only">. Change competition</span>
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-base font-semibold">Mounted Games</span>
              )}
              {pageHeader?.refresh && <button type="button" onClick={pageHeader.refresh} className="mg-nav-btn !px-0" aria-label={pageHeader.refreshLabel ?? 'Refresh'}><RotateCw className="h-[18px] w-[18px]" /></button>}
              <ConnectionPill />
              {!user && choosingCompetition && <Link to="/login" className="mg-nav-btn">Sign in</Link>}
              <LiteChip onOpen={openLiteSettings} />
              {hasRole('Admin') && (
                <button onClick={() => setEditorMode(!editorMode)} className="mg-nav-btn" aria-label={editorMode ? 'Switch to view mode' : 'Switch to edit mode'} aria-pressed={editorMode}>
                  {editorMode ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                </button>
              )}
              <button onClick={openMenu} className="mg-nav-btn !px-0" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-5 w-5" /></button>
            </div>
          )}
        </header>
        {competitionId != null && <TopBarTicker />}
      </div>
      <main className={publicPage
        ? `skin mx-auto w-full max-w-5xl flex-1 px-4 ${/\/competitions\/\d+\/chat\/?$/.test(location.pathname) ? 'pb-0' : tabsCompetitionId != null || globalTabs ? 'pb-28' : 'pb-10'}`
        : 'mx-auto w-full max-w-5xl flex-1 px-3 py-3 sm:px-4 sm:py-5'}>
        {storageError && <p role="status" className={publicPage ? 'mg-notice mt-4' : 'mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900'}>{storageError}</p>}
        <TrainerAccountNotice />
        <PageLoadBoundary page={location.pathname}>
          <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
        </PageLoadBoundary>
      </main>
      {globalTabs && <GlobalTabs meCount={user ? needsYou : 0} />}
      {tabsCompetitionId != null && <BottomTabs competitionId={tabsCompetitionId} entryOnly={meta?.id === tabsCompetitionId && !!meta.entryPhase && !canOrganise({ id: meta.id, createdByUserId: meta.createdByUserId })} me={user ? { initials: initialsOf(user.fullName, user.email), count: needsYou } : undefined} />}
      {menuOpen && <NavigationDrawer settingsOpen={menuShowsSettings} onClose={() => setMenuOpen(false)} />}
      {current && !choosingCompetition && rememberChoice === 'ask' && !menuOpen && <RememberCompetitionDialog />}
    </div>
  );
}
