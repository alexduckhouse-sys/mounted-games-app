import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, Menu, Pencil, RotateCw } from 'lucide-react';
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
import { TickerFeed } from './TickerFeed';
import { useOptionalTicker } from './TickerContext';
import { WeatherLine } from './WeatherLine';
import { ConnectionPill } from './ConnectionPill';
import { BottomTabs } from './BottomTabs';
import { GlobalTabs } from './GlobalTabs';
import { useCompetitionMeta } from './competitionMeta';
import { PageSkeleton } from './Skeletons';
import { InAppShell, useCompactPageBarState } from './CompactPageBarContext';
import './compact-page-bar.css';
import { TrainerAccountNotice } from './TrainerAccountNotice';
import { InstallCard } from './InstallCard';
import { LiteChip } from '../lite/LiteChip';
import { initialsOf } from '../lib/profile';
import { useNeedsYou } from '../pages/profile/needsYou';
import { PageTransition } from './PageTransition';
import { BackLink } from './BackLink';
import { useT } from '../i18n/LanguageContext';
import { ScreenChromeProvider, useChromeHidden } from './ScreenChrome';

/** Pages with no news line in the dock: the legal tabs, unsubscribe, settings and seasons (their own dock button still shows). */
const QUIET_TICKER_PATHS = /^\/(privacy|terms|refunds|cookies|safeguarding|data-deletion|unsubscribe|settings|seasons(\/[^/]+)?)\/?$/;

export function AppShell() {
  return <ScreenChromeProvider><PageWidthProvider>{(width) => <Shell width={width} />}</PageWidthProvider></ScreenChromeProvider>;
}

function Shell({ width }: { width: PageWidth }) {
  const t = useT();
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
  // The full-screen scoring screen asks for no app header and no ticker dock (it has its own back button and fits one screen).
  const chromeHidden = useChromeHidden();
  const onLiveFeed = /\/competitions\/\d+\/chat\/?$/.test(location.pathname);
  // No ticker over a message composer, or behind the creator wizard's Back / Next footer.
  const noTicker = /^\/competitions\/\d+\/(contact|announcements|messages\/[^/]+)\/?$/.test(location.pathname)
    || /^\/admin\/competitions\/(new|\d+(\/format)?)\/?$/.test(location.pathname);
  // The ticker docks above the tab bar on every page but filming. An event's own pages feed it; elsewhere it follows
  // the event last opened, and it only shows when there is news (or a page button such as the timetable's filters).
  const ticker = useOptionalTicker();
  // Legal pages, unsubscribe, settings and seasons are quiet: no news line over them, only a page's own dock button.
  const quietTicker = QUIET_TICKER_PATHS.test(location.pathname) || ticker?.quiet === true;
  const feedCompetitionId = !filmingMode && competitionId == null && ticker ? current?.id ?? null : null;
  const dockShown = !filmingMode && !chromeHidden && !noTicker && ticker != null
    && (ticker.dockAction != null || (!quietTicker && current != null && (ticker.items.length > 0 || ticker.watchCompetitionId != null)));
  // Public pages get the EGUK look; signed-in tools (dashboard, teams, admin) keep their own.
  const globalTabs = hasGlobalTabs(location.pathname);
  const publicPage = choosingCompetition || competitionId != null || onProfile || globalTabs || location.pathname === '/me/members' || location.pathname === '/settings';
  // The tabs belong to a competition. The profile borrows the one being followed, if any.
  const tabsCompetitionId = competitionId ?? (onProfile ? current?.id ?? null : null);
  const hasTabs = !filmingMode && (globalTabs || tabsCompetitionId != null);
  const shown = meta && meta.id === competitionId ? meta : null;
  const title = shown?.name ?? (current && current.id === competitionId ? current.name : null);
  const subtitle = shown ? [competitionDateText(shown.startDate, shown.endDate), shown.location?.trim()].filter(Boolean).join(' · ') : '';

  // Sticky bits further down the page sit under the header, whatever its height.
  const barRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
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
  }, [filmingMode, chromeHidden]);

  return (
    <div className="min-h-screen flex flex-col">
      {!filmingMode && !chromeHidden && (
      <div ref={barRef} className="sticky top-0 z-30">
        <header className="mg-header">
          {compactBar ? (
            <div className={`mg-compact-bar mx-auto ${cap}`}>
              <BackLink to={compactBar.backTo} className="mg-nav-btn !px-0" aria-label={compactBar.backLabel ?? t('shell.header.backToTimetable')}><ChevronLeft className="h-5 w-5" /></BackLink>
              <div className="mg-compact-copy">
                <span className="mg-compact-title">{compactBar.title}</span>
                <span className="mg-compact-subtitle">{compactBar.subtitle}</span>
              </div>
              <ConnectionPill fallback={
                <span className={`mg-badge ${compactBar.badge === 'live' ? 'mg-badge-live' : compactBar.badge === 'finished' ? 'mg-compact-finished' : 'mg-badge-soft'}`}>
                  {compactBar.badge === 'live' ? t('shell.header.onNow') : compactBar.badge === 'finished' ? t('common.finished') : t('shell.header.next')}
                </span>
              } />
              <LiteChip onOpen={openLiteSettings} />
              <button onClick={openMenu} className="mg-nav-btn !px-0" aria-label={t('shell.header.openMenu')} aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-5 w-5" /></button>
            </div>
          ) : (
            <div className={`mx-auto flex ${cap} items-center gap-2.5 py-1.5 pl-4 pr-3 sm:py-3`}>
              {pageHeader?.backTo
                ? <BackLink to={pageHeader.backTo} className="mg-nav-btn !px-0" aria-label={pageHeader.backLabel ?? t('shell.header.back')}><ChevronLeft className="h-5 w-5" /></BackLink>
                : <Link to={inAdminArea ? '/admin' : '/events'} className="mg-logo" aria-label={inAdminArea ? t('shell.header.adminHome') : t('shell.header.home')}>MG</Link>}
              {pageHeader?.plain ? (
                <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5">
                  <h1 className="mg-display truncate text-[22px] font-bold leading-none">{pageHeader.title}</h1>
                  {pageHeader.subtitle && <span className="mg-header-sub truncate text-[13px] leading-tight">{pageHeader.subtitle}</span>}
                </div>
              ) : pageHeader ? (
                <Link to="/events" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left !text-inherit !no-underline">
                  <span className="mg-display truncate text-[22px] font-bold leading-none">{pageHeader.title}</span>
                  <span className="mg-header-sub flex items-center gap-1 text-[13px] leading-tight">
                    <span className="truncate">{pageHeader.subtitle ?? title ?? t('common.mountedGames')}</span>
                    <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
                  </span>
                  <span className="sr-only">{t('shell.header.events')}</span>
                </Link>
              ) : title ? (
                <Link to="/events" className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left !text-inherit !no-underline">
                  <span className="mg-display truncate text-lg font-bold leading-tight">{title}</span>
                  {subtitle && <span className="mg-header-sub truncate text-[13px] leading-tight">{subtitle}</span>}
                  <span className="sr-only">{t('shell.header.events')}</span>
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate text-base font-semibold">{t('common.mountedGames')}</span>
              )}
              {pageHeader?.refresh && <RefreshButton onRefresh={pageHeader.refresh} label={pageHeader.refreshLabel ?? t('shell.header.refresh')} />}
              {pageHeader?.edit && <button type="button" onClick={pageHeader.edit} className="mg-nav-btn !px-0" aria-label={pageHeader.editLabel ?? 'Edit'} aria-pressed={!!pageHeader.editing}><Pencil className="h-[18px] w-[18px]" /></button>}
              <ConnectionPill />
              {!user && choosingCompetition && <Link to="/login" className="mg-nav-btn">{t('common.signIn')}</Link>}
              <LiteChip onOpen={openLiteSettings} />
              <button onClick={openMenu} className="mg-nav-btn !px-0" aria-label={t('shell.header.openMenu')} aria-haspopup="dialog" aria-expanded={menuOpen}><Menu className="h-5 w-5" /></button>
            </div>
          )}
        </header>
        {competitionId != null && <WeatherLine />}
      </div>
      )}
      <main ref={mainRef} className={publicPage
        ? `skin mx-auto w-full ${cap} flex-1 px-4 ${filmingMode ? 'pb-0' : onLiveFeed ? (dockShown ? 'pb-14' : 'pb-0') : dockShown ? (hasTabs ? 'pb-44' : 'pb-24') : hasTabs ? 'pb-28' : 'pb-10'}`
        : `skin mx-auto w-full ${cap} flex-1 px-4 pt-3 sm:pt-5 ${dockShown ? (hasTabs ? 'pb-44' : 'pb-24') : 'pb-3 sm:pb-5'}`}>
        {storageError && <Notice role="status" className={publicPage ? 'mt-4' : 'mb-3'}>{storageError}</Notice>}
        {onProfile && <TrainerAccountNotice />}
        <InstallCard pathname={location.pathname} className={publicPage ? 'mt-4' : 'mb-3'} />
        <PageLoadBoundary page={location.pathname}>
          <InAppShell><Suspense fallback={<PageSkeleton />}><Outlet /></Suspense></InAppShell>
        </PageLoadBoundary>
      </main>
      <PageTransition mainRef={mainRef} disabled={filmingMode} />
      {feedCompetitionId != null && <TickerFeed key={feedCompetitionId} competitionId={feedCompetitionId} />}
      {!filmingMode && !chromeHidden && !noTicker && <TopBarTicker low={!hasTabs} quiet={quietTicker} />}
      {!filmingMode && globalTabs && <GlobalTabs meCount={user ? needsYou : 0} />}
      {!filmingMode && tabsCompetitionId != null && <BottomTabs competitionId={tabsCompetitionId} entryOnly={meta?.id === tabsCompetitionId && !!meta.entryPhase && !canOrganise({ id: meta.id, createdByUserId: meta.createdByUserId })} me={user ? { initials: initialsOf(user.fullName, user.email), count: needsYou } : undefined} />}
      {menuOpen && <NavigationDrawer onClose={() => setMenuOpen(false)} />}
      {current && !choosingCompetition && rememberChoice === 'ask' && !menuOpen && <RememberCompetitionDialog />}
    </div>
  );
}

/** The header's refresh button. The icon turns for a moment after a tap so you can see it took (the data often hasn't changed). */
function RefreshButton({ onRefresh, label }: { onRefresh: () => void; label: string }) {
  const [spinning, setSpinning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const tap = () => {
    onRefresh();
    setSpinning(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSpinning(false), 900);
  };
  return <button type="button" onClick={tap} className="mg-nav-btn !px-0" aria-label={label}><RotateCw className={`h-[18px] w-[18px]${spinning ? ' mg-spin-once' : ''}`} /></button>;
}
