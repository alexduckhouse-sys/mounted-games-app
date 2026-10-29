import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n/LanguageContext';
import { Notice } from '../../components/Notice';
import { TickerNumber } from '../../components/TickerNumber';
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
  const t = useT();
  const [readiness, setReadiness] = useState<CompetitionReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ticks the organiser has made that the server hasn't confirmed yet (key -> wanted state). They show at once,
  // and one save at a time carries them, so ticking one item never locks the others.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const pendingRef = useRef<Record<string, boolean>>({});
  const readinessRef = useRef<CompetitionReadiness | null>(null);
  const sending = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    setLoadFailed(false);
    try {
      const { data } = await api.get<CompetitionReadiness>(`/competitions/${competition.id}/operations/readiness`);
      readinessRef.current = data;
      setReadiness(data);
    } catch (caught) {
      setError(apiMessage(caught, t('ops.equip.loadError')));
      setLoadFailed(true);
    }
  }, [competition.id, t]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const lines = useMemo(() => equipmentLines(readiness?.equipmentChecklist ?? []), [readiness]);
  const acknowledged = useMemo(() => new Set((readiness?.equipmentChecklist ?? []).filter((item) => item.acknowledged).map((item) => item.key)), [readiness]);

  function setPendingNow(next: Record<string, boolean>) {
    pendingRef.current = next;
    setPending(next);
  }

  /** Sends the waiting ticks, one request at a time; whatever was ticked meanwhile goes in the next one. */
  async function pump() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      while (readinessRef.current && Object.keys(pendingRef.current).length > 0) {
        const current = readinessRef.current;
        const sent = { ...pendingRef.current };
        const server = new Set(current.equipmentChecklist.filter((item) => item.acknowledged).map((item) => item.key));
        for (const [key, on] of Object.entries(sent)) { if (on) server.add(key); else server.delete(key); }
        try {
          const { data } = await api.put<CompetitionReadiness>(`/competitions/${competition.id}/operations/equipment-acknowledgements`,
            { acknowledgedKeys: [...server], expectedFingerprint: current.equipmentFingerprint });
          readinessRef.current = data;
          setReadiness(data);
          // Keep any tick that changed while this save was away.
          const rest = Object.fromEntries(Object.entries(pendingRef.current).filter(([key, on]) => !(key in sent) || sent[key] !== on));
          setPendingNow(rest);
        } catch (caught) {
          const status = (caught as { response?: { status?: number } })?.response?.status;
          const undone = new Set(Object.keys(pendingRef.current));
          setPendingNow({});
          if (status === 409) {
            await load();
            setRefreshed(apiMessage(caught, t('ops.equip.changed')));
          } else {
            const names = lines.filter((line) => line.keys.some((key) => undone.has(key))).map((line) => line.label);
            setError(t('ops3.plan.equip.rolledBack', { names: names.join(', ') || t('ops3.plan.equip.thatTick') }));
          }
          break;
        }
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function toggle(keys: string[], on: boolean) {
    if (!readiness) return;
    setError(null);
    setRefreshed(null);
    const next = { ...pendingRef.current };
    for (const key of keys) next[key] = on;
    setPendingNow(next);
    void pump();
  }

  const groups = [
    { name: t('ops.equip.big'), rows: lines.filter((line) => line.big) },
    { name: t('ops.equip.little'), rows: lines.filter((line) => !line.big) },
  ].filter((group) => group.rows.length > 0);
  const isOn = (keys: string[]) => keys.every((key) => (key in pending ? pending[key] : acknowledged.has(key)));

  return (
    <RefinePage>
      <RefineHeader back={`/competitions/${competition.id}/operations`} backLabel={t('ops.hub.back')} context={competition.name} title={t('ops.area.equipment')} />
      <div className="ops-cards ops-tt ops-equip" aria-busy={busy}>
        {error && <Notice actionLabel={loadFailed ? t('common.tryAgain') : undefined} onAction={() => void load()}>{error}</Notice>}
        {refreshed && <Notice tone="info">{refreshed}</Notice>}
        {!readiness && !error && <p role="status" className="rf-note">{t('common.loading')}</p>}
        {readiness && lines.length === 0 && <RefineNote>{t('ops.equip.empty')}</RefineNote>}
        {groups.map((group) => (
          <Fragment key={group.name}>
            <h2 className="rf-sec ops-tt-head"><span>{group.name}</span><span><TickerNumber value={group.rows.filter((row) => isOn(row.keys)).length} format={String} />{t('ops.equip.ofTotal', { total: group.rows.length })}</span></h2>
            <RefineList as="div" label={group.name}>
              {group.rows.map((row) => {
                const on = isOn(row.keys);
                return (
                  <label key={row.name} className="rf-row ops-check">
                    <input type="checkbox" checked={on} onChange={(event) => toggle(row.keys, event.target.checked)} />
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
