import { useEffect, useRef, useState } from 'react';
import { useExitDelay } from '../hooks/useExitDelay';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, X, Settings, History, SlidersHorizontal, CloudSun, Star, ShoppingBag, ChevronRight, ChevronDown, BarChart3, Trophy, QrCode, Users, IdCard, Mic, Monitor, ClipboardList, Film } from 'lucide-react';
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
import { QrAccessModal } from './QrAccessModal';
import { useLanguage, useT } from '../i18n/LanguageContext';

const WEATHER_KEY = 'mg.showWeather';
// On the site menu (no competition open) the list is short, so its rows and icons are bigger; inside a competition they stay compact.
const menuItemClass = (active: boolean, roomy: boolean) => `flex ${roomy ? 'min-h-14 text-lg' : 'min-h-12 text-base'} w-full items-center gap-3 rounded-[10px] px-3 text-left !no-underline hover:!no-underline ${active
  ? 'bg-[rgb(var(--mg-tint))] font-semibold text-[rgb(var(--mg-heading))]'
  : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`;
const sectionHeading = 'mb-1 px-3 text-lg font-bold leading-tight text-[rgb(var(--mg-heading))]';
const menuIconClass = (active: boolean, roomy: boolean) => `${roomy ? 'h-6 w-6' : 'h-5 w-5'} shrink-0 ${active ? '' : 'text-[rgb(var(--mg-muted))]'}`;

export function NavigationDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  // Closing slides the drawer back out before it is removed; links navigate underneath as it goes.
  const { closing, close } = useExitDelay(onClose);
  const { current } = useCurrentCompetition();
  const roomy = !current;
  const itemClass = (active: boolean) => menuItemClass(active, roomy);
  const iconClass = (active: boolean) => menuIconClass(active, roomy);
  const { user, hasRole, canOrganise } = useAuth();
  const { extras } = useNavExtras();
  const { meta } = useCompetitionMeta();
  const ageGroups = useAgeGroups();
  const location = useLocation();
  const navigate = useNavigate();
  const { lite } = useLiteMode();
  const [qrOpen, setQrOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
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
  // This competition: only shown while one is open.
  const links = [
    { to: `${base}/teams`, label: t('shell.menu.teams'), icon: Users, end: true },
    { to: `${base}/following`, label: t('shell.menu.following'), icon: Star, end: true },
    { to: `${base}/shop`, label: t('shell.menu.eventShop'), icon: ShoppingBag, end: true },
  ];
  // General: the same rows everywhere, in the same style; away from a competition Following sits in it and the competition section is gone.
  const generalLinks = [
    { to: '/events', label: t('shell.menu.competitions'), icon: CalendarDays, end: true },
    ...(current ? [] : [{ to: '/following', label: t('shell.menu.following'), icon: Star, end: false }]),
    ...(current
      ? [{ to: seasonsTo, label: t('shell.menu.seasons'), icon: Trophy, end: false }, { to: '/competitions/past', label: t('shell.menu.pastCompetitions'), icon: History, end: false }]
      : [{ to: '/competitions/past', label: t('shell.menu.pastCompetitions'), icon: History, end: false }, { to: seasonsTo, label: t('shell.menu.seasons'), icon: Trophy, end: false }]),
    { to: '/stats', label: t('shell.menu.stats'), icon: BarChart3, end: false },
    { to: '/team-profiles', label: t('shell.menu.teamProfiles'), icon: IdCard, end: false },
    { to: '/shop', label: t('shell.menu.tackShop'), icon: ShoppingBag, end: false },
  ];
  // Weather shows with a competition open, or away from one only when switched on in Settings.
  const weatherRow = (current != null || showWeather) && !lite && (
    <Link to={current ? `${base}/weather` : '/events'} onClick={close} className={`${itemClass(false)} hover:!bg-[rgb(var(--mg-subtle))]`}>
      <CloudSun className={iconClass(false)} /><span className="font-medium text-[rgb(var(--mg-ink))]">{t('shell.menu.weather')}</span>{showWeather && <span className="ml-auto"><WeatherBadge /></span>}
    </Link>
  );
  const groupList = current && ageGroups.competitionId === current.id ? ageGroups.groups : [];
  // Account and club links (teams, dec forms, signups, shop, sign out) live on the profile page now.
  const accountLinks = [
    { to: '/admin', label: t('shell.menu.siteAdmin'), icon: Settings, show: hasRole('Admin') },
  ].filter((item) => item.show);
  const onGroupPage = location.pathname === `${base}/scoring` || location.pathname === `${base}/toplists`;
  const selectedSection = onGroupPage ? new URLSearchParams(location.search).get('section') : null;
  // On the day: organiser screens for this competition, first in the menu.
  const organiser = shown != null && canOrganise(shown);
  const sectionQuery = selectedSection ? `?section=${selectedSection}` : '';
  const dayLinks = [
    { to: `${base}/commentary${sectionQuery}`, label: 'PA desk', icon: Mic },
    { to: `${base}/recordings`, label: t('shell.menu.raceRecordings'), icon: Film },
    { to: `${base}/tv${sectionQuery}`, label: 'TV kiosk', icon: Monitor },
    { to: `${base}/prize-giving${sectionQuery}`, label: t('screen.pg.title'), icon: Trophy },
    ...(hasRole('Admin') ? [{ to: `${base}/announcements`, label: t('teams.chat.announcements'), icon: ClipboardList }] : []),
  ];
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }} aria-labelledby="navigation-title" className={`mg-drawer${closing ? ' is-closing' : ''} mg-font fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[min(88vw,20rem)] max-w-none bg-[rgb(var(--mg-surface))] p-0 text-[rgb(var(--mg-ink))] shadow-xl backdrop:bg-[rgb(var(--mg-overlay)/0.55)]`}>
      <div className="flex min-h-full flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="mg-header flex items-start gap-2.5 p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {current ? <>
              <h2 id="navigation-title" className="mg-display break-words text-xl font-bold leading-tight">{current.name}</h2>
              {subtitle && <span className="mg-header-sub text-[13px] leading-tight">{subtitle}</span>}
            </> : <h2 id="navigation-title" className="mg-display text-xl font-bold leading-tight">{t('shell.menu.title')}</h2>}
          </div>
          <button autoFocus onClick={close} className="mg-nav-btn !px-0" aria-label={t('shell.menu.close')}><X className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-1 flex-col gap-5 p-4">
          {groupList.length > 0 && <AgeGroupMenu groups={groupList} base={base} selectedSection={selectedSection} onPick={close} />}

          {organiser && (
            <nav aria-label="Before the day" className="flex flex-col">
              <NavLink to={`${base}/operations`} onClick={close} className={({ isActive }) => itemClass(isActive)}>
                {({ isActive }) => <><ClipboardList className={iconClass(isActive)} />Before the day</>}
              </NavLink>
            </nav>
          )}

          {organiser && (
            <nav aria-label="On the day" className="flex flex-col">
              <h3 className={sectionHeading}>On the day</h3>
              <button type="button" onClick={() => setAccessOpen(true)} className={itemClass(false)}><QrCode className={iconClass(false)} />Scorer and screen QR codes</button>
              {dayLinks.map((item) => (
                <NavLink key={item.label} to={item.to} end onClick={close} className={({ isActive }) => itemClass(isActive)}>
                  {({ isActive }) => <><item.icon className={iconClass(isActive)} />{item.label}</>}
                </NavLink>
              ))}
            </nav>
          )}

          {current && (
            <nav aria-label={t('shell.menu.thisCompetition')} className="flex flex-col">
              <h3 className={sectionHeading}>{t('shell.menu.thisCompetition')}</h3>
              {weatherRow}
              {links.map((item) => (
                <NavLink key={item.label} to={item.to} end={item.end} onClick={close} className={({ isActive }) => itemClass(isActive)}>
                  {({ isActive }) => <>
                    <item.icon className={iconClass(isActive)} />{item.label}
                  </>}
                </NavLink>
              ))}
            </nav>
          )}

          <nav aria-label={t('shell.menu.general')} className="flex flex-col">
            <h3 className={sectionHeading}>{t('shell.menu.general')}</h3>
            {!current && weatherRow}
            {generalLinks.map((item) => (
              <NavLink key={item.label} to={item.to} end={item.end} onClick={close} className={({ isActive }) => itemClass(isActive)}>
                {({ isActive }) => <><item.icon className={iconClass(isActive)} />{item.label}</>}
              </NavLink>
            ))}
            <button type="button" onClick={() => setQrOpen(true)} className={itemClass(false)}><QrCode className={iconClass(false)} />{t('shell.menu.scanQr')}</button>
            <NavLink to="/settings" onClick={close} className={({ isActive }) => itemClass(isActive)}>{({ isActive }) => <><SlidersHorizontal className={iconClass(isActive)} />{t('shell.menu.settings')}</>}</NavLink>
          </nav>

          {(accountLinks.length > 0 || extras.length > 0) && (
            <nav aria-label={t('shell.menu.account')} className="flex flex-col border-t border-[rgb(var(--mg-rule-soft))] pt-4">
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
              <NavLink to="/login" onClick={close} className="mg-btn mg-btn-primary w-full !min-h-12 !text-base">{t('common.signIn')}</NavLink>
            </div>
          )}
        </div>

        {organiser && shown && (
          <QrAccessModal
            open={accessOpen}
            onClose={() => setAccessOpen(false)}
            competitionId={shown.id}
            competitionName={shown.name}
            sectionId={selectedSection ? Number(selectedSection) : null}
            canWrite
          />
        )}
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

/** The age group as a settings-style row at the top of the menu ("Age group · Juniors"). It opens downwards and pushes the menu down. */
function AgeGroupMenu({ groups, base, selectedSection, onPick }: { groups: AgeGroupLink[]; base: string; selectedSection: string | null; onPick: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = groups.find((group) => String(group.id) === selectedSection) ?? groups[0];
  return (
    <div className="-mb-2">
      <button type="button" aria-expanded={open} aria-controls="menu-age-groups" onClick={() => setOpen((value) => !value)}
        className="flex min-h-[50px] w-full items-center gap-2 rounded-xl border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] py-0 pl-3.5 pr-2.5 text-left">
        <span className="flex-1 text-[15px] font-medium leading-none text-[rgb(var(--mg-ink))]">{t('shell.menu.ageGroup')}</span>
        <b className="min-w-0 truncate text-[15px] font-semibold leading-none text-[rgb(var(--mg-heading))]">{selected.name}</b>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[rgb(var(--mg-muted))] ${open ? 'rotate-180' : ''}`} strokeWidth={2.2} />
      </button>
      {open && (
        <nav id="menu-age-groups" aria-label={t('shell.menu.ageGroups')} className="mt-1.5 overflow-hidden rounded-xl border border-[rgb(var(--mg-rule))]">
          {groups.map((group) => {
            const active = group.id === selected.id;
            return (
              <Link key={group.id} to={`${base}/toplists?section=${group.id}`} onClick={onPick} aria-current={active ? 'page' : undefined}
                className={`flex min-h-[48px] items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-3.5 text-base !no-underline last:border-b-0 hover:!no-underline ${active ? 'bg-[rgb(var(--mg-tint))] font-bold text-[rgb(var(--mg-heading))]' : 'text-[rgb(var(--mg-ink))]'}`}>
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                {group.live ? <span className="mg-badge mg-badge-live">{t('shell.menu.live')}</span>
                  : group.next ? <span className="shrink-0 text-[12.5px] text-[rgb(var(--mg-muted))]">{t('shell.menu.nextAt', { time: group.next })}</span> : null}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
