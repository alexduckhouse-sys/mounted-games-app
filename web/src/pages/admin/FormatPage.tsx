import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Lock, Plus, Trash2, Unlock } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { competitionDateText } from '../../lib/competitionDates';
import { defaultRaceList } from '../../lib/defaultRaces';
import { defaultEventStart, describeHeats, heatSizes, planTimetable, type PlanRow } from '../../lib/formatPlan';
import { readRaceDrafts, writeRaceDraft } from '../../lib/raceDrafts';
import { loadRaceTemplates } from '../../lib/raceTemplates';
import { formatTime } from '../../lib/time';
import type { CompetitionDetail, CompetitionSection, FormTeamsResult, SectionSignup, Session } from '../../types';
import { SectionFormatLabel, SessionKind } from '../../types';
import { FieldDrop, PartHead } from './LaptopParts';
import { RaceListDialog } from './RaceListDialog';
import { NumberField } from '../../components/NumberField';

const DEFAULT_MINUTES = 10;
const MAIN_ARENA = 'Main arena';
const lanesFor = (format: number) => (format === 1 ? 4 : 6);
const message = (e: unknown, fallback: string) => {
  const data = (e as { response?: { data?: { message?: string } | string } }).response?.data;
  return typeof data === 'string' ? data : data?.message ?? fallback;
};

const isRace = (s: Session) => (s.kind ?? (s.isBreak ? SessionKind.Break : SessionKind.Race)) === SessionKind.Race;
const hasScores = (s: Session) => s.status !== 0 || s.heats.some((h) => h.races.some((r) => r.isComplete));

/**
 * Format, after entries close: close signups, form teams, then set up each age group's sessions (arena, races, minutes)
 * and generate the timetable. Start times come from Generate. Breaks and briefings are kept on the timetable itself.
 */
export function FormatPage() {
  const { id } = useParams<{ id: string }>();
  const editingId = id ? parseInt(id, 10) : null;
  const { canOrganise } = useAuth();

  const [comp, setComp] = useState<CompetitionDetail | null>(null);
  const [signups, setSignups] = useState<SectionSignup[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string[]>>(() => (editingId ? readRaceDrafts(editingId) : {}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [minutes, setMinutes] = useState<Record<number, string>>({});
  const [finalists, setFinalists] = useState<Record<number, string>>({});

  const reload = useCallback(async () => {
    if (!editingId) return;
    try {
      const { data: c } = await api.get<CompetitionDetail>(`/competitions/${editingId}`);
      setComp(c);
      if (canOrganise(c)) {
        const { data } = await api.get<SectionSignup[]>(`/competitions/${editingId}/signups`);
        setSignups(data);
      } else setSignups([]);
    } catch { setError('Could not load organiser details. Please try again.'); }
  }, [editingId, canOrganise]);

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
      } catch { if (!cancelled) setError('Could not load organiser details. Please try again.'); }
    })();
    loadRaceTemplates().then((list) => { if (!cancelled) setTemplates(list.map((t) => t.name)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [editingId, canOrganise]);

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
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(message(e, failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!comp) return <div className="skin mx-auto w-full max-w-[880px] pt-10 text-sm text-[rgb(var(--mg-muted))]">{error ?? 'Loading…'}</div>;

  if (!canOrganise(comp)) {
    return (
      <div className="skin mx-auto flex w-full max-w-[880px] flex-wrap items-center gap-3 pt-10 text-sm">
        Only admins, the person who runs this competition and its co-organisers can use these tools.
        <Link to={`/competitions/${comp.id}`} className="mg-btn mg-btn-primary !min-h-11">Back to comp</Link>
      </div>
    );
  }

  const competition = comp;
  const sectionOf = (s: Session) => competition.sections.find((sec) => sec.id === s.competitionSectionId);
  const activeTeams = (section: CompetitionSection) => competition.teams.filter((t) => t.competitionSectionId === section.id && !t.isWithdrawn);
  const minutesFor = (section: CompetitionSection) => {
    const first = raceSessions.find((s) => s.competitionSectionId === section.id && s.minutesPerHeat);
    return first?.minutesPerHeat ?? DEFAULT_MINUTES;
  };
  const racesFor = (s: Session): string[] => {
    const section = sectionOf(s);
    return drafts[s.id] ?? (s.heats[0]?.races.length ? s.heats[0].races.map((r) => r.name) : defaultRaceList('Zone', section?.format ?? 2, section?.ageGroup ?? ''));
  };

  const paidBySection = new Map<number, number>();
  for (const s of signups) if (s.status === 1) paidBySection.set(s.competitionSectionId, (paidBySection.get(s.competitionSectionId) ?? 0) + 1);
  const totalPaid = signups.filter((s) => s.status === 1).length;
  const totalPending = signups.filter((s) => s.status === 0).length;
  const generated = raceSessions.length > 0 && raceSessions.every((s) => s.heats.length > 0);
  const teamsFormed = competition.teams.length > 0;
  const steps = [
    { title: 'Close signups', meta: competition.signupsLocked ? 'Closed' : 'Open', done: !!competition.signupsLocked },
    { title: 'Form teams', meta: teamsFormed ? `${competition.teams.length} ${competition.teams.length === 1 ? 'team' : 'teams'}` : '', done: teamsFormed },
    { title: 'Sessions', meta: raceSessions.length ? `${raceSessions.filter((s) => s.heats.length > 0).length} of ${raceSessions.length} generated` : '', done: generated },
    { title: 'Ready to run', meta: '', done: false },
  ];
  const current = steps.findIndex((s) => !s.done);

  const eventStart = defaultEventStart(new Date(competition.startDate));
  const plan: PlanRow[] = planTimetable({
    eventStart,
    sessions: raceSessions.map((s) => {
      const section = sectionOf(s);
      return {
        id: s.id, name: s.name, arena: s.arenaName?.trim() ?? '', orderIndex: s.orderIndex, raceCount: racesFor(s).length,
        minutesPerHeat: s.minutesPerHeat ?? (section ? minutesFor(section) : DEFAULT_MINUTES), lanes: s.lanesPerHeat ?? lanesFor(section?.format ?? 2),
        teamCount: section ? activeTeams(section).length : 0,
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
  const saveSection = (section: CompetitionSection, patch: { usesRaceFinals?: boolean; runoffRaceName?: string | null; finalistCount?: number | null }) =>
    run(() => api.put(`/competitions/${competition.id}/sections/${section.id}`, {
      runoffRaceName: patch.runoffRaceName !== undefined ? patch.runoffRaceName : section.runoffRaceName ?? null,
      usesRaceFinals: patch.usesRaceFinals ?? section.usesRaceFinals ?? false,
      finalistCount: patch.finalistCount !== undefined ? patch.finalistCount : section.finalistCount ?? null,
    }), 'Could not save that age group.');

  const commitFinalists = (section: CompetitionSection) => {
    const text = (finalists[section.id] ?? '').trim();
    if (text === String(section.finalistCount ?? '')) return;
    const n = parseInt(text, 10);
    if (text && (!Number.isFinite(n) || n < 1 || n > 50)) { setError('Teams in finals must be a number from 1 to 50.'); return; }
    void saveSection(section, { finalistCount: text ? n : null });
  };

  const commitMinutes = (section: CompetitionSection) => {
    const text = (minutes[section.id] ?? '').trim();
    if (!text || text === String(minutesFor(section))) return;
    const n = parseInt(text, 10);
    if (!Number.isFinite(n) || n < 1 || n > 180) { setError('Minutes per heat must be a number from 1 to 180.'); return; }
    void run(async () => {
      for (const s of raceSessions.filter((x) => x.competitionSectionId === section.id)) {
        await api.put(`/competitions/${competition.id}/sessions/${s.id}/settings`, { minutesPerHeat: n });
      }
    }, 'Could not save the minutes per heat.');
  };

  const addSession = (section: CompetitionSection) => {
    const mine = raceSessions.filter((s) => s.competitionSectionId === section.id);
    const name = mine.length === 0 ? section.displayName : `${section.displayName} · Session ${mine.length + 1}`;
    const arena = mine.at(-1)?.arenaName?.trim() || arenas[0] || MAIN_ARENA;
    const order = competition.sessions.reduce((m, s) => Math.max(m, s.orderIndex), 0) + 1;
    return run(async () => {
      const { data } = await api.post<Session>(`/competitions/${competition.id}/sessions`, {
        competitionSectionId: section.id, name, arenaName: arena, scheduledStart: null, orderIndex: order, notes: null, isBreak: false,
        durationMinutes: null, kind: SessionKind.Race, location: null,
      });
      await api.put(`/competitions/${competition.id}/sessions/${data.id}/settings`, { minutesPerHeat: minutesFor(section) });
    }, 'Could not add the session.');
  };

  const updateSession = (s: Session, patch: { name?: string; arenaName?: string }) =>
    run(() => api.put(`/competitions/${competition.id}/sessions/${s.id}`, patch), 'Could not save that session.');

  const removeSession = (s: Session) => {
    if (!window.confirm(`Remove ${s.name}${s.heats.length ? ` and its ${s.heats.length} ${s.heats.length === 1 ? 'heat' : 'heats'}` : ''}?`)) return;
    void run(async () => {
      await api.delete(`/competitions/${competition.id}/sessions/${s.id}`);
      setDrafts(writeRaceDraft(competition.id, s.id, null));
    }, 'Could not remove the session.');
  };

  const saveRaces = (s: Session, races: string[]) => {
    setDrafts(writeRaceDraft(competition.id, s.id, races));
    setEditing(null);
    setNotice(`Race list saved for ${s.name}. It applies when you generate the timetable.`);
  };

  const toggleLock = () => run(() => api.post(`/competitions/${competition.id}/signups-locked`, { locked: !competition.signupsLocked }), 'Could not change signups.');

  async function generate() {
    const targets = raceSessions.filter((s) => !hasScores(s));
    const skipped = raceSessions.filter(hasScores);
    const withTeams = targets.filter((s) => { const section = sectionOf(s); return section && activeTeams(section).length > 0; });
    if (withTeams.length === 0) { setError('There are no teams to put in heats yet. Form teams first, and add a session for each age group.'); return; }
    const replacing = withTeams.filter((s) => s.heats.length > 0).length;
    if (!window.confirm(`Generate heats and start times for ${withTeams.length} ${withTeams.length === 1 ? 'session' : 'sessions'}?${replacing ? ` The ${replacing} that already have heats will get new ones.` : ''}${skipped.length ? ` ${skipped.length} already started or scored and will be left alone.` : ''}`)) return;
    const ok = await run(async () => {
      for (const s of withTeams) {
        const section = sectionOf(s)!;
        const row = planOf.get(s.id)!;
        await api.put(`/competitions/${competition.id}/sessions/${s.id}`, { scheduledStart: row.start.toISOString() });
        await api.post(`/competitions/${competition.id}/sessions/${s.id}/generate-heats`, {
          teamIds: activeTeams(section).map((t) => t.id), raceNames: racesFor(s), lanesPerHeat: s.lanesPerHeat ?? lanesFor(section.format), replaceExisting: true,
        });
        setDrafts(writeRaceDraft(competition.id, s.id, null));
      }
    }, 'Could not generate the timetable.');
    if (ok) setNotice(`Timetable generated for ${withTeams.length} ${withTeams.length === 1 ? 'session' : 'sessions'}.${skipped.length ? ` ${skipped.length} left alone because they had started.` : ''}`);
  }

  const startText = (s: Session) => {
    if (s.heats.length > 0 && s.scheduledStart) return `starts ${formatTime(new Date(s.scheduledStart))}`;
    const row = planOf.get(s.id);
    return s.heats.length > 0 ? 'no start time' : row && row.minutes > 0 ? `would start ${formatTime(row.start)}` : 'not generated yet';
  };
  const heatsText = (s: Session) => {
    if (s.heats.length > 0) return describeHeats(s.heats.map((h) => h.entries.length));
    const section = sectionOf(s);
    return section ? describeHeats(heatSizes(activeTeams(section).length, s.lanesPerHeat ?? lanesFor(section.format))) : 'not generated yet';
  };

  const editingSession = raceSessions.find((s) => s.id === editing) ?? null;
  const editingSection = editingSession ? sectionOf(editingSession) : undefined;
  const subtitle = [competition.name, competitionDateText(competition.startDate, competition.endDate), competition.location?.trim()].filter(Boolean).join(' · ');

  return (
    <div className="skin mx-auto flex w-full max-w-[880px] flex-col gap-9 pb-40 pt-6 sm:pt-10">
      <div className="flex flex-col gap-2.5">
        <h1 className="mg-display text-[44px] font-bold leading-none text-[rgb(var(--mg-heading))]">Format</h1>
        <p className="text-[15px] text-[rgb(var(--mg-muted))]">{subtitle}</p>
      </div>

      <ol aria-label="Steps" className="m-0 grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-4">
        {steps.map((step, i) => {
          const now = i === current;
          return (
            <li key={step.title} aria-current={now ? 'step' : undefined} className={`flex min-h-14 items-center gap-2.5 rounded-xl border-[1.5px] px-3 py-1.5 ${now ? 'border-[rgb(var(--mg-heading))] bg-[rgb(var(--mg-surface))]' : 'border-transparent'}`}>
              <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.done ? 'bg-[rgb(var(--mg-ok))] text-white' : now ? 'bg-[rgb(var(--mg-heading))] text-white' : 'border-2 border-[rgb(var(--mg-control))] text-[rgb(var(--mg-muted))]'}`}>
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

      {error && <p role="alert" className="mg-notice !bg-[rgb(var(--mg-live-row))] !text-[rgb(var(--mg-elim))]">{error}</p>}
      {notice && <p role="status" className="mg-notice">{notice}</p>}

      <Panel id="fm-lock" title="Close signups" done={!!competition.signupsLocked} meta={`${totalPaid} paid · ${totalPending} pending`}>
        <p className="text-sm text-[rgb(var(--mg-body))]">
          {competition.sections.length} age {competition.sections.length === 1 ? 'group' : 'groups'}. Pending signups won’t be put into teams until they’re marked paid.
        </p>
        <button type="button" onClick={() => void toggleLock()} disabled={busy} className="mg-btn mg-btn-secondary !min-h-11 self-start">
          {competition.signupsLocked ? <Unlock className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
          {competition.signupsLocked ? 'Re-open signups' : 'Close signups now'}
        </button>
      </Panel>

      <Panel id="fm-teams" title="Form teams" done={teamsFormed} meta={teamsFormed ? `${competition.teams.length} formed` : undefined}>
        {competition.sections.length === 0 ? (
          <p className="text-sm text-[rgb(var(--mg-muted))]">No age groups yet. Add at least one in Edit details before forming teams.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {teamsFormed && <p className="text-sm text-[rgb(var(--mg-body))]">Forming teams only creates teams from signups that aren’t in a team yet. Unused teams are replaced if you leave that box ticked.</p>}
            {competition.sections.map((sec) => (
              <FormTeamsSectionCard key={sec.id} competitionId={competition.id} section={sec} paidCount={paidBySection.get(sec.id) ?? 0} onChanged={reload} setError={setError} />
            ))}
          </div>
        )}
      </Panel>

      {competition.sections.map((section) => {
        const mine = raceSessions.filter((s) => s.competitionSectionId === section.id);
        const hhf = !!section.usesRaceFinals;
        const teamCount = activeTeams(section).length;
        return (
          <section key={section.id} aria-labelledby={`fm-sec-${section.id}`} className="flex flex-col gap-4">
            <PartHead id={`fm-sec-${section.id}`} title={section.displayName} meta={`${teamCount} ${SectionFormatLabel[section.format].toLowerCase()}`.replace(/^(\d+) individual$/, '$1 individuals')} />
            <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[200px_minmax(0,1fr)_150px_150px]">
              <div className="flex flex-col gap-2 text-[15px] font-medium">
                <span>Structure</span>
                <div role="radiogroup" aria-label={`Structure for ${section.displayName}`} className="flex min-h-12 gap-0.5 rounded-[10px] bg-[rgb(var(--mg-done-bg))] p-[3px]">
                  {([['Standard', false, undefined], ['HHF', true, 'Heat, heat, final']] as const).map(([label, value, aria]) => (
                    <button key={label} type="button" role="radio" aria-checked={hhf === value} aria-label={aria} disabled={busy} onClick={() => { if (hhf !== value) void saveSection(section, { usesRaceFinals: value }); }}
                      className={`flex-1 rounded-lg text-sm font-semibold ${hhf === value ? 'bg-[rgb(var(--mg-button))] text-white' : 'text-[rgb(var(--mg-body))]'}`}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-2 text-[15px] font-medium">
                <span>Run-off race</span>
                <FieldDrop label={`Run-off race for ${section.displayName}`} value={section.runoffRaceName ?? ''} onChange={(value) => void saveSection(section, { runoffRaceName: value || null })}
                  options={[{ value: '', label: 'None' }, ...(section.runoffRaceName && !templates.includes(section.runoffRaceName) ? [{ value: section.runoffRaceName, label: section.runoffRaceName }] : []), ...templates.map((name) => ({ value: name, label: name }))]} />
              </div>
              <label className="flex flex-col gap-2 text-[15px] font-medium">Teams in finals
                <span className="mg-field !min-h-12"><input inputMode="numeric" value={finalists[section.id] ?? String(section.finalistCount ?? '')} onChange={(e) => setFinalists({ ...finalists, [section.id]: e.target.value })} onBlur={() => commitFinalists(section)} /></span>
              </label>
              <label className="flex flex-col gap-2 text-[15px] font-medium">Minutes per heat
                <span className="mg-field !min-h-12"><input inputMode="numeric" value={minutes[section.id] ?? String(minutesFor(section))} onChange={(e) => setMinutes({ ...minutes, [section.id]: e.target.value })} onBlur={() => commitMinutes(section)} /><span className="text-sm text-[rgb(var(--mg-muted))]">min</span></span>
              </label>
            </div>

            <div className="mg-card overflow-visible">
              <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_200px_260px_40px] items-center gap-3 border-b border-[rgb(var(--mg-rule-soft))] py-2.5 pl-4 pr-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--mg-muted))] lg:grid">
                <span>Session</span><span>Arena</span><span>Races</span><span />
              </div>
              {mine.length === 0 && <p className="px-4 py-3 text-sm text-[rgb(var(--mg-muted))]">No sessions yet. Add one to give this age group a race list.</p>}
              <ul>
                {mine.map((s, i) => {
                  const races = racesFor(s);
                  return (
                    <li key={s.id} className={`grid min-h-[60px] grid-cols-[minmax(0,1fr)_40px] items-center gap-x-3 gap-y-2 py-1.5 pl-4 pr-3 lg:grid-cols-[minmax(0,1fr)_200px_260px_40px] ${i ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <SessionName key={`${s.id}-${s.name}`} session={s} disabled={busy} onCommit={(name) => void updateSession(s, { name })} />
                        <span className="text-xs text-[rgb(var(--mg-muted))]">{heatsText(s)} · {startText(s)}</span>
                      </span>
                      <button type="button" aria-label={`Remove ${s.name}`} disabled={busy} onClick={() => removeSession(s)} className="flex h-11 w-10 items-center justify-center text-[rgb(var(--mg-muted))] lg:order-last"><Trash2 className="h-[18px] w-[18px]" aria-hidden="true" /></button>
                      <FieldDrop label={`Arena for ${s.name}`} value={s.arenaName?.trim() || MAIN_ARENA} onChange={(arenaName) => void updateSession(s, { arenaName })} className="col-span-2 lg:col-span-1"
                        options={[...new Set([s.arenaName?.trim() || MAIN_ARENA, ...arenas, MAIN_ARENA, `Arena ${arenas.length + 1}`])].map((name) => ({ value: name, label: name }))} />
                      <button type="button" onClick={() => setEditing(s.id)} className="col-span-2 flex min-h-11 min-w-0 items-center gap-1.5 rounded-[10px] border-[1.5px] border-[rgb(var(--mg-control))] px-2.5 text-left lg:col-span-1" aria-label={`Races for ${s.name}: ${races.length} races`}>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-sm font-semibold">{races.slice(0, 2).join(', ')}{races.length > 2 ? '…' : ''}</span><span className="text-[11px] text-[rgb(var(--mg-muted))]">{races.length} races{drafts[s.id] ? ' · not generated yet' : ''}</span></span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--mg-heading))]" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hhf && (
                <div className="flex min-h-[52px] items-center gap-2.5 border-t border-[rgb(var(--mg-rule-soft))] bg-[rgb(var(--mg-ground))] px-4 py-1 text-sm text-[rgb(var(--mg-body))]">
                  <strong className="font-semibold text-[rgb(var(--mg-ink))]">Final</strong>after each race, from the top of each heat
                </div>
              )}
              <button type="button" onClick={() => void addSession(section)} disabled={busy || (hhf && mine.length >= 1)} title={hhf && mine.length >= 1 ? 'Heat, heat, final uses one session' : undefined}
                className="flex min-h-[52px] w-full items-center gap-2.5 border-t border-[rgb(var(--mg-rule-soft))] px-4 text-left text-[15px] font-semibold text-[rgb(var(--mg-heading))] disabled:opacity-50">
                <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />Add a session
              </button>
            </div>
          </section>
        );
      })}

      {preview && (
        <section aria-labelledby="fm-preview" className="flex flex-col gap-4">
          <PartHead id="fm-preview" title="Timetable preview" meta="Nothing is saved until you generate" />
          <ul className="mg-card mg-list">
            {plan.length === 0 && <li className="p-4 text-sm text-[rgb(var(--mg-muted))]">No sessions yet.</li>}
            {[...plan].sort((a, b) => a.start.getTime() - b.start.getTime()).map((row) => (
              <li key={row.id} className="grid min-h-14 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 py-1 pl-4 pr-3">
                <span className="mg-line-time">{row.minutes > 0 ? formatTime(row.start) : '–'}</span>
                <span className="flex min-w-0 flex-col gap-0.5"><strong className="truncate text-[15px] font-semibold">{row.name}</strong><span className="text-xs text-[rgb(var(--mg-muted))]">{row.arena || MAIN_ARENA} · {describeHeats(row.sizes)}</span></span>
                <span className="text-[13px] text-[rgb(var(--mg-muted))]">{row.minutes > 0 ? `${row.minutes} min` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="fm-breaks" className="flex flex-col gap-4">
        <PartHead id="fm-breaks" title="Breaks and briefings" />
        <div className="mg-card overflow-hidden">
          {fixedItems.length === 0 && <p className="px-4 py-3 text-sm text-[rgb(var(--mg-muted))]">None yet.</p>}
          <ul>
            {fixedItems.map((b, i) => (
              <li key={b.id} className={`grid min-h-14 grid-cols-[64px_minmax(0,1fr)_auto_40px] items-center gap-3 py-1 pl-4 pr-3 ${i ? 'border-t border-[rgb(var(--mg-rule-soft))]' : ''}`}>
                <span className="mg-line-time">{b.scheduledStart ? formatTime(new Date(b.scheduledStart)) : '–'}</span>
                <span className="flex min-w-0 flex-col gap-0.5"><strong className="truncate text-[15px] font-semibold">{b.name}</strong><span className="text-xs text-[rgb(var(--mg-muted))]">{[b.arenaName?.trim() || 'All arenas', b.location?.trim()].filter(Boolean).join(' · ')}</span></span>
                <span className="text-[13px] text-[rgb(var(--mg-muted))]">{b.durationMinutes ? `${b.durationMinutes} min` : ''}</span>
                <button type="button" aria-label={`Remove ${b.name}`} disabled={busy} onClick={() => removeSession(b)} className="flex h-11 w-10 items-center justify-center text-[rgb(var(--mg-muted))]"><Trash2 className="h-[18px] w-[18px]" aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          <Link to={`/competitions/${competition.id}`} className="flex min-h-[52px] items-center gap-2.5 border-t border-[rgb(var(--mg-rule-soft))] px-4 text-[15px] font-semibold !text-[rgb(var(--mg-heading))]">
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />Add a break or briefing
            <span className="ml-auto text-xs font-medium text-[rgb(var(--mg-muted))]">on the timetable</span>
          </Link>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="mg-meta">Ready to run:</span>
        <Link to={`/competitions/${competition.id}`} className="mg-small-btn">Timetable</Link>
        <Link to={`/competitions/${competition.id}/declarations`} className="mg-small-btn">Dec forms</Link>
        <Link to={`/competitions/${competition.id}/details`} className="mg-small-btn">Equipment list</Link>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))]">
        <div className="mx-auto max-w-5xl px-3 sm:px-4">
          <div className="mx-auto flex max-w-[880px] flex-wrap items-center gap-3 py-4">
            <span className="min-w-40 flex-1 text-sm font-medium text-[rgb(var(--mg-muted))]">Start times come from Generate</span>
            <button type="button" onClick={() => setPreview(!preview)} aria-pressed={preview} className="mg-btn mg-btn-secondary !min-h-[50px] !rounded-[10px] !px-[18px] !text-base">Preview timetable</button>
            <button type="button" onClick={() => void generate()} disabled={busy} className="mg-btn mg-btn-primary !min-h-[50px] !rounded-[10px] !px-[18px] !text-base">{busy ? 'Working…' : 'Generate timetable'}</button>
          </div>
        </div>
      </footer>

      {editingSession && (
        <RaceListDialog title={`Races for ${editingSession.name}`} races={racesFor(editingSession)} format={editingSection?.format ?? 2} ageGroup={editingSection?.ageGroup ?? ''}
          templates={templates} onSave={(races) => saveRaces(editingSession, races)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** A step of the format: its title with a tick when done, and what to do. Done steps start folded away. */
function Panel({ id, title, done, meta, children }: { id: string; title: string; done: boolean; meta?: string; children: ReactNode }) {
  const [open, setOpen] = useState(!done);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 border-b-2 border-[rgb(var(--mg-heading))] pb-2">
        <h2 id={id} className="mg-display flex-1 text-[22px] font-bold uppercase leading-none tracking-[0.03em] text-[rgb(var(--mg-heading))]">{title}</h2>
        {meta && <span className="text-[13px] font-medium leading-none text-[rgb(var(--mg-muted))]">{meta}</span>}
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)} className="-my-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-[rgb(var(--mg-heading))]">
          {open ? 'Hide' : done ? 'Change' : 'Show'}<ChevronDown className={`h-4 w-4 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {open && <div id={`${id}-body`} className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}

/** The session's name, editable in place; saved when the person leaves the box. */
function SessionName({ session, disabled, onCommit }: { session: Session; disabled: boolean; onCommit: (name: string) => void }) {
  const [value, setValue] = useState(session.name);
  return (
    <input aria-label={`Name of ${session.name}`} value={value} disabled={disabled} maxLength={120} onChange={(e) => setValue(e.target.value)}
      onBlur={() => { const next = value.trim(); if (next && next !== session.name) onCommit(next); else setValue(session.name); }}
      className="min-h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 text-[15px] font-semibold hover:border-[rgb(var(--mg-rule))] focus:border-[rgb(var(--mg-heading))] focus:outline-none" />
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
      setError(message(e, 'Preview failed.'));
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
      setError(message(e, 'Form-teams failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mg-card space-y-3 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{section.displayName}</span>
        <span className="text-xs text-[rgb(var(--mg-muted))]">{paidCount} paid signup{paidCount === 1 ? '' : 's'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Riders per team
          <NumberField
            
            min={1} max={12}
            className="input !w-16 !py-1.5 text-sm"
            value={ridersPerTeam}
            onChange={(e) => setRidersPerTeam(Math.max(1, parseInt(e.target.value, 10) || defaultSize))}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
          Replace unused existing teams
        </label>
        <button onClick={runPreview} disabled={busy || paidCount === 0} className="mg-btn mg-btn-secondary !min-h-11 !px-3 !text-sm">
          {busy && !committed ? 'Working…' : 'Preview'}
        </button>
        <button onClick={commit} disabled={busy || paidCount === 0} className="mg-btn mg-btn-primary !min-h-11 !px-3 !text-sm">
          <Check className="h-4 w-4" aria-hidden="true" /> Create teams
        </button>
      </div>
      {preview && (
        <div className="space-y-1 rounded-lg bg-[rgb(var(--mg-subtle))] p-2.5 text-xs">
          <p className="font-semibold">
            {committed ? '✔ Created' : 'Preview'} · {preview.teams.length} team{preview.teams.length === 1 ? '' : 's'} from {preview.paidSignups} signup{preview.paidSignups === 1 ? '' : 's'}
          </p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {preview.teams.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="whitespace-nowrap font-semibold">{t.clubName} {t.suffix}</span>
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
