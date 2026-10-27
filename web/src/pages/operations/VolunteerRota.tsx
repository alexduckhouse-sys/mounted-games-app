import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { confirmDialog } from '../../components/ConfirmDialog';
import { Notice } from '../../components/Notice';
import { VOLUNTEER_ROLE_PRESETS } from '../../lib/lorryAndVolunteers';
import { apiErrorMessage } from '../../lib/apiError';
import type { CompetitionDetail, CreateVolunteerShiftInput, VolunteerShift } from '../../types';
import { RefineChoiceRow, RefineList, RefineNote, RefineQty, RefineSection } from '../refine/Refine';
import { ShareTextButtons } from './ShareTextButtons';
import {
  claimVolunteerShift, createVolunteerShift, deleteVolunteerShift, fetchVolunteerShifts, groupShiftsBySession, isRotaShift,
  rotaSummaryText, unclaimVolunteerShift, unfilledShareText, unfilledShifts, updateVolunteerShift,
} from './rotaShifts';
import './operations.css';

const WHOLE_EVENT = 'event';

interface Draft { id: number | null; role: string; session: string; time: string; notes: string; places: number }
const blank = (): Draft => ({ id: null, role: VOLUNTEER_ROLE_PRESETS[0], session: WHOLE_EVENT, time: '', notes: '', places: 1 });

/**
 * The volunteer rota: shifts by session and who has taken them. Everyone can read it. Signed-in volunteers take or give back a place;
 * organisers (`manage`) also add, change and remove shifts and send the unfilled ones on. Steward duties live on the duty board instead.
 */
export function VolunteerRota({ competition, manage }: { competition: CompetitionDetail; manage: boolean }) {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<VolunteerShift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'form' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const id = competition.id;

  useEffect(() => {
    let active = true;
    fetchVolunteerShifts(id).then(
      (data) => { if (active) { setShifts(data.filter(isRotaShift)); setError(null); } },
      (caught) => { if (active) { setError(apiErrorMessage(caught, 'Couldn’t load the volunteer shifts. Check your signal and try again.')); setShifts((current) => current ?? []); } },
    );
    return () => { active = false; };
  }, [id]);

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

  const take = (shift: VolunteerShift) => act(shift.id, 'Couldn’t take that shift. Check your signal and try again.', async () => replace(await claimVolunteerShift(id, shift.id)));
  const giveBack = (shift: VolunteerShift, claimId: number) => act(shift.id, 'Couldn’t give that shift back. Check your signal and try again.', async () => replace(await unclaimVolunteerShift(id, shift.id, claimId)));

  async function removeClaim(shift: VolunteerShift, claimId: number, name: string) {
    if (!(await confirmDialog({ title: `Take ${name} off ${shift.role}?`, message: 'They lose their place on this shift. They are not told.', confirmLabel: 'Take them off', destructive: true }))) return;
    await giveBack(shift, claimId);
  }

  async function removeShift(shift: VolunteerShift) {
    const people = shift.claimedCount > 0 ? ` The ${shift.claimedCount === 1 ? 'person' : `${shift.claimedCount} people`} who signed up lose their place. They are not told.` : '';
    if (!(await confirmDialog({ title: `Delete the ${shift.role} shift?`, message: `It is removed from the rota.${people}`, confirmLabel: 'Delete shift', destructive: true }))) return;
    await act(shift.id, 'Couldn’t delete that shift. Check your signal and try again.', async () => {
      await deleteVolunteerShift(id, shift.id);
      setShifts((current) => (current ?? []).filter((s) => s.id !== shift.id));
    });
  }

  function edit(shift: VolunteerShift) {
    setDraft({ id: shift.id, role: shift.role, session: shift.sessionId == null ? WHOLE_EVENT : String(shift.sessionId), time: shift.startTimeLabel ?? '', notes: shift.notes ?? '', places: shift.requiredCount });
  }

  async function save() {
    if (!draft) return;
    if (!draft.role.trim()) { setError('Give the shift a role.'); return; }
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
    } catch (caught) { setError(apiErrorMessage(caught, 'Couldn’t save that shift. Check your signal and try again.')); }
    finally { setBusy(null); }
  }

  const link = `${window.location.origin}/competitions/${id}/volunteers`;
  const sessionOptions = [{ value: WHOLE_EVENT, label: 'Whole event' }, ...sessions.map((s) => ({ value: String(s.id), label: s.name }))];

  return (
    <div className="ops-cards" aria-busy={busy !== null}>
      {error && <Notice>{error}</Notice>}
      {shifts === null && <p role="status" className="rf-note">Loading the volunteer shifts…</p>}
      {list.length > 0 && <RefineNote>{rotaSummaryText(list)}</RefineNote>}
      {!user && list.length > 0 && <Notice tone="info" actionLabel="Sign in" actionTo="/login">Sign in to take a shift.</Notice>}

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
                    <span className="rf-t2">{shift.isFilled ? 'Full' : `${shift.remainingCount} ${shift.remainingCount === 1 ? 'place' : 'places'} left`} · {shift.claimedCount} of {shift.requiredCount} taken</span>
                    {shift.notes && <span className="rf-t2">{shift.notes}</span>}
                    {shift.claims.length > 0 && (
                      <span className="rf-t2">
                        {shift.claims.map((claim, index) => (
                          <span key={claim.id}>
                            {index > 0 && ', '}
                            {claim.volunteerName}{claim.clubName ? ` (${claim.clubName})` : ''}
                            {manage && !claim.isMine && <> <button type="button" className="ops-danger-link" disabled={busyHere} aria-label={`Take ${claim.volunteerName} off ${shift.role}`} onClick={() => void removeClaim(shift, claim.id, claim.volunteerName)}>Remove</button></>}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {user && mine && <button type="button" className="rf-btn" disabled={busyHere} onClick={() => void giveBack(shift, mine.id)}>Give my place back</button>}
                  {user && !mine && !shift.isFilled && <button type="button" className="rf-btn rf-btn-primary" disabled={busyHere} onClick={() => void take(shift)}>Take this shift</button>}
                  {manage && <button type="button" className="rf-btn" disabled={busyHere} aria-label={`Edit ${shift.role}`} onClick={() => edit(shift)}>Edit</button>}
                  {manage && <button type="button" className="ops-danger-link" disabled={busyHere} aria-label={`Delete ${shift.role}`} onClick={() => void removeShift(shift)}>Delete</button>}
                </div>
              );
            })}
          </RefineList>
        </section>
      ))}
      {shifts !== null && list.length === 0 && !draft && <p className="rf-note">{manage ? 'No shifts yet. Add the jobs you need covered.' : 'The organisers haven’t added any volunteer shifts yet.'}</p>}

      {manage && (
        <>
          {draft ? (
            <div className="ops-dup" role="group" aria-label={draft.id === null ? 'New shift' : 'Change shift'}>
              <RefineChoiceRow label="Role" value={draft.role} options={VOLUNTEER_ROLE_PRESETS.map((role) => ({ value: role, label: role }))} allowOther onChange={(role) => setDraft({ ...draft, role })} />
              <RefineChoiceRow label="Session" value={draft.session} options={sessionOptions} onChange={(session) => setDraft({ ...draft, session })} />
              <label className="rf-fld">Time (optional)<input value={draft.time} maxLength={80} placeholder="For example 9:30 to 12:00" onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
              <label className="rf-fld">Notes (optional)<input value={draft.notes} maxLength={500} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
              <div className="rf-row"><span className="rf-grow rf-t1">People needed</span><RefineQty name="people needed" value={draft.places} max={50} onChange={(places) => setDraft({ ...draft, places: Math.max(1, places) })} /></div>
              <div className="rf-actions">
                <button type="button" className="rf-btn rf-btn-primary" disabled={busy === 'form'} onClick={() => void save()}>{draft.id === null ? 'Add shift' : 'Save shift'}</button>
                <button type="button" className="rf-btn" onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="ops-addbar ops-addrow" onClick={() => setDraft(blank())}><Plus className="h-4 w-4" aria-hidden="true" />Add a shift</button>
          )}

          {needed.length > 0 && (
            <section aria-label="Shifts that still need people">
              <RefineSection title="Still need people" meta={needed.length} />
              <RefineList as="div">
                {needed.map((shift) => (
                  <div key={shift.id} className="rf-row">
                    <span className="rf-grow"><span className="rf-t1">{shift.role}{shift.startTimeLabel ? `, ${shift.startTimeLabel}` : ''}</span><span className="rf-t2">{shift.sessionId == null ? 'Whole event' : shift.sessionName ?? 'Session'} · {shift.remainingCount} {shift.remainingCount === 1 ? 'place' : 'places'} left</span></span>
                  </div>
                ))}
                <div className="rf-row ops-wrap">
                  <span className="rf-grow rf-t1">Ask for help</span>
                  <ShareTextButtons title="Share unfilled shifts" name="Message" text={unfilledShareText(competition.name, list, sessions, link)} />
                </div>
              </RefineList>
            </section>
          )}
        </>
      )}
      {!manage && <p className="rf-note"><Link to={`/competitions/${id}/details`}>Back to the event</Link></p>}
    </div>
  );
}
