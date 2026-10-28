import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Translate } from '../../i18n/translate';
import { Check, ChevronDown, ChevronRight, Lock, Trash2, Unlock } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { competitionDateText } from '../../lib/competitionDates';
import { defaultRaceList } from '../../lib/defaultRaces';
import { defaultEventStart, heatSizes, planTimetable, type PlanRow } from '../../lib/formatPlan';
import { loadRaceTemplates, raceListNames } from '../../lib/raceTemplates';
import { displaySectionName } from '../../lib/section';
import { formatTime } from '../../lib/time';
import type { CompetitionDetail, CompetitionSection, FormTeamsResult, SectionSignup, Session } from '../../types';
import { SessionKind } from '../../types';
import { BreakForm } from './creator/BreakForm';
import { HatbandList } from './creator/Hatbands';
import { Pill } from './creator/parts';
import { PartHead } from './LaptopParts';
import { RaceListDialog } from './RaceListDialog';
import { NumberField } from '../../components/NumberField';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { usePageWidth } from '../../components/pageWidthState';
import { DecFormConfigEditor } from './DecFormConfig';
import { ScorerLinksCard } from '../competition/ScorerLinksCard';
import { DrawUndoBanner } from '../operations/DrawUndoBanner';
import { TimetableClashes } from '../operations/TimetableClashes';
import { useCardsEnabled } from '../competition/ScoringParts';

const DEFAULT_MINUTES = 10;
const lanesFor = (format: number) => (format === 1 ? 4 : 6);
/** "2 heats of 3", "1 heat of 4", or "3 heats (4, 3, 3)" when they differ (the wording of lib/formatPlan, in the chosen language). */
const describeHeats = (t: Translate, sizes: readonly number[]): string => {
  if (sizes.length === 0) return t('admin.format.heats.none');
  const same = sizes.every((size) => size === sizes[0]);
  if (sizes.length === 1) return t('admin.format.heats.of', { count: 1, size: sizes[0] });
  return same ? t('admin.format.heats.of', { count: sizes.length, size: sizes[0] }) : t('admin.format.heats.mixed', { count: sizes.length, sizes: sizes.join(', ') });
};
const message = (e: unknown, fallback: string) => {
  const data = (e as { response?: { data?: { message?: string } | string } }).response?.data;
  return typeof data === 'string' ? data : data?.message ?? fallback;
};

const isRace = (s: Session) => (s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) === SessionKind.Race;
const isFinalSession = (s: Session) =>
  (s.heats.length > 0 && s.heats.every((h) => /^[A-Z](\s+Final)?$/i.test(h.label?.trim() ?? '')))
  || /\b([A-Z]\s+)?Finals?\b/i.test(s.name ?? '');
const hasScores = (s: Session) => s.status !== 0 || s.heats.some((h) => h.races.some((r) => r.isComplete));

/**
 * On the day: what is left once the competition has been set up in the creator. Close signups, form teams, settle each
 * session's race list, then generate the exact timetable. Structure (sessions, heat, heat, final, minutes, arena) is set
 * in the creator, not here. Breaks and briefings are kept on the timetable and survive generating it.
 */
export function FormatPage() {
  usePageWidth('wide');
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const editingId = id ? parseInt(id, 10) : null;
  const { canOrganise } = useAuth();

  const [comp, setComp] = useState<CompetitionDetail | null>(null);
  const [signups, setSignups] = useState<SectionSignup[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoVersion, setUndoVersion] = useState(0);
  const toast = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [cardsEnabled, toggleCardsEnabled] = useCardsEnabled(editingId ?? undefined);

  const reload = useCallback(async () => {
    if (!editingId) return;
    try {
      const { data: c } = await api.get<CompetitionDetail>(`/competitions/${editingId}`);
      setComp(c);
      if (canOrganise(c)) {
        const { data } = await api.get<SectionSignup[]>(`/competitions/${editingId}/signups`);
        setSignups(data);
      } else setSignups([]);
    } catch { setError(t('admin.format.loadFailed')); }
  }, [editingId, canOrganise, t]);

  // Initial load. The same steps as reload(), kept inline so state is only set once a response
  // has arrived, and so a response for a competition we have since left is ignored.
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: c } = await api.get<CompetitionDetail>(`/competitions/${editingId}`);
        if (cancelled) return;
        setComp(c);
        if (canOrganise(c)) {
          const { data } = await api.get<SectionSignup[]>(`/competitions/${editingId}/signups`);
          if (!cancelled) setSignups(data);
        } else setSignups([]);
      } catch { if (!cancelled) setError(t('admin.format.loadFailed')); }
    })();
    loadRaceTemplates().then((list) => { if (!cancelled) setTemplates(raceListNames(list)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [editingId, canOrganise, t]);

  const raceSessions = useMemo(() => (comp?.sessions ?? []).filter(isRace), [comp]);
  const fixedItems = useMemo(() => (comp?.sessions ?? []).filter((s) => !isRace(s)).sort((a, b) => a.orderIndex - b.orderIndex), [comp]);
  const arenas = useMemo(() => [...new Set(raceSessions.map((s) => s.arenaName?.trim() ?? '').filter(Boolean))], [raceSessions]);

  /** Runs one change, then reloads. Reports a failure in the page rather than losing it. */
  async function run(action: () => Promise<unknown>, failure: string, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      if (done) toast.show(done);
      return true;
    } catch (e) {
      setError(message(e, failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!comp) {
    return (
      <div className="skin mx-auto w-full max-w-[880px] pt-10 text-sm text-[rgb(var(--mg-muted))]">
        {error ? <Notice actionLabel={t('common.tryAgain')} onAction={() => { setError(null); void reload(); }}>{error}</Notice> : t('common.loading')}
      </div>
    );
  }

  if (!canOrganise(comp)) {
    return (
      <div className="skin mx-auto flex w-full max-w-[880px] flex-wrap items-center gap-3 pt-10 text-sm">
        {t('admin.format.noAccess')}
        <Link to={`/competitions/${comp.id}`} className="mg-btn mg-btn-primary !min-h-11">{t('admin.format.backToComp')}</Link>
      </div>
    );
  }

  const competition = comp;
  const sectionOf = (s: Session) => competition.sections.find((sec) => sec.id === s.competitionSectionId);
  const activeTeams = (section: CompetitionSection) => competition.teams.filter((t) => t.competitionSectionId === section.id && !t.isWithdrawn);
  const minutesFor = (s: Session) => s.minutesPerHeat ?? DEFAULT_MINUTES;
  /** The race list for a session: what it was planned with, else what its heats run, else the standard list. */
  const racesFor = (s: Session): string[] => {
    if (s.plannedRaces?.length) return s.plannedRaces;
    if (s.heats.length > 0 && sectionOf(s)?.usesRaceFinals) return [...new Set(s.heats.flatMap((h) => h.races.map((r) => r.name)))];
    if (s.heats[0]?.races.length) return s.heats[0].races.map((r) => r.name);
    const section = sectionOf(s);
    return defaultRaceList('Zone', section?.format ?? 2, section?.ageGroup ?? '');
  };

  const paidBySection = new Map<number, number>();
  for (const s of signups) if (s.status === 1) paidBySection.set(s.competitionSectionId, (paidBySection.get(s.competitionSectionId) ?? 0) + 1);
  const totalPaid = signups.filter((s) => s.status === 1).length;
  const totalPending = signups.filter((s) => s.status === 0).length;
  const drawSessions = raceSessions.filter((s) => !isFinalSession(s));
  const generated = drawSessions.length > 0 && drawSessions.every((s) => s.heats.length > 0);
  const teamsFormed = competition.teams.length > 0;
  const racesSet = raceSessions.length > 0 && raceSessions.every((s) => (s.plannedRaces?.length ?? 0) > 0 || s.heats.length > 0);
  const steps = [
    { title: t('admin.format.step.closeSignups'), meta: competition.signupsLocked ? t('admin.format.closed') : t('admin.format.open'), done: !!competition.signupsLocked },
    { title: t('admin.format.step.formTeams'), meta: teamsFormed ? t('admin.format.teamCount', { count: competition.teams.length }) : '', done: teamsFormed },
    { title: t('admin.format.step.raceLists'), meta: raceSessions.length ? t('admin.format.setOf', { done: raceSessions.filter((s) => (s.plannedRaces?.length ?? 0) > 0 || s.heats.length > 0).length, total: raceSessions.length }) : '', done: racesSet },
    { title: t('admin.format.step.timetable'), meta: raceSessions.length ? (generated ? t('admin.format.exact') : t('admin.format.provisional')) : '', done: generated },
  ];
  const current = steps.findIndex((s) => !s.done);

  const eventStart = defaultEventStart(new Date(competition.startDate));
  const plan: PlanRow[] = planTimetable({
    eventStart,
    sessions: raceSessions.map((s) => {
      const section = sectionOf(s);
      return {
        id: s.id, name: s.name, arena: s.arenaName?.trim() ?? '', orderIndex: s.orderIndex, raceCount: racesFor(s).length,
        minutesPerHeat: minutesFor(s), lanes: s.lanesPerHeat ?? lanesFor(section?.format ?? 2),
        teamCount: section ? activeTeams(section).length : 0, raceFinals: !!section?.usesRaceFinals,
      };
    }),
    fixed: fixedItems.flatMap((s) => {
      if (!s.scheduledStart) return [];
      const start = new Date(s.scheduledStart);
      return [{ start, end: new Date(start.getTime() + (s.durationMinutes ?? 0) * 60_000), arena: s.arenaName?.trim() ?? '' }];
    }),
  });
  const planOf = new Map(plan.map((row) => [row.id, row]));

  // ----- changes -----
  const toggleLock = () => run(() => api.post(`/competitions/${competition.id}/signups-locked`, { locked: !competition.signupsLocked }), t('admin.format.lock.failed'));

  const saveRaces = (s: Session, races: string[]) => {
    setEditing(null);
    void run(() => api.put(`/competitions/${competition.id}/sessions/${s.id}`, { plannedRaces: races }), t('admin.format.races.saveFailed'),
      t('admin.format.races.saved', { name: s.name }));
  };

  const addBreak = (b: { kind: 1 | 2; name: string; date: string; time: string; minutes: string; arena: string }) => {
    const order = competition.sessions.reduce((m, s) => Math.max(m, s.orderIndex), 0) + 1;
    return run(() => api.post(`/competitions/${competition.id}/sessions`, {
      competitionSectionId: null, name: b.name, arenaName: b.arena || null, scheduledStart: new Date(`${b.date}T${b.time}`).toISOString(), orderIndex: order,
      notes: null, isBreak: b.kind === 1, durationMinutes: parseInt(b.minutes, 10), kind: b.kind, location: null,
    }), t('admin.format.breaks.addFailed'), t('admin.format.breaks.added', { name: b.name }));
  };

  const removeBreak = async (s: Session) => {
    if (!(await confirmDialog({ title: t('admin.format.breaks.removeTitle', { name: s.name }), message: t('admin.format.breaks.removeMessage'), confirmLabel: t('admin.format.breaks.removeConfirm'), destructive: true }))) return;
    void run(() => api.delete(`/competitions/${competition.id}/sessions/${s.id}`), t('admin.format.breaks.removeFailed'));
  };

  async function generate() {
    const targets = drawSessions.filter((s) => !hasScores(s));
    const skipped = drawSessions.filter(hasScores);
    const withTeams = targets.filter((s) => { const section = sectionOf(s); return section && activeTeams(section).length > 0; });
    if (withTeams.length === 0) { setError(t('admin.format.generate.noTeams')); return; }
    const replacing = withTeams.filter((s) => s.heats.length > 0).length;
    if (!(await confirmDialog({ title: t('admin.format.generate.title'), confirmLabel: t('admin.format.generate.confirm'), message: [t('admin.format.generate.for', { count: withTeams.length }), replacing ? t('admin.format.generate.replacing', { count: replacing }) : '', skipped.length ? t('admin.format.generate.skipped') : ''].filter(Boolean).join(' ') }))) return;
    const ok = await run(async () => {
      for (const s of withTeams) {
        const section = sectionOf(s)!;
        const row = planOf.get(s.id)!;
        await api.put(`/competitions/${competition.id}/sessions/${s.id}`, { scheduledStart: row.start.toISOString() });
        await api.post(`/competitions/${competition.id}/sessions/${s.id}/${section.usesRaceFinals ? 'generate-race-finals' : 'generate-heats'}`, {
          teamIds: activeTeams(section).map((t) => t.id), raceNames: racesFor(s), lanesPerHeat: s.lanesPerHeat ?? lanesFor(section.format), replaceExisting: true,
        });
      }
    }, t('admin.format.generate.failed'));
    if (ok) setUndoVersion((n) => n + 1);
    if (ok) setNotice([t('admin.format.generate.done', { count: withTeams.length }), skipped.length ? t('admin.format.generate.doneSkipped', { count: skipped.length }) : ''].filter(Boolean).join(' '));
  }

  const heatsText = (s: Session) => {
    if (s.heats.length > 0) return sectionOf(s)?.usesRaceFinals ? t('admin.format.heats.finals', { count: s.heats.length }) : describeHeats(t, s.heats.map((h) => h.entries.length));
    const section = sectionOf(s);
    return section ? describeHeats(t, heatSizes(activeTeams(section).length, s.lanesPerHeat ?? lanesFor(section.format))) : t('admin.format.heats.notGenerated');
  };
  const startText = (s: Session) => {
    if (s.heats.length > 0 && s.scheduledStart) return t('admin.format.heats.starts', { time: formatTime(new Date(s.scheduledStart)) });
    const row = planOf.get(s.id);
    return s.heats.length > 0 ? t('admin.format.heats.noStart') : row && row.minutes > 0 ? t('admin.format.heats.wouldStart', { time: formatTime(row.start) }) : t('admin.format.heats.notGenerated');
  };

  // The timetable as it stands: exact for sessions with heats, an estimate for the rest, and the breaks in between.
  const lines = [
    ...raceSessions.map((s) => {
      const exact = s.heats.length > 0 && !!s.scheduledStart;
      const row = planOf.get(s.id);
      const start = exact
        ? new Date(s.scheduledStart!)
        : row && row.minutes > 0
          ? row.start
          : s.scheduledStart
            ? new Date(s.scheduledStart)
            : null;
      return {
        key: `s${s.id}`,
        start,
        orderIndex: s.orderIndex,
        title: s.name,
        sub: [s.arenaName?.trim() || t('admin.format.mainArena'), heatsText(s)].join(' · '),
        minutes: exact ? null : (row && row.minutes > 0 ? row.minutes : s.durationMinutes ?? 0),
        exact,
      };
    }),
    ...fixedItems.map((b) => ({
      key: `b${b.id}`, start: b.scheduledStart ? new Date(b.scheduledStart) : null, orderIndex: b.orderIndex, title: b.name,
      sub: [b.kind === SessionKind.Briefing ? t('admin.format.briefing') : t('admin.format.break'), b.arenaName?.trim() || t('admin.format.allArenas')].join(' · '), minutes: b.durationMinutes ?? 0, exact: true,
    })),
  ].sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity) || a.orderIndex - b.orderIndex);

  const editingSession = raceSessions.find((s) => s.id === editing) ?? null;
  const editingSection = editingSession ? sectionOf(editingSession) : undefined;
  const subtitle = [competition.name, competitionDateText(competition.startDate, competition.endDate), competition.location?.trim()].filter(Boolean).join(' · ');
  const breakDate = (() => { const d = defaultEventStart(new Date(competition.startDate)); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();

  return (
    <div className="skin mx-auto flex w-full max-w-5xl flex-col gap-9 pb-40 pt-6 sm:pt-10">
      <div className="flex flex-col gap-2.5">
        <h1 className="mg-display text-[34px] font-bold leading-none text-[rgb(var(--mg-heading))] sm:text-[44px]">{t('admin.format.title')}</h1>
        <p className="text-[15px] text-[rgb(var(--mg-muted))]">{subtitle}</p>
        <p className="text-sm text-[rgb(var(--mg-muted))]">
          {t('admin.format.structureNote')}{' '}
          <Link to={`/admin/competitions/${competition.id}`} className="font-semibold underline">{t('admin.format.changeStructure')}</Link>
        </p>
      </div>

      <ol aria-label={t('admin.format.steps')} className="m-0 grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-4">
        {steps.map((step, i) => {
          const now = i === current;
          return (
            <li key={step.title} aria-current={now ? 'step' : undefined} className={`flex min-h-14 items-center gap-2.5 rounded-xl border-[1.5px] px-3 py-1.5 ${now ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-surface))]' : 'border-transparent'}`}>
              <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.done ? 'bg-[rgb(var(--mg-ok))] text-white' : now ? 'bg-[rgb(var(--mg-button))] text-[rgb(var(--mg-button-ink))]' : 'border-2 border-[rgb(var(--mg-control))] text-[rgb(var(--mg-muted))]'}`}>
                {step.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className={`text-sm ${now ? 'font-bold' : 'font-semibold'} ${i > current && !step.done ? 'text-[rgb(var(--mg-muted))]' : 'text-[rgb(var(--mg-heading))]'}`}>{step.title}</strong>
                {step.meta && <span className="text-xs text-[rgb(var(--mg-muted))]">{step.meta}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      {error && <Notice>{error}</Notice>}
      {notice && <Notice tone="info">{notice}</Notice>}
      {toast.node}
      {editingId != null && <DrawUndoBanner competitionId={editingId} version={undoVersion} onRestored={() => void reload()} />}
      <TimetableClashes competition={competition} />

      <div className="flex flex-col gap-9 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-7">
        <div className="flex min-w-0 flex-col gap-9">
          <Panel id="fm-lock" title={t('admin.format.lock.title')} done={!!competition.signupsLocked} meta={t('admin.format.lock.meta', { paid: totalPaid, pending: totalPending })}>
            <p className="text-sm text-[rgb(var(--mg-body))]">
              {t('admin.format.lock.groups', { count: competition.sections.length })}
            </p>
            <button type="button" onClick={() => void toggleLock()} disabled={busy} className="mg-btn mg-btn-secondary !min-h-11 self-start">
              {competition.signupsLocked ? <Unlock className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
              {competition.signupsLocked ? t('admin.format.lock.reopen') : t('admin.format.lock.closeNow')}
            </button>
          </Panel>

          <Panel id="fm-dec" title={t('admin.format.decPanel.title')} done={false} meta={t('admin.format.decPanel.meta')}>
            <DecFormConfigEditor competitionId={competition.id} />
          </Panel>

          <Panel id="fm-teams" title={t('admin.format.teams.title')} done={teamsFormed} meta={teamsFormed ? t('admin.format.teams.formed', { count: competition.teams.length }) : undefined}>
            {competition.sections.length === 0 ? (
              <p className="text-sm text-[rgb(var(--mg-muted))]">{t('admin.format.teams.noGroups')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {teamsFormed && <p className="text-sm text-[rgb(var(--mg-body))]">{t('admin.format.teams.note')}</p>}
                {competition.sections.map((sec) => (
                  <FormTeamsSectionCard key={sec.id} competitionId={competition.id} section={sec} paidCount={paidBySection.get(sec.id) ?? 0} onChanged={reload} setError={setError} />
                ))}
              </div>
            )}
          </Panel>

          <Panel id="fm-races" title={t('admin.format.races.title')} done={racesSet} keepOpen meta={steps[2].meta || undefined}>
            <p className="text-sm text-[rgb(var(--mg-body))]">{t('admin.format.races.note')}</p>
            {competition.sections.map((section) => {
              const mine = raceSessions.filter((s) => s.competitionSectionId === section.id);
              return (
                <section key={section.id} aria-label={displaySectionName(section.displayName)} className="mg-card overflow-visible">
                  <div className="flex items-baseline gap-3 border-b border-[rgb(var(--mg-rule-soft))] px-4 py-2.5">
                    <strong className="min-w-0 flex-1 truncate text-[15px]">{displaySectionName(section.displayName)}</strong>
                    <span className="text-xs text-[rgb(var(--mg-muted))]">{t(section.usesRaceFinals ? 'admin.format.races.sectionMetaFinals' : 'admin.format.races.sectionMeta', { count: activeTeams(section).length })}</span>
                  </div>
                  {mine.length === 0 && <p className="px-4 py-3 text-sm text-[rgb(var(--mg-muted))]">{t('admin.format.races.noSessions')}</p>}
                  <ul>
                    {mine.map((s, i) => {
                      const races = racesFor(s);
                      const chosen = (s.plannedRaces?.length ?? 0) > 0 || s.heats.length > 0;
                      return (
                        <li key={s.id} className={`flex min-h-[60px] items-center gap-3 px-4 py-1.5 ${i ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <strong className="truncate text-[15px] font-semibold">{s.name}</strong>
                            <span className="text-xs text-[rgb(var(--mg-muted))]">{heatsText(s)} · {startText(s)}</span>
                          </span>
                          {hasScores(s) ? <span className="text-xs text-[rgb(var(--mg-muted))]">{t('admin.format.races.started')}</span> : (
                            <button type="button" onClick={() => setEditing(s.id)} aria-label={t('admin.format.races.forSessionCount', { name: s.name, count: races.length })}
                              className="flex min-h-11 min-w-0 max-w-[55%] items-center gap-1.5 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] px-2.5 text-left">
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-sm font-semibold">{races.slice(0, 2).join(', ')}{races.length > 2 ? '…' : ''}</span>
                                <span className="text-[11px] text-[rgb(var(--mg-muted))]">{t(chosen ? 'admin.format.races.count' : 'admin.format.races.countStandard', { count: races.length })}</span>
                              </span>
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </Panel>

          <section aria-labelledby="fm-breaks" className="flex flex-col gap-4">
            <PartHead id="fm-breaks" title={t('admin.format.breaks.title')} />
            <div className="mg-card overflow-hidden">
              {fixedItems.length === 0 && <p className="px-4 py-3 text-sm text-[rgb(var(--mg-muted))]">{t('admin.format.breaks.none')}</p>}
              <ul>
                {fixedItems.map((b, i) => (
                  <li key={b.id} className={`grid min-h-14 grid-cols-[64px_minmax(0,1fr)_auto_40px] items-center gap-3 py-1 pl-4 pr-3 ${i ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                    <span className="mg-line-time">{b.scheduledStart ? formatTime(new Date(b.scheduledStart)) : '–'}</span>
                    <span className="flex min-w-0 flex-col gap-0.5"><strong className="truncate text-[15px] font-semibold">{b.name}</strong><span className="text-xs text-[rgb(var(--mg-muted))]">{[b.arenaName?.trim() || t('admin.format.allArenas'), b.location?.trim()].filter(Boolean).join(' · ')}</span></span>
                    <span className="text-[13px] text-[rgb(var(--mg-muted))]">{b.durationMinutes ? t('admin.format.minutes', { count: b.durationMinutes }) : ''}</span>
                    <button type="button" aria-label={t('admin.format.breaks.remove', { name: b.name })} disabled={busy} onClick={() => removeBreak(b)} className="flex h-11 w-10 items-center justify-center text-[rgb(var(--mg-muted))]"><Trash2 className="h-[18px] w-[18px]" aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
              <BreakForm date={breakDate} arenas={arenas} busy={busy} onAdd={(b) => void addBreak(b)} />
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-[calc(var(--mg-shell-h,64px)+24px)]">
          <section aria-labelledby="fm-timetable" className="flex flex-col gap-4">
            <PartHead id="fm-timetable" title={t('admin.format.step.timetable')} meta={raceSessions.length === 0 ? undefined : <Pill tone={generated ? 'plain' : 'provisional'}>{generated ? t('admin.format.exact') : t('admin.format.provisional')}</Pill>} />
            {!generated && raceSessions.length > 0 && (
              <p className="text-sm text-[rgb(var(--mg-muted))]">{t(teamsFormed ? 'admin.format.timetable.estimateTeams' : 'admin.format.timetable.estimate')}</p>
            )}
            <ul className="mg-card mg-list" aria-label={t('admin.format.timetable.soFar')}>
              {lines.length === 0 && <li className="p-4 text-sm text-[rgb(var(--mg-muted))]">{t('admin.format.timetable.none')}</li>}
              {lines.map((line) => (
                <li key={line.key} className="grid min-h-14 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-1 pl-4 pr-3">
                  <span className="mg-line-time">{line.start ? formatTime(line.start) : '–'}</span>
                  <span className="flex min-w-0 flex-col gap-0.5"><strong className="truncate text-[15px] font-semibold">{line.title}</strong><span className="text-xs text-[rgb(var(--mg-muted))]">{line.sub}</span></span>
                  <span className="text-[13px] text-[rgb(var(--mg-muted))]">{line.minutes ? t('admin.format.minutes', { count: line.minutes }) : ''}</span>
                </li>
              ))}
            </ul>
          </section>

          {competition.laneHatbands && competition.laneHatbands.length > 0 && (
            <section aria-labelledby="fm-hatbands" className="flex flex-col gap-4">
              <PartHead id="fm-hatbands" title={t('admin.format.timetable.hatbands')} />
              <HatbandList hatbands={competition.laneHatbands} />
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="mg-meta">{t('admin.format.timetable.readyToRun')}</span>
            <Link to={`/competitions/${competition.id}`} className="mg-small-btn">{t('admin.format.step.timetable')}</Link>
            <Link to={`/competitions/${competition.id}/declarations`} className="mg-small-btn">{t('admin.format.timetable.decForms')}</Link>
            <Link to={`/competitions/${competition.id}/details`} className="mg-small-btn">{t('admin.format.timetable.equipment')}</Link>
          </div>
          <div className="mg-card flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <label className="flex cursor-pointer items-center gap-2.5 font-semibold text-[rgb(var(--mg-heading))]">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={cardsEnabled}
                onChange={(e) => toggleCardsEnabled(e.target.checked)}
              />
              <span>{t('admin.format.timetable.cards')}</span>
            </label>
            <span className="text-xs text-[rgb(var(--mg-muted))]">{cardsEnabled ? t('admin.format.timetable.cardsShown') : t('admin.format.off')}</span>
          </div>
          <ScorerLinksCard competitionId={competition.id} canWrite={canOrganise(competition)} />
        </div>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-3 px-3 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-4">
          <button type="button" onClick={() => void generate()} disabled={busy} className="mg-btn mg-btn-primary !min-h-[50px] !rounded-[10px] !px-[18px] !text-base">{busy ? t('admin.format.timetable.working') : t('admin.format.timetable.generate')}</button>
        </div>
      </footer>

      {editingSession && (
        <RaceListDialog title={t('admin.format.races.forSession', { name: editingSession.name })} races={racesFor(editingSession)} format={editingSection?.format ?? 2} ageGroup={editingSection?.ageGroup ?? ''}
          templates={templates} onSave={(races) => saveRaces(editingSession, races)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** A step of the format: its title with a tick when done, and what to do. Done steps start folded away. */
function Panel({ id, title, done, meta, keepOpen, children }: { id: string; title: string; done: boolean; meta?: string; keepOpen?: boolean; children: ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(keepOpen || !done);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 border-b-2 border-[rgb(var(--mg-heading))] pb-2">
        <h2 id={id} className="mg-display flex-1 text-[22px] font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">{title}</h2>
        {meta && <span className="text-[13px] font-medium leading-none text-[rgb(var(--mg-muted))]">{meta}</span>}
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)} className="-my-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-[rgb(var(--mg-heading))]">
          {open ? t('admin.format.hide') : done ? t('admin.format.change') : t('admin.format.show')}<ChevronDown className={`h-4 w-4 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {open && <div id={`${id}-body`} className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}


function FormTeamsSectionCard({
  competitionId, section, paidCount, onChanged, setError,
}: {
  competitionId: number;
  section: CompetitionSection;
  paidCount: number;
  onChanged: () => void | Promise<void>;
  setError: (msg: string | null) => void;
}) {
  const { t } = useLanguage();
  const defaultSize = section.format === 1 ? 2 : section.format === 3 ? 1 : 4;
  const [ridersPerTeam, setRidersPerTeam] = useState<number>(defaultSize);
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);
  const [preview, setPreview] = useState<FormTeamsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState(false);

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<FormTeamsResult>(
        `/competitions/${competitionId}/sections/${section.id}/form-teams`,
        { ridersPerTeam, preview: true, replaceExisting },
      );
      setPreview(data);
      setCommitted(false);
    } catch (e) {
      setError(message(e, t('admin.format.teams.previewFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<FormTeamsResult>(
        `/competitions/${competitionId}/sections/${section.id}/form-teams`,
        { ridersPerTeam, preview: false, replaceExisting },
      );
      setPreview(data);
      setCommitted(true);
      await onChanged();
    } catch (e) {
      setError(message(e, t('admin.format.teams.createFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mg-card space-y-3 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{section.displayName}</span>
        <span className="text-xs text-[rgb(var(--mg-muted))]">{t('admin.format.teams.paidSignups', { count: paidCount })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          {t('admin.format.teams.ridersPerTeam')}
          <NumberField
            
            min={1} max={12}
            className="input !w-16 !py-1.5 text-sm"
            value={ridersPerTeam}
            onChange={(e) => setRidersPerTeam(Math.max(1, parseInt(e.target.value, 10) || defaultSize))}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
          {t('admin.format.teams.replaceUnused')}
        </label>
        <button onClick={runPreview} disabled={busy || paidCount === 0} className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm">
          {busy && !committed ? t('admin.format.teams.working') : t('admin.format.teams.preview')}
        </button>
        <button onClick={commit} disabled={busy || paidCount === 0} className="mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm">
          <Check className="h-4 w-4" aria-hidden="true" /> {t('admin.format.teams.create')}
        </button>
      </div>
      {preview && (
        <div className="space-y-1 rounded-lg bg-[rgb(var(--mg-subtle))] p-2.5 text-xs">
          <p className="font-semibold">
            {t('admin.format.teams.summary', { label: committed ? t('admin.format.teams.created') : t('admin.format.teams.preview'), teams: t('admin.format.teamCount', { count: preview.teams.length }), signups: t('admin.format.signupCount', { count: preview.paidSignups }) })}
          </p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {preview.teams.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="whitespace-nowrap font-semibold">{t.teamName || `${t.clubName} ${t.suffix}`.trim()}</span>
                <span className="truncate text-[rgb(var(--mg-muted))]">{t.riderNames.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default FormatPage;
