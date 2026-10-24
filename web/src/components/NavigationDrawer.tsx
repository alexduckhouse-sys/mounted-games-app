import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowLeftRight, X, Settings, History, SlidersHorizontal, CloudSun, Star, BookOpen, ShoppingBag, ChevronRight, BarChart3, Trophy } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLiteMode } from '../lite/LiteModeContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { competitionDateText } from '../lib/competitionDates';
import { initialsOf, roleLabel } from '../lib/profile';
import { useNavExtras } from './NavExtrasContext';
import { WeatherBadge } from './WeatherBadge';
import { useAgeGroups } from './AgeGroupsContext';
import { useCompetitionMeta } from './competitionMeta';

const WEATHER_KEY = 'mg.showWeather';
const itemClass = (active: boolean) => `flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left text-base !no-underline hover:!no-underline ${active
  ? 'bg-[rgb(var(--mg-tint))] font-semibold text-[rgb(var(--mg-heading))]'
  : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`;
const iconClass = (active: boolean) => `h-5 w-5 shrink-0 ${active ? '' : 'text-[rgb(var(--mg-muted))]'}`;

export function NavigationDrawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { current } = useCurrentCompetition();
  const { user, hasRole } = useAuth();
  const { extras } = useNavExtras();
  const { meta } = useCompetitionMeta();
  const ageGroups = useAgeGroups();
  const location = useLocation();
  const { lite } = useLiteMode();
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
    { to: current ? `${base}/following` : '/following', label: 'Following', icon: Star, end: true },
    { to: current ? `${base}/shop` : '/shop', label: 'Event shop', icon: ShoppingBag, end: true },
    { to: current ? `${base}/rulebooks` : '/events', label: 'Rulebooks', icon: BookOpen, end: true },
  ];
  // Account and club links (teams, dec forms, signups, shop, sign out) live on the profile page now.
  const accountLinks = [
    { to: '/me#site-admin', label: 'Site admin', icon: Settings, show: hasRole('Admin') },
  ].filter((item) => item.show);
  const selectedSection = location.pathname === `${base}/scoring` ? new URLSearchParams(location.search).get('section') : null;
  return (
    <dialog ref={ref} onCancel={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="navigation-title" className="mg-font fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(88vw,20rem)] max-w-none bg-[rgb(var(--mg-surface))] p-0 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.55)]">
      <div className="flex min-h-full flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="mg-header flex items-start gap-2.5 p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {current ? <>
              <span className="mg-header-sub text-xs font-semibold uppercase tracking-[0.08em]">Following</span>
              <h2 id="navigation-title" className="mg-display break-words text-xl font-bold leading-tight">{current.name}</h2>
              {subtitle && <span className="mg-header-sub text-[13px] leading-tight">{subtitle}</span>}
            </> : <h2 id="navigation-title" className="mg-display text-xl font-bold leading-tight">Menu</h2>}
          </div>
          <button autoFocus onClick={onClose} className="mg-nav-btn !px-0" aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-1 flex-col gap-5 p-4">
          {!user && (
            <div className="flex flex-col gap-2 rounded-xl bg-[rgb(var(--mg-tint))] p-3">
              <NavLink to="/login" onClick={onClose} className="mg-btn mg-btn-primary !min-h-12 !text-base">Sign in</NavLink>
              <p className="text-center text-[13px] text-[rgb(var(--mg-muted))]">For trainers, organisers and stewards</p>
            </div>
          )}
          {user && (
            <Link to="/me" onClick={onClose} className="flex min-h-14 items-center gap-3 rounded-[10px] bg-[rgb(var(--mg-subtle))] px-3 !no-underline hover:!no-underline">
              <span aria-hidden="true" className="mg-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--mg-heading))] text-base font-bold leading-none text-[rgb(var(--mg-surface))]">{initialsOf(user.fullName, user.email)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-semibold leading-tight text-[rgb(var(--mg-ink))]">{user.fullName || user.email}</span>
                <span className="truncate text-[13px] leading-tight text-[rgb(var(--mg-muted))]">{[roleLabel(user.roles), user.clubName].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))]" />
            </Link>
          )}

          {showWeather && !lite && <div className="flex min-h-12 items-center gap-3 rounded-[10px] bg-[rgb(var(--mg-subtle))] px-3 py-2"><CloudSun className="h-5 w-5 shrink-0 text-[rgb(var(--mg-muted))]" /><span className="font-medium">Weather</span><span className="ml-auto"><WeatherBadge /></span></div>}

          {current && ageGroups.competitionId === current.id && ageGroups.groups.length > 0 && (
            <nav aria-label="Age groups" className="flex flex-col gap-2.5">
              <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-[rgb(var(--mg-muted))]">Age groups</h3>
              <div className="grid grid-cols-3 gap-2">
                {ageGroups.groups.map((group) => {
                  const active = selectedSection === String(group.id) || (location.pathname === `${base}/scoring` && !location.search && group.id === ageGroups.groups[0].id);
                  return <Link key={group.id} to={`${base}/scoring?section=${group.id}`} onClick={onClose} aria-current={active ? 'page' : undefined} className="mg-chip !min-h-11 !px-2 text-center !text-sm !whitespace-normal">{group.name}</Link>;
                })}
              </div>
            </nav>
          )}

          <nav aria-label="Main navigation" className="flex flex-col">
            {links.map((item) => (
              <NavLink key={item.label} to={item.to} end={item.end} onClick={onClose} className={({ isActive }) => itemClass(isActive && current !== null)}>
                {({ isActive }) => <>
                  <item.icon className={iconClass(isActive && current !== null)} />{item.label}
                </>}
              </NavLink>
            ))}
          </nav>

          <div className="h-px bg-[rgb(var(--mg-rule-soft))]" />

          <div className="flex flex-col">
            <NavLink to="/events" end onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><ArrowLeftRight className={iconClass(isActive)} />Events</>}</NavLink>
            {current && <NavLink to="/shop" onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><ShoppingBag className={iconClass(isActive)} />Tack &amp; kit shop</>}</NavLink>}
            <NavLink to={seasonsTo} onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><Trophy className={iconClass(isActive)} />Seasons</>}</NavLink>
            <NavLink to="/competitions/past" onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><History className={iconClass(isActive)} />Past competitions</>}</NavLink>
            <NavLink to="/stats" onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><BarChart3 className={iconClass(isActive)} />Rider and team stats</>}</NavLink>
            <NavLink to="/settings" onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><SlidersHorizontal className={iconClass(isActive)} />Settings</>}</NavLink>
          </div>

          {(accountLinks.length > 0 || extras.length > 0) && (
            <nav aria-label="Account and management" className="flex flex-col border-t border-[rgb(var(--mg-rule-soft))] pt-4">
              {accountLinks.map((item) => <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><item.icon className={iconClass(isActive)} />{item.label}</>}</NavLink>)}
              {extras.map((item) => <NavLink key={item.to} to={item.to} end={item.end} onClick={onClose} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><item.icon className={iconClass(isActive)} />{item.label}</>}</NavLink>)}
            </nav>
          )}
        </div>

      </div>
    </dialog>
  );
}
