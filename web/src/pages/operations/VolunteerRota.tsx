import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/LanguageContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { dutySessions, heatCount, heatDutySummary } from '../../lib/heatDuties';
import { VOLUNTEER_ROLE_PRESETS } from '../../lib/lorryAndVolunteers';
import { apiErrorMessage } from '../../lib/apiError';
import type { CompetitionDetail, CreateVolunteerShiftInput, VolunteerShift } from '../../types';
import { Chevron, RefineChoiceRow, RefineList, RefineNote, RefineQty, RefineSection } from '../refine/Refine';
import { ShareTextButtons } from './ShareTextButtons';
import {
  claimVolunteerShift, createVolunteerShift, deleteVolunteerShift, fetchVolunteerShifts, groupShiftsBySession, isRotaShift,
  rotaSummaryText, unclaimVolunteerShift, unfilledShareText, unfilledShifts, updateVolunteerShift,
} from './rotaShifts';
import './operations.css';

const WHOLE_EVENT = 'event';

/** The stored role stays the English preset; only what the organiser reads is translated. */
const ROLE_PRESET_KEYS: Record<(typeof VOLUNTEER_ROLE_PRESETS)[number], MessageKey> = {
  'Ring Crew': 'site.volunteers.preset.ringCrew',
  'Line Judge': 'site.volunteers.preset.lineJudge',
  'Collecting Ring': 'site.volunteers.preset.collectingRing',
  'Tack Steward': 'site.volunteers.preset.tackSteward',
  'Gate Steward': 'site.volunteers.preset.gateSteward',
  'First Aid Liaison': 'site.volunteers.preset.firstAid',
};

interface Draft { id: number | null; role: string; session: string; time: string; notes: string; places: number }
const blank = (): Draft => ({ id: null, role: VOLUNTEER_ROLE_PRESETS[0], session: WHOLE_EVENT, time: '', notes: '', places: 1 });

/**
 * The volunteer rota: shifts by session and who has taken them. Everyone can read it. Signed-in volunteers take or give back a place;
 * organisers (`manage`) also add, change and remove shifts and send the unfilled ones on. Steward duties live on the duty board instead.
 */
export function VolunteerRota({ competition, manage }: { competition: CompetitionDetail; manage: boolean }) {
  const t = useT();
  const { user } = useAuth();
  const [shifts, setShifts] = useState<VolunteerShift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'form' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dutySummary, setDutySummary] = useState<ReturnType<typeof heatDutySummary> | null>(null);
  const id = competition.id;

  useEffect(() => {
    let active = true;
    fetchVolunteerShifts(id).then(
      (data) => { if (active) { setShifts(data.filter(isRotaShift)); setDutySummary(heatDutySummary(data, heatCount(dutySessions(competition.sessions)))); setError(null); } },
      (caught) => { if (active) { setError(apiErrorMessage(caught, t('site.volunteers.loadFailed'))); setShifts((current) => current ?? []); } },
    );
    return () => { active = false; };
  // The summary is worked out from the first load; the sessions only matter for the heat count.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t]);

  const sessions = useMemo(() => competition.sessions.filter((s) => !s.isBreak).slice().sort((a, b) => a.orderIndex - b.orderIndex), [competition.sessions]);
  const list = useMemo(() => shifts ?? [], [shifts]);
  const groups = useMemo(() => groupShiftsBySession(list, sessions), [list, sessions]);
  const needed = unfilledShifts(list);
  const replace = (next: VolunteerShift) => setShifts((current) => (current ?? []).map((s) => (s.id === next.id ? next : s)));

  async function act(shiftId: number, failure: string, work: () => Promise<void>) {
    setBusy(shiftId);
    setError(null);
    try { await work(); } catch (caught) { setError(apiErrorMessage(caught, failure)); } finally { setBusy(null); }
  }

  const take = (shift: VolunteerShift) => act(shift.id, t('site.volunteers.takeFailed'), async () => replace(await claimVolunteerShift(id, shift.id)));
  const giveBack = (shift: VolunteerShift, claimId: number) => act(shift.id, t('site.volunteers.giveFailed'), async () => replace(await unclaimVolunteerShift(id, shift.id, claimId)));

  async function removeClaim(shift: VolunteerShift, claimId: number, name: string) {
    if (!(await confirmDialog({ title: t('site.volunteers.removeTitle', { name, role: shift.role }), message: t('site.volunteers.removeMessage'), confirmLabel: t('site.volunteers.removeLabel'), destructive: true }))) return;
    await giveBack(shift, claimId);
  }

  async function removeShift(shift: VolunteerShift) {
    const people = shift.claimedCount > 0 ? ` ${t('site.volunteers.deletePeople', { count: shift.claimedCount })}` : '';
    if (!(await confirmDialog({ title: t('site.volunteers.deleteTitle', { role: shift.role }), message: `${t('site.volunteers.deleteMessage')}${people}`, confirmLabel: t('site.volunteers.deleteLabel'), destructive: true }))) return;
    await act(shift.id, t('site.volunteers.deleteFailed'), async () => {
      await deleteVolunteerShift(id, shift.id);
      setShifts((current) => (current ?? []).filter((s) => s.id !== shift.id));
    });
  }

  function edit(shift: VolunteerShift) {
    setDraft({ id: shift.id, role: shift.role, session: shift.sessionId == null ? WHOLE_EVENT : String(shift.sessionId), time: shift.startTimeLabel ?? '', notes: shift.notes ?? '', places: shift.requiredCount });
  }

  async function save() {
    if (!draft) return;
    if (!draft.role.trim()) { setError(t('site.volunteers.needRole')); return; }
    const body: CreateVolunteerShiftInput = {
      role: draft.role.trim(),
      sessionId: draft.session === WHOLE_EVENT ? null : Number(draft.session),
      startTimeLabel: draft.time.trim() || null,
      notes: draft.notes.trim() || null,
      requiredCount: draft.places,
    };
    setBusy('form');
    setError(null);
    try {
      const saved = draft.id === null ? await createVolunteerShift(id, body) : await updateVolunteerShift(id, draft.id, body);
      setShifts((current) => (draft.id === null ? [...(current ?? []), saved] : (current ?? []).map((s) => (s.id === saved.id ? saved : s))));
      setDraft(null);
    } catch (caught) { setError(apiErrorMessage(caught, t('site.volunteers.saveFailed'))); }
    finally { setBusy(null); }
  }

  const link = `${window.location.origin}/competitions/${id}/volunteers`;
  const sessionOptions = [{ value: WHOLE_EVENT, label: t('site.volunteers.wholeEvent') }, ...sessions.map((s) => ({ value: String(s.id), label: s.name }))];

  return (
    <div className="ops-cards" aria-busy={busy !== null}>
      {manage && (
        <RefineList as="div">
          <Link to={`/competitions/${id}/operations/heat-duties`} className="rf-row">
            <span className="rf-grow">
              <span className="rf-t1">{t('duties.title')}</span>
              <span className="rf-t2">{dutySummary === null ? t('common.loading') : dutySummary.heats === 0 ? t('duties.row.noHeats') : dutySummary.started ? t('duties.row.summary', { filled: dutySummary.filled, total: dutySummary.heats }) : t('duties.row.none')}</span>
            </span>
            <Chevron />
          </Link>
        </RefineList>
      )}
      {error && <Notice>{error}</Notice>}
      {shifts === null && <p role="status" className="rf-note">{t('site.volunteers.loading')}</p>}
      {list.length > 0 && <RefineNote>{rotaSummaryText(list)}</RefineNote>}
      {!user && list.length > 0 && <Notice tone="info" actionLabel={t('common.signIn')} actionTo="/login">{t('site.volunteers.signInToTake')}</Notice>}

      {groups.map((group) => (
        <section key={group.key} aria-label={group.title}>
          <RefineSection title={group.title} />
          <RefineList as="div">
            {group.shifts.map((shift) => {
              const mine = shift.claims.find((claim) => claim.isMine);
              const busyHere = busy === shift.id;
              return (
                <div key={shift.id} className="rf-row ops-wrap">
                  <span className="rf-grow">
                    <span className="rf-t1">{shift.role}{shift.startTimeLabel ? `, ${shift.startTimeLabel}` : ''}</span>
                    <span className="rf-t2">{shift.isFilled ? t('site.volunteers.full') : t('site.volunteers.placesLeft', { count: shift.remainingCount })} · {t('site.volunteers.taken', { taken: shift.claimedCount, total: shift.requiredCount })}</span>
                    {shift.notes && <span className="rf-t2">{shift.notes}</span>}
                    {shift.claims.length > 0 && (
                      <span className="rf-t2">
                        {shift.claims.map((claim, index) => (
                          <span key={claim.id}>
                            {index > 0 && ', '}
                            {claim.volunteerName}{claim.clubName ? ` (${claim.clubName})` : ''}
                            {manage && !claim.isMine && <> <button type="button" className="ops-danger-link" disabled={busyHere} aria-label={t('site.volunteers.removeAria', { name: claim.volunteerName, role: shift.role })} onClick={() => void removeClaim(shift, claim.id, claim.volunteerName)}>{t('site.volunteers.remove')}</button></>}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {user && mine && <button type="button" className="rf-btn" disabled={busyHere} onClick={() => void giveBack(shift, mine.id)}>{t('site.volunteers.giveBack')}</button>}
                  {user && !mine && !shift.isFilled && <button type="button" className="rf-btn rf-btn-primary" disabled={busyHere} onClick={() => void take(shift)}>{t('site.volunteers.take')}</button>}
                  {manage && <button type="button" className="rf-btn" disabled={busyHere} aria-label={t('site.volunteers.editRole', { role: shift.role })} onClick={() => edit(shift)}>{t('common.edit')}</button>}
                  {manage && <button type="button" className="ops-danger-link" disabled={busyHere} aria-label={t('site.volunteers.deleteRole', { role: shift.role })} onClick={() => void removeShift(shift)}>{t('common.delete')}</button>}
                </div>
              );
            })}
          </RefineList>
        </section>
      ))}
      {shifts !== null && list.length === 0 && !draft && <p className="rf-note">{manage ? t('site.volunteers.emptyManage') : t('site.volunteers.empty')}</p>}

      {manage && (
        <>
          {draft ? (
            <div className="ops-dup" role="group" aria-label={draft.id === null ? t('site.volunteers.newShift') : t('site.volunteers.changeShift')}>
              <RefineChoiceRow label={t('site.volunteers.role')} value={draft.role} options={VOLUNTEER_ROLE_PRESETS.map((role) => ({ value: role, label: t(ROLE_PRESET_KEYS[role]) }))} allowOther onChange={(role) => setDraft({ ...draft, role })} />
              <RefineChoiceRow label={t('site.volunteers.session')} value={draft.session} options={sessionOptions} onChange={(session) => setDraft({ ...draft, session })} />
              <label className="rf-fld">{t('site.volunteers.time')}<input value={draft.time} maxLength={80} placeholder={t('site.volunteers.timePlaceholder')} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
              <label className="rf-fld">{t('site.volunteers.notes')}<input value={draft.notes} maxLength={500} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
              <div className="rf-row"><span className="rf-grow rf-t1">{t('site.volunteers.peopleNeeded')}</span><RefineQty name={t('site.volunteers.peopleNeededName')} value={draft.places} max={50} onChange={(places) => setDraft({ ...draft, places: Math.max(1, places) })} /></div>
              <div className="rf-actions">
                <button type="button" className="rf-btn rf-btn-primary" disabled={busy === 'form'} onClick={() => void save()}>{draft.id === null ? t('site.volunteers.addShift') : t('site.volunteers.saveShift')}</button>
                <button type="button" className="rf-btn" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="ops-addbar ops-addbar-gap" onClick={() => setDraft(blank())}><Plus className="h-4 w-4" aria-hidden="true" />{t('site.volunteers.addAShift')}</button>
          )}

          {needed.length > 0 && (
            <section aria-label={t('site.volunteers.stillNeedAria')}>
              <RefineSection title={t('site.volunteers.stillNeed')} meta={needed.length} />
              <RefineList as="div">
                {needed.map((shift) => (
                  <div key={shift.id} className="rf-row">
                    <span className="rf-grow"><span className="rf-t1">{shift.role}{shift.startTimeLabel ? `, ${shift.startTimeLabel}` : ''}</span><span className="rf-t2">{shift.sessionId == null ? t('site.volunteers.wholeEvent') : shift.sessionName ?? t('site.volunteers.session')} · {t('site.volunteers.placesLeft', { count: shift.remainingCount })}</span></span>
                  </div>
                ))}
                <div className="rf-row ops-wrap">
                  <span className="rf-grow rf-t1">{t('site.volunteers.askForHelp')}</span>
                  <ShareTextButtons title={t('site.volunteers.shareTitle')} name={t('site.volunteers.shareName')} text={unfilledShareText(competition.name, list, sessions, link)} />
                </div>
              </RefineList>
            </section>
          )}
        </>
      )}
      {!manage && <p className="rf-note"><Link to={`/competitions/${id}/details`}>{t('site.volunteers.backToEvent')}</Link></p>}
    </div>
  );
}
