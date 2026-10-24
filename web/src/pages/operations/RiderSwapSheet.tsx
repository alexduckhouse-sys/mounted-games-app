import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import type { DeclarationForm } from '../../types';
import { RefineDisclosure, RefineList, RefineNote, RefineSheet } from '../refine/Refine';
import type { RiderSwap, TeamEntry } from './types';
import { apiMessage, isOffline, newRequestId, statusOf } from './types';
import './operations.css';

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function swapLine(swap: RiderSwap): string {
  const out = swap.before.find((rider) => rider.riderEntryId === swap.outRiderEntryId)?.fullName ?? 'A rider';
  const incoming = swap.before.find((rider) => rider.riderEntryId === swap.inRiderEntryId)?.fullName
    ?? swap.after.find((rider) => rider.riderEntryId === swap.inRiderEntryId)?.fullName
    ?? 'a reserve';
  return `${incoming} in for ${out}`;
}

/** Bring a reserve in for a rider on the team's current declaration, or record a Referee-approved emergency replacement. */
export function RiderSwapSheet({ competitionId, team, canWrite, onClose, onSwapped }: {
  competitionId: number;
  team: TeamEntry;
  canWrite: boolean;
  onClose: () => void;
  onSwapped: (message: string) => void;
}) {
  const [form, setForm] = useState<DeclarationForm | null | undefined>(undefined);
  const [history, setHistory] = useState<RiderSwap[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outId, setOutId] = useState<number | null>(null);
  const [inId, setInId] = useState<number | null>(null);
  const [replacementRider, setReplacementRider] = useState('');
  const [replacementPony, setReplacementPony] = useState('');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data } = await api.get<DeclarationForm[]>('/declaration-forms', { params: { competitionId, teamId: team.teamId } });
      // The API lists newest first; the newest is the team's current declaration.
      const current = Array.isArray(data) && data.length > 0 ? data[0] : null;
      setForm(current);
      if (current) {
        const hasReserve = current.riders.some((r) => r.isReserve);
        if (!hasReserve) setInId(0);
        const swaps = await api.get<RiderSwap[]>(`/competitions/${competitionId}/declaration-forms/${current.id}/swaps`);
        setHistory(Array.isArray(swaps.data) ? swaps.data : []);
      }
    } catch (failure) {
      setForm(undefined);
      setLoadError(isOffline(failure)
        ? 'You appear to be offline. Riders need a connection. Try again when you have signal.'
        : apiMessage(failure, 'Couldn’t load the declaration. Try again.'));
    }
  }, [competitionId, team.teamId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const riders = form ? [...form.riders].sort((a, b) => a.orderIndex - b.orderIndex) : [];
  const riding = riders.filter((rider) => !rider.isReserve);
  const reserves = riders.filter((rider) => rider.isReserve);
  const isEmergency = inId === 0 || reserves.length === 0;
  const effectiveInId = reserves.length === 0 ? 0 : inId;
  const emergencyReady = !isEmergency || (Boolean(replacementRider.trim() || replacementPony.trim()) && Boolean(reason.trim()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || busy || outId == null || effectiveInId == null) return;
    if (form.isLocked && !override) { setError('This declaration is locked. Tick the override box to change it.'); return; }
    if ((form.isLocked || isEmergency) && !reason.trim()) { setError('Give a reason (e.g. Referee approval) to record this change.'); return; }
    if (isEmergency && !replacementRider.trim() && !replacementPony.trim()) {
      setError('Enter the replacement rider name or replacement pony name.');
      return;
    }
    const formattedReason = isEmergency
      ? `[Emergency: ${replacementRider.trim()}${replacementPony.trim() ? ` | ${replacementPony.trim()}` : ''}] ${reason.trim()}`
      : (reason.trim() || null);
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<RiderSwap>(`/competitions/${competitionId}/declaration-forms/${form.id}/swap`, {
        outRiderEntryId: outId,
        inRiderEntryId: effectiveInId,
        reason: formattedReason,
        overrideLock: form.isLocked && override,
        requestId,
      });
      onSwapped(`${team.teamName}: ${swapLine(data)}.`);
      onClose();
    } catch (failure) {
      const status = statusOf(failure);
      setError(isOffline(failure)
        ? 'The connection dropped, so we can’t tell whether the swap went through. Tap Swap again. It can’t apply twice.'
        : apiMessage(failure, status === 409 ? 'This declaration can’t be changed that way.' : 'Couldn’t swap the rider. Try again.'));
      if (!isOffline(failure)) setRequestId(newRequestId());
    } finally {
      setBusy(false);
    }
  }

  return (
    <RefineSheet title={`Swap a rider: ${team.teamName}`} onClose={onClose}>
      {form === undefined && !loadError && <p role="status" className="rf-note">Loading the declaration…</p>}
      {loadError && <p role="alert" className="mg-notice ops-alert">{loadError} <button type="button" className="rf-btn rf-btn-text" onClick={() => void load()}>Try again</button></p>}
      {form === null && <RefineNote>This team hasn’t submitted a declaration yet, so there is nobody to swap.</RefineNote>}
      {form && reserves.length === 0 && (
        <RefineNote>The declaration lists no reserve. Record an emergency rider or pony replacement below.</RefineNote>
      )}
      {form && (
        <form className="ops-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="ops-pick">
            <legend>Rider coming out</legend>
            {riding.map((rider) => (
              <label key={rider.id} className="rf-row ops-check"><input type="radio" name="swap-out" checked={outId === rider.id} onChange={() => setOutId(rider.id)} /> <span className="rf-grow">{rider.fullName}{rider.isCaptain ? ' (captain)' : ''}</span></label>
            ))}
          </fieldset>
          {reserves.length > 0 && (
            <fieldset className="ops-pick">
              <legend>Reserve coming in</legend>
              {reserves.map((rider) => (
                <label key={rider.id} className="rf-row ops-check"><input type="radio" name="swap-in" checked={inId === rider.id} onChange={() => setInId(rider.id)} /> <span className="rf-grow">{rider.fullName}</span></label>
              ))}
              <label className="rf-row ops-check">
                <input type="radio" name="swap-in" checked={inId === 0} onChange={() => setInId(0)} />
                <span className="rf-grow">Emergency replacement (rider or pony)</span>
              </label>
            </fieldset>
          )}
          {isEmergency && (
            <div className="flex flex-col gap-2">
              <label className="rf-fld">Replacement rider name
                <input placeholder="Leave blank for pony-only swap" value={replacementRider} onChange={(event) => setReplacementRider(event.target.value)} />
              </label>
              <label className="rf-fld">Replacement pony name
                <input placeholder="Replacement pony" value={replacementPony} onChange={(event) => setReplacementPony(event.target.value)} />
              </label>
            </div>
          )}
          <label className="rf-fld">Reason{form.isLocked || isEmergency ? '' : ' (optional)'}
            <textarea className="ops-note-input" placeholder={isEmergency ? 'e.g. Referee approved — lame pony' : undefined} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          </label>
          {form.isLocked && (
            <label className="rf-row ops-check">
              <input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} />
              <span className="rf-grow">Override the lock<span className="rf-t2">Locked declaration.</span></span>
            </label>
          )}
          {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}
          <div className="rf-actions">
            <button type="button" className="rf-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="rf-btn rf-btn-primary rf-grow" disabled={busy || !canWrite || outId == null || effectiveInId == null || !emergencyReady}>{busy ? 'Swapping…' : 'Swap rider'}</button>
          </div>
        </form>
      )}
      {history.length > 0 && (
        <div className="ops-gap">
          <RefineList as="div">
            <RefineDisclosure title="Swap history" trailing={<span className="rf-t2">{history.length}</span>}>
              <ul className="ops-done">
                {history.map((swap) => (
                  <li key={swap.id} className="rf-row ops-history">
                    <span className="rf-grow">
                      <span className="rf-t1">{swapLine(swap)}</span>
                      <span className="rf-t2">{when(swap.createdAt)}{swap.overrodeLock ? ' · lock overridden' : ''}</span>
                      {swap.reason && <span className="rf-t2 ops-reason">{swap.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </RefineDisclosure>
          </RefineList>
        </div>
      )}
    </RefineSheet>
  );
}
