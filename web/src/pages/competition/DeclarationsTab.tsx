import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Download } from 'lucide-react';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import type { DeclarationForm, SectionSignup, Team } from '../../types';
import { downloadCsv, safeFilename } from '../../lib/csv';
import { decFormsCsv } from '../../lib/decFormCsv';
import { decDraftKey, parseDraft, ridersRequired, type DecFormDraft } from '../../lib/decForm';
import { DecFormEditor } from './decform/DecFormEditor';
import { DecFormList } from './DecFormList';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { parseConfigResponse, STANDARD_CONFIG, type DecFormConfig } from '../../lib/decFormConfig';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

interface LockTimeInfo {
  competitionId: number;
  declarationsCloseAt: string | null;
  isClosed: boolean;
}

function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readDraft(competitionId: number, teamId: number, required: number): DecFormDraft | null {
  try { return parseDraft(localStorage.getItem(decDraftKey(competitionId, teamId)), required); } catch { return null; }
}

export function DeclarationsTab() {
  usePageWidth('wide');
  const desktop = useIsDesktop();
  const { competition } = useCompetition();
  const { user, hasRole, canOrganise } = useAuth();
  const [params] = useSearchParams();
  // null until the forms have come back, so the editor starts from the team's real declaration.
  const [forms, setForms] = useState<DeclarationForm[] | null>(null);
  const [signupResult, setSignupResult] = useState<{ userId: string; items: (SectionSignup & { competitionId?: number; declarationAccessGranted?: boolean; linkedTeams?: { id: number; name: string }[] })[] } | null>(null);
  const signupUserId = user?.id;
  const [chosen, setChosen] = useState<number | null>(null);
  // What this competition's dec form asks. Null until it has come back; the standard form if it can't be fetched.
  const [config, setConfig] = useState<DecFormConfig | null>(null);

  const [lockInfo, setLockInfo] = useState<LockTimeInfo | null>(null);
  const [lockInput, setLockInput] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isOrganiser = hasRole('Admin') || canOrganise(competition);
  const declarationsClosed = Boolean(lockInfo?.declarationsCloseAt && (lockInfo.isClosed || now >= new Date(lockInfo.declarationsCloseAt).getTime()));

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(api.get<LockTimeInfo>(`/declaration-forms/competition/${competition.id}/lock-time`))
      .then((r) => {
        if (!cancelled && r?.data) {
          setLockInfo(r.data);
          setLockInput(toLocalDateTimeInput(r.data.declarationsCloseAt));
        }
      })
      .catch(() => { if (!cancelled) setLockInfo(null); });
    return () => { cancelled = true; };
  }, [competition.id]);

  async function updateLockTime(iso: string | null) {
    setLockBusy(true);
    setLockError('');
    try {
      const { data } = await api.put<LockTimeInfo>(
        `/declaration-forms/competition/${competition.id}/lock-time`,
        { declarationsCloseAt: iso },
      );
      setLockInfo(data);
      setLockInput(toLocalDateTimeInput(data.declarationsCloseAt));
    } catch {
      setLockError('Couldn’t save the dec form deadline. Check your signal and try again.');
    } finally {
      setLockBusy(false);
    }
  }

  useEffect(() => {
    if (!signupUserId) return;
    let cancelled = false;
    Promise.resolve(api.get<(SectionSignup & { competitionId?: number; declarationAccessGranted?: boolean; linkedTeams?: { id: number; name: string }[] })[]>('/me/signups'))
      .then((r) => { if (!cancelled && Array.isArray(r?.data)) setSignupResult({ userId: signupUserId, items: r.data }); })
      .catch(() => { if (!cancelled) setSignupResult({ userId: signupUserId, items: [] }); });
    return () => { cancelled = true; };
  }, [signupUserId]);

  // Trainers submit for the teams they coach, a club's Team Manager for any team of their club,
  // and self-entered riders for their own team/pair/individual entry.
  // Admins and people who organise this competition can submit for any team. The API enforces the same rule.
  const myTeams = useMemo(() => {
    if (hasRole('Admin') || canOrganise(competition)) return competition.teams;
    if (!user) return [];
    const manager = hasRole('Manager') && user.clubId != null;
    const mySignups = signupResult?.userId === user.id ? signupResult.items : [];
    const compSignups = mySignups.filter((s) => s.competitionId === competition.id && s.declarationAccessGranted === true && (s.status === 0 || s.status === 1));
    return competition.teams.filter((t) =>
      t.trainerUserId === user.id
      || (manager && t.clubId === user.clubId)
      || compSignups.some((s) => (s.teamId === t.id || s.linkedTeams?.some((linked) => linked.id === t.id)) && s.competitionSectionId === t.competitionSectionId)
    );
  }, [competition, hasRole, canOrganise, user, signupResult]);

  useEffect(() => {
    let cancelled = false;
    api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId: competition.id } })
      .then((r) => { if (!cancelled) setForms(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setForms([]); });
    return () => { cancelled = true; };
  }, [competition.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: DecFormConfig = STANDARD_CONFIG;
      try {
        const { data } = await api.get(`/competitions/${competition.id}/dec-form-config`);
        loaded = parseConfigResponse(data)?.config ?? STANDARD_CONFIG;
      } catch { /* the standard form is a safe fallback */ }
      if (!cancelled) setConfig(loaded);
    })();
    return () => { cancelled = true; };
  }, [competition.id]);

  // The link from the profile names the team; otherwise a half-done form comes back, and a lone team opens itself.
  const wanted = Number(params.get('team'));
  const requiredFor = (t: Team) => ridersRequired(competition.sections.find((s) => s.id === t.competitionSectionId)?.format);
  const withDraft = useMemo(
    () => myTeams.find((t) => readDraft(competition.id, t.id, ridersRequired(competition.sections.find((s) => s.id === t.competitionSectionId)?.format)) !== null),
    [competition.id, competition.sections, myTeams],
  );
  const automatic = myTeams.find((t) => t.id === wanted) ?? withDraft ?? (myTeams.length === 1 ? myTeams[0] : undefined);
  const team = myTeams.find((t) => t.id === chosen) ?? automatic;
  const existing = team ? forms?.find((f) => f.teamId === team.id) : undefined;
  // Read when a team is opened, so unfinished work comes back but a form that has since been sent doesn't.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the draft is only looked up when the team changes
  const draft = useMemo(() => (team ? readDraft(competition.id, team.id, requiredFor(team)) : null), [competition.id, team?.id]);
  const priorPhone = forms?.find((f) => f.submittedByUserId === user?.id && f.submittedByPhone)?.submittedByPhone ?? undefined;

  async function remove(id: number) {
    const target = forms?.find((f) => f.id === id);
    if (!(await confirmDialog({ title: 'Delete this dec form?', message: `The dec form for ${target?.teamName ?? 'this team'} goes for good.`, confirmLabel: 'Delete dec form', destructive: true }))) return;
    setDeleteError('');
    try {
      await api.delete(`/declaration-forms/${id}`);
      setForms((cur) => cur?.filter((f) => f.id !== id) ?? cur);
    } catch {
      setDeleteError('Couldn’t delete the dec form. Check your signal and try again.');
    }
  }

  function saved(form: DeclarationForm) {
    setForms((cur) => [form, ...(cur ?? []).filter((f) => f.teamId !== form.teamId)]);
  }

  function exportCsv() {
    downloadCsv(`${safeFilename(competition.name)}-dec-forms.csv`, decFormsCsv(forms ?? [], (config ?? STANDARD_CONFIG).customFields));
  }

  const count = forms?.length ?? 0;

  const teamRail = desktop && user != null && myTeams.length > 1;
  const editor = declarationsClosed && !isOrganiser ? null : team && forms && config && (
    <DecFormEditor key={team.id} competition={competition} team={team} existing={existing} draft={draft}
      priorPhone={priorPhone} onSaved={saved} config={config} />
  );
  const cards = (
    <DecFormList
      forms={forms ?? []}
      teams={competition.teams}
      sections={competition.sections}
      config={config ?? STANDARD_CONFIG}
      canDelete={(f) => isOrganiser || (!declarationsClosed && user != null && (f.submittedByUserId === user.id || myTeams.some((t) => t.id === f.teamId)))}
      onDelete={(f) => void remove(f.id)}
    />
  );
  const rail = (
    <nav aria-label="Teams" className="mg-card overflow-hidden">
      <h2 className="mg-display border-b-2 border-[rgb(var(--mg-heading))] px-3 py-2 text-[15px] font-bold uppercase tracking-[0.05em] text-[rgb(var(--mg-heading))]">Your teams</h2>
      <ul className="m-0 max-h-[70dvh] list-none overflow-y-auto p-0">
        {myTeams.map((t) => (
          <li key={t.id} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
            <button type="button" aria-pressed={team?.id === t.id} onClick={() => setChosen(t.id)}
              className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-[15px] ${team?.id === t.id ? 'bg-[rgb(var(--mg-tint))] font-bold text-[rgb(var(--mg-heading))]' : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`}>
              <span className="min-w-0 flex-1 truncate">{t.displayName}</span>
              {forms?.some((f) => f.teamId === t.id) && <Check aria-label="Dec form sent" className="h-4 w-4 shrink-0" />}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
  const exportButton = (
    <div className="flex justify-end">
      <button onClick={exportCsv} disabled={count === 0} className="mg-small-btn gap-1.5 !min-h-9 !px-3 !text-xs" title="Download all submitted dec forms as CSV">
        <Download className="h-3.5 w-3.5" /> Export CSV ({count})
      </button>
    </div>
  );

  const deadlineHeader = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isOrganiser ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-[rgb(var(--mg-body))]">
              <span>Declaration deadline (set lock time)</span>
              <input
                type="datetime-local"
                aria-label="Declaration deadline"
                value={lockInput}
                onChange={(e) => setLockInput(e.target.value)}
                className="rounded border border-[rgb(var(--mg-rule))] bg-[rgb(var(--mg-surface))] px-2.5 py-1.5 text-xs text-[rgb(var(--mg-ink))]"
              />
            </label>
            <button
              type="button"
              disabled={lockBusy || !lockInput}
              onClick={() => void updateLockTime(lockInput ? new Date(lockInput).toISOString() : null)}
              className="btn-ghost !px-3 !py-1.5 text-xs font-semibold"
            >
              Set lock time
            </button>
            {lockInfo?.declarationsCloseAt && (
              <button
                type="button"
                disabled={lockBusy}
                onClick={() => void updateLockTime(null)}
                className="btn-ghost !px-3 !py-1.5 text-xs"
              >
                Clear lock time
              </button>
            )}
          </div>
        ) : <div />}
        {isOrganiser && exportButton}
      </div>
      {lockInfo?.declarationsCloseAt && (
        declarationsClosed ? (
          <Notice
            tone="info"
            actionLabel={isOrganiser ? undefined : 'Message the organisers'}
            actionTo={isOrganiser ? undefined : `/competitions/${competition.id}/contact`}
          >
            Dec forms closed on {new Date(lockInfo.declarationsCloseAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.
            {!isOrganiser && ' Contact the organiser for an emergency change.'}
          </Notice>
        ) : (
          <Notice tone="info">Dec form deadline: {new Date(lockInfo.declarationsCloseAt).toLocaleString()}.</Notice>
        )
      )}

      {lockError && <Notice>{lockError}</Notice>}
      {deleteError && <Notice onDismiss={() => setDeleteError('')}>{deleteError}</Notice>}
    </>
  );

  if (teamRail) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        {deadlineHeader}
        <PageGrid variant="left" aside={rail}>
          <div className="flex flex-col gap-3">{editor}{cards}</div>
        </PageGrid>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {deadlineHeader}

      {!user ? (
        <div className="flex items-center gap-3">
          <p className="ev-body m-0 flex-1 !text-[15px] !text-[rgb(var(--mg-ink))]">Trainers sign in to send dec forms for their teams.</p>
          <Link to="/login" state={{ from: `/competitions/${competition.id}/declarations` }} className="sp-pill !min-h-9 !px-3.5 !text-sm">Sign in</Link>
        </div>
      ) : declarationsClosed && !isOrganiser ? null : myTeams.length === 0 ? (
        <p className="text-sm text-[rgb(var(--mg-muted))]">You have no teams in this competition.</p>
      ) : (
        <>
          {myTeams.length > 1 && (
            <div role="group" aria-label="Choose a team" className="mg-chips">
              {myTeams.map((t) => (
                <button key={t.id} type="button" className="mg-chip" aria-pressed={team?.id === t.id} onClick={() => setChosen(t.id)}>
                  {forms?.some((f) => f.teamId === t.id) && <Check aria-hidden="true" className="h-4 w-4" />}
                  {t.displayName}
                </button>
              ))}
            </div>
          )}
          {editor}
        </>
      )}

      {cards}
    </div>
  );
}
