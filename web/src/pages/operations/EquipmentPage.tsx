import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useCompetition } from '../competition/context';
import { RefineHeader, RefineList, RefineNote, RefinePage } from '../refine/Refine';
import { equipmentLines } from './equipment';
import type { CompetitionReadiness } from './types';
import { apiMessage } from './types';
import './operations.css';

/** Equipment: what to put out, big kit then little kit. Ticking a row saves straight away. */
export function EquipmentPage() {
  const { competition } = useCompetition();
  const [readiness, setReadiness] = useState<CompetitionReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await api.get<CompetitionReadiness>(`/competitions/${competition.id}/operations/readiness`);
      setReadiness(data);
    } catch (caught) {
      setError(apiMessage(caught, 'Couldn’t load the equipment list. Try again.'));
    }
  }, [competition.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const lines = useMemo(() => equipmentLines(readiness?.equipmentChecklist ?? []), [readiness]);
  const acknowledged = useMemo(() => new Set((readiness?.equipmentChecklist ?? []).filter((item) => item.acknowledged).map((item) => item.key)), [readiness]);

  async function toggle(keys: string[], on: boolean) {
    if (!readiness || busy) return;
    const next = new Set(acknowledged);
    for (const key of keys) { if (on) next.add(key); else next.delete(key); }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.put<CompetitionReadiness>(`/competitions/${competition.id}/operations/equipment-acknowledgements`,
        { acknowledgedKeys: [...next], expectedFingerprint: readiness.equipmentFingerprint });
      setReadiness(data);
    } catch (caught) {
      const status = (caught as { response?: { status?: number } })?.response?.status;
      if (status === 409) await load();
      setError(apiMessage(caught, status === 409 ? 'The list changed on another device, so it has been refreshed.' : 'Couldn’t save that tick. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const groups = [
    { name: 'Big equipment', rows: lines.filter((line) => line.big) },
    { name: 'Little equipment', rows: lines.filter((line) => !line.big) },
  ].filter((group) => group.rows.length > 0);
  const isOn = (keys: string[]) => keys.every((key) => acknowledged.has(key));

  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel="Back to preparations" context={competition.name} title="Equipment" />
      <div className="ops-cards ops-tt ops-equip" aria-busy={busy}>
        {error && <p role="alert" className="mg-notice ops-alert">{error}</p>}
        {!readiness && !error && <p role="status" className="rf-note">Loading…</p>}
        {readiness && lines.length === 0 && <RefineNote>No equipment items were found for the current race list.</RefineNote>}
        {groups.map((group) => (
          <Fragment key={group.name}>
            <h2 className="rf-sec ops-tt-head"><span>{group.name}</span><span>{group.rows.filter((row) => isOn(row.keys)).length} of {group.rows.length}</span></h2>
            <RefineList as="div" label={group.name}>
              {group.rows.map((row) => {
                const on = isOn(row.keys);
                return (
                  <label key={row.name} className="rf-row ops-check">
                    <input type="checkbox" checked={on} disabled={busy} onChange={(event) => void toggle(row.keys, event.target.checked)} />
                    <span className={`rf-grow rf-t1 ${on ? 'ops-struck' : ''}`}>{row.label}</span>
                  </label>
                );
              })}
            </RefineList>
          </Fragment>
        ))}
      </div>
    </RefinePage>
  );
}
