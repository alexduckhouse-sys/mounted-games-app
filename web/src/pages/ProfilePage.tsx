import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, ClipboardList, Contact, CreditCard, LogOut, Package, Pencil, ShoppingBag, UserCog, UserRound, Users, type LucideIcon } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { EmailConfirmBanner } from '../components/EmailConfirmBanner';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { useTeamNotifications } from '../hooks/useTeamNotifications';
import { initialsOf, roleLabel } from '../lib/profile';
import type { DeclarationForm, Team, TrainerRequest } from '../types';
import { useNeedsYou } from './profile/needsYou';

const NO_TEAMS: Team[] = [];

/** Who I am, what needs me, my club and my account, in one place (the Me tab). */
export function ProfilePage() {
  const { user, hasRole, canEdit, logout } = useAuth();
  const { current } = useCurrentCompetition();
  const { requests, decForms: missing, teams, count, review } = useNeedsYou();
  const navigate = useNavigate();
  const notify = useTeamNotifications(NO_TEAMS);
  const [savedRiders, setSavedRiders] = useState<number | null>(null);
  const [forms, setForms] = useState<DeclarationForm[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const userId = user?.id;
  const clubId = user?.clubId ?? null;
  const competitionId = current?.id ?? null;

  useEffect(() => {
    if (!userId || clubId == null) return;
    let cancelled = false;
    api.get<unknown[]>(`/clubs/${clubId}/saved-riders`).then((r) => { if (!cancelled && Array.isArray(r.data)) setSavedRiders(r.data.length); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, clubId]);

  useEffect(() => {
    if (!userId || competitionId == null) return;
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId } })
      .then((r) => { if (!cancelled && Array.isArray(r.data)) setForms(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, competitionId]);

  if (!user) return null;

  const isAdmin = hasRole('Admin');
  const runsClub = isAdmin || hasRole('Manager');
  // The admin lock on edit mode guards the admin's own changes; a team manager has no such switch.
  const locked = isAdmin && !canEdit();
  const showClub = isAdmin || clubId != null || hasRole('Trainer') || hasRole('Manager') || (teams?.length ?? 0) > 0;
  const showTeams = !isAdmin || (teams?.length ?? 0) > 0;
  const teamsHere = competitionId == null ? [] : (teams ?? NO_TEAMS).filter((t) => t.competitionId === competitionId);
  const submitted = teamsHere.filter((t) => forms?.some((f) => f.teamId === t.id)).length;
  const decFormCount = forms && teamsHere.length > 0 ? `${submitted} of ${teamsHere.length}` : undefined;

  async function decide(request: TrainerRequest, action: 'approve' | 'decline') {
    setFailed(null);
    if (!(await review(request, action))) setFailed(request.userId);
  }

  return (
    <div className="flex flex-col gap-6">
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

      {count > 0 && (
        <Section title="Needs you" aside={String(count)}>
          {requests.map((request) => (
            <div key={request.userId} className="mg-card flex flex-col gap-2.5 px-3.5 py-3">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="mg-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--mg-late-bg))] text-[15px] font-bold text-[rgb(var(--mg-late-ink))]">
                  {initialsOf(request.fullName, request.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold leading-tight">{request.fullName}</div>
                  <div className="text-sm text-[rgb(var(--mg-muted))]">Wants to join as {request.requestedRole === 'Manager' ? 'a team manager' : 'a trainer'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="mg-btn mg-btn-primary !min-h-11 flex-1 !text-[15px]" disabled={locked} title={locked ? 'Switch to edit mode' : undefined}
                  onClick={() => decide(request, 'approve')}>Approve</button>
                <button type="button" className="mg-btn mg-btn-secondary !min-h-11 flex-1 !text-[15px]" disabled={locked} title={locked ? 'Switch to edit mode' : undefined}
                  onClick={() => decide(request, 'decline')}>Decline</button>
              </div>
              {failed === request.userId && <p role="alert" className="text-sm font-medium text-[rgb(var(--mg-elim))]">Could not update this request. Try again.</p>}
            </div>
          ))}
          {missing.map((t) => (
            <Link key={t.id} to={`/competitions/${t.competitionId}/declarations?team=${t.id}`}
              className="flex min-h-[60px] items-center gap-3 rounded-xl bg-[rgb(var(--mg-live-row))] px-3.5 text-[rgb(var(--mg-elim))]">
              <ClipboardList aria-hidden="true" className="h-6 w-6 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-base font-semibold leading-tight text-[rgb(var(--mg-ink))]">Dec form needed: {t.displayName}</span>
              <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            </Link>
          ))}
        </Section>
      )}

      {showClub && (
        <Section title="My club" aside={user.clubName ?? undefined}>
          <div className="mg-card mg-list">
            {showTeams && <ListRow to="/teams" icon={Users} label="Teams" count={teams ? String(teams.length) : undefined} />}
            {clubId != null && <ListRow icon={Contact} label="Saved riders" count={savedRiders != null ? String(savedRiders) : undefined} />}
            <ListRow to="/declarations" icon={ClipboardList} label="Dec forms" count={decFormCount} />
            {runsClub && <ListRow to="/me/members" icon={UserCog} label="Members" />}
          </div>
        </Section>
      )}

      <Section title="Account">
        <div className="mg-card mg-list">
          <button type="button" role="switch" aria-checked={notify.enabled} disabled={notify.permission === 'denied' || notify.permission === 'unsupported'}
            onClick={() => { void notify.setEnabled(!notify.enabled); }}
            className="mg-row !min-h-14 disabled:opacity-50">
            <Bell aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />
            <span className="flex-1 text-base font-semibold">Notifications</span>
            <span aria-hidden="true" className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${notify.enabled ? 'bg-[rgb(var(--mg-button))]' : 'bg-[rgb(var(--mg-control))]'}`}>
              <span className={`h-5 w-5 rounded-full bg-white transition-transform ${notify.enabled ? 'translate-x-5' : ''}`} />
            </span>
          </button>
          <ListRow to="/me/account" icon={UserRound} label="My account" />
          {!isAdmin && <ListRow to="/me/signups" icon={CreditCard} label="My signups" />}
          <ListRow to="/me/catalogue" icon={Package} label="My items for sale" />
          <ListRow to="/me/orders" icon={ShoppingBag} label="Orders & sales" />
          <button type="button" className="mg-row !min-h-14" onClick={() => { logout(); navigate('/'); }}>
            <LogOut aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />
            <span className="flex-1 text-base font-semibold">Sign out</span>
          </button>
        </div>
      </Section>
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

/** A tappable row with an icon, a label, an optional count and a chevron. Without `to` it just reports. */
function ListRow({ to, icon: IconComponent, label, count }: { to?: string; icon: LucideIcon; label: string; count?: string }) {
  const body = (
    <>
      <IconComponent aria-hidden="true" className="h-6 w-6 shrink-0 text-[rgb(var(--mg-heading))]" />
      <span className="flex-1 text-base font-semibold">{label}</span>
      {count && <span className="text-[15px] text-[rgb(var(--mg-muted))]">{count}</span>}
      {to && <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[rgb(var(--mg-dash))]" />}
    </>
  );
  return to
    ? <Link to={to} className="mg-row !min-h-14">{body}</Link>
    : <div className="mg-row !min-h-14">{body}</div>;
}
