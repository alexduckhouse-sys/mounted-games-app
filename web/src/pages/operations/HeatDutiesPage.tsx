import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { useHideChrome } from '../../components/ScreenChrome';
import { useT } from '../../i18n/LanguageContext';
import { apiErrorMessage, apiErrorStatus } from '../../lib/apiError';
import {
  applySetup, buildSavePayload, clearDraft, defaultSetup, dutySessions, freshenDraft, initialSlots, loadDraft, saveDraft, setupFromShifts,
  type DutySession, type RoleSetup, type SlotState,
} from '../../lib/heatDuties';
import type { HeatDutiesConflictResult, SaveHeatDutiesResult, VolunteerShift } from '../../types';
import { useCompetition } from '../competition/context';
import { RefineFoot, RefineHeader, RefinePage } from '../refine/Refine';
import { HeatDutiesCheck } from './HeatDutiesCheck';
import { HeatDutiesHeats } from './HeatDutiesHeats';
import { HeatDutiesRoles } from './HeatDutiesRoles';
import { fetchVolunteerShifts } from './rotaShifts';
import './heatDuties.css';

type Step = 0 | 1 | 2;
interface Model { step: Step; setup: RoleSetup; slots: SlotState }

/** `/competitions/:id/operations/heat-duties`: roles for every heat, a team for each duty, then check and save. */
export function HeatDutiesPage() {
  const t = useT();
  const { competition } = useCompetition();
  const { canOrganise } = useAuth();
  const [shifts, setShifts] = useState<VolunteerShift[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const back = `/competitions/${competition.id}/operations/volunteers`;
  const sessions = useMemo(() => dutySessions(competition.sessions), [competition.sessions]);

  useEffect(() => {
    let active = true;
    fetchVolunteerShifts(competition.id).then(
      (data) => { if (active) { setShifts(data); setLoadError(null); } },
      (caught) => { if (active) setLoadError(apiErrorMessage(caught, t('duties.loadFailed'))); },
    );
    return () => { active = false; };
    // `t` changes only with the language; reloading the shifts for that would be wasted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competition.id, attempt]);

  const header = (step: Step | null) => (
    <RefineHeader back={back} backLabel={t('duties.back')} context={competition.name} title={t('duties.title')}>
      {step !== null && <Progress step={step} />}
    </RefineHeader>
  );

  if (!canOrganise(competition)) return <RefinePage>{header(null)}<Notice>{t('duties.notAllowed')}</Notice></RefinePage>;
  if (sessions.length === 0) return <RefinePage>{header(null)}<Notice tone="info">{t('duties.noHeats')}</Notice></RefinePage>;
  if (loadError) return <RefinePage>{header(null)}<Notice actionLabel={t('common.tryAgain')} onAction={() => { setLoadError(null); setAttempt((n) => n + 1); }}>{loadError}</Notice></RefinePage>;
  if (shifts === null) return <RefinePage>{header(null)}<p role="status" className="rf-note">{t('duties.loading')}</p></RefinePage>;
  return <Wizard shifts={shifts} sessions={sessions} back={back} />;
}

function Progress({ step }: { step: Step }) {
  const t = useT();
  const names = [t('duties.step.roles'), t('duties.step.heats'), t('duties.step.check')];
  return (
    <div className="hd-prog">
      <p className="hd-prog-text">{t('duties.step.label', { step: step + 1, name: names[step] })}</p>
      <ol aria-label={t('duties.progress')}>
        {names.map((name, index) => <li key={name} data-state={index < step ? 'done' : index === step ? 'current' : 'todo'} aria-current={index === step ? 'step' : undefined}><span className="hd-sr">{name}</span></li>)}
      </ol>
    </div>
  );
}

function Wizard({ shifts, sessions, back }: { shifts: VolunteerShift[]; sessions: readonly DutySession[]; back: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { competition } = useCompetition();
  const id = competition.id;
  const [model, setModel] = useState<Model>(() => {
    const draft = loadDraft(id);
    if (draft) return { step: draft.step, setup: draft.setup, slots: freshenDraft(draft, sessions) };
    const setup = shifts.some((shift) => shift.heatId != null) ? setupFromShifts(shifts, sessions) : defaultSetup(sessions);
    return { step: 0, setup, slots: initialSlots(sessions, setup, shifts) };
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A focused set-up job: the app header and ticker dock step aside so the steps and the Back/Next buttons have the screen.
  useHideChrome(true);

  // The draft follows the wizard, but only once the organiser has changed something, so opening the page never hides newer saved duties.
  useEffect(() => {
    if (dirty) saveDraft(id, { v: 1, step: model.step, setup: model.setup, slots: model.slots.slots, overridden: model.slots.overridden });
  }, [dirty, id, model]);

  const change = useCallback((update: (current: Model) => Model) => { setDirty(true); setModel(update); }, []);
  const go = (step: Step) => { setError(null); change((current) => ({ ...current, step })); window.scrollTo?.({ top: 0 }); };

  async function save() {
    setSaving(true);
    setError(null);
    const order = sessions.flatMap((item) => item.heats.map((heat) => heat.id));
    const sessionIds = sessions.map((item) => item.session.id);
    const send = (confirm: boolean) => api.put<SaveHeatDutiesResult>(`/competitions/${id}/heat-duties`, buildSavePayload(model.slots.slots, order, sessionIds, confirm));
    try {
      try {
        await send(false);
      } catch (caught) {
        if (apiErrorStatus(caught) !== 409) throw caught;
        const conflict = (caught as { response?: { data?: HeatDutiesConflictResult } }).response?.data;
        const count = conflict?.checkedInShifts?.length ?? 0;
        const agreed = await confirmDialog({ title: t('duties.confirm.title'), message: t('duties.confirm.message', { count }), confirmLabel: t('duties.confirm.button'), destructive: true });
        if (!agreed) { setSaving(false); return; }
        await send(true);
      }
      clearDraft(id);
      setDirty(false);
      navigate(back, { state: { dutiesSaved: true } });
    } catch (caught) {
      setError(apiErrorMessage(caught, t('duties.save.failed')));
      setSaving(false);
    }
  }

  const { step, setup, slots } = model;
  return (
    <RefinePage>
      <RefineHeader back={back} backLabel={t('duties.back')} context={competition.name} title={t('duties.title')}><Progress step={step} /></RefineHeader>
      {error && <Notice>{error}</Notice>}
      {step === 0 && <HeatDutiesRoles setup={setup} sessions={sessions} onChange={(next) => change((m) => ({ ...m, setup: next, slots: applySetup(m.slots, sessions, next) }))} />}
      {step === 1 && <HeatDutiesHeats competitionId={id} sessions={sessions} setup={setup} state={slots} teams={competition.teams} onChange={(next) => change((m) => ({ ...m, slots: next }))} />}
      {step === 2 && <HeatDutiesCheck sessions={sessions} state={slots} teams={competition.teams} />}
      <RefineFoot aboveTabs>
        {step === 0 ? <button type="button" className="rf-btn hd-foot-btn" onClick={() => navigate(back)}>{t('common.cancel')}</button>
          : <button type="button" className="rf-btn hd-foot-btn" disabled={saving} onClick={() => go((step - 1) as Step)}>{t('common.back')}</button>}
        {step < 2
          ? <button type="button" className="rf-btn rf-btn-primary hd-foot-btn hd-foot-main" onClick={() => go((step + 1) as Step)}>{step === 0 ? t('duties.next.heats') : t('duties.next.check')}</button>
          : <button type="button" className="rf-btn rf-btn-primary hd-foot-btn hd-foot-main" disabled={saving} onClick={() => void save()}>{saving ? t('common.saving') : t('duties.save')}</button>}
      </RefineFoot>
    </RefinePage>
  );
}
