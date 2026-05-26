import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Sparkles, Lock, Unlock, Users, ChevronLeft, AlertTriangle,
  Check, Wand2, ArrowRight, Layers, Hammer,
} from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import type {
  CompetitionDetail, CompetitionSection, FormTeamsResult, SectionSignup,
} from '../../types';

/**
 * Format-after-signups wizard. Runs after entries close: walks an organiser
 * from "lock signups" through "auto-bin paid signups into teams" and finishes
 * by handing off to the full editor wizard to pick sessions / races / lanes.
 *
 * Designed so the organiser can do it in ~3 clicks if defaults are fine, but
 * still see what's about to happen (preview) before they commit.
 */
export function FormatPage() {
  const { id } = useParams<{ id: string }>();
  const editingId = id ? parseInt(id, 10) : null;
  const { canOrganise } = useAuth();
  const navigate = useNavigate();

  const [comp, setComp] = useState<CompetitionDetail | null>(null);
  const [signups, setSignups] = useState<SectionSignup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!editingId) return;
    const [c, s] = await Promise.all([
      api.get<CompetitionDetail>(`/competitions/${editingId}`).then((r) => r.data),
      api.get<SectionSignup[]>(`/competitions/${editingId}/signups`).then((r) => r.data),
    ]);
    setComp(c);
    setSignups(s);
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [editingId]);

  async function toggleLock() {
    if (!comp || busy) return;
    setBusy(true);
    try {
      await api.post(`/competitions/${comp.id}/signups-locked`, { locked: !comp.signupsLocked });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (!comp) return <div className="card p-4 text-sm text-slate-500">Loading…</div>;

  if (!canOrganise()) {
    return (
      <div className="card p-4 text-sm">
        Organiser tools are restricted to admins and trainers who created the competition.
        <Link to={`/competitions/${comp.id}`} className="ml-2 btn-primary !py-1 !px-3 text-xs">Back to comp</Link>
      </div>
    );
  }

  const paidBySection = new Map<number, SectionSignup[]>();
  for (const s of signups) {
    if (s.status !== 1) continue;
    if (!paidBySection.has(s.competitionSectionId)) paidBySection.set(s.competitionSectionId, []);
    paidBySection.get(s.competitionSectionId)!.push(s);
  }

  const totalPaid = signups.filter((s) => s.status === 1).length;
  const totalPending = signups.filter((s) => s.status === 0).length;
  const teamsAlreadyCreated = comp.teams.length;
  const sessionsAlreadyCreated = comp.sessions.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to={`/competitions/${comp.id}`} className="btn-ghost !py-1.5 !px-2.5 text-sm">
          <ChevronLeft className="w-4 h-4" /> Back to comp
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-brand-600" /> Format competition
        </h1>
      </div>

      <div className="card p-4 space-y-2">
        <p className="text-sm">
          <span className="font-semibold">{comp.name}</span> — once entries are closed,
          this page bins paid signups into teams (by Pony Club, A/B/C…), then hands
          you over to the full editor to pick sessions, races and heat timings.
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          You can re-run any step if you've added more signups since the last attempt.
        </p>
      </div>

      {/* Step 1: Lock signups */}
      <div className="card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold">1</span>
          <h2 className="font-semibold text-base">Close signups</h2>
          <span className={`ml-auto text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
            comp.signupsLocked
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
          }`}>
            {comp.signupsLocked ? 'Closed' : 'Open'}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-300">
          {totalPaid} paid · {totalPending} pending across {comp.sections.length} section{comp.sections.length === 1 ? '' : 's'}.
          {totalPending > 0 && (
            <span className="ml-2 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Pending signups won't be auto-formed into teams until you mark them paid.
            </span>
          )}
        </p>
        <button
          onClick={toggleLock}
          disabled={busy}
          className={`btn-ghost !py-1 !px-2 text-xs ${
            comp.signupsLocked
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
          }`}
        >
          {comp.signupsLocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          {comp.signupsLocked ? 'Re-open signups' : 'Close signups now'}
        </button>
      </div>

      {/* Step 2: Form teams */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold">2</span>
          <h2 className="font-semibold text-base">Form teams from paid signups</h2>
        </div>
        {teamsAlreadyCreated > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
            {teamsAlreadyCreated} team{teamsAlreadyCreated === 1 ? '' : 's'} already exist on this comp. Forming teams
            here only creates new teams from signups that aren't linked to a team yet (unused teams may be replaced if you tick the option).
          </p>
        )}
        {comp.sections.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            No sections yet — go to the wizard and add at least one section before forming teams.
          </p>
        ) : (
          <div className="space-y-2">
            {comp.sections.map((sec) => (
              <FormTeamsSectionCard
                key={sec.id}
                competitionId={comp.id}
                section={sec}
                paidCount={paidBySection.get(sec.id)?.length ?? 0}
                onChanged={reload}
                setError={setError}
              />
            ))}
          </div>
        )}
      </div>

      {/* Step 3: Sessions / heats — link out to existing wizard */}
      <div className="card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold">3</span>
          <h2 className="font-semibold text-base">Set sessions, races and timings</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-300">
          With teams formed, jump into the full editor to pick race lists, lanes per heat and
          mins per heat for each section. Hitting Save generates heats from your formed teams.
        </p>
        <p className="text-[11px] text-slate-500">
          {sessionsAlreadyCreated > 0
            ? `${sessionsAlreadyCreated} session${sessionsAlreadyCreated === 1 ? '' : 's'} already configured.`
            : 'No sessions yet.'}
        </p>
        <Link
          to={`/admin/competitions/${comp.id}`}
          className="btn-primary !py-1.5 !px-3 text-sm w-fit"
        >
          <Wand2 className="w-4 h-4" /> Open editor wizard
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-400 text-white text-xs font-bold">
            <Check className="w-3 h-3" />
          </span>
          <h2 className="font-semibold text-base">Ready to run</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-300">
          Trainers can submit dec forms for their formed teams, stewards can mark eliminations
          from their phones, and the live scoring screen is ready for the day.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/competitions/${comp.id}`} className="btn-ghost !py-1 !px-2 text-xs">
            <Layers className="w-3 h-3" /> Timetable
          </Link>
          <Link to={`/competitions/${comp.id}/declarations`} className="btn-ghost !py-1 !px-2 text-xs">
            <Users className="w-3 h-3" /> Dec forms
          </Link>
          <Link to={`/competitions/${comp.id}/details`} className="btn-ghost !py-1 !px-2 text-xs">
            <Hammer className="w-3 h-3" /> Equipment list
          </Link>
        </div>
      </div>

      {error && (
        <div className="card p-3 text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30">
          {error}
        </div>
      )}

      <button
        onClick={() => navigate(`/competitions/${comp.id}`)}
        className="btn-ghost !py-1.5 !px-3 text-sm w-fit"
      >
        <ChevronLeft className="w-4 h-4" /> Done — back to comp
      </button>
    </div>
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
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Preview failed.');
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
      const msg = (e as { response?: { data?: { message?: string } | string } }).response?.data;
      setError(typeof msg === 'string' ? msg : msg?.message ?? 'Form-teams failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm flex-1 truncate">{section.displayName}</span>
        <span className="text-[11px] text-slate-500">{paidCount} paid signup{paidCount === 1 ? '' : 's'}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="flex items-center gap-1">
          Riders per team
          <input
            type="number"
            min={1} max={12}
            className="input !py-0.5 !px-1 w-14 text-xs"
            value={ridersPerTeam}
            onChange={(e) => setRidersPerTeam(Math.max(1, parseInt(e.target.value, 10) || defaultSize))}
          />
        </label>
        <label className="flex items-center gap-1 text-[11px]">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
          />
          Replace unused existing teams
        </label>
        <button
          onClick={runPreview}
          disabled={busy || paidCount === 0}
          className="btn-ghost !py-1 !px-2 text-[11px]"
        >
          {busy && !committed ? 'Working…' : 'Preview'}
        </button>
        <button
          onClick={commit}
          disabled={busy || paidCount === 0}
          className="btn-primary !py-1 !px-2 text-[11px]"
        >
          <Check className="w-3 h-3" /> Create teams
        </button>
      </div>
      {preview && (
        <div className="rounded bg-slate-50 dark:bg-slate-800/50 p-2 text-[11px] space-y-1">
          <p className="font-semibold text-slate-700 dark:text-slate-200">
            {committed ? '✔ Created' : 'Preview'} · {preview.teams.length} team{preview.teams.length === 1 ? '' : 's'} from {preview.paidSignups} signup{preview.paidSignups === 1 ? '' : 's'}
          </p>
          <ul className="space-y-0.5 max-h-48 overflow-y-auto">
            {preview.teams.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold whitespace-nowrap">{t.clubName} {t.suffix}</span>
                <span className="text-slate-500 truncate">{t.riderNames.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default FormatPage;
