import { useEffect, useRef, useState } from 'react';
import { useExitDelay } from '../hooks/useExitDelay';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, X, Settings, History, SlidersHorizontal, CloudSun, Star, ShoppingBag, ChevronRight, ChevronDown, BarChart3, Trophy, QrCode, Users } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLiteMode } from '../lite/LiteModeContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { competitionDateText } from '../lib/competitionDates';
import { initialsOf, roleLabel } from '../lib/profile';
import { useNavExtras } from './NavExtrasContext';
import { WeatherBadge } from './WeatherBadge';
import { useAgeGroups, type AgeGroupLink } from './AgeGroupsContext';
import { useCompetitionMeta } from './competitionMeta';
import { QrPermissionScannerModal } from './QrPermissionScannerModal';

const WEATHER_KEY = 'mg.showWeather';
const itemClass = (active: boolean) => `flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left text-base !no-underline hover:!no-underline ${active
  ? 'bg-[rgb(var(--mg-tint))] font-semibold text-[rgb(var(--mg-heading))]'
  : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`;
const sectionHeading = 'mb-1 px-3 text-lg font-bold leading-tight text-[rgb(var(--mg-heading))]';
const iconClass = (active: boolean) => `h-5 w-5 shrink-0 ${active ? '' : 'text-[rgb(var(--mg-muted))]'}`;

export function NavigationDrawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Closing slides the drawer back out before it is removed; links navigate underneath as it goes.
  const { closing, close } = useExitDelay(onClose);
  const { current } = useCurrentCompetition();
  const { user, hasRole } = useAuth();
  const { extras } = useNavExtras();
  const { meta } = useCompetitionMeta();
  const ageGroups = useAgeGroups();
  const location = useLocation();
  const navigate = useNavigate();
  const { lite } = useLiteMode();
  const [qrOpen, setQrOpen] = useState(false);
  const showWeather = (() => { try { return localStorage.getItem(WEATHER_KEY) === '1'; } catch { return false; } })();
  // The Seasons link goes straight to the season when the followed competition is in one, or the season list otherwise.
  const [seasonLinks, setSeasonLinks] = useState<{ competitionId: number; seasons: { id: string }[] } | null>(null);
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (currentId == null) return;
    let cancelled = false;
    api.get<{ id: string }[]>(`/seasons/for-competition/${currentId}`)
      .then((r) => { if (!cancelled) setSeasonLinks({ competitionId: currentId, seasons: Array.isArray(r.data) ? r.data : [] }); })
      .catch(() => { if (!cancelled) setSeasonLinks({ competitionId: currentId, seasons: [] }); });
    return () => { cancelled = true; };
  }, [currentId]);
  const seasons = currentId != null && seasonLinks?.competitionId === currentId ? seasonLinks.seasons : [];
  const seasonsTo = seasons.length === 1 ? `/seasons/${seasons[0].id}` : '/seasons';
  useEffect(() => {
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = overflow; };
  }, []);
  const base = current ? `/competitions/${current.id}` : '/events';
  const shown = meta && current && meta.id === current.id ? meta : null;
  const subtitle = shown ? [competitionDateText(shown.startDate, shown.endDate), shown.location?.trim()].filter(Boolean).join(' · ') : '';
  const links = [
    ...(current ? [{ to: `${base}/teams`, label: 'Teams', icon: Users, end: true }] : []),
    { to: current ? `${base}/following` : '/following', label: 'Following', icon: Star, end: true },
    { to: current ? `${base}/shop` : '/shop', label: 'Event shop', icon: ShoppingBag, end: true },
  ];
  const weatherRow = (current != null || showWeather) && !lite && (
    <Link to={current ? `${base}/weather` : '/events'} onClick={close} className={`${itemClass(false)} hover:!bg-[rgb(var(--mg-subtle))]`}>
      <CloudSun className={iconClass(false)} /><span className="font-medium text-[rgb(var(--mg-ink))]">Weather</span>{showWeather && <span className="ml-auto"><WeatherBadge /></span>}
    </Link>
  );
  const groupList = current && ageGroups.competitionId === current.id ? ageGroups.groups : [];
  // Account and club links (teams, dec forms, signups, shop, sign out) live on the profile page now.
  const accountLinks = [
    { to: '/admin', label: 'Site admin', icon: Settings, show: hasRole('Admin') },
  ].filter((item) => item.show);
  const onGroupPage = location.pathname === `${base}/scoring` || location.pathname === `${base}/toplists`;
  const selectedSection = onGroupPage ? new URLSearchParams(location.search).get('section') : null;
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }} aria-labelledby="navigation-title" className={`mg-drawer${closing ? ' is-closing' : ''} mg-font fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(88vw,20rem)] max-w-none bg-[rgb(var(--mg-surface))] p-0 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.55)]`}>
      <div className="flex min-h-full flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="mg-header flex items-start gap-2.5 p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {current ? <>
              <h2 id="navigation-title" className="mg-display break-words text-xl font-bold leading-tight">{current.name}</h2>
              {subtitle && <span className="mg-header-sub text-[13px] leading-tight">{subtitle}</span>}
            </> : <h2 id="navigation-title" className="mg-display text-xl font-bold leading-tight">Menu</h2>}
          </div>
          <button autoFocus onClick={close} className="mg-nav-btn !px-0" aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>

        {groupList.length > 0 && <AgeGroupMenu groups={groupList} base={base} selectedSection={selectedSection} onPick={close} />}

        <div className="flex flex-1 flex-col gap-5 p-4">
          {current ? (
            <nav aria-label="This competition" className="flex flex-col">
              <h3 className={sectionHeading}>This competition</h3>
              {weatherRow}
              {links.map((item) => (
                <NavLink key={item.label} to={item.to} end={item.end} onClick={close} className={({ isActive }) => itemClass(isActive)}>
                  {({ isActive }) => <>
                    <item.icon className={iconClass(isActive)} />{item.label}
                  </>}
                </NavLink>
              ))}
            </nav>
          ) : (
            <nav aria-label="Main navigation" className="flex flex-col">
              {weatherRow}
              {links.map((item) => (
                <NavLink key={item.label} to={item.to} end={item.end} onClick={close} className={({ isActive }) => itemClass(isActive && current !== null)}>
                  {({ isActive }) => <>
                    <item.icon className={iconClass(isActive && current !== null)} />{item.label}
                  </>}
                </NavLink>
              ))}
            </nav>
          )}

          <nav aria-label="General" className="flex flex-col">
            {current ? <h3 className={sectionHeading}>General</h3> : <div className="mb-2 h-px bg-[rgb(var(--mg-rule-soft))]" />}
            <NavLink to="/events" end onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><CalendarDays className={iconClass(isActive)} />Competitions</>}</NavLink>
            {current && <NavLink to="/shop" onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><ShoppingBag className={iconClass(isActive)} />Tack &amp; kit shop</>}</NavLink>}
            <NavLink to={seasonsTo} onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><Trophy className={iconClass(isActive)} />Seasons</>}</NavLink>
            <NavLink to="/competitions/past" onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><History className={iconClass(isActive)} />Past competitions</>}</NavLink>
            <NavLink to="/stats" onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><BarChart3 className={iconClass(isActive)} />Rider and team stats</>}</NavLink>
            <button type="button" onClick={() => setQrOpen(true)} className={itemClass(false)}><QrCode className={iconClass(false)} />Scan a QR code</button>
            <NavLink to="/settings" onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><SlidersHorizontal className={iconClass(isActive)} />Settings</>}</NavLink>
          </nav>

          {(accountLinks.length > 0 || extras.length > 0) && (
            <nav aria-label="Account and management" className="flex flex-col border-t border-[rgb(var(--mg-rule-soft))] pt-4">
              {accountLinks.map((item) => <NavLink key={item.to} to={item.to} onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><item.icon className={iconClass(isActive)} />{item.label}</>}</NavLink>)}
              {extras.map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><item.icon className={iconClass(isActive)} />{item.label}</>}</NavLink>)}
            </nav>
          )}

          {user ? (
            <Link to="/me" onClick={close} className="mt-auto flex min-h-14 items-center gap-3 rounded-[10px] bg-[rgb(var(--mg-subtle))] px-3 !no-underline hover:!no-underline">
              <span aria-hidden="true" className="mg-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--mg-heading))] text-base font-bold leading-none text-[rgb(var(--mg-surface))]">{initialsOf(user.fullName, user.email)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-semibold leading-tight text-[rgb(var(--mg-ink))]">{user.fullName || user.email}</span>
                <span className="truncate text-[13px] leading-tight text-[rgb(var(--mg-muted))]">{[roleLabel(user.roles), user.clubName].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))]" />
            </Link>
          ) : (
            <div className="mt-auto border-t border-[rgb(var(--mg-rule-soft))] pt-3">
              <NavLink to="/login" onClick={close} className="mg-btn mg-btn-primary w-full !min-h-12 !text-base">Sign in</NavLink>
            </div>
          )}
        </div>

        <QrPermissionScannerModal
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          onNavigate={(to) => {
            setQrOpen(false);
            close();
            navigate(to);
          }}
        />
      </div>
    </dialog>
  );
}

/** The age group as a full-width navy row under the header. It opens downwards and pushes the menu down. */
function AgeGroupMenu({ groups, base, selectedSection, onPick }: { groups: AgeGroupLink[]; base: string; selectedSection: string | null; onPick: () => void }) {
  const [open, setOpen] = useState(false);
  const selected = groups.find((group) => String(group.id) === selectedSection) ?? groups[0];
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls="menu-age-groups" onClick={() => setOpen((value) => !value)}
        className="mg-header flex min-h-[54px] w-full items-center gap-3 border-t border-[rgb(var(--mg-header-line))] px-5 text-left">
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="mg-header-sub text-[12.5px] font-medium leading-none">Age group</span>
          <b className="truncate text-[17px] font-bold leading-tight">{selected.name}</b>
        </span>
        <ChevronDown aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${open ? 'rotate-180' : ''}`} strokeWidth={2.4} />
      </button>
      {open && (
        <nav id="menu-age-groups" aria-label="Age groups" className="border-b-2 border-[rgb(var(--mg-heading))]">
          {groups.map((group) => {
            const active = group.id === selected.id;
            return (
              <Link key={group.id} to={`${base}/scoring?section=${group.id}`} onClick={onPick} aria-current={active ? 'page' : undefined}
                className={`flex min-h-[50px] items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-5 text-base !no-underline last:border-b-0 hover:!no-underline ${active ? 'bg-[rgb(var(--mg-tint))] font-bold text-[rgb(var(--mg-heading))]' : 'text-[rgb(var(--mg-ink))]'}`}>
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                {group.live ? <span className="mg-badge mg-badge-live">Live</span>
                  : group.next ? <span className="shrink-0 text-[12.5px] text-[rgb(var(--mg-muted))]">Next {group.next}</span> : null}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
