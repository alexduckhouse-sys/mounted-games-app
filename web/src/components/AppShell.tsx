import { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, Menu, RotateCw } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { RememberCompetitionDialog } from '../competition/RememberCompetitionDialog';
import { competitionDateText } from '../lib/competitionDates';
import { competitionIdFromPath, hasGlobalTabs } from '../lib/routes';
import { PageWidthProvider } from './PageWidth';
import { PAGE_WIDTH_CLASS, type PageWidth } from './pageWidthState';
import { Notice } from './Notice';
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
import { usePageFade } from '../hooks/usePageFade';

export function AppShell() {
  return <PageWidthProvider>{(width) => <Shell width={width} />}</PageWidthProvider>;
}

function Shell({ width }: { width: PageWidth }) {
  const cap = PAGE_WIDTH_CLASS[width];
  const { user, canOrganise, hasRole } = useAuth();
  const { current, rememberChoice, storageError } = useCurrentCompetition();
  const { meta } = useCompetitionMeta();
  const { config: compactBar, header: pageHeader } = useCompactPageBarState();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const openMenu = () => setMenuOpen(true);
  const openLiteSettings = () => navigate('/settings#lite-mode');
  const location = useLocation();
  const { count: needsYou } = useNeedsYou();
  // On the site admin pages an admin's MG logo goes to the site admin dashboard rather than the events list.
  const inAdminArea = hasRole('Admin') && /^\/admin(\/(competitions|trainer-requests|rules))?\/?$/.test(location.pathname);
  const onProfile = location.pathname === '/me' || location.pathname === '/me/';
  const choosingCompetition = ['/', '/events', '/competitions', '/competitions/past'].includes(location.pathname);
  const competitionId = competitionIdFromPath(location.pathname);
  const filmingMode = /\/competitions\/\d+\/broadcast\/?$/.test(location.pathname);
  // Public pages get the EGUK look; signed-in tools (dashboard, teams, admin) keep their own.
  const globalTabs = hasGlobalTabs(location.pathname);
  const publicPage = choosingCompetition || competitionId != null || onProfile || globalTabs || location.pathname === '/me/members' || location.pathname === '/settings';
  // The tabs belong to a competition. The profile borrows the one being followed, if any.
  const tabsCompetitionId = competitionId ?? (onProfile ? current?.id ?? null : null);
  const shown = meta && meta.id === competitionId ? meta : null;
  const title = shown?.name ?? (current && current.id === competitionId ? current.name : null);
  const subtitle = shown ? [competitionDateText(shown.startDate, shown.endDate), shown.location?.trim()].filter(Boolean).join(' · ') : '';

  // Sticky bits further down the page sit under the header, whatever its height.
  const barRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  usePageFade(mainRef, location.pathname);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      document.documentElement.style.setProperty('--mg-shell-h', '0px');
      return;
    }
    const publish = () => document.documentElement.style.setProperty('--mg-shell-h', `${bar.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => observer?.disconnect();
  }, [filmingMode]);

  return (
    <div className="min-h-screen flex flex-col">
      {!filmingMode && (
      <div ref={barRef} className="sticky top-0 z-30">
        <header className="mg-header">
          {compactBar ? (
            <div className={`mg-compact-bar mx-auto ${cap}`}>
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
              <LiteChip onOpen={openLiteSettings} />
              <button onClick={openMenu} className="mg-nav-btn !px-0" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-5 w-5" /></button>
            </div>
          ) : (
            <div className={`mx-auto flex ${cap} items-center gap-2.5 py-3 pl-4 pr-3`}>
              {pageHeader?.backTo
                ? <Link to={pageHeader.backTo} className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center text-white" aria-label={pageHeader.backLabel ?? 'Back'}><ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.25} /></Link>
                : <Link to={inAdminArea ? '/admin' : '/events'} className="mg-logo" aria-label={inAdminArea ? 'Site admin home' : 'Mounted Games home'}>MG</Link>}
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
                  <span className="sr-only">. Events</span>
                </Link>
              ) : title ? (
                <Link to="/events" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left !text-inherit !no-underline">
                  <span className="mg-display truncate text-lg font-bold leading-tight">{title}</span>
                  {subtitle && <span className="mg-header-sub truncate text-[13px] leading-tight">{subtitle}</span>}
                  <span className="sr-only">. Events</span>
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-base font-semibold">Mounted Games</span>
              )}
              {pageHeader?.refresh && <button type="button" onClick={pageHeader.refresh} className="mg-nav-btn !px-0" aria-label={pageHeader.refreshLabel ?? 'Refresh'}><RotateCw className="h-[18px] w-[18px]" /></button>}
              <ConnectionPill />
              {!user && choosingCompetition && <Link to="/login" className="mg-nav-btn">Sign in</Link>}
              <LiteChip onOpen={openLiteSettings} />
              <button onClick={openMenu} className="mg-nav-btn !px-0" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-5 w-5" /></button>
            </div>
          )}
        </header>
        {competitionId != null && <TopBarTicker />}
      </div>
      )}
      <main ref={mainRef} className={publicPage
        ? `skin mx-auto w-full ${cap} flex-1 px-4 ${filmingMode || /\/competitions\/\d+\/chat\/?$/.test(location.pathname) ? 'pb-0' : tabsCompetitionId != null || globalTabs ? 'pb-28' : 'pb-10'}`
        : `skin mx-auto w-full ${cap} flex-1 px-4 py-3 sm:py-5`}>
        {storageError && <Notice role="status" className={publicPage ? 'mt-4' : 'mb-3'}>{storageError}</Notice>}
        {onProfile && <TrainerAccountNotice />}
        <PageLoadBoundary page={location.pathname}>
          <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
        </PageLoadBoundary>
      </main>
      {!filmingMode && globalTabs && <GlobalTabs meCount={user ? needsYou : 0} />}
      {!filmingMode && tabsCompetitionId != null && <BottomTabs competitionId={tabsCompetitionId} entryOnly={meta?.id === tabsCompetitionId && !!meta.entryPhase && !canOrganise({ id: meta.id, createdByUserId: meta.createdByUserId })} me={user ? { initials: initialsOf(user.fullName, user.email), count: needsYou } : undefined} />}
      {menuOpen && <NavigationDrawer onClose={() => setMenuOpen(false)} />}
      {current && !choosingCompetition && rememberChoice === 'ask' && !menuOpen && <RememberCompetitionDialog />}
    </div>
  );
}
