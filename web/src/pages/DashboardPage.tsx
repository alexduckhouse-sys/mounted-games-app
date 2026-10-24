import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useCurrentCompetition } from '../competition/CurrentCompetitionContext';
import { usePageHeader } from '../components/CompactPageBarContext';
import { useMyTeams } from '../hooks/useMyTeams';
import { competitionDateText, isOnToday } from '../lib/competitionDates';
import { eventFacts, type Fact } from '../lib/dashboard';
import { priceLabel } from '../lib/money';
import { heatRowsForTeam, heatTime, teamsNeedingForms } from '../lib/myTeams';
import { isComingUp } from '../lib/mySignups';
import { roleLabel } from '../lib/profile';
import { dayKey } from '../lib/timetableDay';
import { displaySectionName } from '../lib/section';
import type { CompetitionDetail, CompetitionPickerPage, LiveStreamsResponse, MySignup } from '../types';
import { QuickActions } from './dashboard/QuickActions';

const TONE = { normal: 'text-[rgb(var(--mg-ink))]', late: 'text-[rgb(var(--mg-late-time))]', muted: 'text-[rgb(var(--mg-muted))]' } as const;

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const { current } = useCurrentCompetition();
  const mine = useMyTeams();
  const now = useMemo(() => new Date(), []);
  const [picker, setPicker] = useState<CompetitionPickerPage | null>(null);
  const [focus, setFocus] = useState<{ id: number; detail: CompetitionDetail; viewers: LiveStreamsResponse['streams'] } | null>(null);
  const [signups, setSignups] = useState<{ userId: string; items: MySignup[] } | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    api.get<CompetitionPickerPage>('/competitions/picker', { params: { past: false, page: 1 } })
      .then(({ data }) => { if (!cancelled && Array.isArray(data?.items)) setPicker(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const onToday = picker?.items.filter((item) => isOnToday(item.startDate, item.endDate, now)) ?? [];
  const focusId = current?.id ?? onToday.find((item) => item.live)?.id ?? onToday[0]?.id ?? null;

  useEffect(() => {
    if (focusId == null) return;
    let cancelled = false;
    Promise.all([
      api.get<CompetitionDetail>(`/competitions/${focusId}`).then((r) => r.data),
      api.get<LiveStreamsResponse>(`/competitions/${focusId}/streams`).then((r) => (Array.isArray(r.data?.streams) ? r.data.streams : [])).catch(() => []),
    ]).then(([detail, viewers]) => { if (!cancelled) setFocus({ id: focusId, detail, viewers }); })
      .catch(() => { if (!cancelled) setFocus(null); });
    return () => { cancelled = true; };
  }, [focusId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api.get<MySignup[]>('/me/signups').then(({ data }) => { if (!cancelled && Array.isArray(data)) setSignups({ userId, items: data }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const event = focus && focus.id === focusId ? focus : null;
  const facts = event ? eventFacts(event.detail, event.viewers) : null;
  const pickerLive = picker?.items.find((item) => item.id === focusId)?.live;
  const live = !!facts?.isLive || !!pickerLive;

  const teams = mine.teams;
  const mySignups = signups && signups.userId === userId ? signups.items : [];
  const awaiting = mySignups.filter((s) => s.status === 0 && isComingUp(s.competitionStart, now));
  const needForms = teamsNeedingForms(teams, mine.forms, mine.comps, now);
  const looked = teams.filter((team) => team.relationship === 'trainer' || team.relationship === 'manager');
  const formsIn = looked.filter((team) => mine.forms.some((form) => form.teamId === team.id)).length;
  const isAdmin = hasRole('Admin');
  const needs = [
    ...needForms.map((team) => ({ key: `form-${team.id}`, to: `/competitions/${team.competitionId}/declarations`, title: `Dec form needed: ${team.displayName}`, sub: mine.comps.get(team.competitionId)?.name ?? '', urgent: true })),
    ...awaiting.map((s) => ({ key: `pay-${s.id}`, to: '/me/signups', title: 'Entry awaiting payment', sub: `${s.competitionName} · ${priceLabel(s.amountMinor)}`, urgent: false })),
  ];

  // Heats still to run today for the teams I look after, soonest first.
  const todayKey = dayKey(now);
  const todays = teams.flatMap((team) => {
    const comp = mine.comps.get(team.competitionId);
    return comp ? heatRowsForTeam(team, comp).filter((row) => row.status !== 'over' && row.effective && dayKey(row.effective) === todayKey).map((row) => ({ team, row })) : [];
  }).sort((a, b) => a.row.effective!.getTime() - b.row.effective!.getTime()).slice(0, 6);

  const first = user?.fullName?.trim().split(/\s+/)[0];
  usePageHeader({
    title: user ? `${greeting(now)}${first ? `, ${first}` : ''}` : 'Mounted Games',
    subtitle: user ? [user.clubName, roleLabel(user.roles)].filter(Boolean).join(' · ') : 'Sign in for your teams and entries',
    plain: true,
  });

  const jumps: Array<{ label: string; to: string; fact: Fact }> = facts && focusId != null ? [
    { label: 'Timetable', to: `/competitions/${focusId}`, fact: facts.timetable },
    { label: 'Toplists', to: `/competitions/${focusId}/toplists`, fact: facts.toplists },
    { label: 'Live & stream', to: `/competitions/${focusId}/chat`, fact: facts.live },
    { label: 'Details', to: `/competitions/${focusId}/details`, fact: facts.details },
  ] : [];

  const shortcuts: Array<{ to: string; label: string; meta: string }> = [
    ...(user ? [
      { to: '/teams', label: 'My teams', meta: plural(teams.length, 'team') },
      { to: '/declarations', label: 'Dec forms', meta: looked.length ? `${formsIn} of ${looked.length} in` : '' },
      ...(isAdmin ? [] : [{ to: '/me/signups', label: 'My signups', meta: String(mySignups.length) }]),
    ] : []),
    { to: '/shop', label: 'Shop', meta: '' },
  ];

  // Admins get the whole dashboard on the Me page.
  if (isAdmin) return <Navigate to="/me" replace />;

  return <div className="skin mx-auto flex w-full max-w-5xl flex-col gap-4 pb-2">
    {!user && (
      <div className="mg-card flex flex-col gap-2 p-3.5">
        <Link to="/login" className="mg-btn mg-btn-primary !min-h-12 !text-base">Sign in</Link>
        <p className="text-center text-[13px] text-[rgb(var(--mg-muted))]">For trainers, organisers and stewards</p>
      </div>
    )}

    {event && (
      <div className="mg-band mg-band-deep flex min-h-14 items-center gap-2.5 py-2">
        {live && <span className="inline-flex h-[22px] shrink-0 items-center rounded-[4px] bg-[rgb(var(--mg-red))] px-2 text-[11px] font-bold leading-none tracking-[0.06em]">LIVE</span>}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <strong className="truncate text-[15px] font-semibold">{event.detail.name}</strong>
          <span className="truncate text-xs text-[rgb(var(--mg-header-sub))]">{facts!.line}</span>
        </span>
        <Link to={`/competitions/${event.id}`} aria-label={`Open ${event.detail.name}`} className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-white px-3.5 text-sm font-bold !text-[rgb(var(--mg-header))]">Open</Link>
      </div>
    )}

    {jumps.length > 0 && <nav aria-label="This event" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {jumps.map((jump) => (
        <Link key={jump.label} to={jump.to} className="flex min-h-[60px] flex-col justify-center gap-1 rounded-[10px] border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] px-3 py-2 !text-[rgb(var(--mg-ink))]">
          <span className="mg-display text-[13px] font-bold uppercase leading-none tracking-[0.06em] text-[rgb(var(--mg-heading))]">{jump.label}</span>
          <span className={`truncate text-[13px] font-semibold ${TONE[jump.fact.tone]}`}>{jump.fact.text}</span>
        </Link>
      ))}
    </nav>}

    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      {(needs.length > 0 || todays.length > 0) && (
        <div className="flex min-w-0 flex-col gap-4">
          {needs.length > 0 && <section className="mg-sec" aria-label="Needs you">
            <div className="mg-sec-head"><h2>Needs you</h2><span className="!font-bold text-[rgb(var(--mg-red))]">{needs.length}</span></div>
            <div className="mg-lines">
              {needs.map((item) => (
                <Link key={item.key} to={item.to} className={`mg-line grid-cols-[minmax(0,1fr)_14px] !gap-x-2.5 ${item.urgent ? 'bg-[rgb(var(--mg-live-row))] shadow-[inset_3px_0_0_rgb(var(--mg-red))]' : ''}`}>
                  <span className="flex min-w-0 flex-col gap-0.5"><strong className="text-[15px] font-semibold">{item.title}</strong>{item.sub && <span className={`text-xs ${item.urgent ? 'text-[rgb(var(--mg-elim))]' : 'text-[rgb(var(--mg-muted))]'}`}>{item.sub}</span>}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>}

          {todays.length > 0 && <section className="mg-sec" aria-label="Your teams today">
            <div className="mg-sec-head"><h2>Your teams today</h2></div>
            <div className="mg-lines">
              {todays.map(({ team, row }) => (
                <div key={`${team.id}-${row.heatId}`} className="mg-line grid-cols-[44px_minmax(0,1fr)] !gap-x-2.5 !min-h-12">
                  <span className={`mg-line-time ${row.delayMinutes > 0 ? 'text-[rgb(var(--mg-late-time))]' : ''}`}>{heatTime(row)}</span>
                  <span className="flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
                    <strong className="text-[15px] font-semibold">{team.displayName}</strong>
                    <span className="truncate text-xs text-[rgb(var(--mg-muted))]">{[displaySectionName(team.sectionName), row.label, row.delayMinutes > 0 ? `+${row.delayMinutes} min` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-4">
        {user && hasRole('Trainer') && <QuickActions focus={picker?.items.find((item) => item.id === focusId) ?? null} today={onToday.length > 0} />}

        <section className="mg-sec" aria-label="Shortcuts">
          <div className="mg-sec-head"><h2>Shortcuts</h2></div>
          <div className="mg-lines">
            {shortcuts.map((link) => (
              <Link key={link.to} to={link.to} className="mg-line grid-cols-[minmax(0,1fr)_auto_14px] !min-h-12 !gap-x-3 !py-0 !pl-3.5">
                <span className="text-[15px] font-semibold">{link.label}</span>
                <span className="text-xs text-[rgb(var(--mg-muted))]">{link.meta}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--mg-faint))]" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>

    {!event && !picker && <p role="status" className="mg-meta px-1">Looking for what’s on today…</p>}
    {!event && picker && focusId == null && <p className="mg-meta px-1">Nothing is on today. {picker.items[0] ? `Next up: ${picker.items[0].name}, ${competitionDateText(picker.items[0].startDate, picker.items[0].endDate)}.` : ''}</p>}
  </div>;
}
