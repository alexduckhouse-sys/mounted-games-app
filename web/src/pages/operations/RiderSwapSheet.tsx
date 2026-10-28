import { useT } from '../../i18n/LanguageContext';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { activeLocale, tr } from '../../i18n/translate';
import type { DeclarationForm } from '../../types';
import { RefineDisclosure, RefineList, RefineNote, RefineSheet } from '../refine/Refine';
import type { RiderSwap, TeamEntry } from './types';
import { apiMessage, isOffline, newRequestId, statusOf } from './types';
import { Notice } from '../../components/Notice';
import './operations.css';

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(activeLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function swapLine(swap: RiderSwap): string {
  const out = swap.before.find((rider) => rider.riderEntryId === swap.outRiderEntryId)?.fullName ?? tr('ops2.swap.aRider');
  if (swap.outRiderEntryId === swap.inRiderEntryId) {
    return `${out} (${swap.reason})`;
  }
  const incoming = swap.before.find((rider) => rider.riderEntryId === swap.inRiderEntryId)?.fullName
    ?? swap.after.find((rider) => rider.riderEntryId === swap.inRiderEntryId)?.fullName
    ?? tr('ops2.swap.aReserve');
  return tr('ops2.swap.inFor', { incoming, out });
}

/** Bring a reserve in for a rider on the team's current declaration, or record a Referee-approved emergency replacement. */
export function RiderSwapSheet({ competitionId, team, canWrite, onClose, onSwapped }: {
  competitionId: number;
  team: TeamEntry;
  canWrite: boolean;
  onClose: () => void;
  onSwapped: (message: string) => void;
}) {
  const t = useT();
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
        ? t('ops2.offline')
        : apiMessage(failure, t('ops2.swap.loadError')));
    }
  }, [competitionId, team.teamId, t]);

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
    if (form.isLocked && !override) { setError(t('ops2.swap.locked')); return; }
    if ((form.isLocked || isEmergency) && !reason.trim()) { setError(t('ops2.swap.giveReason')); return; }
    if (isEmergency && !replacementRider.trim() && !replacementPony.trim()) {
      setError(t('ops2.swap.enterName'));
      return;
    }
    const rawReason = isEmergency
      ? `[Emergency: ${replacementRider.trim()}${replacementPony.trim() ? ` | ${replacementPony.trim()}` : ''}] ${reason.trim()}`
      : (reason.trim() || null);
    const formattedReason = rawReason && rawReason.length > 500 ? rawReason.slice(0, 500) : rawReason;
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
        ? t('ops2.swap.dropped')
        : apiMessage(failure, status === 409 ? t('ops2.swap.conflict') : t('ops2.swap.error')));
      if (!isOffline(failure)) setRequestId(newRequestId());
    } finally {
      setBusy(false);
    }
  }

  return (
    <RefineSheet title={t('ops2.swap.title', { name: team.teamName })} onClose={onClose}>
      {form === undefined && !loadError && <p role="status" className="rf-note">{t('ops2.swap.loading')}</p>}
      {loadError && <Notice actionLabel={t('common.tryAgain')} onAction={() => void load()}>{loadError}</Notice>}
      {form === null && <RefineNote>{t('ops2.swap.noDec')}</RefineNote>}
      {form && reserves.length === 0 && (
        <RefineNote>{t('ops2.swap.noReserve')}</RefineNote>
      )}
      {form && (
        <form className="ops-form" onSubmit={(event) => void submit(event)}>
          <fieldset className="ops-pick">
            <legend>{t('ops2.swap.out')}</legend>
            {riding.map((rider) => (
              <label key={rider.id} className="rf-row ops-check"><input type="radio" name="swap-out" checked={outId === rider.id} onChange={() => setOutId(rider.id)} /> <span className="rf-grow">{rider.fullName}{rider.isCaptain ? ` (${t('ops2.swap.captain')})` : ''}</span></label>
            ))}
          </fieldset>
          {reserves.length > 0 && (
            <fieldset className="ops-pick">
              <legend>{t('ops2.swap.in')}</legend>
              {reserves.map((rider) => (
                <label key={rider.id} className="rf-row ops-check"><input type="radio" name="swap-in" checked={inId === rider.id} onChange={() => setInId(rider.id)} /> <span className="rf-grow">{rider.fullName}</span></label>
              ))}
              <label className="rf-row ops-check">
                <input type="radio" name="swap-in" checked={inId === 0} onChange={() => setInId(0)} />
                <span className="rf-grow">{t('ops2.swap.emergency')}</span>
              </label>
            </fieldset>
          )}
          {isEmergency && (
            <div className="flex flex-col gap-2">
              <label className="rf-fld">{t('ops2.swap.repRider')}
                <input placeholder={t('ops2.swap.repRiderPh')} value={replacementRider} onChange={(event) => setReplacementRider(event.target.value)} />
              </label>
              <label className="rf-fld">{t('ops2.swap.repPony')}
                <input placeholder={t('ops2.swap.repPonyPh')} value={replacementPony} onChange={(event) => setReplacementPony(event.target.value)} />
              </label>
            </div>
          )}
          <label className="rf-fld">{form.isLocked || isEmergency ? t('ops2.panel.reasonLabel') : t('ops2.panel.reasonOptional')}
            <textarea className="ops-note-input" placeholder={isEmergency ? t('ops2.swap.reasonPh') : undefined} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          </label>
          {form.isLocked && (
            <label className="rf-row ops-check">
              <input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} />
              <span className="rf-grow">{t('ops2.swap.override')}<span className="rf-t2">{t('ops2.swap.lockedDec')}</span></span>
            </label>
          )}
          {error && <Notice>{error}</Notice>}
          <div className="rf-actions">
            <button type="button" className="rf-btn" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="rf-btn rf-btn-primary rf-grow" disabled={busy || !canWrite || outId == null || effectiveInId == null || !emergencyReady}>{busy ? t('ops2.swap.swapping') : t('ops2.panel.swap')}</button>
          </div>
        </form>
      )}
      {history.length > 0 && (
        <div className="ops-gap">
          <RefineList as="div">
            <RefineDisclosure title={t('ops2.swap.history')} trailing={<span className="rf-t2">{history.length}</span>}>
              <ul className="ops-done">
                {history.map((swap) => (
                  <li key={swap.id} className="rf-row ops-history">
                    <span className="rf-grow">
                      <span className="rf-t1">{swapLine(swap)}</span>
                      <span className="rf-t2">{when(swap.createdAt)}{swap.overrodeLock ? ` · ${t('ops2.swap.overridden')}` : ''}</span>
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
