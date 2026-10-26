import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { api } from '../api';
import { signOutDestination } from '../auth/signOutDestination';
import { useAuth } from '../auth/AuthContext';
import { EmailConfirmBanner } from '../components/EmailConfirmBanner';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useMyTeams } from '../hooks/useMyTeams';
import { heatRowsForTeam, heatTime } from '../lib/myTeams';
import { formatDelayDuration } from '../lib/time';
import { dayKey } from '../lib/timetableDay';
import { displaySectionName } from '../lib/section';
import { initialsOf, roleLabel } from '../lib/profile';
import type { DeclarationForm, Team } from '../types';
import type { ExtendedMySignup } from './MySignupsPage';
import { useNeedsYou } from './profile/needsYou';
import { NeedsYouPanel } from './dashboard/NeedsYouPanel';
import { useTodaysEvents } from './dashboard/useTodaysEvents';
import '../components/sitePages.css';

const NO_TEAMS: Team[] = [];

interface SavedRiderRow {
  id: number;
  fullName: string;
  ponyName?: string | null;
  horseName?: string | null;
}

/**
 * Who I am, what needs me, my club, my shop and my account, in one place (the Me tab): a header, then rows grouped
 * under small headings. What shows depends on the role; there is no site admin on this page (it has its own).
 */
export function ProfilePage() {
  const { user, hasRole, canOrganise, logout } = useAuth();
  const { current } = useCurrentCompetition();
  const { teams } = useNeedsYou();
  const mine = useMyTeams();
  const now = useMemo(() => new Date(), []);
  const navigate = useNavigate();
  const [savedRiders, setSavedRiders] = useState<SavedRiderRow[] | null>(null);
  const [ridersOpen, setRidersOpen] = useState(false);
  const [forms, setForms] = useState<DeclarationForm[] | null>(null);
  const [entries, setEntries] = useState<ExtendedMySignup[] | null>(null);
  const [itemCount, setItemCount] = useState<number | null>(null);

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

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.get<ExtendedMySignup[]>('/me/signups').then((r) => { if (!cancelled && Array.isArray(r.data)) setEntries(r.data); }).catch(() => {});
    api.get<{ isActive?: boolean }[]>('/commerce/catalogue').then((r) => { if (!cancelled && Array.isArray(r.data)) setItemCount(r.data.filter((item) => item.isActive !== false).length); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const isAdmin = hasRole('Admin');
  const canCreate = isAdmin || hasRole('Trainer');
  const events = useTodaysEvents(true);

  if (!user) return null;

  const todayKey = dayKey(now);
  const todays = mine.teams.flatMap((team) => {
    const comp = mine.comps.get(team.competitionId);
    return comp ? heatRowsForTeam(team, comp).filter((row) => row.status !== 'over' && row.effective && dayKey(row.effective) === todayKey).map((row) => ({ team, row })) : [];
  }).sort((a, b) => a.row.effective!.getTime() - b.row.effective!.getTime()).slice(0, 6);

  const dueEntries = (entries ?? []).filter((e) => e.status === 0 && !e.isWaitlist && !e.isWithdrawn);
  const comingUp = events.upcoming.filter((event) => canOrganise({ id: event.id })).length;

  const runsClub = isAdmin || hasRole('Manager');
  const showClub = isAdmin || clubId != null || hasRole('Trainer') || hasRole('Manager') || (teams?.length ?? 0) > 0;
  const showTeams = !isAdmin || (teams?.length ?? 0) > 0;
  const teamsHere = competitionId == null ? [] : (teams ?? NO_TEAMS).filter((t) => t.competitionId === competitionId);
  const submitted = teamsHere.filter((t) => forms?.some((f) => f.teamId === t.id)).length;
  const decFormCount = forms && teamsHere.length > 0 ? `${submitted} of ${teamsHere.length}` : undefined;
  const line = [roleLabel(user.roles), user.clubName].filter(Boolean).join(' · ');

  return (
    <div className="skin mx-auto w-full max-w-[560px] pb-4 pt-3">
      <h1 className="sr-only">Me</h1>
      <div className="sp-card">
        <div className="sp-row !min-h-[84px]">
          <div className="sp-ava" aria-hidden="true">{initialsOf(user.fullName, user.email)}</div>
          <div className="sp-grow">
            <h2 className="m-0 truncate font-[family-name:var(--mg-font-display)] text-2xl font-extrabold leading-none text-[rgb(var(--mg-heading))]">{user.fullName || user.email}</h2>
            <span className="sp-t2">{line}</span>
          </div>
          <Link to="/me/account" className="sp-pill sp-pill-sm" aria-label="Edit your account details">Edit</Link>
        </div>
      </div>

      <EmailConfirmBanner />

      <NeedsYouPanel events={events.upcoming} dueEntries={dueEntries} />

      {todays.length > 0 && (
        <Section title="Your teams today">
          {todays.map(({ team, row }) => (
            <Link key={`${team.id}-${row.heatId}`} to={`/competitions/${team.competitionId}/teams/${team.id}`} className="sp-row">
              <span className="sp-grow">
                <span className="sp-t1">{team.displayName}</span>
                <span className="sp-t2">{[displaySectionName(team.sectionName), row.sessionName, row.label, row.lane != null ? `Lane ${row.lane}` : '', row.delayMinutes > 0 ? `+${formatDelayDuration(row.delayMinutes)}` : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="sp-num" data-tone={row.delayMinutes > 0 ? 'warn' : undefined}>{heatTime(row)}</span>
              <Chevron />
            </Link>
          ))}
        </Section>
      )}

      {events.today.length > 0 && (canCreate || todays.length === 0) && (
        <Section title="Today">
          {events.today.map((event) => (
            <Link key={event.id} to={`/competitions/${event.id}`} className="sp-row">
              <span className="sp-grow">
                <span className="sp-t1">{event.name}</span>
                <span className="sp-t2">{event.live
                  ? `${[event.live.sectionName, event.live.heatLabel, event.live.arenaName].filter(Boolean).join(' · ')} on now`
                  : event.location ?? ''}</span>
              </span>
              {event.live && <span className="sp-chip" data-tone="live">LIVE</span>}
              <Chevron />
            </Link>
          ))}
        </Section>
      )}

      {canCreate && (
        <section aria-label="Organiser">
          <h2 className="sp-sec">Organiser</h2>
          <div className="sp-card">
            <Link to={isAdmin ? '/admin/competitions' : '/events'} className="sp-row">
              <span className="sp-grow">
                <span className="sp-t1">Your competitions</span>
                {comingUp > 0 && <span className="sp-t2">{comingUp} coming up</span>}
              </span>
              <Chevron />
            </Link>
            {isAdmin && (
              <Link to="/admin" className="sp-row">
                <span className="sp-grow"><span className="sp-t1">Site admin</span><span className="sp-t2">Users, trainer requests, email</span></span>
                <Chevron />
              </Link>
            )}
            <Link to="/admin/competitions/new" className="sp-add sp-add-row"><Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />Create a competition</Link>
          </div>
        </section>
      )}

      {showClub && (
        <section aria-label="My club">
          <h2 className="sp-sec">My club{user.clubName && <small>{user.clubName}</small>}</h2>
          <div className="sp-card">
            {showTeams && <ListRow to="/teams" label="Teams" value={teams ? String(teams.length) : undefined} />}
            {clubId != null && (
              <>
                <ListRow label="Saved riders" value={savedRiders != null ? String(savedRiders.length) : undefined} expanded={ridersOpen} onClick={() => setRidersOpen((open) => !open)} />
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
                    <Link to="/declarations" className="font-semibold text-[rgb(var(--mg-heading))] underline">Manage on dec forms</Link>
                  </div>
                )}
              </>
            )}
            <ListRow to="/declarations" label="Dec forms" value={decFormCount} />
            {runsClub && <ListRow to="/me/members" label="Members" />}
            {runsClub && <ListRow to="/me/payouts" label="Payouts" />}
          </div>
        </section>
      )}

      <Section title="Shop">
        <ListRow to="/me/catalogue" label="Things I sell" value={itemCount != null ? String(itemCount) : undefined} />
        <ListRow to="/me/orders" label="Orders and sales" />
      </Section>

      <Section title="Account">
        {!isAdmin && <ListRow to="/me/signups" label="My entries" value={entries ? String(entries.length) : undefined} />}
        <ListRow to="/me/account" label="My account" />
        <ListRow to="/settings" label="Settings" sub="Notifications, theme, bottom bar" />
        <button type="button" className="sp-row" onClick={() => { logout(); navigate(signOutDestination(), { replace: true }); }}>
          <span className="sp-grow"><span className="sp-t1">Sign out</span></span>
        </button>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="sp-sec">{title}</h2>
      <div className="sp-card">{children}</div>
    </section>
  );
}

function Chevron({ open = false }: { open?: boolean }) {
  return <ChevronRight aria-hidden="true" className={`sp-chev h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} strokeWidth={2.5} />;
}

/** A tappable row: a label (and an optional second line), an optional value and a chevron. */
function ListRow({ to, onClick, expanded, label, sub, value }: { to?: string; onClick?: () => void; expanded?: boolean; label: string; sub?: string; value?: string }) {
  const body = (
    <>
      <span className="sp-grow"><span className="sp-t1">{label}</span>{sub && <span className="sp-t2">{sub}</span>}</span>
      {value && <span className="sp-t2">{value}</span>}
      <Chevron open={expanded} />
    </>
  );
  return to
    ? <Link to={to} className="sp-row">{body}</Link>
    : <button type="button" aria-expanded={expanded} onClick={onClick} className="sp-row">{body}</button>;
}
