import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { QrCode } from '../../components/QrCode';
import { useCompetition } from './context';
import { useAuth } from '../../auth/AuthContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { api } from '../../api';
import type { DeclarationForm, SectionSignup, Team } from '../../types';
import { downloadCsv, safeFilename } from '../../lib/csv';
import { decFormsCsv } from '../../lib/decFormCsv';
import type { LockInfo } from '../../lib/decFormDeadline';
import { decDraftKey, decFormStat, parseDraft, ridersRequired, type DecFormDraft } from '../../lib/decForm';
import { DecFormEditor } from './decform/DecFormEditor';
import { DecFormList } from './DecFormList';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { Sheet } from '../../components/Sheet';
import { useDockAction } from '../../components/TickerContext';
import { RefineChoiceRow, RefineDateTimeRow } from '../refine/Refine';
import { PageGrid } from '../../components/PageGrid';
import { usePageWidth } from '../../components/pageWidthState';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { parseConfigResponse, STANDARD_CONFIG, type DecFormConfig } from '../../lib/decFormConfig';
import '../../components/sitePages.css';
import '../../components/eventPages.css';

function readDraft(competitionId: number, teamId: number, required: number): DecFormDraft | null {
  try { return parseDraft(localStorage.getItem(decDraftKey(competitionId, teamId)), required); } catch { return null; }
}

export function DeclarationsTab() {
  const { t, locale } = useLanguage();
  usePageWidth('wide');
  const desktop = useIsDesktop();
  const { competition } = useCompetition();
  const { user, hasRole, canOrganise } = useAuth();
  const [params] = useSearchParams();
  // null until the forms have come back, so the editor starts from the team's real declaration.
  const [forms, setForms] = useState<DeclarationForm[] | null>(null);
  const [signupResult, setSignupResult] = useState<{ userId: string; items: (SectionSignup & { competitionId?: number; declarationAccessGranted?: boolean; linkedTeams?: { id: number; name: string }[] })[] } | null>(null);
  const signupUserId = user?.id;
  const [showQr, setShowQr] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  // What this competition's dec form asks. Null until it has come back; the standard form if it can't be fetched.
  const [config, setConfig] = useState<DecFormConfig | null>(null);

  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
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
    Promise.resolve(api.get<LockInfo>(`/declaration-forms/competition/${competition.id}/lock-time`))
      .then((r) => {
        if (!cancelled && r?.data) {
          setLockInfo(r.data);
        }
      })
      .catch(() => { if (!cancelled) setLockInfo(null); });
    return () => { cancelled = true; };
  }, [competition.id]);

  async function updateLockTime(iso: string | null) {
    setLockBusy(true);
    setLockError('');
    try {
      const { data } = await api.put<LockInfo>(
        `/declaration-forms/competition/${competition.id}/lock-time`,
        { declarationsCloseAt: iso },
      );
      setLockInfo(data);
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
    if (!(await confirmDialog({ title: t('entries.tab.deleteTitle'), message: t('entries.tab.deleteMessage', { team: target?.teamName ?? t('entries.tab.thisTeam') }), confirmLabel: t('entries.tab.deleteConfirm'), destructive: true }))) return;
    setDeleteError('');
    try {
      await api.delete(`/declaration-forms/${id}`);
      setForms((cur) => cur?.filter((f) => f.id !== id) ?? cur);
    } catch {
      setDeleteError(t('entries.tab.deleteFailed'));
    }
  }

  function saved(form: DeclarationForm) {
    setForms((cur) => [form, ...(cur ?? []).filter((f) => f.teamId !== form.teamId)]);
  }

  function exportCsv() {
    downloadCsv(`${safeFilename(competition.name)}-dec-forms.csv`, decFormsCsv(forms ?? [], (config ?? STANDARD_CONFIG).customFields));
  }

  const count = forms?.length ?? 0;

  // Teams that are still in the event are the ones expected to send a form.
  const expected = competition.teams.filter((item) => !item.isWithdrawn);
  const formsIn = expected.filter((item) => forms?.some((f) => f.teamId === item.id)).length;
  const stat = forms !== null && expected.length > 0 && (
    <p className="sp-note !m-0" role="status">{decFormStat(formsIn, expected.length)}</p>
  );
  // Organisers' tools (deadline, QR code, export) sit behind the dock button; with no dock they stay on the page.
  const [toolsOpen, setToolsOpen] = useState(false);
  const docked = useDockAction(isOrganiser ? { label: t('entries.tab.toolsTitle'), icon: 'settings', onClick: () => setToolsOpen(true) } : null);
  const inSheet = docked && isOrganiser;
  // With the tools in the sheet, an organiser's page opens on the search; the team they fill a form for is chosen there.
  const organiserLayout = inSheet;
  const teamRail = desktop && user != null && myTeams.length > 1;
  const editor = declarationsClosed && !isOrganiser ? null : team && forms && config && (
    <DecFormEditor key={team.id} competition={competition} team={team} existing={existing} draft={draft}
      priorPhone={priorPhone} onSaved={saved} config={config} lockInfo={lockInfo}
      onDelete={isOrganiser || !declarationsClosed ? (f) => void remove(f.id) : undefined} />
  );
  const cards = (
    <DecFormList
      forms={forms ?? []}
      teams={competition.teams}
      sections={competition.sections}
      config={config ?? STANDARD_CONFIG}
      canDelete={(f) => isOrganiser || (!declarationsClosed && user != null && (f.submittedByUserId === user.id || myTeams.some((t) => t.id === f.teamId)))}
      onDelete={(f) => void remove(f.id)}
      summary={organiserLayout ? stat : undefined}
    />
  );
  const rail = (
    <nav aria-label={t('entries.tab.teams')} className="mg-card overflow-hidden">
      <h2 className="mg-display border-b-2 border-[rgb(var(--mg-heading))] px-3 py-2 text-[15px] font-bold uppercase tracking-[0.05em] text-[rgb(var(--mg-heading))]">{t('entries.tab.yourTeams')}</h2>
      <ul className="m-0 max-h-[70dvh] list-none overflow-y-auto p-0">
        {myTeams.map((item) => (
          <li key={item.id} className="border-b border-[rgb(var(--mg-rule-soft))] last:border-b-0">
            <button type="button" aria-pressed={team?.id === item.id} onClick={() => setChosen(item.id)}
              className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-[15px] ${team?.id === item.id ? 'bg-[rgb(var(--mg-tint))] font-bold text-[rgb(var(--mg-heading))]' : 'font-medium text-[rgb(var(--mg-ink))] hover:bg-[rgb(var(--mg-subtle))]'}`}>
              <span className="min-w-0 flex-1 truncate">{item.displayName}</span>
              {forms?.some((f) => f.teamId === item.id) && <Check aria-label={t('entries.tab.formSent')} className="h-4 w-4 shrink-0" />}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
  const exportButton = (
    <button type="button" onClick={exportCsv} disabled={count === 0} className="sp-pill sp-pill-sm disabled:opacity-50" title={t('entries.tab.exportTitle')}>
      {t('entries.tab.exportCsv', { count })}
    </button>
  );

  const qr = (
    <div className="sp-card">
      <button type="button" className="sp-row" aria-expanded={showQr} onClick={() => setShowQr((open) => !open)}>
        <span className="sp-grow"><span className="sp-t1 !font-medium">{t('entries.tab.showQr')}</span></span>
        <ChevronRight aria-hidden="true" className={`sp-chev h-4 w-4 transition-transform ${showQr ? 'rotate-90' : ''}`} strokeWidth={2.5} />
      </button>
      {showQr && (
        <div className="flex items-center gap-3 border-t border-[rgb(var(--mg-rule-soft))] px-4 py-3">
          <QrCode value={`${window.location.origin}/competitions/${competition.id}/declarations`} label={t('entries.tab.qrLabel', { name: competition.name })} className="w-36 rounded-lg border border-[rgb(var(--mg-rule))] bg-white p-2" />
          <p className="m-0 text-xs text-[rgb(var(--mg-muted))]">{t('entries.tab.qrScan', { name: competition.name })}</p>
        </div>
      )}
    </div>
  );
  const exportFooter = isOrganiser && !inSheet && <div className="flex justify-end">{exportButton}</div>;
  const deadlineRow = (
    <div className="sp-card">
      <RefineDateTimeRow label={t('entries.tab.formsClose')} value={lockInfo?.declarationsCloseAt ?? null} disabled={lockBusy}
        eventDays={[new Date(competition.startDate)].filter((d) => !Number.isNaN(d.getTime()))} onChange={(iso) => { void updateLockTime(iso); }} />
    </div>
  );
  const toolsSheet = inSheet && toolsOpen && (
    <Sheet title={t('entries.tab.toolsTitle')} onClose={() => setToolsOpen(false)}>
      <div className="flex flex-col gap-3">
        {deadlineRow}
        {myTeams.length > 1 && (
          <div className="sp-card">
            <RefineChoiceRow label={t('entries.tab.fillFor')} value={String(chosen ?? '')} placeholder={t('entries.tab.chooseTeam')}
              options={myTeams.map((item) => ({ value: String(item.id), label: item.displayName }))}
              onChange={(value) => { setChosen(Number(value)); setToolsOpen(false); }} />
          </div>
        )}
        {qr}
        <div className="flex justify-end">{exportButton}</div>
      </div>
    </Sheet>
  );

  const deadlineHeader = (
    <>
      {isOrganiser && !inSheet && <div className="flex flex-col gap-2">{deadlineRow}</div>}
      {lockInfo?.declarationsCloseAt && declarationsClosed && (
        <Notice
          tone="info"
          actionLabel={isOrganiser ? undefined : t('entries.tab.messageOrganisers')}
          actionTo={isOrganiser ? undefined : `/competitions/${competition.id}/contact`}
        >
          {t('entries.tab.closedOn', { date: new Date(lockInfo.declarationsCloseAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) })}
          {!isOrganiser && t('entries.tab.contactOrganiser')}
        </Notice>
      )}

      {lockError && <Notice>{lockError}</Notice>}
      {deleteError && <Notice onDismiss={() => setDeleteError('')}>{deleteError}</Notice>}
      {!organiserLayout && stat}
      {!inSheet && qr}
    </>
  );

  if (teamRail) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        {deadlineHeader}
        <PageGrid variant="left" aside={rail}>
          <div className="flex flex-col gap-3">{editor}{cards}</div>
        </PageGrid>
        {exportFooter}
        {toolsSheet}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {deadlineHeader}

      {!user ? (
        <div className="flex items-center gap-3">
          <p className="ev-body m-0 flex-1 !text-[15px] !text-[rgb(var(--mg-ink))]">{t('entries.tab.signInPrompt')}</p>
          <Link to="/login" state={{ from: `/competitions/${competition.id}/declarations` }} className="sp-pill !min-h-9 !px-3.5 !text-sm">{t('common.signIn')}</Link>
        </div>
      ) : declarationsClosed && !isOrganiser ? null : myTeams.length === 0 ? (
        <p className="text-sm text-[rgb(var(--mg-muted))]">{t('entries.tab.noTeams')}</p>
      ) : (
        <>
          {myTeams.length > 1 && !organiserLayout && (
            <div role="group" aria-label={t('entries.tab.chooseTeam')} className="mg-chips !flex-wrap !overflow-visible">
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
      {exportFooter}
      {toolsSheet}
    </div>
  );
}
