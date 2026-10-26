import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, ClipboardList, Contact, CreditCard, Landmark, LogOut, Package, Pencil, ShoppingBag, UserCog, UserRound, Users, type LucideIcon } from 'lucide-react';
import { api } from '../api';
import { signOutDestination } from '../auth/signOutDestination';
import { useAuth } from '../auth/AuthContext';
import { EmailConfirmBanner } from '../components/EmailConfirmBanner';
import { Notice } from '../components/Notice';
import { usePageWidth } from '../components/pageWidthState';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useMyTeams } from '../hooks/useMyTeams';
import { heatRowsForTeam, heatTime } from '../lib/myTeams';
import { formatDelayDuration } from '../lib/time';
import { dayKey } from '../lib/timetableDay';
import { displaySectionName } from '../lib/section';
import { useTeamNotifications } from '../hooks/useTeamNotifications';
import { initialsOf, roleLabel } from '../lib/profile';
import type { DeclarationForm, Team } from '../types';
import { useNeedsYou } from './profile/needsYou';
import { NeedsYouPanel } from './dashboard/NeedsYouPanel';
import { QuickActions } from './dashboard/QuickActions';
import { SiteAdmin } from './dashboard/SiteAdmin';
import { TodaysEvents } from './dashboard/TodaysEvents';
import { useTodaysEvents } from './dashboard/useTodaysEvents';

const NO_TEAMS: Team[] = [];

interface SavedRiderRow {
  id: number;
  fullName: string;
  ponyName?: string | null;
  horseName?: string | null;
}

/**
 * Who I am, what needs me, my club and my account, in one place (the Me tab). For an admin this is the whole dashboard:
 * what needs them, quick actions, today's events and the site admin sections, in a grid on a laptop.
 */
export function ProfilePage() {
  usePageWidth('wide');
  const { user, hasRole, logout } = useAuth();
  const { current } = useCurrentCompetition();
  const { teams } = useNeedsYou();
  const mine = useMyTeams();
  const now = useMemo(() => new Date(), []);
  const location = useLocation();
  const navigate = useNavigate();
  const notify = useTeamNotifications(NO_TEAMS);
  const [savedRiders, setSavedRiders] = useState<SavedRiderRow[] | null>(null);
  const [ridersOpen, setRidersOpen] = useState(false);
  const [forms, setForms] = useState<DeclarationForm[] | null>(null);

  const userId = user?.id;
  const clubId = user?.clubId ?? null;
  const competitionId = current?.id ?? null;

  useEffect(() => {
    if (!userId || clubId == null) return;
    let cancelled = false;
    api.get<SavedRiderRow[]>(`/clubs/${clubId}/saved-riders`).then((r) => { if (!cancelled && Array.isArray(r.data)) setSavedRiders(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, clubId]);

  useEffect(() => {
    if (!userId || competitionId == null) return;
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId } })
      .then((r) => { if (!cancelled && Array.isArray(r.data)) setForms(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, competitionId]);

  const isAdmin = hasRole('Admin');
  const organiser = isAdmin || hasRole('Trainer') || hasRole('Manager');
  const events = useTodaysEvents(organiser);

  // /admin sends people here with #site-admin; the section exists only once the page has drawn.
  const wantsSiteAdmin = isAdmin && location.hash === '#site-admin';
  useEffect(() => {
    if (wantsSiteAdmin) document.getElementById('site-admin')?.scrollIntoView?.();
  }, [wantsSiteAdmin]);

  if (!user) return null;

  const todayKey = dayKey(now);
  const todays = mine.teams.flatMap((team) => {
    const comp = mine.comps.get(team.competitionId);
    return comp ? heatRowsForTeam(team, comp).filter((row) => row.status !== 'over' && row.effective && dayKey(row.effective) === todayKey).map((row) => ({ team, row })) : [];
  }).sort((a, b) => a.row.effective!.getTime() - b.row.effective!.getTime()).slice(0, 6);

  const teamsToday = todays.length > 0 && <Section title="Your teams today">
    <div className="mg-card mg-list">
      {todays.map(({ team, row }) => <Link key={`${team.id}-${row.heatId}`} to={`/competitions/${team.competitionId}/teams/${team.id}`} className="mg-row !min-h-14">
        <span className={`shrink-0 font-semibold ${row.delayMinutes > 0 ? 'text-[rgb(var(--mg-late-time))]' : ''}`}>{heatTime(row)}</span>
        <span className="flex min-w-0 flex-col gap-1">
          <strong>{team.displayName}</strong>
          <span className="text-xs text-[rgb(var(--mg-muted))]">{[displaySectionName(team.sectionName), row.sessionName, row.label, row.lane != null ? `Lane ${row.lane}` : '', row.delayMinutes > 0 ? `+${formatDelayDuration(row.delayMinutes)}` : ''].filter(Boolean).join(' · ')}</span>
        </span>
      </Link>)}
    </div>
  </Section>;

  const runsClub = isAdmin || hasRole('Manager');
  const showClub = isAdmin || clubId != null || hasRole('Trainer') || hasRole('Manager') || (teams?.length ?? 0) > 0;
  const showTeams = !isAdmin || (teams?.length ?? 0) > 0;
  const teamsHere = competitionId == null ? [] : (teams ?? NO_TEAMS).filter((t) => t.competitionId === competitionId);
  const submitted = teamsHere.filter((t) => forms?.some((f) => f.teamId === t.id)).length;
  const decFormCount = forms && teamsHere.length > 0 ? `${submitted} of ${teamsHere.length}` : undefined;

  const clubSection = showClub && (
<Section title="My club" aside={user.clubName ?? undefined}>
          <div className="mg-card mg-list">
            {showTeams && <ListRow to="/teams" icon={Users} label="Teams" count={teams ? String(teams.length) : undefined} />}
            {clubId != null && (
              <>
                <ListRow
                  icon={Contact}
                  label="Saved riders"
                  count={savedRiders != null ? String(savedRiders.length) : undefined}
                  expanded={ridersOpen}
                  onClick={() => setRidersOpen((open) => !open)}
                />
                {ridersOpen && (
                  <div className="flex flex-col gap-2 bg-[rgb(var(--mg-subtle))] px-4 py-3 text-sm">
                    {savedRiders && savedRiders.length > 0 ? (
                      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Saved riders list">
                        {savedRiders.map((rider) => {
                          const pony = rider.ponyName ?? rider.horseName;
                          return (
                            <li key={rider.id} className="flex items-baseline justify-between gap-2">
                              <span className="font-semibold text-[rgb(var(--mg-ink))]">{rider.fullName}</span>
                              {pony && <span className="text-[rgb(var(--mg-muted))]">{pony}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="m-0 text-[rgb(var(--mg-muted))]">No saved riders yet.</p>
                    )}
                    <Link to="/declarations" className="mg-text-link !min-h-0 self-start !text-sm font-semibold">
                      Manage on dec forms →
                    </Link>
                  </div>
                )}
              </>
            )}
            <ListRow to="/declarations" icon={ClipboardList} label="Dec forms" count={decFormCount} />
            {runsClub && <ListRow to="/me/members" icon={UserCog} label="Members" />}
            {runsClub && <ListRow to="/me/payouts" icon={Landmark} label="Payouts" />}
          </div>
        </Section>
  );

  const accountSection = (
    <Section title="Account">
        <div className="mg-card mg-list">
          <button type="button" role="switch" aria-checked={notify.enabled} disabled={notify.permission === 'denied'}
            onClick={() => { void notify.setEnabled(!notify.enabled); }}
            className="mg-row !min-h-14 disabled:opacity-50">
            <Bell aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />
            <span className="flex-1 text-base font-semibold">Notifications</span>
            <span aria-hidden="true" className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${notify.enabled ? 'bg-[rgb(var(--mg-button))]' : 'bg-[rgb(var(--mg-control))]'}`}>
              <span className={`h-5 w-5 rounded-full bg-white transition-transform ${notify.enabled ? 'translate-x-5' : ''}`} />
            </span>
          </button>
          {notify.problem && <div className="px-3.5 pb-3"><Notice>{notify.problem}</Notice></div>}
          <ListRow to="/me/account" icon={UserRound} label="My account" />
          {!isAdmin && <ListRow to="/me/signups" icon={CreditCard} label="My signups" />}
          <ListRow to="/me/catalogue" icon={Package} label="My items for sale" />
          <ListRow to="/me/orders" icon={ShoppingBag} label="Orders & sales" />
          <button type="button" className="mg-row !min-h-14" onClick={() => { logout(); navigate(signOutDestination(), { replace: true }); }}>
            <LogOut aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />
            <span className="flex-1 text-base font-semibold">Sign out</span>
          </button>
        </div>
      </Section>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="mg-band flex items-center gap-3.5 py-4">
        <div className="mg-display flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--mg-heading))] text-[22px] font-bold leading-none text-[rgb(var(--mg-surface))]" aria-hidden="true">
          {initialsOf(user.fullName, user.email)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="mg-display truncate text-[26px] font-bold leading-none text-[rgb(var(--mg-heading))]">{user.fullName || user.email}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mg-badge bg-[rgb(var(--mg-tint))] text-[rgb(var(--mg-heading))]">{roleLabel(user.roles)}</span>
            {user.clubName && <span className="text-sm text-[rgb(var(--mg-muted))]">{user.clubName}</span>}
          </div>
        </div>
        <Link to="/me/account" className="mg-icon-btn" aria-label="Account details"><Pencil aria-hidden="true" className="h-[18px] w-[18px]" /></Link>
      </div>

      <EmailConfirmBanner />

      {isAdmin ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <NeedsYouPanel events={events.week} />
            {teamsToday}
            <TodaysEvents events={events.week} loaded={events.loaded} />
          </div>
          <div className="flex flex-col gap-6">
            <QuickActions focus={events.focus} today={events.today.length > 0} />
            {clubSection}
            {accountSection}
          </div>
        </div>
      ) : (
        <>
          <NeedsYouPanel events={events.week} />
            {teamsToday}
          <QuickActions focus={events.focus} today={events.today.length > 0} />
          {clubSection}
          {accountSection}
        </>
      )}

      {isAdmin && <SiteAdmin hideTrainerRequests />}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="mg-section-head"><h2>{title}</h2>{aside && <span>{aside}</span>}</div>
      {children}
    </section>
  );
}

/** A tappable row with an icon, a label, an optional count and a chevron. */
function ListRow({ to, onClick, expanded, icon: IconComponent, label, count }: { to?: string; onClick?: () => void; expanded?: boolean; icon: LucideIcon; label: string; count?: string }) {
  const body = (
    <>
      <IconComponent aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />
      <span className="flex-1 text-base font-semibold">{label}</span>
      {count && <span className="text-[15px] text-[rgb(var(--mg-muted))]">{count}</span>}
      <ChevronRight aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))] transition-transform ${expanded ? 'rotate-90' : ''}`} />
    </>
  );
  return to
    ? <Link to={to} className="mg-row !min-h-14">{body}</Link>
    : <button type="button" aria-expanded={expanded} onClick={onClick} className="mg-row !min-h-14">{body}</button>;
}
